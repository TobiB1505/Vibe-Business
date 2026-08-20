import { sleep } from "workflow";
import { createServiceClient } from "@/lib/supabase/service";
import { createSandboxCodingAgentProvider } from "@/modules/coding-agent/sandbox-runtime/provider";
import { mintInstallationCloneCredential } from "@/modules/github/installation-token";
import { createGithubRepositoryReader } from "@/modules/github/repository-reader";
import {
  createExecutionProbe,
  createGithubGitWritePort,
} from "@/modules/execution/github/adapter";
import { getProjectWithRepository } from "@/modules/projects/queries";
import { createVercelSandboxProvider } from "@/modules/validation/vercel/provider";
import type { AgentCheckName } from "@/modules/coding-agent/schema";
import type { OperationFailureCode } from "../failures";
import type { StoredOperationRun } from "../store";
import { VercelWorkflowExecutor } from "../vercel/executor";
import {
  cleanupAgentWorkspaceStep,
  enqueueValidationStep,
  extractAndVerifyStep,
  finishAgentExecutionStep,
  collectAgentStep,
  pollAgentStep,
  provisionAgentWorkspaceStep,
  startAgentStep,
  writeAgentBranchStep,
  type AgentExecutionDeps,
  type AgentRepositoryTarget,
} from "./execution";

/**
 * The durable agentic execution (EXECUTION CORE-4 §21, §36, §37).
 *
 * ## The step graph
 *
 * ```
 * provision ─▶ start agent ─▶ (sleep ─▶ poll)* ─▶ collect ─▶ extract ─▶ write branch
 *      │            │              │                 │           │           │
 *      └────────────┴──────────────┴─────────────────┴───────────┴───────────┘
 *                                      ▼
 *                                  cleanup ─▶ finish ─▶ enqueue validation
 * ```
 *
 * The last step is the only one outside the failure-carrying discipline below:
 * it runs after the run is already recorded as succeeded, and its own outcome
 * cannot change this workflow's (Sprint 0048).
 *
 * ## Why the agent is watched rather than awaited
 *
 * Because a Vercel step is killed at 300 seconds and the budget authorizes
 * twenty minutes. The first real run hit exactly that: 27 Anthropic calls over
 * five minutes, then `Task timed out after 300 seconds`, leaving a run row
 * reading `turns: 0`, a reservation still held and a sandbox still alive.
 *
 * Lowering the budget to fit the platform would have answered a hosting
 * constraint by giving the customer less. So the harness is detached and the
 * workflow watches it: `sleep()` suspends without holding a function open, and
 * each poll is a step measured in milliseconds. No step in this graph now needs
 * to stay alive for more than a few seconds (ADR 0029, A1).
 *
 * ## Why cleanup is carried in a local rather than by returning early
 *
 * The same reason `changeValidationWorkflow` is written this way, and it was
 * learned the expensive way: an early `return` inside the try block is exactly
 * the shape that leaked a paid VM when a step died at the platform ceiling.
 * Cleanup and finish must happen on **every** path, so failure is carried and
 * the flow falls through.
 *
 * ## Retries
 *
 * `maxRetries = 0` on every step, and there is no exception. The validation
 * workflow allows one — cleanup — because stopping a sandbox is idempotent and
 * "already gone" is a success. That reasoning holds here too, and it is
 * deliberately not taken: this cleanup step *also writes the sandbox usage
 * ledger row*, and a platform retry after a partial failure could double it.
 * A leaked VM expires on the sandbox's own 15-minute lifetime bound; a
 * duplicated ledger row corrupts the first real cost baseline, which is the
 * artifact this sprint exists to produce.
 *
 * Recovery does not come from retries anyway. It comes from persisted state:
 * a resumed workflow reads what is recorded and refuses to redo the paid step,
 * which is a stronger guarantee than a retry budget because it holds no matter
 * how the previous attempt died (§37).
 */

/**
 * Rebuilds everything from the operation's own project row.
 *
 * Nothing comes from client input: not the repository, not the installation,
 * not the commit. A step receives an operation id and re-derives the world from
 * server state, which is what makes "the client cannot choose the repo" a
 * structural fact rather than a validation rule (§53).
 */
