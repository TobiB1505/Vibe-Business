import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  deriveAgentLimits,
  deriveGatewayCeilings,
  type AgentRuntimeLimits,
} from "@/modules/coding-agent/budget";
import {
  agentTokenExpiryFor,
  mintRunGatewayToken,
  readAgentGatewayConfig,
} from "@/modules/coding-agent/gateway-config";
import { type WorkspaceObservation } from "@/modules/coding-agent/sandbox-runtime/changes";
import { AGENT_RUNTIME_DIRNAME, type SandboxAgentRuntimeDeps } from "@/modules/coding-agent/sandbox-runtime/provider";
import { type BaseContentPort, type BaseTreePort } from "@/modules/coding-agent/candidate";
import { createLifecycleRecorder } from "@/modules/coding-agent/observability/lifecycle";
import { agentSandboxNameFor } from "@/modules/coding-agent/identity";
import type { DetachedCodingAgentProvider } from "@/modules/coding-agent/provider";
import { findAgentRunByOperation, type StoredAgentExecutionRun } from "@/modules/coding-agent/store";
import { findExecutionSpecByIdentity } from "@/modules/execution-contract/store";
import type { ExecutionProbePort, GitWritePort } from "@/modules/execution/git-port";
import { type SandboxHandle, type SandboxProvider } from "@/modules/validation/sandbox-port";
import { sanitizeCommandOutput } from "@/modules/validation/logs";
import type { OperationFailureCode } from "../../failures";
import { getProjectOperationRunById, type ProjectOperationRun } from "../../store";
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
    operation: ProjectOperationRun,
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
export async function recordLifecycle(
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

/**
 * Why the workspace was lost, recorded where a person will find it.
 *
 * ## What this is repairing
 *
 * `sandbox_lost` is the failure code with no detail field — `StepOutcome` has
 * none on its error branch — and for four days that is all any agent run
 * produced. The cause was two characters in a `find` argument, and the sentence
 * naming it existed at every layer except the one anybody reads: the provider
 * built it, `run()` carried it, and the observation functions returned `false`.
 *
 * Two things were already built and unused, and this is what wires them:
 *
 * - `workspace_failed` had an event type, a milestone slot, a phase and an
 *   audience, and no producer anywhere in the codebase.
 * - `SandboxProvider.inspect()` had an implementation, a test and zero
 *   production callers. Its docblock describes exactly this blind spot and ends
 *   "recorded on the audit event an operator reads" — an intention that was
 *   never connected to one.
 *
 * ## Why `inspect` is called here and nowhere else
 *
 * Because its docblock insists on it: it is asked **only on a path that has
 * already failed**, so it costs one provider call when something is already
 * wrong and nothing at all when things work. "Stopped at a 300000 ms timeout"
 * and "the sandbox is running fine and the command is malformed" are different
 * bugs, and the first observation cannot tell them apart on its own.
 *
 * Its own failure is swallowed into the detail rather than raised: this runs on
 * a path that is already returning a failure, and turning telemetry into a
 * second exception would lose the first one.
 *
 * ## What it costs
 *
 * Nothing on a healthy run — nothing calls it. On a failed one, one provider
 * call and one row. It changes no control flow: every caller returns exactly
 * the `sandbox_lost` it returned before.
 */
export async function recordWorkspaceFailure(
  deps: AgentExecutionDeps,
  run: StoredAgentExecutionRun,
  failure: { observation: WorkspaceObservation; detail: string | null },
): Promise<void> {
  let sandboxState: string | null = null;
  try {
    sandboxState = await deps.sandboxProvider.inspect({ name: agentSandboxNameFor(run.id) });
  } catch (error) {
    sandboxState = error instanceof Error ? `${error.name}: ${error.message}` : null;
  }

  await recordLifecycle(deps, run, "workspace_failed", "Project could not be prepared", {
    observation: failure.observation,
    // Sanitized like any other command output — this is a sandbox running a
    // customer's repository, so it is untrusted text (Rule 18). `boundEvent`
    // redacts again and cuts to 240 characters from the *front*, which is where
    // this failure class puts the useful part: `TypeError: The argument
    // 'args[31]' must be a string without null bytes` is the whole finding.
    detail: failure.detail === null ? null : sanitizeCommandOutput(failure.detail).text,
    sandboxState,
  });
}

export async function loadRun(
  deps: AgentExecutionDeps,
  operationId: string,
): Promise<
  StepOutcome<{ operation: ProjectOperationRun; run: StoredAgentExecutionRun }>
> {
  const operation = await getProjectOperationRunById(deps.supabase, operationId);
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
export async function loadSpec(deps: AgentExecutionDeps, run: StoredAgentExecutionRun) {
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

/** Where the run's own files live inside the sandbox. Derived, never stored. */
export type SandboxPaths = {
  runtimeDir: string;
  markerPath: string;
  baselinePath: string;
  workspaceDir: string;
  workspaceCwd: string;
};

/** The workspace, relative to the sandbox home. `.` when the repo is the root. */
export function workspaceCwdFor(sourceRoot: string, workspaceRoot: string): string {
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
export async function resolveSandboxPaths(
  sandbox: SandboxHandle,
  target: { sourceRoot: string; workspaceRoot: string },
): Promise<{ ok: true; paths: SandboxPaths } | { ok: false; detail: string }> {
  const home = await sandbox.run({
    command: { command: "pwd", args: [] },
    cwd: ".",
    timeoutMs: 30_000,
  });

  const sandboxHome = home.exitCode === 0 ? home.output.trim() : "";
  if (sandboxHome.length === 0 || !sandboxHome.startsWith("/")) {
    // The output, not a restatement. "`pwd` answered nothing" and "`pwd` printed
    // a relative path" reach here identically and are different failures, and
    // this is the first command any step runs — so when it is the one that
    // broke, nothing later in the run will explain it.
    return { ok: false, detail: home.output };
  }

  const runtimeDir = `${sandboxHome}/${AGENT_RUNTIME_DIRNAME}`;
  const workspaceCwd = workspaceCwdFor(target.sourceRoot, target.workspaceRoot);

  return {
    ok: true,
    paths: {
      runtimeDir,
      markerPath: `${runtimeDir}/marker`,
      baselinePath: `${runtimeDir}/baseline.txt`,
      workspaceDir: workspaceCwd === "." ? sandboxHome : `${sandboxHome}/${workspaceCwd}`,
      workspaceCwd,
    },
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
export function buildRunProvider(
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
export type AgentRunContext = {
  operation: ProjectOperationRun;
  run: StoredAgentExecutionRun;
  spec: NonNullable<Awaited<ReturnType<typeof loadSpec>>>;
  limits: AgentRuntimeLimits;
  target: AgentRepositoryTarget;
  sandbox: SandboxHandle;
  paths: SandboxPaths;
  provider: DetachedCodingAgentProvider;
};

export async function loadAgentRunContext(
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
    await recordWorkspaceFailure(deps, run, {
      observation: "reconnect",
      // `reconnect` collapses every reason to `null` on purpose, so it has
      // nothing to say here. `inspect`, asked inside the recorder, does.
      detail: sandbox ? `the sandbox answered but is ${sandbox.liveness}` : null,
    });
    return { ok: false, failureCode: "sandbox_lost" };
  }

  const resolvedPaths = await resolveSandboxPaths(sandbox, target);
  if (!resolvedPaths.ok) {
    await recordWorkspaceFailure(deps, run, {
      observation: "sandbox_home",
      detail: resolvedPaths.detail,
    });
    return { ok: false, failureCode: "sandbox_lost" };
  }
  const paths = resolvedPaths.paths;

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
