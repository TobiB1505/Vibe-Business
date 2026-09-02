import "server-only";
import {
  AgentExecutionDeps,
  StepOutcome,
  recordLifecycle,
  loadRun,
  loadSpec,
} from "./shared";
import { alertOperator } from "@/lib/observability/alert";
import { redactCredentials } from "@/lib/security/credential-patterns";
import { AGENT_SANDBOX_LIFETIME_MS } from "@/modules/coding-agent/budget";
import { readAgentGatewayConfig } from "@/modules/coding-agent/gateway-config";
import { AGENT_RUNTIME_DIRNAME, installAgentRuntime } from "@/modules/coding-agent/sandbox-runtime/provider";
import { agentSandboxNameFor } from "@/modules/coding-agent/identity";
import type { AgentCheckName } from "@/modules/coding-agent/schema";
import { SANDBOX_BUDGETS } from "@/modules/validation/budgets";
import { installCommand, planValidationSteps } from "@/modules/validation/commands";
import { DEPENDENCY_HOSTS, SOURCE_HOSTS, type SandboxHandle } from "@/modules/validation/sandbox-port";
import { SANDBOX_ENVIRONMENT } from "@/modules/validation/orchestrator";
import { setOperationStage } from "../../store";
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
    /*
     * A sandbox that cannot be prepared is exactly what VB-012 exists for
     * (PERF-022). This was a bare `console.error`, so it reached a Vercel log
     * stream nobody watches and never became an issue with a count — the
     * failure `alert.ts` was written to end.
     *
     * The detail is redacted before it is passed, not after. It is the tail of
     * a command run inside the customer's own tree, which makes it untrusted
     * repository output (rule 18) that can carry whatever their install
     * printed. Sentry scrubs it again on the way out; the local log line is
     * what the first pass is for, because `beforeSend` never sees that one.
     *
     * It is still passed, rather than reduced to an exit code: without any of
     * it an operator cannot tell a registry timeout from a missing binary, and
     * that distinction is the only reason to report this at all.
     */
    await alertOperator("[agent-execution] the agent harness could not be installed", {
      operationId,
      agentExecutionRunId: run.id,
      detail: redactCredentials(harness.output.slice(-2_000)),
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