async function resolveTarget(
  operation: StoredOperationRun,
  options: { withCloneCredential: boolean },
): Promise<AgentRepositoryTarget | null> {
  const supabase = createServiceClient();

  const project = await getProjectWithRepository(supabase, operation.projectId);
  if (!project?.repository) return null;

  const { owner, name: repo, installationId } = project.repository;
  if (!owner || !repo) return null;

  // Minted only for the step that clones, at the last possible moment, and
  // never persisted. The agent step resolves a target without one: by then the
  // source is on disk and `.git` is gone, so a token would be exposure bought
  // for nothing (§13).
  let cloneCredential: { username: string; password: string } | null = null;
  if (options.withCloneCredential) {
    cloneCredential = await mintInstallationCloneCredential(installationId);
    if (!cloneCredential) return null;
  }

  const repositoryTarget = { installationId, owner, repo };

  return {
    owner,
    repo,
    repositoryUrl: `https://github.com/${owner}/${repo}.git`,
    // Vercel materializes the clone at `/vercel/sandbox/<repo>/`.
    sourceRoot: repo,
    workspaceRoot: "",
    cloneCredential,
    git: createGithubGitWritePort(repositoryTarget),
    // No production origin: an agentic execution has no live-route premise to
    // re-check, so `isServed` has nothing to answer and is never called. Passing
    // null is the honest description rather than inventing an origin.
    probe: createExecutionProbe(repositoryTarget, null),
    // The same bounded reader the analyzer uses. Reading a file at the pinned
    // base commit to compute a diff is an ordinary read, not a new capability.
    base: createGithubRepositoryReader(installationId, owner, repo),
    // The same reader again, for the question `getTextFile` cannot answer:
    // it returns null for a file that is absent, binary, oversized or a
    // directory alike, and only a path the base tree really does contain may be
    // protected from the repository's own ignore rules.
    baseTree: createGithubRepositoryReader(installationId, owner, repo),
  };
}

function deps(): AgentExecutionDeps {
  return {
    supabase: createServiceClient(),
    /*
     * The harness runs in the execution's own microVM, not in this function.
     *
     * Not a preference. `@anthropic-ai/claude-agent-sdk` spawns a native binary
     * of 307–325 MB depending on platform and a Vercel function's whole
     * deployment budget is 250 MB, so the in-process topology is not something
     * this process can offer — the first real run proved it by failing in 44 ms
     * with zero turns.
     *
     * The real adapters, only ever constructed here. Tests inject fakes; there
     * is no local-execution implementation to fall back to (ADR 0015).
     */
    runtime: { build: createSandboxCodingAgentProvider },
    sandboxProvider: createVercelSandboxProvider(),
    resolveTarget,
  };
}

async function provisionWorkspace(operationId: string) {
  "use step";
  return provisionAgentWorkspaceStep(deps(), operationId);
}
// Provisioning buys a billed microVM and its outcome is not knowable from
// outside. A platform retry could buy a second one for the same question.
provisionWorkspace.maxRetries = 0;

async function startAgent(operationId: string, availableChecks: AgentCheckName[]) {
  "use step";
  return startAgentStep(deps(), operationId, availableChecks);
}
// The paid loop's ignition. A retry cannot distinguish "the agent never
// started" from "it started and the outcome was lost", and for a paid provider
// call that ambiguity must resolve to *not starting it again* (§37).
startAgent.maxRetries = 0;

async function pollAgent(operationId: string) {
  "use step";
  return pollAgentStep(deps(), operationId);
}
/*
 * The one step in this workflow that may retry.
 *
 * It is read-only against the sandbox and writes at most a monotonic turn
 * count, so "already done" and "done twice" are the same state. Retrying it is
 * how a transient provider blip stops being a lost twenty-minute run.
 */
pollAgent.maxRetries = 2;

async function collectAgent(operationId: string) {
  "use step";
  return collectAgentStep(deps(), operationId);
}
collectAgent.maxRetries = 0;

/**
 * How often the workflow looks at a running agent.
 *
 * Twenty seconds is a compromise between two costs that pull opposite ways: a
 * shorter interval means a finished run is noticed sooner and its sandbox is
 * released sooner, and a longer one means fewer function invocations across a
 * twenty-minute run. It is not a timeout — nothing fails because a poll was
 * late.
 */
const AGENT_POLL_INTERVAL_MS = 20_000;

/**
 * The hard bound on the loop.
 *
 * Derived from the longest wall clock any budget authorizes plus provisioning
 * slack, divided by the interval. It exists so the loop is finite *in the code*
 * rather than finite because a condition is expected to become true — an
 * unbounded workflow loop is the failure mode that turns one stuck run into a
 * permanent one.
 *
 * Reaching it is itself a failure: the run outlived every bound and is stopped.
 */
const AGENT_MAX_POLLS = Math.ceil((25 * 60_000) / AGENT_POLL_INTERVAL_MS);

type WatchOutcome =
  | { ok: true; expired: boolean }
  | { ok: false; failureCode: OperationFailureCode };

/**
 * Watches a detached agent to completion, in short steps.
 *
 * `sleep()` suspends the workflow without holding a function open, so a
 * twenty-minute run costs sixty brief invocations rather than one that the
 * platform kills at three hundred seconds. That kill is exactly what happened
 * to the first real run: 27 Anthropic calls, five minutes of work, and a run
 * row that still said `turns: 0`.
 *
 * Not a step itself — `sleep` must be called from workflow context.
 */
async function watchAgent(operationId: string): Promise<WatchOutcome> {
  for (let poll = 0; poll < AGENT_MAX_POLLS; poll += 1) {
    await sleep(AGENT_POLL_INTERVAL_MS);

    const observed = await pollAgent(operationId);
    if (!observed.ok) return { ok: false, failureCode: observed.failureCode };
    if (observed.finished) return { ok: true, expired: false };
    if (observed.expired) return { ok: true, expired: true };
  }

  // The loop's own bound, reached. The run has outlived even the slack, so it
  // is treated exactly as an expiry rather than watched forever.
  return { ok: true, expired: true };
}

