import "server-only";

import type { SandboxHandle } from "@/modules/validation/sandbox-port";
import type {
  CodingAgentProvider,
  CodingAgentRequest,
  CodingAgentResult,
} from "../provider";
import type { AgentProviderOutcome } from "../schema";
import { AGENT_RUNTIME_PROGRAM } from "./program";
import {
  AGENT_RUNTIME_TOOLS,
  AGENT_RUNTIME_VERSION,
  AGENT_SDK_VERSION,
  parseAgentRuntimeResult,
  toAgentModelUsage,
  type AgentRuntimeRequest,
} from "./protocol";

/**
 * The Claude Agent SDK, running inside the execution's own microVM
 * (EXECUTION CORE-4 runtime placement).
 *
 * ## Why the runtime moved
 *
 * The first real agent run failed in 44 ms having taken zero turns. The cause
 * was not policy: `@anthropic-ai/claude-agent-sdk` spawns a native `claude`
 * binary of 307–325 MB depending on platform, and a Vercel function's whole
 * deployment budget is 250 MB. The harness was never going to start there.
 *
 * So the harness runs where a 325 MB binary and a real shell are unremarkable —
 * an ephemeral sandbox that already exists for this execution — and the things
 * that must not be there stay outside.
 *
 * ```
 *  Vibe (trusted)                          Agent sandbox (untrusted)
 *  ────────────────────────────────────    ─────────────────────────────────────
 *  ExecutionSpec, policy, Credits          Claude Agent SDK + native binary
 *  GitHub App credential                   the customer's repository at baseSha
 *  Supabase service role                   Read / Write / Edit / Glob / Grep / Bash
 *  ANTHROPIC_API_KEY  ◀── injected here    ANTHROPIC_BASE_URL ─▶ Vibe Agent Gateway
 *  branch write, validation, approval      a short-lived, execution-scoped token
 * ```
 *
 * The exchange in the right-hand column is the whole point. The sandbox samples
 * through `ANTHROPIC_BASE_URL` — the mechanism Anthropic's own secure-deployment
 * guidance names for exactly this — so the only credential inside the VM is a
 * signed statement about one execution, and Vibe's key never leaves the gateway
 * process.
 *
 * ## What the sandbox can do with its token
 *
 * Ask this run's model for a message, up to this run's budget, until this run's
 * expiry. That is the complete list. It cannot call another Vibe API, cannot
 * name another execution, cannot choose another model and cannot outlive the
 * run — and the gateway re-reads durable state on every request, so cancelling
 * the run revokes it.
 *
 * The token is on the environment of the `node` command, so repository-supplied
 * build and test commands the agent runs inherit it. That is accepted rather
 * than overlooked: the worst a hostile repository can do with it is spend the
 * budget its own execution already authorized. It is the reason the token is
 * scoped the way it is instead of being an API key.
 *
 * ## Where the change comes from
 *
 * Not from here. This provider reports turns, usage and an outcome; what the
 * run actually changed is established afterwards by reading the workspace back
 * against the pinned base commit. The agent's own account of its work is never
 * read (Rule 77), and there is no field in the protocol to put it in.
 */

/** Everything the runtime needs, none of which the agent chooses. */
export type SandboxAgentRuntimeDeps = {
  sandbox: SandboxHandle;
  /** Absolute path of the runtime directory. Outside the repository tree. */
  runtimeDir: string;
  /** Absolute path of the repository workspace the agent works in. */
  workspaceDir: string;
  /** Repository workspace, relative to the sandbox home — for `run`'s cwd. */
  workspaceCwd: string;
  /** `ANTHROPIC_BASE_URL`. The gateway, never `api.anthropic.com`. */
  gatewayBaseUrl: string;
  /** The run's execution-scoped token. Never a provider key. */
  gatewayToken: string;
  /** Lifecycle telemetry. Counts and identifiers only — never model text. */
  onEvent?: (event: SandboxRuntimeEvent) => void;
};

export type SandboxRuntimeEvent =
  | { kind: "cli_started" }
  | { kind: "cli_exited"; exitCode: number; timedOut: boolean }
  | { kind: "turn_observed"; turns: number };

/** Where the runtime lives inside the sandbox, relative to its home. */
export const AGENT_RUNTIME_DIRNAME = ".vibe-agent";

