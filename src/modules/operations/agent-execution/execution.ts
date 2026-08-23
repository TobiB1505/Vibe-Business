import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { recordAuditEvent } from "@/modules/audit-log/events";
import { startChangeValidation } from "@/modules/validation/service";
import type { OperationExecutor } from "../executor";
import {
  AGENT_SANDBOX_LIFETIME_MS,
  deriveAgentLimits,
  deriveGatewayCeilings,
  checkBudgetMatchesScope,
  type AgentRuntimeLimits,
} from "@/modules/coding-agent/budget";
import {
  agentTokenExpiryFor,
  mintRunGatewayToken,
  readAgentGatewayConfig,
} from "@/modules/coding-agent/gateway-config";
import {
  captureWorkspaceBaseline,
  discoverWorkspaceChanges,
  plantChangeMarker,
  readWorkspaceBaseline,
} from "@/modules/coding-agent/sandbox-runtime/changes";
import {
  AGENT_RUNTIME_DIRNAME,
  installAgentRuntime,
  type SandboxAgentRuntimeDeps,
} from "@/modules/coding-agent/sandbox-runtime/provider";
import {
  extractCandidateChange,
  verifyCandidateChange,
  type BaseContentPort,
  type BaseTreePort,
} from "@/modules/coding-agent/candidate";
import {
  changeEvidenceMetadata,
  changeRejectionMetadata,
  summarizeChangeEvidence,
} from "@/modules/coding-agent/change-evidence";
import { ExecutionToolGateway } from "@/modules/coding-agent/gateway";
import { createBaseIgnorePort } from "@/modules/coding-agent/ignored-paths";
import { createLifecycleRecorder } from "@/modules/coding-agent/observability/lifecycle";
import { MAX_EVENTS_PER_RUN } from "@/modules/coding-agent/observability/events";
import { eventsFromRuntimeFeed } from "@/modules/coding-agent/observability/runtime-feed";
import { listExecutionEvents, recordExecutionEvents } from "@/modules/coding-agent/observability/store";
import {
  agentSandboxNameFor,
  computeAgentChangeIdentity,
  computeCandidateDigest,
} from "@/modules/coding-agent/identity";
import { agentToolDescriptors, compileAgentInstruction } from "@/modules/coding-agent/prompt";
import type { ExecutionSpec } from "@/modules/execution-contract/spec";
import type { ExecutionBrief } from "@/modules/execution-context/brief";
import {
  completionBudgetFor,
  loadAgentVerificationPlan,
  loadExecutionBrief,
  loadPlanStep,
} from "@/modules/execution-context/service";
import { toSandboxPolicy, type AgentVerificationPlan } from "@/modules/execution-context/verification";
import { toSandboxCompletionPolicy } from "@/modules/execution-context/completion";
import { assertPolicyConsistency } from "@/modules/execution-context/policy";
import { summarizeContextUsage } from "@/modules/execution-context/usage";
import type { DetachedCodingAgentProvider } from "@/modules/coding-agent/provider";
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
  recordAgentMessageProgress,
  markAgentRunStarted,
  updateAgentRunCreditReservation,
  type StoredAgentExecutionRun,
} from "@/modules/coding-agent/store";
import { recordAgentSandboxUsage } from "@/modules/coding-agent/usage";
import {
  authorizeOperationCredits,
  releaseOperationCredits,
  settleOperationCredits,
} from "@/modules/credits/operation-billing";
import { findExecutionSpecByIdentity } from "@/modules/execution-contract/store";
import { agentBranchNameFor } from "@/modules/execution/identity";
import { prepareChangeOnBranch } from "@/modules/execution/github-writer";
import { compileCommitMessage, renderCommitMessage } from "@/modules/execution/commit-message";
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
import { operationHasCreditHold } from "../billing";
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

/**
 * How the agent harness is built for one run (ADR 0029, A1).
 *
 * A builder rather than a provider instance, because the harness outlives the
 * step that starts it. Three different function invocations — start, observe,
 * collect — each construct their own, from a sandbox handle they reconnected
 * to and paths they re-derived. Nothing is carried between them in memory,
 * because the first real run proved memory does not survive: the platform
 * killed the step at 300 seconds with the agent still working.
 */
export type AgentExecutionRuntime = {
  /**
   * Builds the harness for one run.
   *
   * Injected for the same reason `sandboxProvider` is: the real one is
   * constructed only at the composition root, and there is no local-execution
   * implementation for a test to reach for by accident (ADR 0015).
   *
   * Called fresh in every step that needs it. The object it returns holds no
   * state between calls — it cannot, because each call happens in a different
   * function invocation (ADR 0029, A1).
   */
  build: (context: SandboxAgentContext) => DetachedCodingAgentProvider;
};

/** Everything the sandbox-hosted harness needs. None of it agent-chosen. */
export type SandboxAgentContext = SandboxAgentRuntimeDeps;

export type AgentExecutionDeps = {
  /** Service-role client: workflow steps have no user session (ADR 0013). */
  supabase: SupabaseClient;
  runtime: AgentExecutionRuntime;
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
  /**
   * Which paths the repository contained at the base commit.
   *
   * Separate from `base` rather than folded into it, so that "we could not
   * establish what is tracked" is a value a caller can express. Null disables
   * every ignore rule: without a tracked-path answer there is no way to tell a
   * generated artifact from a source file, and keeping the path is the safe
   * direction.
   */
  baseTree: BaseTreePort | null;
};

export type StepOutcome<T> = ({ ok: true } & T) | { ok: false; failureCode: OperationFailureCode };

/**
 * One milestone, recorded against the run that produced it.
 *
 * A thin wrapper so a step needs three arguments rather than five, and so the
 * ownership fields come from the persisted run row rather than from anything a
 * caller assembles (Rule 53). Never throws: telemetry attached to a paid
 * execution must not be able to fail it.
 */
