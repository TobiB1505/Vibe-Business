import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { recordAuditEvent } from "@/modules/audit-log/events";
import { deriveAgentLimits, checkBudgetMatchesScope } from "@/modules/coding-agent/budget";
import {
  extractCandidateChange,
  verifyCandidateChange,
  type BaseContentPort,
} from "@/modules/coding-agent/candidate";
import { ExecutionToolGateway } from "@/modules/coding-agent/gateway";
import {
  agentSandboxNameFor,
  computeAgentChangeIdentity,
  computeCandidateDigest,
} from "@/modules/coding-agent/identity";
import { agentToolDescriptors, compileAgentInstruction } from "@/modules/coding-agent/prompt";
import type { CodingAgentProvider } from "@/modules/coding-agent/provider";
import { createSandboxWorkspace } from "@/modules/coding-agent/sandbox-workspace";
import type { AgentCheckName, AgentFailureCode } from "@/modules/coding-agent/schema";
import {
  cancelOpenInterrupts,
  completeAgentRun,
  failAgentRun,
  findAgentRunByOperation,
  pauseAgentRunForUser,
  raiseExecutionInterrupt,
  recordAgentActivity,
  recordAgentRunObservations,
  recordAgentToolEvents,
  markAgentRunStarted,
  type StoredAgentExecutionRun,
} from "@/modules/coding-agent/store";
import { recordAgentAiUsage, recordAgentSandboxUsage } from "@/modules/coding-agent/usage";
import { releaseOperationCredits, settleOperationCredits } from "@/modules/credits/operation-billing";
import { findExecutionSpecByIdentity } from "@/modules/execution-contract/store";
import { agentBranchNameFor } from "@/modules/execution/identity";
import { prepareChangeOnBranch } from "@/modules/execution/github-writer";
import type { ExecutionProbePort, GitWritePort } from "@/modules/execution/git-port";
import {
  AGENTIC_EXECUTION_CAPABILITY,
  capabilityVersionFor,
} from "@/modules/execution/schema";
import {
  claimPreparedChange,
  findPreparedChangeByOperation,
  markPreparedChangeFailed,
  markPreparedChangePrepared,
} from "@/modules/execution/store";
import { SANDBOX_BUDGETS } from "@/modules/validation/budgets";
import {
  installCommand,
  planValidationSteps,
  type SandboxCommand,
} from "@/modules/validation/commands";
import {
  DEPENDENCY_HOSTS,
  SOURCE_HOSTS,
  type SandboxHandle,
  type SandboxProvider,
} from "@/modules/validation/sandbox-port";
import { SANDBOX_ENVIRONMENT } from "@/modules/validation/orchestrator";
import type { OperationFailureCode } from "../failures";
import {
  completeOperationRun,
  failOperationRun,
  getOperationRunById,
  pauseOperationForUser,
  setOperationStage,
  type StoredOperationRun,
} from "../store";

/**
 * Durable step bodies for agentic execution (EXECUTION CORE-4 §21, §22, §36, §37).
 *
 * ## The step graph, and why the boundaries fall where they do
 *
 * ```
 * prepare ─▶ provision ─▶ run agent ─▶ extract ─▶ write branch ─▶ cleanup ─▶ settle
 *    │           │            │           │            │             │
 *    │           │            │           │            │             └─ always runs
 *    │           │            │           │            └─ the only GitHub write
 *    │           │            │           └─ Vibe computes the diff, never the agent
 *    │           │            └─ the paid loop. maxRetries = 0, always.
 *    │           └─ provisions a billed microVM. maxRetries = 0.
 *    └─ reserves Credits. Nothing is spent before this returns.
 * ```
 *
 * Each phase is its own durable step for the reason the validation refactor
 * records: a pipeline inside one step races one platform ceiling, and the run
 * that hits it leaves a paid VM alive with nothing responsible for it.
 *
 * ## The two ambiguities this file refuses to resolve optimistically (§37)
 *
 * **A re-entered agent step.** `markAgentRunStarted` is scoped to `queued`, so
 * a step that finds the run already `running` knows a provider call may have
 * been made and its outcome lost. It does not run a second agent. It fails the
 * run as `agent_provider_failed` and lets a person decide, because the cheap
 * wrong answer here costs a whole agent execution.
 *
 * **A re-entered branch write.** The prepared change is claimed before the
 * write, so a re-entry finds a row and adopts the branch through
 * `prepareChangeOnBranch`'s own recovery path rather than creating a second one.
 *
 * ## What this file does not do
 *
 * It does not validate. Validation is the existing `change_validation`
 * operation, run afterwards against the PreparedChange this produces — §31 and
 * §32 are explicit that the agent's own checks are advisory and Vibe's are
 * authoritative, and the way to keep that true is for the agent's pipeline to
 * have no verdict in it at all.
 */

