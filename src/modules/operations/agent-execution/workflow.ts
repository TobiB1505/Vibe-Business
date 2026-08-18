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
import {
  cleanupAgentWorkspaceStep,
  extractAndVerifyStep,
  finishAgentExecutionStep,
  provisionAgentWorkspaceStep,
  runAgentStep,
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
 * provision ─▶ run agent ─▶ extract ─▶ write branch
 *      │           │           │            │
 *      └───────────┴───────────┴────────────┘
 *                        ▼
 *                    cleanup ─▶ finish
 * ```
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
    runtime: { kind: "sandbox_workspace", build: createSandboxCodingAgentProvider },
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

async function runAgent(operationId: string, availableChecks: AgentCheckName[]) {
  "use step";
  return runAgentStep(deps(), operationId, availableChecks);
}
// The paid loop. A retry cannot distinguish "the agent never ran" from "the
// agent ran and its result was lost", and for a paid provider call that
// ambiguity must resolve to *not running it again* (§37).
runAgent.maxRetries = 0;

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
      const agent = await runAgent(operationId, provisioned.availableChecks);
      if (!agent.ok) {
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
}