async function recordLifecycle(
  deps: AgentExecutionDeps,
  run: StoredAgentExecutionRun,
  type: Parameters<ReturnType<typeof createLifecycleRecorder>>[0],
  summary: string,
  metadata?: Parameters<ReturnType<typeof createLifecycleRecorder>>[2],
): Promise<void> {
  const record = createLifecycleRecorder({
    supabase: deps.supabase,
    runId: run.id,
    projectId: run.projectId,
    userId: run.userId,
    now: deps.now,
  });

  await record(type, summary, metadata);
}

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
        timeoutMs: AGENT_SANDBOX_LIFETIME_MS,
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

  // The gateway has to be reachable *after* the registry is closed, so its
  // configuration is resolved before either install runs. A run that discovers
  // at turn one that it has nowhere to sample has already bought a VM.
  const gateway = readAgentGatewayConfig();
  if (!gateway) return { ok: false, failureCode: "missing_required_context" };

  const installed = await sandbox.run({
    command: installCommand(packageManager),
    cwd: workdir.length > 0 ? workdir : ".",
    timeoutMs: SANDBOX_BUDGETS.installTimeoutMs,
  });

  /*
   * The harness, installed inside the same registry window and nowhere else.
   *
   * This is the whole of "bootstrap egress and execution egress are separate":
   * fetching a package needs npm, and running the agent needs the gateway.
   * Leaving the registry reachable during the run would put a package publish
   * between a customer's repository and an exfiltration channel.
   */
  let harness: { ok: true } | { ok: false; output: string } = { ok: true };
  if (installed.exitCode === 0) {
    harness = await installAgentRuntime({
      sandbox,
      runtimeCwd: AGENT_RUNTIME_DIRNAME,
      timeoutMs: SANDBOX_BUDGETS.installTimeoutMs,
    });
  }

  /*
   * Narrowed regardless of how either install ended, and to the least the run
   * can work with.
   *
   * `deny_all` blocks DNS as well as traffic, closing the covert channel an
   * allowlist leaves open, and it stays the answer whenever the harness is not
   * in here. When it is, exactly one host survives — the Agent Gateway — and
   * the token that reaches it authorizes one route on one execution. The agent
   * never sees an open network either way: this happens before it exists (§12).
   */
  await sandbox.applyNetworkPolicy({ mode: "allow_domains", domains: [gateway.host] });

  // The other half of the runtime trail. Which sandbox, and what it may reach
  // from here — the two facts a person needs before asking why a run behaved
  // the way it did. No credential, and no host the operator did not configure.
  console.info("[agent-runtime]", {
    kind: "workspace_ready",
    operationId,
    agentExecutionRunId: run.id,
    sandboxId: sandbox.id,
    egress: gateway.host,
  });

  await recordLifecycle(deps, run, "workspace_ready", "Project prepared", {
    sandboxId: sandbox.id,
    egressHost: gateway.host,
  });

  if (installed.exitCode !== 0) {
    return { ok: false, failureCode: "validation_checks_failed" };
  }

  if (!harness.ok) {
    console.error("[agent-execution] the agent harness could not be installed", {
      operationId,
      agentExecutionRunId: run.id,
      detail: harness.output.slice(-2_000),
    });
    return { ok: false, failureCode: "sandbox_unavailable" };
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

/** Where the run's own files live inside the sandbox. Derived, never stored. */
type SandboxPaths = {
  runtimeDir: string;
  markerPath: string;
  baselinePath: string;
  workspaceDir: string;
  workspaceCwd: string;
};

/** The workspace, relative to the sandbox home. `.` when the repo is the root. */
function workspaceCwdFor(sourceRoot: string, workspaceRoot: string): string {
  const joined = [sourceRoot, workspaceRoot]
    .map((segment) => segment.replace(/^\/+|\/+$/g, ""))
    .filter((segment) => segment.length > 0)
    .join("/");

  return joined.length > 0 ? joined : ".";
}

/**
 * Asks the sandbox where it is, and derives every path from that.
 *
 * Asked rather than assumed: the harness needs absolute paths, and hardcoding
 * the provider's layout would make a provider change look like a model that
 * suddenly could not find any files.
 *
 * Re-derived in every step rather than persisted, because it is a pure function
 * of the sandbox and the repository target — both of which each step already
 * has to re-establish anyway.
 */
async function resolveSandboxPaths(
  sandbox: SandboxHandle,
  target: { sourceRoot: string; workspaceRoot: string },
): Promise<SandboxPaths | null> {
  const home = await sandbox.run({
    command: { command: "pwd", args: [] },
    cwd: ".",
    timeoutMs: 30_000,
  });

  const sandboxHome = home.exitCode === 0 ? home.output.trim() : "";
  if (sandboxHome.length === 0 || !sandboxHome.startsWith("/")) return null;

  const runtimeDir = `${sandboxHome}/${AGENT_RUNTIME_DIRNAME}`;
  const workspaceCwd = workspaceCwdFor(target.sourceRoot, target.workspaceRoot);

  return {
    runtimeDir,
    markerPath: `${runtimeDir}/marker`,
    baselinePath: `${runtimeDir}/baseline.txt`,
    workspaceDir: workspaceCwd === "." ? sandboxHome : `${sandboxHome}/${workspaceCwd}`,
    workspaceCwd,
  };
}

/**
 * Builds the harness for one run.
 *
 * The gateway token is minted here, in whichever step needs a provider. It is
 * short-lived and execution-scoped, so re-minting one is not a second grant —
 * every claim in it is re-checked against durable state at the gateway on every
 * request (ADR 0029 §2). Storing one instead would mean keeping a bearer
 * credential in a database row for the length of a run.
 */
function buildRunProvider(
  deps: AgentExecutionDeps,
  input: {
    sandbox: SandboxHandle;
    run: StoredAgentExecutionRun;
    limits: AgentRuntimeLimits;
    paths: SandboxPaths;
    gateway: { baseUrl: string; secret: string };
  },
): DetachedCodingAgentProvider {
  const ceilings = deriveGatewayCeilings({ limits: input.limits, model: input.run.model });

  return deps.runtime.build({
    sandbox: input.sandbox,
    /*
     * Runtime lifecycle, to the operator's log rather than to the audit trail.
     *
     * The audit log is a founder's activity feed — "Vibe started making a change
     * to your app" — and "the CLI exited 127" is not a sentence that belongs in
     * it. What the customer's records already carry is the outcome: turns on the
     * run row, tokens and latency per sampling call in `ai_usage_events`, CPU
     * and egress in `sandbox_usage_events`, and the reservation's own status.
     */
    onEvent: (event) => {
      console.info("[agent-runtime]", {
        operationId: input.run.operationRunId,
        agentExecutionRunId: input.run.id,
        ...event,
      });
    },
    runtimeDir: input.paths.runtimeDir,
    workspaceDir: input.paths.workspaceDir,
    workspaceCwd: input.paths.workspaceCwd,
    gatewayBaseUrl: input.gateway.baseUrl,
    gatewayToken: mintRunGatewayToken(
      {
        runId: input.run.id,
        specId: input.run.executionSpecId,
        projectId: input.run.projectId,
        userId: input.run.userId,
        model: input.run.model,
        maxOutputTokens: ceilings.maxOutputTokens,
        maxRequests: ceilings.maxRequests,
        expiresAt: agentTokenExpiryFor(input.limits.maxWallClockMs, (deps.now ?? Date.now)()),
      },
      input.gateway.secret,
    ),
  });
}

/**
 * Everything the agent steps re-establish from scratch, every time.
 *
 * Three steps now touch one run — start, observe, collect — and each is a
 * separate function invocation that has never seen the others. So none of them
 * inherits anything: the spec is loaded by id, the repository target is rebuilt
 * from the project row, the sandbox is reconnected by its deterministic name,
 * and the paths are re-derived. That is what makes any of them safe to retry.
 */
type AgentRunContext = {
  operation: StoredOperationRun;
  run: StoredAgentExecutionRun;
  spec: NonNullable<Awaited<ReturnType<typeof loadSpec>>>;
  limits: AgentRuntimeLimits;
  target: AgentRepositoryTarget;
  sandbox: SandboxHandle;
  paths: SandboxPaths;
  provider: DetachedCodingAgentProvider;
};

async function loadAgentRunContext(
  deps: AgentExecutionDeps,
  operationId: string,
): Promise<StepOutcome<{ context: AgentRunContext }>> {
  const loaded = await loadRun(deps, operationId);
  if (!loaded.ok) return loaded;
  const { operation, run } = loaded;

  const spec = await loadSpec(deps, run);
  if (!spec) return { ok: false, failureCode: "missing_required_context" };
  if (!spec.spec.budget) return { ok: false, failureCode: "agentic_pricing_not_configured" };

  const target = await deps.resolveTarget(operation, { withCloneCredential: false });
  if (!target) return { ok: false, failureCode: "missing_required_context" };

  const sandbox = await deps.sandboxProvider.reconnect({ name: agentSandboxNameFor(run.id) });
  if (!sandbox || sandbox.liveness !== "running") {
    return { ok: false, failureCode: "sandbox_lost" };
  }

  const paths = await resolveSandboxPaths(sandbox, target);
  if (!paths) return { ok: false, failureCode: "sandbox_lost" };

  const gateway = readAgentGatewayConfig();
  if (!gateway) return { ok: false, failureCode: "missing_required_context" };

  const limits = deriveAgentLimits({ budget: spec.spec.budget, policy: spec.spec.policy });

  return {
    ok: true,
    context: {
      operation,
      run,
      spec,
      limits,
      target,
      sandbox,
      paths,
      provider: buildRunProvider(deps, { sandbox, run, limits, paths, gateway }),
    },
  };
}

/**
 * The tool gateway for one run.
 *
 * Constructed even though the sandbox-hosted harness never calls it: it is what
 * `compileAgentInstruction` describes to the model, it carries the counters the
 * observation record is written from, and it is still the only door in the
 * `AgentWorkspace` sense. What changed with ADR 0029 is which side of the VM
 * boundary the writes happen on, not whether the policy exists.
 */
function buildToolGateway(
  deps: AgentExecutionDeps,
  context: AgentRunContext,
  availableChecks: readonly AgentCheckName[],
): ExecutionToolGateway {
  const workspace = createSandboxWorkspace({
    sandbox: context.sandbox,
    sourceRoot: context.target.sourceRoot,
    workspaceRoot: context.target.workspaceRoot,
  });

  // The commands the gateway would run, constructed by `validation/commands.ts`
  // — the one place in this codebase allowed to build a command (Sprint 10A §12).
  const packageManager = context.spec.spec.repository.packageManager === "npm" ? "npm" : "pnpm";
  const checkCommands: Partial<Record<AgentCheckName, SandboxCommand>> = {};
  for (const entry of planValidationSteps({ packageManager, scripts: [...availableChecks] })) {
    if (!entry.run || entry.step === "install") continue;
    checkCommands[entry.step as AgentCheckName] = entry.command;
  }

  return new ExecutionToolGateway({
    spec: context.spec.spec,
    workspace,
    limits: context.limits,
    checkCommands,
    commandTimeoutMs: SANDBOX_BUDGETS.commandTimeoutMs,
    now: deps.now,
  });
}

/* ---------------------------------------------------------------------------
 * Step 2a — start the harness, and return (§37, ADR 0029 A1)
 * ------------------------------------------------------------------------ */

/**
 * Launches the agent and finishes in seconds.
 *
 * ## Why this is not "run the agent"
 *
 * Because the first real run was killed doing exactly that. It reached
 * Anthropic 27 times over five minutes and the platform ended the step at 300
 * seconds — with the harness still working, the run row still reading
 * `turns: 0`, the reservation still held and the sandbox still alive.
 *
 * The budget promises twenty minutes of agent work. No Vercel step can hold a
 * connection open that long, and lowering the budget to fit would be answering
 * a platform constraint by giving the customer less. So the harness is
 * detached: this step starts it and returns, and short polling steps watch it.
 *
 * ## The marker, and why it is planted here
 *
 * Immediately before the first turn, after both installs, so an install
 * artifact is never mistaken for the agent's work. The baseline listing is
 * taken at the same instant and left *in the sandbox*, because the step that
 * will compare against it does not exist yet.
 */
export async function startAgentStep(
  deps: AgentExecutionDeps,
  operationId: string,
  availableChecks: readonly AgentCheckName[],
): Promise<StepOutcome<{ paused?: boolean }>> {
  const loaded = await loadAgentRunContext(deps, operationId);
  if (!loaded.ok) return loaded;
  const { context } = loaded;

  const mismatches = checkBudgetMatchesScope({
    budget: context.spec.spec.budget!,
    policy: context.spec.spec.policy,
  });
  if (mismatches.length > 0) {
    console.error("[agent-execution] budget and write scope disagree", { mismatches });
    return { ok: false, failureCode: "change_preparation_failed" };
  }

  /*
   * The paid-call guard, and the reason a retry cannot buy a second agent.
   *
   * Scoped to `queued`, so the second entrant reports false. Taken *before* the
   * harness is launched rather than after, because the ambiguity §37 forbids
   * resolving optimistically is "did a provider call already happen", and the
   * only safe order is to claim first.
   */
  const claimed = await markAgentRunStarted(deps.supabase, context.run.id);
  if (!claimed) return { ok: false, failureCode: "inference_interrupted" };

  /*
   * Re-acquires a hold a pause released (ADR 0041 §P2).
   *
   * `context.run.creditReservationId` is the historical pointer left by
   * `claimAgentExecutionRun` — non-null exactly when this run was billable at
   * claim time, and never cleared by a release. On a fresh, never-paused run
   * that pointer's reservation is still active, so `operationHasCreditHold`
   * is true and this is a no-op — the same code path covers first entry and
   * resume without branching on which one this is.
   *
   * The idempotency key is scoped to the operation's current pause cycle, not
   * the bare operation id, mirroring `runInferenceStep`'s identical re-acquire
   * for business_audit: reusing `operation:<id>` would find the first (now
   * released) reservation and replay it rather than take a fresh one. A
   * retried entry for the same cycle lands on the same reservation; a later
   * pause/resume cycle takes a distinct one.
   *
   * Must land before any terminal transition: `completeAgentRun` /
   * `failAgentRun` finalize whatever `credit_reservation_id` currently names,
   * so the pointer is updated here, immediately once a fresh reservation
   * exists, rather than left to a later step.
   *
   * Tracked in a local rather than re-read off `context.run` below: `context`
   * was loaded once at the top of this call and never refreshed, so a second
   * interrupt raised later in this same invocation must consult this variable
   * — not the stale snapshot — or its own release would name the reservation
   * this step just replaced rather than the one it is actually holding.
   */
  let creditReservationId = context.run.creditReservationId;
  if (creditReservationId && !(await operationHasCreditHold(deps.supabase, operationId))) {
    const reacquired = await authorizeOperationCredits(deps.supabase, {
      projectId: context.run.projectId,
      operation: "agent_execution_dogfood",
      idempotencyKey: `operation:${operationId}:resume:${context.operation.pauseCycle}`,
      operationRunId: operationId,
    });

    if (!reacquired.ok) {
      return { ok: false, failureCode: "insufficient_credits" };
    }

    creditReservationId = reacquired.billable ? reacquired.reservationId : null;
    if (creditReservationId) {
      await updateAgentRunCreditReservation(deps.supabase, context.run.id, creditReservationId);
    }
  }

  await setOperationStage(deps.supabase, { operationId, stage: "running_agent" });

  await recordLifecycle(deps, context.run, "agent_started", "Started working on the change", {
    model: context.run.model,
    maxWallClockMs: context.limits.maxWallClockMs,
    maxSdkIterations: context.limits.maxTurns,
  });

  if (!(await captureWorkspaceBaseline({
    sandbox: context.sandbox,
    cwd: context.paths.workspaceCwd,
    baselinePath: context.paths.baselinePath,
  }))) {
    return { ok: false, failureCode: "sandbox_lost" };
  }

  if (!(await plantChangeMarker({
    sandbox: context.sandbox,
    markerPath: context.paths.markerPath,
  }))) {
    return { ok: false, failureCode: "sandbox_lost" };
  }

  const gateway = buildToolGateway(deps, context, availableChecks);

  /*
   * What Vibe already knows that bears on this step (EXECUTION CONTEXT
   * INTELLIGENCE, PART D).
   *
   * Wrapped, and null on any failure. A brief is an optimisation over an
   * execution that already worked without one: an unreadable snapshot must cost
   * this run its briefing, never its run. `loadExecutionBrief` is scoped by the
   * project id on the persisted run row, because this is the service-role
   * client and RLS is not doing the scoping (Rule 53).
   */
  const contextInput = {
    supabase: deps.supabase,
    projectId: context.run.projectId,
    spec: context.spec.spec,
  };

  let brief: ExecutionBrief | null = null;
  let verification: AgentVerificationPlan | null = null;
  try {
    [brief, verification] = await Promise.all([
      loadExecutionBrief(contextInput),
      loadAgentVerificationPlan(contextInput),
    ]);
  } catch (error) {
    console.error("[execution-context] the brief could not be compiled", {
      operationId,
      agentExecutionRunId: context.run.id,
      detail: error instanceof Error ? `${error.name}: ${error.message.slice(0, 200)}` : "unknown",
    });
  }

  const completionBudget = completionBudgetFor(verification);

  /*
   * Do Vibe's two policies contradict each other? (PART M)
   *
   * Run #7's LOW plan required a diff review and its completion budget refused
   * every attempt at one. Both were internally consistent; nothing compared
   * them, so whichever check ran first won. This compares them before the
   * harness starts, and a contradiction is a bug in Vibe's own configuration
   * rather than a customer's situation — so it is logged loudly and the run
   * continues under the safer of the two, exactly as it would have without a
   * plan at all.
   */
  if (verification && completionBudget) {
    try {
      assertPolicyConsistency(verification, completionBudget);
    } catch (error) {
      console.error("[execution-context] trusted policies contradict each other", {
        operationId,
        agentExecutionRunId: context.run.id,
        detail: error instanceof Error ? error.message.slice(0, 300) : "unknown",
      });
    }
  }

  const instruction = compileAgentInstruction({
    spec: context.spec.spec,
    limits: context.limits,
    availableChecks,
    brief,
    verification,
    completion: completionBudget,
  });

  /*
   * The plan, recorded before the harness can act on it (Sprint 0042).
   *
   * Written from the compiled plan rather than re-derived later, for the same
   * reason the context counts are: a stored run has to say what it was actually
   * told, and observability that recomputes its own inputs eventually disagrees
   * with the run it is describing.
   */
  if (verification) {
    await recordAgentRunObservations(deps.supabase, context.run.id, {
      verificationMode: verification.mode,
      verificationPlanVersion: verification.planVersion,
    });

    if (completionBudget) {
      await recordAgentRunObservations(deps.supabase, context.run.id, {
        completionBudgetVersion: completionBudget.budgetVersion,
      });

      await recordLifecycle(
        deps,
        context.run,
        "completion_budget_compiled",
        `Completion budget: ${completionBudget.mode}`,
        {
          budgetVersion: completionBudget.budgetVersion,
          mode: completionBudget.mode,
          implementationStabilisationCalls: completionBudget.implementationStabilisationCalls,
          maxCompletionActions: completionBudget.maxCompletionActions,
          maxOutsideBriefReads: completionBudget.maxOutsideBriefReads,
          maxConvergenceWindows: completionBudget.maxConvergenceWindows,
          maxRepairCycles: completionBudget.maxRepairCycles,
          maxCompletionWallClockMs: completionBudget.maxCompletionWallClockMs,
        },
      );
    }

    await recordLifecycle(
      deps,
      context.run,
      "verification_plan_compiled",
      `Checking plan: ${verification.mode}`,
      {
        mode: verification.mode,
        planVersion: verification.planVersion,
        required: verification.requiredChecks.join(", "),
        allowed: verification.allowedChecks.join(", ") || "none",
        forbidden: verification.forbiddenChecks.join(", ") || "none",
        maxCommands: verification.maxVerificationCommands,
        maxWallClockMs: verification.maxVerificationWallClockMs,
      },
    );
  }

  /*
   * Recorded before the harness starts, from what was actually compiled.
   *
   * `instruction.context` describes the bytes that went into the prompt rather
   * than what a brief would render to if asked again later — observability that
   * re-derives what a run was given eventually disagrees with what the run was
   * given. A run that was briefed but read none of it is a finding; a run that
   * lost the record of being briefed is a hole.
   */
  if (brief && instruction.context) {
    await recordAgentRunObservations(deps.supabase, context.run.id, {
      contextBriefVersion: brief.briefVersion,
      contextFreshness: brief.freshness.state,
      contextBytes: instruction.briefed ? instruction.context.bytes : 0,
      contextFactsSent: instruction.briefed ? instruction.context.factsRendered : 0,
      contextCandidatesSent: instruction.briefed ? instruction.context.candidatesRendered : 0,
      /*
       * How large the repository being compressed was (Sprint 0053).
       *
       * Recorded unconditionally on `instruction.briefed`, unlike the three
       * lines above it. Those measure what reached the prompt, so a withheld
       * brief genuinely sent zero bytes. This measures the *tree*, which was
       * that size whether or not Vibe chose to describe it — and the compiler
       * has already nulled every field when the snapshot was not fresh, which
       * is the case where the size is genuinely unknown for this commit.
       */
      contextCandidatesAvailable: brief.repositoryScale.candidatesAvailable,
      repoTreeEntries: brief.repositoryScale.treeEntries,
      repoFilesAnalyzed: brief.repositoryScale.filesAnalyzed,
      repoBytesAnalyzed: brief.repositoryScale.bytesAnalyzed,
      repoRoutesDetected: brief.repositoryScale.routesDetected,
      repoSurfacesDetected: brief.repositoryScale.surfacesDetected,
      /*
       * What the step's own cited evidence said its surface was (Sprint 0044).
       *
       * Recorded even when nothing resolved, because an empty scope list is the
       * finding: it means the planner cited nothing this compiler recognises,
       * and the run fell back to the prose hints that made run #6 and run #7
       * compile to byte-identical briefs.
       */
      contextSurfaceScopes: [...brief.surface.requirement.scopes],
      contextSurfacePages:
        brief.surface.publicPagesResolved + brief.surface.authenticatedPagesResolved,
    });

    await recordLifecycle(
      deps,
      context.run,
      "context_compiled",
      instruction.briefed
        ? "Started from what Vibe already knows about this project"
        : "Nothing Vibe knows applied to this commit",
      {
        briefVersion: brief.briefVersion,
        freshness: brief.freshness.state,
        briefed: instruction.briefed,
        bytes: instruction.context.bytes,
        facts: instruction.context.factsRendered,
        candidates: instruction.context.candidatesRendered,
        factsOmitted: instruction.context.factsOmitted,
        candidatesOmitted: instruction.context.candidatesOmitted,
        // What the compiler was selecting from, beside what it selected. The
        // pair is the point: 12 of 12 and 12 of 40 cost very different money.
        candidatesAvailable: brief.repositoryScale.candidatesAvailable,
        repositoryRoutes: brief.repositoryScale.routesDetected,
        repositoryTreeEntries: brief.repositoryScale.treeEntries,
      },
    );

    /*
     * The surface, separately from the size of the brief.
     *
     * Run #6 and run #7 produced identical `context_compiled` payloads — same
     * bytes, same facts, same candidates — for two tasks whose execution
     * surfaces have nothing in common. This is the line that would have shown
     * the difference before a paid run had to.
     */
    await recordLifecycle(
      deps,
      context.run,
      "execution_surface_resolved",
      brief.surface.requirement.scopes.length > 0
        ? `This step's surface: ${brief.surface.requirement.scopes.join(", ")}`
        : "The step cites no evidence this compiler recognises",
      {
        requirementVersion: brief.surface.requirement.requirementVersion,
        scopes: brief.surface.requirement.scopes.join(", ") || "none",
        surfaces: brief.surface.requirement.surfaces.join(", ") || "none",
        derivedFrom: brief.surface.requirement.derivedFrom.join(", ") || "none",
        unrecognised: brief.surface.requirement.unrecognised.join(", ") || "none",
        publicPagesResolved: brief.surface.publicPagesResolved,
        publicPagesIncluded: brief.surface.publicPagesIncluded,
        authenticatedPagesResolved: brief.surface.authenticatedPagesResolved,
        authenticatedPagesIncluded: brief.surface.authenticatedPagesIncluded,
      },
    );
  }

  const started = await context.provider.start({
    runId: context.run.id,
    instruction,
    model: context.run.model,
    effort: "high",
    tools: agentToolDescriptors(availableChecks),
    limits: {
      maxTurns: context.limits.maxTurns,
      maxWallClockMs: context.limits.maxWallClockMs,
      maxProviderSpendUsd: context.limits.maxProviderSpendUsd,
    },
    invokeTool: (name: string, input: unknown) => gateway.invoke(name, input),
    // Carried into the sandbox as data. The harness is the only place a shell
    // command exists before it runs, so it is the only place this can apply.
    ...(verification ? { verification: toSandboxPolicy(verification) } : {}),
    /*
     * The completion budget, with the brief's own paths.
     *
     * The paths are what let the harness tell a read of a file Vibe pointed at
     * from a read of one it did not — the distinction the outside-brief
     * allowance rests on, and the reason the brief and the budget are compiled
     * together rather than in two places.
     */
    ...(completionBudget
      ? {
          completion: toSandboxCompletionPolicy({
            budget: completionBudget,
            briefPaths: (brief?.fileCandidates ?? []).map((candidate) => candidate.path),
            /*
             * The required checks travel with the budget, because the harness
             * has to know which operations a Vibe policy already marked
             * required before it may refuse one on resource grounds (PART H).
             */
            requiredChecks: verification?.requiredChecks ?? [],
          }),
        }
      : {}),
    // Nothing to cancel through: the harness outlives this call. Cancellation
    // is the poll loop's job, and the sandbox's own lifetime is the backstop.
    signal: new AbortController().signal,
  });

  /*
   * The tool trail is written here, not at collect.
   *
   * It belongs to the gateway instance the harness was handed, and that
   * instance dies with this invocation — the collecting step is a different
   * function on a different machine and builds a fresh, empty one. Recording it
   * anywhere else would silently persist zeros.
   *
   * Under the sandbox topology the trail is empty by construction: the harness
   * edits files with its own tools inside the VM and never calls back. It is
   * still written, because "the gateway brokered nothing" is a fact worth
   * having recorded rather than an absence to infer.
   */
  const counters = gateway.counters;
  await recordAgentRunObservations(deps.supabase, context.run.id, {
    toolCallsAllowed: counters.allowedCalls,
    toolCallsDenied: counters.deniedCalls,
    filesRead: counters.filesRead,
    checkRuns: counters.checkRuns,
    repairAttempts: gateway.repairAttempts,
    changedBytes: counters.changedBytes,
  });

  await recordAgentToolEvents(deps.supabase, {
    runId: context.run.id,
    projectId: context.run.projectId,
    events: gateway.toolEvents,
  });
  await recordAgentActivity(deps.supabase, {
    runId: context.run.id,
    projectId: context.run.projectId,
    records: gateway.activityRecords,
  });

  const interrupt = gateway.interrupt;
  if (interrupt) {
    await raiseExecutionInterrupt(deps.supabase, {
      projectId: context.run.projectId,
      userId: context.run.userId,
      executionSpecId: context.run.executionSpecId,
      agentExecutionRunId: context.run.id,
      interrupt,
    });
    const paused = await pauseAgentRunForUser(deps.supabase, context.run.id);
    await pauseOperationForUser(deps.supabase, operationId);

    /*
     * Release-on-pause (ADR 0041 §P2).
     *
     * Real inference already ran to reach this interrupt — activity and tool
     * events were already recorded above — so the release is
     * `abandoned_with_usage`, not `cancelled_before_usage`. Guarded on
     * `paused`, the actual winner of `pauseAgentRunForUser`'s CAS, mirroring
     * `expireStaleAgentExecution`'s own "whoever wins the swap owns
     * finalization" rule.
     *
     * `creditReservationId`, not `context.run.creditReservationId`: a resume
     * can raise a second interrupt within this same invocation, after the
     * re-acquire above has already replaced the reservation this run holds.
     * Releasing the stale snapshot would name the reservation this step just
     * moved away from rather than the one actually funding it.
     */
    if (paused && creditReservationId) {
      await releaseOperationCredits(deps.supabase, {
        reservationId: creditReservationId,
        reason: "abandoned_with_usage",
      });
    }

    await recordAuditEvent(deps.supabase, {
      userId: context.run.userId,
      projectId: context.run.projectId,
      eventType: "agent_execution.needs_user_input",
      metadata: {
        projectId: context.run.projectId,
        operationId,
        agentExecutionRunId: context.run.id,
        interruptType: interrupt.type,
      },
    });

    return { ok: true, paused: true };
  }

  if (!started.ok) {
    console.error("[agent-execution] the agent harness could not be started", {
      operationId,
      agentExecutionRunId: context.run.id,
      detail: started.failureDetail,
    });
    return { ok: false, failureCode: "provider_unavailable" };
  }

  return { ok: true };
}

/* ---------------------------------------------------------------------------
 * Step 2b — watch it, briefly and repeatedly
 * ------------------------------------------------------------------------ */

export type PollAgentOutcome = StepOutcome<{
  /** The harness wrote its result. Nothing further will change. */
  finished: boolean;
  /** The run outlived its authorized wall clock and must be stopped. */
  expired: boolean;
  /** Model responses observed so far — already persisted before this returns. */
  assistantMessages: number;
}>;

/**
 * One short look at a running agent.
 *
 * Cheap by construction: it reconnects, reads two small files and writes at
 * most one column. It is called on a timer for the whole length of a run, so
 * anything expensive here is paid for dozens of times.
 *
 * The turn count is persisted *here*, not at the end. That is the whole point —
 * the first real run's turns were lost because the only record of them lived in
 * a function the platform killed.
 */
export async function pollAgentStep(
  deps: AgentExecutionDeps,
  operationId: string,
): Promise<PollAgentOutcome> {
  const loaded = await loadAgentRunContext(deps, operationId);
  if (!loaded.ok) return loaded;
  const { context } = loaded;

  const observation = await context.provider.observe();

  // Written before anything else can fail. A model response that happened is a
  // fact about what a customer was charged for (Rule 47).
  await recordAgentMessageProgress(deps.supabase, context.run.id, observation.assistantMessages);

  /*
   * The harness's feed, made durable.
   *
   * The whole file is re-offered on every poll and the write is an upsert on
   * the sequence the harness itself assigned, so a lost poll costs nothing and
   * a workflow retry rewrites identical rows. That is the same property the
   * turn counter has, for the same reason: nothing in this process survives to
   * the next invocation, so a cursor would be a fourth thing to lose.
   *
   * Wrapped, because this is telemetry hanging off a paid run. A run whose
   * event log could not be written is still a run.
   */
  if (observation.entries && observation.entries.length > 0) {
    try {
      await recordExecutionEvents(deps.supabase, {
        runId: context.run.id,
        projectId: context.run.projectId,
        userId: context.run.userId,
        events: eventsFromRuntimeFeed({
          entries: observation.entries,
          observedAt: new Date((deps.now ?? Date.now)()).toISOString(),
          // The two halves of a real timestamp: Vibe's own start time, and the
          // harness's offset from it. Neither alone is enough — the sandbox's
          // clock is not this system's, and a poll's read time stamps a whole
          // batch with one moment.
          startedAt: context.run.startedAt,
          workspaceDir: context.paths.workspaceDir,
        }),
      });
    } catch (error) {
      console.error("[agent-observability] the runtime feed could not be recorded", {
        operationId,
        agentExecutionRunId: context.run.id,
        detail: error instanceof Error ? `${error.name}: ${error.message.slice(0, 200)}` : "unknown",
      });
    }
  }

  /*
   * The wall clock, enforced by Vibe against durable state.
   *
   * Measured from the run row's own `started_at` rather than from anything this
   * invocation remembers, because no invocation has been here before. A harness
   * that ignored its own ceiling is stopped by this and by the sandbox's
   * independent lifetime — two bounds, neither of which is the agent's to hold.
   */
  const startedAt = context.run.startedAt ? Date.parse(context.run.startedAt) : null;
  const now = (deps.now ?? Date.now)();
  const expired =
    startedAt !== null && Number.isFinite(startedAt)
      ? now - startedAt > context.limits.maxWallClockMs
      : false;

  return {
    ok: true,
    finished: observation.finished,
    expired,
    assistantMessages: observation.assistantMessages,
  };
}

/* ---------------------------------------------------------------------------
 * Step 2c — collect what it left behind (§16, §17, §19, §25, §35)
 * ------------------------------------------------------------------------ */

export type RunAgentOutcome = StepOutcome<{
  /** True when the run stopped on a question and is holding (§25). */
  paused: boolean;
  /**
   * Paths Vibe observed, *before* any of them is known to be a change.
   *
   * Named for what it is. The candidate count comes one step later, from the
   * comparison against the pinned base, and is usually smaller — 14 against 2
   * in run #3, because the agent's own build wrote twelve artifacts the
   * repository ignores.
   */
  observedPathCount: number;
  /**
   * The paths Vibe observed.
   *
   * Carried to the extract step rather than re-derived there, because the
   * answer must be taken at the moment the agent stopped and while its baseline
   * is still in the sandbox — not after whatever else touches the workspace next.
   */
  changedPaths: readonly string[] | null;
}>;

export async function collectAgentStep(
  deps: AgentExecutionDeps,
  operationId: string,
): Promise<RunAgentOutcome> {
  const loaded = await loadAgentRunContext(deps, operationId);
  if (!loaded.ok) return loaded;
  const { context } = loaded;
  const { run } = context;

  const startedAtMs = run.startedAt ? Date.parse(run.startedAt) : (deps.now ?? Date.now)();
  const result = await context.provider.collect({
    startedAtMs: Number.isFinite(startedAtMs) ? startedAtMs : (deps.now ?? Date.now)(),
  });

  /*
   * What the run changed, read off the filesystem while the sandbox is still
   * alive and before anything else touches it.
   *
   * Taken even when the run failed. A harness that died after writing four
   * files still wrote four files, and a change set that quietly became empty
   * because of how a run ended would be a false statement about the workspace.
   */
  const baseline = await readWorkspaceBaseline({
    sandbox: context.sandbox,
    baselinePath: context.paths.baselinePath,
  });

  const observed = baseline
    ? await discoverWorkspaceChanges({
        sandbox: context.sandbox,
        cwd: context.paths.workspaceCwd,
        before: baseline,
        markerPath: context.paths.markerPath,
      })
    : null;

  const changedPaths = observed?.paths ?? null;
  const observedPathCount = changedPaths?.length ?? 0;

  /*
   * Only the columns this step is the one to know.
   *
   * The tool counters were written when the harness was started, by the gateway
   * instance that saw the calls. Writing them again from a gateway rebuilt here
   * would overwrite a real trail with the zeros of an object nothing ever used.
   *
   * `observed_path_count`, not `changed_file_count`. This step has looked at the
   * filesystem and nothing else: it does not yet know which of these paths are
   * a change, because that is decided by comparing them against the pinned base
   * one step later. Run #3 stored 14 in a column named for the other number and
   * the change was two files — the same confusion that made run #2's eighteen
   * touched paths read as eighteen changes.
   */
  await recordAgentRunObservations(deps.supabase, run.id, {
    /*
     * Both counts, each written under its own name.
     *
     * `sdkLoopIterations` is the unit the budget's ceiling is in and is null
     * when the harness never reported one — which is the honest value for a run
     * that died before its terminal message. Filling it with the message count
     * is the substitution that made run b33635a1 read "66 / 40".
     */
    assistantMessages: result.assistantMessages,
    sdkLoopIterations: result.sdkLoopIterations,
    observedPathCount,
    durationMs: result.durationMs,
    providerSessionId: result.sessionId,
  });

  /*
   * Provider usage is NOT recorded here.
   *
   * Every sampling call already wrote its own row as it happened, from the
   * Agent Gateway — which is the only place that sees what a streamed response
   * actually cost. Recording a summary here as well would double-count a run
   * whose per-call rows are the ones the ceilings are measured against.
   */

  if (result.outcome === "provider_error") {
    /*
     * The one string that says *why*, written where a person can read it.
     *
     * This is an infrastructure error string, not model output: no prompt, no
     * response, no reasoning, so Rules 43 and 47 have nothing to say about it.
     */
    console.error("[agent-execution] the coding-agent provider failed", {
      operationId,
      agentExecutionRunId: run.id,
      provider: context.provider.id,
      durationMs: result.durationMs,
      assistantMessages: result.assistantMessages,
      detail: result.failureDetail,
    });

    return { ok: false, failureCode: "provider_unavailable" };
  }

  /*
   * A change set Vibe is not sure is complete cannot become a diff.
   *
   * The baseline was lost, or a listing degraded, so "these are the files" is a
   * claim this run cannot make. Refusing here is the honest outcome: preparing a
   * partial change would hand a reviewer something to approve that is missing a
   * file nobody knows about (Rule 27).
   */
  if (!baseline || observed?.truncated) {
    console.error("[agent-execution] the workspace observation was incomplete", {
      operationId,
      agentExecutionRunId: run.id,
      baselineFound: baseline !== null,
      observedPaths: observed?.paths.length ?? 0,
    });
    return { ok: false, failureCode: "change_preparation_failed" };
  }

  await recordLifecycle(deps, run, "agent_finished", "Finished working on the change", {
    outcome: result.outcome,
    assistantMessages: result.assistantMessages,
    // Null when the harness never reported one, and recorded as null rather
    // than as the message count — the inspector reads this field directly.
    sdkLoopIterations: result.sdkLoopIterations,
    durationMs: result.durationMs,
  });

  await recordLifecycle(
    deps,
    run,
    "change_discovered",
    `Observed ${observedPathCount} ${observedPathCount === 1 ? "path" : "paths"} in the workspace`,
    { observedPaths: observedPathCount },
  );

  await recordContextUsage(deps, context);
  await recordVerificationOutcome(deps, context, result);

  return { ok: true, paused: false, observedPathCount, changedPaths };
}


/* ---------------------------------------------------------------------------
 * What the briefing was worth (EXECUTION CONTEXT INTELLIGENCE, PART L, PART M)
 * ------------------------------------------------------------------------ */

/**
 * Counts what the run read against what it was briefed with.
 *
 * ## Where each half comes from
 *
 * The reading comes from the durable `file_read` events, which were built from
 * the harness's own tool stream — what the agent *executed*, never its account
 * of what it looked at (Rule 77). The briefing is recompiled: it is a pure
 * function of the immutable spec and the snapshot that spec names, so the same
 * inputs give the same candidates, and storing a second copy of a list already
 * derivable from stored state would be the duplicate source of truth this
 * sprint exists to avoid.
 *
 * "Recompiled" is checked rather than assumed. If the recompiled brief does not
 * match the version and freshness the run recorded at start, nothing is written
 * — an unmeasurable run is recorded as unmeasured, which is a fact, rather than
 * as a comparison against a briefing it was never given.
 *
 * ## Why a failure here changes nothing
 *
 * Because this is telemetry hanging off a paid execution, computed after the
 * change has already been observed. A run whose context metrics could not be
 * written is still a run, and its change is still exactly as good.
 */
async function recordContextUsage(
  deps: AgentExecutionDeps,
  context: AgentRunContext,
): Promise<void> {
  const { run } = context;
  if (!run.contextBriefVersion) return;

  try {
    const brief = await loadExecutionBrief({
      supabase: deps.supabase,
      projectId: run.projectId,
      spec: context.spec.spec,
    });

    if (
      !brief ||
      brief.briefVersion !== run.contextBriefVersion ||
      brief.freshness.state !== run.contextFreshness
    ) {
      return;
    }

    const events = await listExecutionEvents(deps.supabase, {
      runId: run.id,
      projectId: run.projectId,
      limit: MAX_EVENTS_PER_RUN,
    });

    const readPaths = events
      .filter((event) => event.type === "file_read")
      .map((event) => event.metadata.path)
      .filter((path): path is string => typeof path === "string");

    const usage = summarizeContextUsage({
      candidates: brief.fileCandidates.map((candidate) => candidate.path),
      readPaths,
    });

    await recordAgentRunObservations(deps.supabase, run.id, {
      contextCandidatesRead: usage.candidatesRead,
      uniqueFilesRead: usage.uniqueFilesRead,
      repeatedFileReads: usage.repeatedFileReads,
      filesReadOutsideContext: usage.filesReadOutsideContext,
    });

    await recordLifecycle(
      deps,
      run,
      "context_used",
      `Read ${usage.candidatesRead} of ${usage.candidatesOffered} briefed file(s) and ` +
        `${usage.filesReadOutsideContext} beyond the briefing`,
      {
        candidatesOffered: usage.candidatesOffered,
        candidatesRead: usage.candidatesRead,
        uniqueFilesRead: usage.uniqueFilesRead,
        repeatedFileReads: usage.repeatedFileReads,
        filesReadOutsideContext: usage.filesReadOutsideContext,
      },
    );
  } catch (error) {
    console.error("[execution-context] context usage could not be recorded", {
      agentExecutionRunId: run.id,
      detail: error instanceof Error ? `${error.name}: ${error.message.slice(0, 200)}` : "unknown",
    });
  }
}


/**
 * Provider calls and cost after the last observed write (PART L).
 *
 * A timestamp comparison against one boundary, and nothing cleverer. Returns
 * nothing at all when the boundary is unknown — PART L is explicit that an
 * unreliable split should not exist rather than exist approximately, and a run
 * that wrote no file has no far side to be on.
 *
 * `provider_cost_usd` is untouched. This is an additional column beside it,
 * never a re-derivation of it.
 */
async function postEditSpend(
  deps: AgentExecutionDeps,
  run: StoredAgentExecutionRun,
  lastEditMs: number | null,
): Promise<{ postEditProviderCalls?: number; postEditProviderCostUsd?: number }> {
  if (lastEditMs === null || !run.startedAt) return {};

  const boundary = new Date(Date.parse(run.startedAt) + lastEditMs).toISOString();

  const { data, error } = await deps.supabase
    .from("ai_usage_events")
    .select("provider_cost_usd")
    .eq("job_id", run.id)
    .eq("project_id", run.projectId)
    .gt("created_at", boundary);

  if (error) return {};

  const rows = (data ?? []) as { provider_cost_usd: string | number | null }[];
  return {
    postEditProviderCalls: rows.length,
    postEditProviderCostUsd: rows.reduce<number>(
      (total, row) => total + Number(row.provider_cost_usd ?? 0),
      0,
    ),
  };
}

/**
 * How many post-edit reads landed outside what the brief named.
 *
 * The number the outside-brief allowance exists to move. Compared against the
 * recompiled brief's own candidate paths, and skipped entirely when the brief
 * cannot be reproduced — an unmeasurable run is recorded as unmeasured.
 */
async function postEditBriefReads(
  deps: AgentExecutionDeps,
  run: StoredAgentExecutionRun,
  spec: ExecutionSpec,
  postEdit: readonly { type: string; metadata: Record<string, unknown> }[],
): Promise<{ postEditReadsBeyondBrief?: number }> {
  if (!run.contextBriefVersion) return {};

  try {
    const brief = await loadExecutionBrief({
      supabase: deps.supabase,
      projectId: run.projectId,
      spec,
    });
    if (!brief || brief.briefVersion !== run.contextBriefVersion) return {};

    const named = new Set(brief.fileCandidates.map((candidate) => candidate.path));
    const reads = postEdit.filter((event) => event.type === "file_read");

    return {
      postEditReadsBeyondBrief: reads.filter((event) => {
        const path = event.metadata.path;
        return typeof path === "string" && !named.has(path);
      }).length,
    };
  } catch {
    return {};
  }
}

/** Tool events that count as "the agent did something" for the tail counters. */
const TOOL_EVENT_TYPES: ReadonlySet<string> = new Set([
  "file_read",
  "file_written",
  "file_edited",
  "file_searched",
  "command_started",
]);

/**
 * What the verification plan cost, and where the implementation ended
 * (Sprint 0042, PART K, PART L).
 *
 * ## The boundary, and why it is named for what it measures
 *
 * Vibe cannot observe the moment an agent believes it is finished — there is no
 * signal for it, and asking the agent would be reading its account of its own
 * work, which Rule 77 forbids for exactly this kind of question. What Vibe can
 * observe is the last time it wrote a file. Everything after that instant was
 * checking or exploring, so `time_to_last_edit_ms` is the honest approximation
 * and the column is named for the observation rather than for the inference.
 *
 * That one number is what makes PART L answerable without inventing a split:
 * with it, "how many provider calls happened after the implementation was
 * already complete" is a timestamp comparison against the usage ledger, done at
 * read time, rather than a figure stored here that could drift from it.
 *
 * ## Failure changes nothing
 *
 * Telemetry hanging off a paid execution, computed after the change has already
 * been observed. A run whose verification metrics could not be written is still
 * a run, and its change is exactly as good.
 */
async function recordVerificationOutcome(
  deps: AgentExecutionDeps,
  context: AgentRunContext,
  /*
   * Passed in rather than read off the run row.
   *
   * The row was loaded at the top of this step, before this invocation wrote
   * `duration_ms` to it — so `run.durationMs` here is whatever it was *before*
   * the run finished, which for every real run is null. The collected result is
   * the only value that describes the run that just ended.
   */
  result: {
    durationMs: number;
    verificationCommands: number | null;
    verificationRefusals: number | null;
    policyDecisions: number | null;
    repairCycles: number | null;
    implementationMutations: number | null;
    convergenceMutations: number | null;
    requiredVerificationActions: number | null;
    requiredVerificationOverrides: number | null;
  },
): Promise<void> {
  const { run } = context;
  const durationMs = result.durationMs;

  try {
    const events = await listExecutionEvents(deps.supabase, {
      runId: run.id,
      projectId: run.projectId,
      limit: MAX_EVENTS_PER_RUN,
    });

    const startedAt = run.startedAt ? Date.parse(run.startedAt) : Number.NaN;
    if (!Number.isFinite(startedAt)) return;

    const offsetOf = (event: { occurredAt: string }): number | null => {
      const at = Date.parse(event.occurredAt);
      return Number.isFinite(at) ? Math.max(0, at - startedAt) : null;
    };

    const writes = events.filter(
      (event) => event.type === "file_written" || event.type === "file_edited",
    );
    const checks = events.filter((event) => event.type === "verification_check_started");
    const refusals = events.filter((event) => event.type === "verification_command_refused");

    const editOffsets = writes.map(offsetOf).filter((value): value is number => value !== null);
    const checkOffsets = checks.map(offsetOf).filter((value): value is number => value !== null);

    /*
     * From the first permitted check to the end of the run.
     *
     * Not "the sum of the check durations": the gaps between checks are the
     * model deciding what to do next, and that time is bought by the plan just
     * as surely as the commands are. Run #4's 4m58s was mostly the commands,
     * but a run that spends two minutes thinking between two ten-second tests
     * has still spent two minutes on verification.
     */
    const verificationMs =
      checkOffsets.length > 0 ? Math.max(0, durationMs - Math.min(...checkOffsets)) : null;

    /*
     * The harness's own count wins, and a disagreement is logged.
     *
     * Two counters exist because one of them cannot detect its own silence.
     * Run #5 derived zero verification commands from the feed while the run
     * had executed a permitted targeted test — correct arithmetic over an
     * empty set, because `allowedTools` had auto-allowed Bash past the
     * permission handler and the decision point was never reached. A counter
     * written where the decision happens is the only thing that could have
     * disagreed, and the disagreement is the bug report.
     */
    const harnessChecks = result.verificationCommands;
    if (harnessChecks !== null && harnessChecks !== checks.length) {
      console.error("[agent-verification] the harness and the feed disagree on check count", {
        agentExecutionRunId: run.id,
        harness: harnessChecks,
        feed: checks.length,
      });
    }

    /*
     * The tail, counted against the one boundary Vibe can actually observe.
     *
     * Everything after the last write was either checking or exploring, and
     * splitting those two apart afterwards would need to know what the agent
     * intended. The useful question — how much did this run spend once the code
     * was already written — does not need that, so it is not claimed.
     */
    const lastEditMs = editOffsets.length > 0 ? Math.max(...editOffsets) : null;
    const after = (event: { occurredAt: string }): boolean => {
      const offset = offsetOf(event);
      return lastEditMs !== null && offset !== null && offset > lastEditMs;
    };

    const postEdit = events.filter(after);
    const completionRefusals = events.filter(
      (event) => event.type === "completion_action_refused",
    );

    await recordAgentRunObservations(deps.supabase, run.id, {
      verificationCommands: harnessChecks ?? checks.length,
      verificationRefusals: result.verificationRefusals ?? refusals.length,
      verificationMs,
      timeToFirstEditMs: editOffsets.length > 0 ? Math.min(...editOffsets) : null,
      timeToLastEditMs: lastEditMs,

      postEditToolCalls: postEdit.filter((event) => TOOL_EVENT_TYPES.has(event.type)).length,
      postEditReads: postEdit.filter((event) => event.type === "file_read").length,
      postEditCommands: postEdit.filter((event) => event.type === "command_started").length,
      completionRefusals: completionRefusals.length,
      repairCycles: result.repairCycles ?? undefined,
      implementationMutations: result.implementationMutations ?? undefined,
      convergenceMutations: result.convergenceMutations ?? undefined,
      requiredVerificationActions: result.requiredVerificationActions ?? undefined,
      requiredVerificationOverrides: result.requiredVerificationOverrides ?? undefined,
      policyDecisions: result.policyDecisions,
      ...(await postEditSpend(deps, run, lastEditMs)),
      ...(await postEditBriefReads(deps, run, context.spec.spec, postEdit)),
    });

    if (run.verificationMode) {
      await recordLifecycle(
        deps,
        run,
        "verification_completed",
        `Ran ${checks.length} check(s); ${refusals.length} refused by policy`,
        {
          mode: run.verificationMode,
          commands: checks.length,
          refusals: refusals.length,
          verificationMs: verificationMs ?? 0,
          lastEditMs: editOffsets.length > 0 ? Math.max(...editOffsets) : 0,
        },
      );
    }
  } catch (error) {
    console.error("[agent-verification] the verification outcome could not be recorded", {
      agentExecutionRunId: run.id,
      detail: error instanceof Error ? `${error.name}: ${error.message.slice(0, 200)}` : "unknown",
    });
  }
}

/* ---------------------------------------------------------------------------
 * Step 3 — Vibe computes the change and checks it (§27, §28)
 * ------------------------------------------------------------------------ */

export type ExtractOutcome = StepOutcome<{
  files: readonly { path: string; content: string; contentHash: string; bytes: number }[];
  candidateDigest: string;
}>;

/** The writes the tool gateway brokered, under the `gateway_tools` topology. */
async function readBrokeredWritePaths(
  deps: AgentExecutionDeps,
  runId: string,
): Promise<string[]> {
  const { data, error } = await deps.supabase
    .from("agent_tool_events")
    .select("path, decision, capability")
    .eq("agent_execution_run_id", runId)
    .eq("decision", "allowed")
    .in("capability", ["workspace_write_file", "workspace_delete_file"]);

  if (error) throw error;

  return [
    ...new Set(
      ((data ?? []) as { path: string | null }[])
        .map((event) => event.path)
        .filter((path): path is string => path !== null),
    ),
  ];
}

export async function extractAndVerifyStep(
  deps: AgentExecutionDeps,
  operationId: string,
  /** What the agent step observed, when the harness ran in the sandbox. */
  observedPaths: readonly string[] | null = null,
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

  /*
   * The paths, from whichever source this topology makes authoritative — and in
   * neither case from anything the agent said about its own work (Rule 77).
   *
   * Under `gateway_tools` it is the tool trail Vibe wrote as it brokered each
   * write. Under `sandbox_workspace` there is no broker, so it is the
   * filesystem comparison the agent step performed while the sandbox was still
   * alive. The bytes come from the filesystem either way.
   */
  const changedPaths = observedPaths
    ? [...new Set(observedPaths)]
    : await readBrokeredWritePaths(deps, run.id);

  if (changedPaths.length === 0) {
    return { ok: false, failureCode: "agent_produced_no_change" };
  }

  /*
   * Suppression, at the candidate boundary and nowhere earlier.
   *
   * The workspace scan above still reported every path the agent touched, and
   * the evidence below still names all of them. What is decided here is only
   * which of those paths become a *change* — because a file the repository
   * itself ignores was never its source, and writing it onto a branch would be
   * wrong at any budget.
   *
   * Both authorities are read at the pinned base commit: the tree, so a tracked
   * file can never be withheld, and `.gitignore`, so the twenty minutes the
   * agent spent with write access to the workspace cannot influence the rules
   * applied to its own output.
   */
  const skippedIgnoreFiles: { path: string; reason: string }[] = [];
  const candidate = await extractCandidateChange({
    spec: spec.spec,
    changes: changedPaths.map((path) => ({ path, content: null })),
    workspace,
    base: target.base,
    limits,
    tree: target.baseTree,
    ignore: createBaseIgnorePort({
      base: target.base,
      baseSha: spec.spec.repository.baseSha,
      onSkipped: (detail) => skippedIgnoreFiles.push(detail),
    }),
  });

  if (skippedIgnoreFiles.length > 0) {
    // A bound that was reached is reported, never silently absorbed: an ignore
    // file that went unread means some path may be in the change that the
    // repository would have withheld.
    console.warn("[agent-change] some ignore rules could not be read", {
      operationId,
      agentExecutionRunId: run.id,
      skipped: skippedIgnoreFiles,
    });
  }

  /*
   * What the observation actually contained, written down before anything
   * decides on it.
   *
   * Computed for every candidate rather than only for a refused one, because
   * "the change was accepted and here is why it was that size" is the baseline
   * a later rejection is read against. Paths, bytes and counts only — never a
   * byte of the files themselves (Rule 26).
   */
  const evidence = summarizeChangeEvidence({
    observedPaths: changedPaths,
    candidate,
    detectedBy: observedPaths ? "workspace_scan" : "gateway_tool_trail",
  });

  console.info("[agent-change]", {
    operationId,
    agentExecutionRunId: run.id,
    ...evidence,
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
    const metadata = changeRejectionMetadata({
      evidence,
      rejections: verification.rejections,
      violations: verification.violations,
    });

    /*
     * The same evidence in the log as in the audit row.
     *
     * Not redundancy: the audit row is what a reader queries weeks later, and
     * the log line is what is available during a dogfood run while the sandbox
     * is still warm and the next decision is being made.
     */
    console.error("[agent-execution] the produced change was refused", {
      operationId,
      agentExecutionRunId: run.id,
      ...metadata,
    });

    await recordAuditEvent(deps.supabase, {
      userId: run.userId,
      projectId: run.projectId,
      eventType: "agent_execution.change_rejected",
      metadata: {
        projectId: run.projectId,
        operationId,
        agentExecutionRunId: run.id,
        ...metadata,
      },
    });
    await recordLifecycle(deps, run, "change_rejected", "The change was refused", {
      rejections: verification.rejections.join(", "),
      observedPaths: evidence.observedPathCount,
      candidateFiles: evidence.candidateFileCount,
      observedIgnored: evidence.ignoredPathCount,
      totalDiffBytes: evidence.totalDiffBytes,
    });

    return { ok: false, failureCode: "agent_change_rejected" };
  }

  if (verification.files.length === 0) {
    return { ok: false, failureCode: "agent_produced_no_change" };
  }

  /*
   * The candidate count, written by the step that actually knows it.
   *
   * `observed_path_count` was written by collect, from the filesystem. This is
   * the other number: what survived comparison with the pinned base and would
   * be written. Run #3 was 14 and 2, and before this the row carried only the
   * first under a name that promised the second.
   */
  await recordAgentRunObservations(deps.supabase, run.id, {
    changedFileCount: verification.files.length,
    changedBytes: candidate.totalBytes,
  });

  await recordLifecycle(
    deps,
    run,
    "change_verified",
    `${verification.files.length} ${verification.files.length === 1 ? "file" : "files"} changed`,
    {
      candidateFiles: verification.files.length,
      observedPaths: evidence.observedPathCount,
      observedIgnored: evidence.ignoredPathCount,
      totalDiffBytes: evidence.totalDiffBytes,
    },
  );

  /*
   * The evidence for an *accepted* change, made durable.
   *
   * Previously only a refusal wrote one, which had it backwards: an accepted
   * change is the one a human is asked to approve and the one that may reach a
   * branch, so it is the one whose "which paths were withheld, and by which
   * rule" somebody will want months later. Run #3 withheld twelve paths and the
   * only record of which twelve was a platform log.
   */
  await recordAuditEvent(deps.supabase, {
    userId: run.userId,
    projectId: run.projectId,
    eventType: "agent_execution.change_verified",
    metadata: {
      projectId: run.projectId,
      operationId,
      agentExecutionRunId: run.id,
      ...changeEvidenceMetadata(evidence),
    },
  });

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

  /*
   * The commit message, compiled before the write (Sprint 0046, PART H).
   *
   * `loadPlanStep` is the same trusted lookup `execution-context/service.ts`
   * already uses — fixture registry first, then the project's real plan — so
   * this opens no second source of truth. A step it cannot find (an unusual,
   * legitimate case: a plan reworded or removed since the run started)
   * compiles to `null`, and the compiler's own fallback produces a generic but
   * still-real Conventional Commit rather than failing the write.
   *
   * Title, purpose and doneWhen come from this same step, not from
   * `spec.spec.objective` — the two describe the same field in production
   * (the objective was copied from this exact step when the spec was built),
   * but reading one source rather than two avoids a second place either could
   * ever drift from the other.
   */
  const trustedStep = await loadPlanStep({
    supabase: deps.supabase,
    projectId: run.projectId,
    spec: spec.spec,
  });

  const compiledMessage = compileCommitMessage(
    trustedStep
      ? {
          title: trustedStep.title,
          purpose: trustedStep.purpose,
          doneWhen: trustedStep.completionCriteria,
          changeKind: trustedStep.changeKind,
          evidenceIds: trustedStep.evidenceIds,
        }
      : null,
    {
      executionId: run.id,
      stepKey: spec.spec.stepKey,
      preparedChangeId: prepared.id,
    },
  );

  await recordLifecycle(
    deps,
    run,
    "commit_message_compiled",
    compiledMessage.fallback
      ? "Could not classify this change; using the generic commit message"
      : `Commit message: ${compiledMessage.type}${compiledMessage.scope ? `(${compiledMessage.scope})` : ""}`,
    {
      compilerVersion: compiledMessage.compilerVersion,
      type: compiledMessage.type,
      scope: compiledMessage.scope,
      subject: compiledMessage.subject,
      fallback: compiledMessage.fallback,
      fallbackReason: compiledMessage.fallbackReason,
    },
  );

  const write = await prepareChangeOnBranch(
    target.git,
    {
      owner: target.owner,
      repo: target.repo,
      baseBranch: prepared.baseBranch,
      baseSha: prepared.baseSha,
      branchName: prepared.branchName,
      capability: AGENTIC_EXECUTION_CAPABILITY,
      commitMessage: renderCommitMessage(compiledMessage),
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

  await recordLifecycle(deps, run, "branch_prepared", "Your change is ready to review", {
    branch: prepared.branchName,
    commitSha: write.commitSha,
    files: files.length,
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

  await recordLifecycle(deps, run, "sandbox_stopping", "Shutting down the workspace");

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

    await recordLifecycle(deps, run, "sandbox_stopped", "Workspace shut down", {
      activeCpuMs: usage?.activeCpuDurationMs ?? null,
      networkEgressBytes: usage?.networkEgressBytes ?? null,
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

    // Whoever wins the status swap owns the billing finalization.
    //
    // `expireStaleAgentExecution` can finalize this same run from a web request
    // process — it runs on every status poll — so "the workflow is here" is not
    // evidence that the workflow is entitled to charge. Without this gate both
    // processes finalize: E2b measured the result 20 times out of 20 against
    // real PostgreSQL, a charge standing against a hold recorded as released.
    //
    // Nothing new is invented. This is the pattern the three deterministic
    // families already use on `operation_runs.status` — see
    // `business-audit/execution.ts`, where `settleOperationBilling` sits behind
    // `if (!transitioned) return`. Agent execution had the same primitive
    // available, returning the same boolean, and discarded it.
    //
    // The cost of returning here rather than gating the charge alone: an
    // attempt that wins the swap and then dies before `completeOperationRun`
    // leaves an operation row nothing finishes, because the retry loses the
    // swap and stops. That window exists today for the same reason — a crash
    // between two adjacent writes — and is narrower than the alternative, which
    // is letting a process that lost the swap keep writing.
    if (!transitioned) return;

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

    // No longer conditional: reaching this line *is* having won the swap, so a
    // second guard on the same fact would only suggest there is a path where
    // the two disagree.
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

    await recordLifecycle(deps, run, "execution_completed", "Ready for review", {
      preparedChangeId: outcome.preparedChangeId,
    });
    return;
  }

  await cancelOpenInterrupts(deps.supabase, run.id);
  const failed = await failAgentRun(deps.supabase, {
    runId: run.id,
    failureCode: toAgentFailureCode(outcome.failureCode),
  });

  // The same authority, in the other direction. Releasing a hold whose
  // settlement belongs to whoever won the swap is how Vibe loses the charge for
  // work it delivered.
  if (!failed) return;

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

  await recordLifecycle(deps, run, "execution_failed", "The run stopped without a change", {
    failureCode: outcome.failureCode,
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

/* ---------------------------------------------------------------------------
 * Handing a finished change to Independent Validation (Sprint 0048)
 * ------------------------------------------------------------------------ */

/**
 * Enqueues validation for the change this run just prepared.
 *
 * ## Why this calls the same function the button does
 *
 * `startChangeValidation` is the only entry point to validation, and it carries
 * every guard: project ownership, prepared-change readiness, snapshot presence,
 * profile support, depth resolution, identity reuse, in-flight detection and
 * the unique index that settles a double submit. Reproducing any part of that
 * here would create a second validation path — one that could drift from the
 * one a user's click takes, and would be exactly the wrong thing to have two of.
 *
 * So this step resolves three identifiers and calls it. Nothing else.
 *
 * ## Why it is safe against a retry it does not have
 *
 * Not by new code. A second call for the same artifact finds either a reusable
 * passed run or an active operation with the same input identity, and returns
 * `reused` or `running` without provisioning anything. The idempotency is the
 * existing guards', which is the only kind worth relying on.
 *
 * ## Why a failure here cannot fail the run
 *
 * The agent execution is already complete: the branch is written, the prepared
 * change exists, the credits are settled and the run row says `succeeded`.
 * Validation not starting is a missing convenience, not a broken execution —
 * the user can still click "Validate change" and get exactly what they would
 * have got before this sprint. So every outcome is recorded and none is
 * propagated.
 *
 * ## Ownership
 *
 * `projectId` and `userId` come from the persisted run row, never from an
 * argument. This runs under the service-role client, which bypasses RLS, so the
 * ownership it filters on must be the ownership the database already recorded
 * (Rule 53).
 */
export async function enqueueValidationStep(
  deps: AgentExecutionDeps,
  executor: OperationExecutor,
  operationId: string,
): Promise<void> {
  const run = await findAgentRunByOperation(deps.supabase, operationId);
  if (!run?.preparedChangeId) return;

  let outcome: string;
  let detail: string | null = null;

  try {
    const started = await startChangeValidation(deps.supabase, executor, {
      projectId: run.projectId,
      userId: run.userId,
      preparedChangeId: run.preparedChangeId,
    });

    outcome = started.kind;
    if (started.kind === "failed") detail = started.error;
  } catch {
    // A provider or database fault. Not inspected — the value is untyped and
    // may carry third-party prose — and deliberately not rethrown.
    outcome = "failed";
    detail = "execution_start_failed";
  }

  await recordAuditEvent(deps.supabase, {
    userId: run.userId,
    projectId: run.projectId,
    eventType: "agent_execution.validation_enqueued",
    metadata: {
      projectId: run.projectId,
      operationId,
      agentExecutionRunId: run.id,
      preparedChangeId: run.preparedChangeId,
      outcome,
      ...(detail ? { detail } : {}),
    },
  });
}