/**
 * Installs the harness during the bootstrap-egress window.
 *
 * Separated from `run` because the two need different networks and the
 * difference is the security property. Installing needs the npm registry;
 * running needs the gateway and nothing else. Doing both under one policy would
 * mean the agent samples with a registry still reachable, which is a package
 * publish away from being an exfiltration channel.
 *
 * `--ignore-scripts` for the same reason validation uses it: install is the one
 * networked step, and a lifecycle hook is the classic supply-chain execution
 * point. The SDK declares no scripts of its own — its native binary arrives as
 * an optional platform dependency — so nothing legitimate is lost.
 */
export async function installAgentRuntime(input: {
  sandbox: SandboxHandle;
  /** The runtime directory, relative to the sandbox home. */
  runtimeCwd: string;
  timeoutMs: number;
}): Promise<{ ok: true } | { ok: false; output: string }> {
  const made = await input.sandbox.run({
    command: { command: "mkdir", args: ["-p", "--", input.runtimeCwd] },
    cwd: ".",
    timeoutMs: 30_000,
  });
  if (made.exitCode !== 0) return { ok: false, output: made.output };

  const installed = await input.sandbox.run({
    command: {
      command: "npm",
      args: [
        "install",
        "--no-save",
        "--no-audit",
        "--no-fund",
        "--ignore-scripts",
        // Pinned. A floating version would make "what harness ran" a question
        // with no answer after the fact.
        `@anthropic-ai/claude-agent-sdk@${AGENT_SDK_VERSION}`,
      ],
    },
    cwd: input.runtimeCwd,
    timeoutMs: input.timeoutMs,
  });

  return installed.exitCode === 0 ? { ok: true } : { ok: false, output: installed.output };
}

/**
 * Writes a Vibe-authored file into the sandbox without a command line.
 *
 * The content is piped through `base64 -d` on stdin, so it never appears as an
 * argument and there is nothing to quote — the same technique `sandbox-workspace.ts`
 * uses, and for the same reason. The only interpolated value is a path this
 * module constructs.
 */
async function writeSandboxFile(
  sandbox: SandboxHandle,
  input: { path: string; content: string },
): Promise<boolean> {
  const encoded = Buffer.from(input.content, "utf8").toString("base64");
  const script = [
    `base64 -d > '${input.path.replace(/'/g, "'\\''")}' <<'VIBE_EOF'`,
    encoded,
    "VIBE_EOF",
  ].join("\n");

  const written = await sandbox.run({
    command: { command: "sh", args: ["-c", script] },
    cwd: ".",
    timeoutMs: 30_000,
  });

  return written.exitCode === 0;
}

/**
 * The environment the harness runs in, in full.
 *
 * An allowlist, like the in-process adapter's — but this one is built from
 * nothing rather than filtered from `process.env`, because the process this
 * runs in is a sandbox and there is no ambient environment worth inheriting.
 *
 * `ANTHROPIC_AUTH_TOKEN` rather than `ANTHROPIC_API_KEY`: the value is not an
 * API key and naming it one is how a value ends up somewhere an API key is
 * expected. The SDK sends it as `Authorization: Bearer`, which the gateway
 * accepts.
 */
function runtimeEnv(deps: SandboxAgentRuntimeDeps): Record<string, string> {
  return {
    ANTHROPIC_BASE_URL: deps.gatewayBaseUrl,
    ANTHROPIC_AUTH_TOKEN: deps.gatewayToken,
    /*
     * Auto memory loads regardless of `settingSources` (Anthropic, "Hosting the
     * Agent SDK" → Multi-tenant isolation), and this harness runs inside a
     * customer's repository tree. Without this, a `CLAUDE.md` the customer wrote
     * would reach the system prompt as instructions — which Rule 25 forbids.
     */
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
    /* Per-run, and outside the repository, so it is neither shared nor a diff. */
    CLAUDE_CONFIG_DIR: `${deps.runtimeDir}/claude`,
    CLAUDE_AGENT_SDK_CLIENT_APP: "vibe-business-execution/1",
    CI: "1",
  };
}

/** The SDK's terminal classification, mapped in Vibe's process rather than in the VM. */
function outcomeFor(subtype: string): AgentProviderOutcome {
  switch (subtype) {
    case "success":
      return "completed";
    case "error_max_turns":
      return "max_turns";
    case "error_max_budget_usd":
      return "max_cost";
    default:
      return "provider_error";
  }
}

/**
 * Counts the turns the harness reported as it went.
 *
 * Read from the NDJSON progress stream rather than from the final result,
 * because the interesting failures are the ones with no final result — a run
 * that reached four turns and then died is a different report from one that
 * never started, and the acceptance criterion for this runtime is precisely
 * "did a real turn happen".
 */