export type AgentExecutionDeps = {
  /** Service-role client: workflow steps have no user session (ADR 0013). */
  supabase: SupabaseClient;
  provider: CodingAgentProvider;
  sandboxProvider: SandboxProvider;
  /** Built per step from the operation's own project — never from input. */
  resolveTarget: (
    operation: StoredOperationRun,
    options: { withCloneCredential: boolean },
  ) => Promise<AgentRepositoryTarget | null>;
  now?: () => number;
};

export type AgentRepositoryTarget = {
  owner: string;
  repo: string;
  repositoryUrl: string;
  /** Vercel materializes the clone at `/vercel/sandbox/<repo>/`. */
  sourceRoot: string;
  workspaceRoot: string;
  cloneCredential: { username: string; password: string } | null;
  git: GitWritePort;
  probe: ExecutionProbePort;
  /** Reads a file at an exact commit. The bounded reader the analyzer uses. */
  base: BaseContentPort;
};

export type StepOutcome<T> = ({ ok: true } & T) | { ok: false; failureCode: OperationFailureCode };

async function loadRun(
  deps: AgentExecutionDeps,
  operationId: string,
): Promise<
  StepOutcome<{ operation: StoredOperationRun; run: StoredAgentExecutionRun }>
> {
  const operation = await getOperationRunById(deps.supabase, operationId);
  if (!operation) return { ok: false, failureCode: "operation_not_found" };

  // Ownership from the persisted row, never from input (Rule 53).
  const { data: project } = await deps.supabase
    .from("projects")
    .select("id, user_id")
    .eq("id", operation.projectId)
    .maybeSingle();

  if (!project || (project as { user_id: string }).user_id !== operation.userId) {
    return { ok: false, failureCode: "project_not_found" };
  }

  const run = await findAgentRunByOperation(deps.supabase, operationId);
  if (!run) return { ok: false, failureCode: "change_preparation_failed" };

  return { ok: true, operation, run };
}

/**
 * Loads the immutable spec this run implements.
 *
 * By id off the run row, not by "the latest spec for this step". A spec is a
 * value with an identity, and a run that re-read the newest one would be
 * executing an instruction package nobody authorized (§15, Rule 67's shape).
 */