async function extractChange(operationId: string, observedPaths: string[] | null) {
  "use step";
  return extractAndVerifyStep(deps(), operationId, observedPaths);
}
extractChange.maxRetries = 0;

async function writeBranch(
  operationId: string,
  files: readonly { path: string; content: string; contentHash: string; bytes: number }[],
  candidateDigest: string,
) {
  "use step";
  return writeAgentBranchStep(deps(), operationId, files, candidateDigest);
}
// A consequential external write. Recovery is `prepareChangeOnBranch`'s own
// branch inspection, not a retry that could create a second branch.
writeBranch.maxRetries = 0;

async function cleanupWorkspace(operationId: string) {
  "use step";
  return cleanupAgentWorkspaceStep(deps(), operationId);
}
cleanupWorkspace.maxRetries = 0;

/**
 * Hands the finished change to Independent Validation (Sprint 0048).
 *
 * The last step in the graph, and the only one whose failure is not a failure:
 * by the time it runs the branch is written, the prepared change exists and the
 * credits are settled, so validation not starting leaves exactly the state this
 * workflow produced before this sprint — a change waiting for a click.
 *
 * It calls `startChangeValidation`, the same function the button calls, rather
 * than reproducing any part of it. Every guard, the reuse check and the
 * in-flight check come along, which is also why a second call cannot provision
 * a second sandbox.
 */
async function enqueueValidation(operationId: string) {
  "use step";
  await enqueueValidationStep(deps(), new VercelWorkflowExecutor(), operationId);
}
// Starting a durable run is an external side effect. Recovery is the identity
// guard inside `startChangeValidation`, not a retry — and a missed enqueue
// costs a click rather than a run.
enqueueValidation.maxRetries = 0;

async function finish(
  operationId: string,
  outcome:
    | { kind: "succeeded"; preparedChangeId: string }
    | { kind: "paused" }
    | { kind: "failed"; failureCode: OperationFailureCode },
) {
  "use step";
  await finishAgentExecutionStep(deps(), operationId, outcome);
}

export async function agentExecutionWorkflow(operationId: string) {
  "use workflow";

  let failureCode: OperationFailureCode | null = null;
  let paused = false;
  let preparedChangeId: string | null = null;

  try {
    const provisioned = await provisionWorkspace(operationId);
    if (!provisioned.ok) {
      failureCode = provisioned.failureCode;
    } else {
      const started = await startAgent(operationId, provisioned.availableChecks);
      if (!started.ok) {
        failureCode = started.failureCode;
      } else if (started.paused) {
        // The harness raised a question before it ever got going. The run holds
        // its claims and its reservation until a customer answers (§25).
        paused = true;
      } else {
        const watched = await watchAgent(operationId);
        if (!watched.ok) failureCode = watched.failureCode;
        else if (watched.expired) failureCode = "agent_wall_clock_exceeded";
      }

      const agent =
        failureCode === null && !paused
          ? await collectAgent(operationId)
          : null;

      if (agent === null) {
        // Already failed above; fall through to cleanup.
      } else if (!agent.ok) {
        failureCode = agent.failureCode;
      } else if (agent.paused) {
        // A question was raised. The run holds its claims and its reservation,
        // and nothing further happens until an answer arrives (§25).
        paused = true;
      } else {
        const extracted = await extractChange(
          operationId,
          agent.changedPaths ? [...agent.changedPaths] : null,
        );
        if (!extracted.ok) {
          failureCode = extracted.failureCode;
        } else {
          const written = await writeBranch(
            operationId,
            extracted.files,
            extracted.candidateDigest,
          );
          if (!written.ok) failureCode = written.failureCode;
          else preparedChangeId = written.preparedChangeId;
        }
      }
    }
  } catch {
    // A step exhausted its retries or threw outside the returned-failure
    // convention. The value is untyped and may carry provider prose, so it is
    // deliberately not inspected — but the run still reaches cleanup below,
    // which is the guarantee an early return could not make.
    failureCode = "provider_unavailable";
  }

  // Unconditional. The workspace has no remaining purpose once the change is
  // extracted, and nothing about deciding an outcome should be able to keep a
  // paid VM alive. A paused run is the one exception the sandbox itself
  // handles: it is stopped too, because a customer's answer may take days and
  // a VM must never wait for one.
  await cleanupWorkspace(operationId);

  if (paused) {
    await finish(operationId, { kind: "paused" });
    return;
  }

  if (failureCode !== null || preparedChangeId === null) {
    await finish(operationId, {
      kind: "failed",
      failureCode: failureCode ?? "agent_produced_no_change",
    });
    return;
  }

  await finish(operationId, { kind: "succeeded", preparedChangeId });

  // After `finish`, deliberately. The run is recorded as succeeded before
  // anything downstream is attempted, so the outcome of this workflow never
  // depends on what the next stage does with its result.
  await enqueueValidation(operationId);
}