function turnsFromProgress(output: string): { turns: number; started: boolean } {
  let turns = 0;
  let started = false;

  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;

    try {
      const event = JSON.parse(trimmed) as { t?: unknown; n?: unknown };
      if (event.t === "started") started = true;
      if (event.t === "turn" && typeof event.n === "number" && event.n > turns) turns = event.n;
    } catch {
      // The repository's own build output shares this stream. A line that is
      // not our JSON is not an error; it is somebody else's stdout.
    }
  }

  return { turns, started };
}

export function createSandboxCodingAgentProvider(
  deps: SandboxAgentRuntimeDeps,
): CodingAgentProvider {
  return {
    id: "anthropic",
    harness: "claude_agent_sdk_sandbox",

    async run(request: CodingAgentRequest): Promise<CodingAgentResult> {
      const startedAt = Date.now();

      const failure = (detail: string, outcome: AgentProviderOutcome = "provider_error") => ({
        outcome,
        turns: 0,
        usage: [],
        sessionId: null,
        providerDeniedToolCalls: 0,
        durationMs: Date.now() - startedAt,
        failureDetail: detail,
      });

      const payload: AgentRuntimeRequest = {
        version: AGENT_RUNTIME_VERSION,
        systemPrompt: request.instruction.system,
        userMessage: request.instruction.userMessage,
        model: request.model,
        effort: request.effort,
        maxTurns: request.limits.maxTurns,
        maxBudgetUsd: request.limits.maxProviderSpendUsd,
        tools: AGENT_RUNTIME_TOOLS,
        cwd: deps.workspaceDir,
      };

      const wrote = await writeSandboxFile(deps.sandbox, {
        path: `${deps.runtimeDir}/run.mjs`,
        content: AGENT_RUNTIME_PROGRAM,
      });
      if (!wrote) return failure("the agent runtime program could not be written");

      const configured = await writeSandboxFile(deps.sandbox, {
        path: `${deps.runtimeDir}/request.json`,
        content: JSON.stringify(payload),
      });
      if (!configured) return failure("the agent runtime request could not be written");

      // Cancelled before it began. Checked here rather than trusted to the
      // command's own signal handling: a paid loop that starts after a
      // cancellation is the expensive mistake, not a slow one.
      if (request.signal.aborted) return failure("the run was cancelled", "aborted");

      deps.onEvent?.({ kind: "cli_started" });

      const executed = await deps.sandbox.run({
        command: { command: "node", args: [`${deps.runtimeDir}/run.mjs`, deps.runtimeDir] },
        cwd: deps.workspaceCwd,
        // The provider's own wall clock. Vibe's `AbortController` cannot reach
        // into the VM, so the ceiling has to be the command's.
        timeoutMs: request.limits.maxWallClockMs,
        env: runtimeEnv(deps),
      });

      deps.onEvent?.({
        kind: "cli_exited",
        exitCode: executed.exitCode,
        timedOut: executed.timedOut,
      });

      const progress = turnsFromProgress(executed.output);
      if (progress.turns > 0) {
        deps.onEvent?.({ kind: "turn_observed", turns: progress.turns });
      }

      const result = parseAgentRuntimeResult(
        await deps.sandbox.readFile({ path: `${deps.runtimeDir}/result.json`, maxBytes: 256 * 1024 }),
      );

      if (!result) {
        /*
         * No result file, or one this runtime does not recognise.
         *
         * Whatever the progress stream showed is still reported. §37 forbids
         * resolving a paid ambiguity optimistically, and it forbids the reverse
         * too: a run that took three turns and lost its result file did take
         * three turns, and pretending otherwise would understate what a customer
         * was charged for.
         */
        return {
          ...failure(
            executed.timedOut
              ? "the agent runtime exceeded its wall clock"
              : progress.started
                ? "the agent runtime produced no result"
                : "the agent runtime did not start",
          ),
          turns: progress.turns,
        };
      }

      return {
        outcome: outcomeFor(result.subtype),
        // The harness's own count when it finished, the observed count when it
        // did not. Never a number the model reported about itself.
        turns: Math.max(result.turns, progress.turns),
        usage: toAgentModelUsage(result.modelUsage),
        sessionId: result.sessionId,
        providerDeniedToolCalls: result.permissionDenials,
        durationMs: Date.now() - startedAt,
        failureDetail:
          result.subtype === "success" ? null : (result.error ?? `agent run ended: ${result.subtype}`),
      };
    },
  };
}