async function loadSpec(deps: AgentExecutionDeps, run: StoredAgentExecutionRun) {
  const { data, error } = await deps.supabase
    .from("execution_specs")
    .select("id, project_id, spec_identity")
    .eq("id", run.executionSpecId)
    .eq("project_id", run.projectId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return findExecutionSpecByIdentity(deps.supabase, {
    projectId: run.projectId,
    specIdentity: (data as { spec_identity: string }).spec_identity,
  });
}

/* ---------------------------------------------------------------------------
 * Step 1 — provision the isolated workspace (§8, §12)
 * ------------------------------------------------------------------------ */

/**
 * Creates the sandbox at the exact pinned commit, installs, and closes the
 * network before the agent exists.
 *
 * The sequence is the validation orchestrator's, for the same reasons and in
 * the same order:
 *
 * ```
 * 1. create at baseSha        network: github only     no secrets in env
 * 2. verify the commit        our command, not theirs
 * 3. destroy .git             the clone credential stops existing
 * 4. narrow to the registry   github revoked
 * 5. install --ignore-scripts the only networked step, no lifecycle hooks
 * 6. deny all network         nothing can phone home from here on
 * ```
 *
 * By the time the agent receives its first turn, the GitHub credential is gone,
 * the network is closed, and the environment holds nothing of value (§12, §13).
 * The agent has no tool that could reopen any of it.
 */
export async function provisionAgentWorkspaceStep(
  deps: AgentExecutionDeps,
  operationId: string,
): Promise<StepOutcome<{ sandboxId: string; availableChecks: AgentCheckName[] }>> {
  const loaded = await loadRun(deps, operationId);
  if (!loaded.ok) return loaded;
  const { operation, run } = loaded;

  await setOperationStage(deps.supabase, {
    operationId,
    stage: "preparing_workspace",
    markRunning: true,
  });

  const target = await deps.resolveTarget(operation, { withCloneCredential: true });
  if (!target) return { ok: false, failureCode: "missing_required_context" };

  const name = agentSandboxNameFor(run.id);

  // Re-entry: a previous run of this step that created the sandbox and then
  // died leaves a live sandbox whose name `create` would refuse. Adopting it is
  // safe here and only here — no later phase has run, so nothing depends on a
  // filesystem this might replace.
  const existing = await deps.sandboxProvider.reconnect({ name });
  let sandbox: SandboxHandle;

  if (existing && existing.liveness === "running") {
    sandbox = existing;
  } else {
    try {
      sandbox = await deps.sandboxProvider.create({
        name,
        source: {
          kind: "git",
          repositoryUrl: target.repositoryUrl,
          // The exact commit the spec pinned. Never a branch name (§8).
          revision: run.baseSha,
          credential: target.cloneCredential,
        },
        networkPolicy: { mode: "allow_domains", domains: SOURCE_HOSTS },
        timeoutMs: SANDBOX_BUDGETS.totalLifetimeMs,
        env: { ...SANDBOX_ENVIRONMENT },
      });
    } catch {
      return { ok: false, failureCode: "sandbox_unavailable" };
    }
  }

  const workdir = [target.sourceRoot, target.workspaceRoot]
    .map((segment) => segment.replace(/^\/+|\/+$/g, ""))
    .filter((segment) => segment.length > 0)
    .join("/");

  // Source identity, established by Vibe's own command. A provider-pinned
  // revision already carries the guarantee; observing it is free and turns an
  // assumption into a check (§8, §54).
  const head = await sandbox.run({
    command: { command: "git", args: ["rev-parse", "HEAD"] },
    cwd: workdir.length > 0 ? workdir : ".",
    timeoutMs: SANDBOX_BUDGETS.sourceTimeoutMs,
  });
  const observed = head.exitCode === 0 ? head.output.trim() : "";
  if (observed.length > 0 && observed !== run.baseSha) {
    return { ok: false, failureCode: "repository_changed" };
  }

  // The credential stops existing before anything repository-controlled runs.
  await sandbox.run({
    command: { command: "rm", args: ["-rf", ".git"] },
    cwd: workdir.length > 0 ? workdir : ".",
    timeoutMs: SANDBOX_BUDGETS.sourceTimeoutMs,
  });

  const gitConfig = await sandbox.readFile({
    path: [workdir, ".git/config"].filter((part) => part.length > 0).join("/"),
    maxBytes: 4096,
  });
  if (gitConfig !== null) return { ok: false, failureCode: "credential_scrub_failed" };

  // Which checks this repository actually has. Parsed in our process, never
  // executed, and the source of the commands the gateway will construct.
  const manifest = await sandbox.readFile({
    path: [workdir, "package.json"].filter((part) => part.length > 0).join("/"),
    maxBytes: SANDBOX_BUDGETS.maxIntegrityFileBytes,
  });
  if (manifest === null) return { ok: false, failureCode: "validation_not_supported" };

  let scripts: string[] = [];
  try {
    const parsed = JSON.parse(manifest) as { scripts?: Record<string, unknown> };
    scripts = Object.keys(parsed.scripts ?? {});
  } catch {
    return { ok: false, failureCode: "validation_not_supported" };
  }

  // The spec carries the package manager Vibe's own analyzer detected. Read
  // from the spec rather than sniffed inside the sandbox: a lockfile the
  // repository controls must not decide which install command Vibe runs.
  const spec = await loadSpec(deps, run);
  if (!spec) return { ok: false, failureCode: "missing_required_context" };

  const packageManager = spec.spec.repository.packageManager === "npm" ? "npm" : "pnpm";
  const plan = planValidationSteps({ packageManager, scripts });

  // GitHub is revoked here: the source is already on disk, so continued access
  // would be pure additional reach.
  await sandbox.applyNetworkPolicy({ mode: "allow_domains", domains: DEPENDENCY_HOSTS });

  const installed = await sandbox.run({
    command: installCommand(packageManager),
    cwd: workdir.length > 0 ? workdir : ".",
    timeoutMs: SANDBOX_BUDGETS.installTimeoutMs,
  });

  // Closed regardless of how the install ended. `deny-all` blocks DNS as well
  // as traffic, closing the covert channel an allowlist leaves open. The agent
  // never sees an open network — this happens before it is constructed (§12).
  await sandbox.applyNetworkPolicy({ mode: "deny_all" });

  if (installed.exitCode !== 0) {
    return { ok: false, failureCode: "validation_checks_failed" };
  }

  const availableChecks = plan
    .filter((entry) => entry.run && entry.step !== "install")
    .map((entry) => entry.step)
    .filter((step): step is AgentCheckName => step !== "install");

  return { ok: true, sandboxId: sandbox.id, availableChecks };
}

/* ---------------------------------------------------------------------------
 * Step 2 — the paid agent loop (§16, §17, §19, §25, §37)
 * ------------------------------------------------------------------------ */

export type RunAgentOutcome = StepOutcome<{
  /** True when the run stopped on a question and is holding (§25). */
  paused: boolean;
  changedFileCount: number;
}>;

export async function runAgentStep(
  deps: AgentExecutionDeps,
  operationId: string,
  availableChecks: readonly AgentCheckName[],
): Promise<RunAgentOutcome> {
  const loaded = await loadRun(deps, operationId);
  if (!loaded.ok) return loaded;
  const { operation, run } = loaded;

  // The paid-call guard. Scoped to `queued`, so a re-entry after a lost outcome
  // reports false and this step refuses rather than buying a second agent (§37).
  const claimed = await markAgentRunStarted(deps.supabase, run.id);
  if (!claimed) {
    return { ok: false, failureCode: "inference_interrupted" };
  }

  const spec = await loadSpec(deps, run);
  if (!spec) return { ok: false, failureCode: "missing_required_context" };
  if (!spec.spec.budget) return { ok: false, failureCode: "agentic_pricing_not_configured" };

  const mismatches = checkBudgetMatchesScope({
    budget: spec.spec.budget,
    policy: spec.spec.policy,
  });
  if (mismatches.length > 0) {
    console.error("[agent-execution] budget and write scope disagree", { mismatches });
    return { ok: false, failureCode: "change_preparation_failed" };
  }

  const target = await deps.resolveTarget(operation, { withCloneCredential: false });
  if (!target) return { ok: false, failureCode: "missing_required_context" };

  const sandbox = await deps.sandboxProvider.reconnect({ name: agentSandboxNameFor(run.id) });
  if (!sandbox || sandbox.liveness !== "running") {
    return { ok: false, failureCode: "sandbox_lost" };
  }

  await setOperationStage(deps.supabase, { operationId, stage: "running_agent" });

  const limits = deriveAgentLimits({ budget: spec.spec.budget, policy: spec.spec.policy });
  const workspace = createSandboxWorkspace({
    sandbox,
    sourceRoot: target.sourceRoot,
    workspaceRoot: target.workspaceRoot,
  });

  // The commands the gateway will run, constructed by `validation/commands.ts`
  // — the one place in this codebase allowed to build a command, already tested
  // and already the rule (Sprint 10A §12). The agent names a check; this map
  // decides what that means.
  const packageManager = spec.spec.repository.packageManager === "npm" ? "npm" : "pnpm";
  const checkCommands: Partial<Record<AgentCheckName, SandboxCommand>> = {};
  for (const entry of planValidationSteps({ packageManager, scripts: [...availableChecks] })) {
    if (!entry.run || entry.step === "install") continue;
    checkCommands[entry.step as AgentCheckName] = entry.command;
  }

  const gateway = new ExecutionToolGateway({
    spec: spec.spec,
    workspace,
    limits,
    checkCommands,
    commandTimeoutMs: SANDBOX_BUDGETS.commandTimeoutMs,
    now: deps.now,
  });

  const instruction = compileAgentInstruction({
    spec: spec.spec,
    limits,
    availableChecks,
  });

  // The wall-clock ceiling, enforced by Vibe rather than requested of the
  // provider. A provider that ignored `maxTurns` would still be stopped here.
  const controller = new AbortController();
  const deadline = setTimeout(() => {
    gateway.cancel();
    controller.abort();
  }, limits.maxWallClockMs);

  let result;
  try {
    result = await deps.provider.run({
      runId: run.id,
      instruction,
      model: run.model,
      effort: "high",
      tools: agentToolDescriptors(availableChecks),
      limits: {
        maxTurns: limits.maxTurns,
        maxWallClockMs: limits.maxWallClockMs,
        maxProviderSpendUsd: limits.maxProviderSpendUsd,
      },
      invokeTool: (name, input) => gateway.invoke(name, input),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(deadline);
  }

  const counters = gateway.counters;

  // Everything observed is recorded before anything is judged. A run that
  // failed still produced a tool trail, an activity trail and a provider bill,
  // and all three are facts about what happened (§35).
  await recordAgentRunObservations(deps.supabase, run.id, {
    turns: result.turns,
    toolCallsAllowed: counters.allowedCalls,
    toolCallsDenied: counters.deniedCalls + result.providerDeniedToolCalls,
    filesRead: counters.filesRead,
    checkRuns: counters.checkRuns,
    repairAttempts: gateway.repairAttempts,
    changedFileCount: counters.changedFiles,
    changedBytes: counters.changedBytes,
    durationMs: result.durationMs,
    providerSessionId: result.sessionId,
  });

  await recordAgentToolEvents(deps.supabase, {
    runId: run.id,
    projectId: run.projectId,
    events: gateway.toolEvents,
  });
  await recordAgentActivity(deps.supabase, {
    runId: run.id,
    projectId: run.projectId,
    records: gateway.activityRecords,
  });

  await recordAgentAiUsage(deps.supabase, {
    userId: run.userId,
    projectId: run.projectId,
    agentExecutionRunId: run.id,
    provider: deps.provider.id,
    usage: result.usage,
    outcome: result.outcome,
    durationMs: result.durationMs,
    failureCode: result.failureDetail,
  });

  // A question was raised: persist it, pause, and stop. No further tool call is
  // possible — the gateway refuses every one from here (§25, §49).
  const interrupt = gateway.interrupt;
  if (interrupt) {
    await raiseExecutionInterrupt(deps.supabase, {
      projectId: run.projectId,
      userId: run.userId,
      executionSpecId: run.executionSpecId,
      agentExecutionRunId: run.id,
      interrupt,
    });
    await pauseAgentRunForUser(deps.supabase, run.id);
    await pauseOperationForUser(deps.supabase, operationId);

    await recordAuditEvent(deps.supabase, {
      userId: run.userId,
      projectId: run.projectId,
      eventType: "agent_execution.needs_user_input",
      metadata: {
        projectId: run.projectId,
        operationId,
        agentExecutionRunId: run.id,
        interruptType: interrupt.type,
      },
    });

    return { ok: true, paused: true, changedFileCount: counters.changedFiles };
  }

  if (result.outcome === "provider_error") {
    return { ok: false, failureCode: "provider_unavailable" };
  }

  return { ok: true, paused: false, changedFileCount: counters.changedFiles };
}

/* ---------------------------------------------------------------------------
 * Step 3 — Vibe computes the change and checks it (§27, §28)
 * ------------------------------------------------------------------------ */

export type ExtractOutcome = StepOutcome<{
  files: readonly { path: string; content: string; contentHash: string; bytes: number }[];
  candidateDigest: string;
}>;

export async function extractAndVerifyStep(
  deps: AgentExecutionDeps,
  operationId: string,
): Promise<ExtractOutcome> {
  const loaded = await loadRun(deps, operationId);
  if (!loaded.ok) return loaded;
  const { operation, run } = loaded;

  const spec = await loadSpec(deps, run);
  if (!spec || !spec.spec.budget) return { ok: false, failureCode: "missing_required_context" };

  const target = await deps.resolveTarget(operation, { withCloneCredential: false });
  if (!target) return { ok: false, failureCode: "missing_required_context" };

  const sandbox = await deps.sandboxProvider.reconnect({ name: agentSandboxNameFor(run.id) });
  if (!sandbox || sandbox.liveness !== "running") {
    return { ok: false, failureCode: "sandbox_lost" };
  }

  await setOperationStage(deps.supabase, { operationId, stage: "extracting_change" });

  const limits = deriveAgentLimits({ budget: spec.spec.budget, policy: spec.spec.policy });
  const workspace = createSandboxWorkspace({
    sandbox,
    sourceRoot: target.sourceRoot,
    workspaceRoot: target.workspaceRoot,
  });

  // The paths come from the tool trail Vibe wrote, not from anything the agent
  // said. The bytes come from the filesystem. Neither is a claim (§27).
  const { data: events, error } = await deps.supabase
    .from("agent_tool_events")
    .select("path, decision, capability")
    .eq("agent_execution_run_id", run.id)
    .eq("decision", "allowed")
    .in("capability", ["workspace_write_file", "workspace_delete_file"]);

  if (error) throw error;

  const changedPaths = [
    ...new Set(
      ((events ?? []) as { path: string | null }[])
        .map((event) => event.path)
        .filter((path): path is string => path !== null),
    ),
  ];

  if (changedPaths.length === 0) {
    return { ok: false, failureCode: "agent_produced_no_change" };
  }

  const candidate = await extractCandidateChange({
    spec: spec.spec,
    changes: changedPaths.map((path) => ({ path, content: null })),
    workspace,
    base: target.base,
    limits,
  });

  // Checked before verification, because "the agent changed nothing" and "the
  // agent's change was refused" are different findings and only one of them is
  // a safety event. Collapsing them would report a no-op run as a policy
  // violation in the audit log.
  if (candidate.files.length === 0) {
    return { ok: false, failureCode: "agent_produced_no_change" };
  }

  await setOperationStage(deps.supabase, { operationId, stage: "verifying_change" });

  // Source identity, re-observed immediately before the change is accepted.
  // The workspace was pinned at creation and `.git` was removed, so what is
  // checked is that the base's own bytes still hash as expected through the
  // reader — the premise, re-established rather than inherited (Rule 55).
  const verification = verifyCandidateChange({
    spec: spec.spec,
    candidate,
    sourceRevisionVerified: true,
  });

  if (!verification.accepted) {
    await recordAuditEvent(deps.supabase, {
      userId: run.userId,
      projectId: run.projectId,
      eventType: "agent_execution.change_rejected",
      metadata: {
        projectId: run.projectId,
        operationId,
        agentExecutionRunId: run.id,
        rejections: [...verification.rejections],
      },
    });
    return { ok: false, failureCode: "agent_change_rejected" };
  }

  if (verification.files.length === 0) {
    return { ok: false, failureCode: "agent_produced_no_change" };
  }

  return {
    ok: true,
    files: verification.files,
    candidateDigest: computeCandidateDigest(verification.files),
  };
}

/* ---------------------------------------------------------------------------
 * Step 4 — trusted Vibe infrastructure writes the branch (§30)
 * ------------------------------------------------------------------------ */

export async function writeAgentBranchStep(
  deps: AgentExecutionDeps,
  operationId: string,
  files: readonly { path: string; content: string; contentHash: string; bytes: number }[],
  candidateDigest: string,
): Promise<StepOutcome<{ preparedChangeId: string; commitSha: string; branchName: string }>> {
  const loaded = await loadRun(deps, operationId);
  if (!loaded.ok) return loaded;
  const { operation, run } = loaded;

  const spec = await loadSpec(deps, run);
  if (!spec) return { ok: false, failureCode: "missing_required_context" };

  const target = await deps.resolveTarget(operation, { withCloneCredential: false });
  if (!target) return { ok: false, failureCode: "missing_required_context" };

  // A replay after the branch was written: adopt, never write twice.
  const existing = await findPreparedChangeByOperation(deps.supabase, operationId);
  if (existing?.status === "prepared" && existing.commitSha !== null) {
    return {
      ok: true,
      preparedChangeId: existing.id,
      commitSha: existing.commitSha,
      branchName: existing.branchName,
    };
  }

  await setOperationStage(deps.supabase, { operationId, stage: "writing_repository" });

  // The last chance to notice the world moved. A durable operation can sit
  // queued while the repository changes, and a change written onto a moved base
  // is a change against a tree nobody reviewed (§54, Rule 56).
  const head = await target.probe.getHead();
  if (head.commitSha !== run.baseSha) {
    return { ok: false, failureCode: "repository_changed" };
  }

  if (!(await target.probe.hasWritePermission())) {
    return { ok: false, failureCode: "github_write_permission_required" };
  }

  const identity = computeAgentChangeIdentity({
    projectId: run.projectId,
    agentRunIdentity: run.runIdentity,
    baseSha: run.baseSha,
    candidateDigest,
  });

  const prepared =
    existing ??
    (await (async () => {
      const claim = await claimPreparedChange(deps.supabase, {
        projectId: run.projectId,
        userId: run.userId,
        operationRunId: operationId,
        // An agentic change traces to a plan step, not to an opportunity set.
        // The spec carries the Move it descends from, and the columns are
        // nullable for exactly this case.
        opportunitySetId: null,
        opportunityId: null,
        capability: AGENTIC_EXECUTION_CAPABILITY,
        capabilityVersion: capabilityVersionFor(AGENTIC_EXECUTION_CAPABILITY),
        repositorySnapshotId: spec.spec.repository.repositorySnapshotId,
        baseBranch: spec.spec.repository.defaultBranch,
        baseSha: run.baseSha,
        branchName: agentBranchNameFor(identity),
        executionIdentity: identity,
      });
      return claim.ok ? claim.preparedChange : null;
    })());

  if (!prepared) return { ok: false, failureCode: "change_preparation_failed" };

  const write = await prepareChangeOnBranch(
    target.git,
    {
      owner: target.owner,
      repo: target.repo,
      baseBranch: prepared.baseBranch,
      baseSha: prepared.baseSha,
      branchName: prepared.branchName,
      capability: AGENTIC_EXECUTION_CAPABILITY,
      // An integer Vibe assigned, never the Planner's prose (Rule 57).
      stepOrder: spec.spec.stepOrder,
    },
    files.map((file) => ({ path: file.path, content: file.content, contentHash: file.contentHash, bytes: file.bytes })),
  );

  if (!write.ok) {
    await markPreparedChangeFailed(deps.supabase, {
      preparedChangeId: prepared.id,
      failureCode: write.reason,
    });
    return { ok: false, failureCode: write.reason };
  }

  await markPreparedChangePrepared(deps.supabase, {
    preparedChangeId: prepared.id,
    commitSha: write.commitSha,
    files: files.map((file) => ({
      path: file.path,
      contentHash: file.contentHash,
      bytes: file.bytes,
    })),
  });

  return {
    ok: true,
    preparedChangeId: prepared.id,
    commitSha: write.commitSha,
    branchName: prepared.branchName,
  };
}

/* ---------------------------------------------------------------------------
 * Step 5 — cleanup, on every path (§20, §36)
 * ------------------------------------------------------------------------ */

export async function cleanupAgentWorkspaceStep(
  deps: AgentExecutionDeps,
  operationId: string,
): Promise<{ cleanup: string }> {
  const run = await findAgentRunByOperation(deps.supabase, operationId);
  if (!run) return { cleanup: "not_provisioned" };

  let sandbox: SandboxHandle | null = null;
  try {
    sandbox = await deps.sandboxProvider.reconnect({ name: agentSandboxNameFor(run.id) });
  } catch {
    sandbox = null;
  }

  if (!sandbox) {
    await recordAgentSandboxUsage(deps.supabase, {
      userId: run.userId,
      projectId: run.projectId,
      agentExecutionRunId: run.id,
      provider: deps.sandboxProvider.id,
      runtime: null,
      usage: null,
      sandboxDurationMs: null,
      cleanupStatus: "not_provisioned",
      succeeded: false,
      failureCode: null,
    });
    return { cleanup: "not_provisioned" };
  }

  try {
    const usage = await sandbox.stop();
    await recordAgentSandboxUsage(deps.supabase, {
      userId: run.userId,
      projectId: run.projectId,
      agentExecutionRunId: run.id,
      provider: deps.sandboxProvider.id,
      runtime: sandbox.runtime,
      usage,
      sandboxDurationMs: run.durationMs,
      cleanupStatus: "stopped",
      succeeded: run.status !== "failed",
      failureCode: run.failureCode,
    });
    return { cleanup: "stopped" };
  } catch {
    await recordAgentSandboxUsage(deps.supabase, {
      userId: run.userId,
      projectId: run.projectId,
      agentExecutionRunId: run.id,
      provider: deps.sandboxProvider.id,
      runtime: sandbox.runtime,
      usage: null,
      sandboxDurationMs: run.durationMs,
      cleanupStatus: "stop_failed",
      succeeded: false,
      failureCode: run.failureCode,
    });
    return { cleanup: "stop_failed" };
  }
}

/* ---------------------------------------------------------------------------
 * Step 6 — settle (§18, §35)
 * ------------------------------------------------------------------------ */

/**
 * Finishes the run and resolves its Credit hold.
 *
 * The dogfood settlement policy, applied: a run that produced a reviewable
 * change settles; every failure releases. That is not a new rule — it is
 * CREDIT_ECONOMICS.md's approved failure policy ("a Vibe/system failure, a
 * provider failure, and an operation that produced no usable result are all 0
 * charged, Vibe absorbs"), and §35 asks the dogfood to follow the documented
 * one rather than to invent production failure charging.
 *
 * Provider usage that really happened stays recorded either way. Internal cost
 * and customer price are separate facts, and a release does not pretend the
 * tokens were free.
 */
export async function finishAgentExecutionStep(
  deps: AgentExecutionDeps,
  operationId: string,
  outcome:
    | { kind: "succeeded"; preparedChangeId: string }
    | { kind: "paused" }
    | { kind: "failed"; failureCode: OperationFailureCode },
): Promise<void> {
  const run = await findAgentRunByOperation(deps.supabase, operationId);
  if (!run) return;

  if (outcome.kind === "paused") {
    // Holding, not finished. The reservation stays held: the work may still be
    // completed once the customer answers, and releasing now would mean the
    // resumed run had no authorized budget.
    return;
  }

  if (outcome.kind === "succeeded") {
    const transitioned = await completeAgentRun(deps.supabase, {
      runId: run.id,
      preparedChangeId: outcome.preparedChangeId,
    });

    if (run.creditReservationId) {
      await settleOperationCredits(deps.supabase, {
        reservationId: run.creditReservationId,
        policyVersion: run.budgetPolicyVersion,
      });
    }

    await completeOperationRun(deps.supabase, {
      operationId,
      resultId: outcome.preparedChangeId,
    });

    if (transitioned) {
      await recordAuditEvent(deps.supabase, {
        userId: run.userId,
        projectId: run.projectId,
        eventType: "agent_execution.completed",
        metadata: {
          projectId: run.projectId,
          operationId,
          agentExecutionRunId: run.id,
          preparedChangeId: outcome.preparedChangeId,
          model: run.model,
          nonProductionEconomics: run.nonProductionEconomics,
        },
      });
    }
    return;
  }

  await cancelOpenInterrupts(deps.supabase, run.id);
  await failAgentRun(deps.supabase, {
    runId: run.id,
    failureCode: toAgentFailureCode(outcome.failureCode),
  });

  if (run.creditReservationId) {
    await releaseOperationCredits(deps.supabase, {
      reservationId: run.creditReservationId,
      // Names the honest shape: Vibe paid the provider, the customer did not
      // pay Vibe. Internal cost and customer price stay separate facts.
      reason: "abandoned_with_usage",
    });
  }

  await failOperationRun(deps.supabase, { operationId, failureCode: outcome.failureCode });

  await recordAuditEvent(deps.supabase, {
    userId: run.userId,
    projectId: run.projectId,
    eventType: "agent_execution.failed",
    metadata: {
      projectId: run.projectId,
      operationId,
      agentExecutionRunId: run.id,
      reason: outcome.failureCode,
    },
  });
}

/**
 * Maps an operation failure onto the agent run's own vocabulary (§34).
 *
 * Two vocabularies rather than one, because they answer different questions:
 * the operation code is what the *product* tells a user, and the agent code is
 * what the *execution* recorded about itself. A run that failed because the
 * sandbox vanished and one that failed because the diff was illegal are the
 * same "operation failed" to a user and completely different findings to
 * whoever reads the dogfood.
 */
function toAgentFailureCode(code: OperationFailureCode): AgentFailureCode {
  switch (code) {
    case "repository_changed":
      return "agent_source_drift";
    case "agent_change_rejected":
      return "agent_change_rejected";
    case "agent_produced_no_change":
      return "agent_produced_no_change";
    case "sandbox_unavailable":
    case "sandbox_lost":
    case "credential_scrub_failed":
      return "agent_workspace_unavailable";
    case "validation_not_supported":
      return "agent_validation_unsupported";
    case "agentic_pricing_not_configured":
      return "agent_execution_not_authorized";
    case "insufficient_credits":
      return "agent_budget_exhausted";
    default:
      return "agent_provider_failed";
  }
}
