import "server-only";

import type { SandboxHandle } from "@/modules/validation/sandbox-port";
import type {
  CodingAgentRequest,
  CodingAgentResult,
  DetachedCodingAgentProvider,
  DetachedObservation,
  DetachedStartOutcome,
} from "../provider";
import type { AgentProviderOutcome } from "../schema";
import { writeSandboxTextFile } from "./files";
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
    case "founder_input_required":
      return "aborted";
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
/**
 * One line of the harness's progress feed.
 *
 * Deliberately three shapes and no more. `t` is a closed tag, `s` is the
 * monotonic sequence the harness assigned, and everything else is a bounded
 * identifier — a tool name, a repository path, a command Vibe's own harness
 * ran. There is no field a sentence could arrive in.
 */
export type RuntimeProgressEntry = {
  sequence: number;
  /** Milliseconds since the harness started. Absent from an older feed. */
  offsetMs?: number;
  kind:
    | "started"
    | "turn"
    | "tool"
    | "finished"
    | "verification"
    | "verification_refused"
    | "phase";
  /** Model responses so far, on a `turn` line. */
  assistantMessages?: number;
  tool?: string;
  path?: string;
  command?: string;
  subtype?: string;
  /** Which check a verification line was about. Closed vocabulary. */
  check?: string;
  /** Why a check command was refused. Closed vocabulary. */
  refusalReason?: string;
  /** Which observed phase the run moved into. Closed vocabulary. */
  phase?: string;
};

export type RuntimeProgress = {
  /** Model responses seen so far. Never the harness's own loop count. */
  assistantMessages: number;
  started: boolean;
  finished: boolean;
  entries: readonly RuntimeProgressEntry[];
};

function readString(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value.length > 0 ? value.slice(0, max) : undefined;
}

export function parseRuntimeProgress(output: string): RuntimeProgress {
  let assistantMessages = 0;
  let started = false;
  let finished = false;
  const entries: RuntimeProgressEntry[] = [];

  const lines = output.split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (!trimmed.startsWith("{")) continue;

    let event: Record<string, unknown>;
    try {
      event = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      // The repository's own build output shares this stream. A line that is
      // not our JSON is not an error; it is somebody else's stdout.
      continue;
    }

    /*
     * The harness's own counter, or the line's position when it has none.
     *
     * Both are monotonic and unique within the file, which is all the durable
     * upsert needs. The fallback matters because a feed written by an older
     * runtime has no `s` — and a parser that dropped those lines would silently
     * lose the progress of a run that was already in flight when this shipped.
     */
    const sequence = typeof event.s === "number" && event.s > 0 ? event.s : index + 1;

    // Milliseconds since the harness started, when it reported one. Undefined
    // rather than zero for a feed written before this was emitted: zero would
    // claim every line happened at the instant the run began.
    const offsetMs =
      typeof event.ms === "number" && Number.isFinite(event.ms) && event.ms >= 0
        ? event.ms
        : undefined;

    if (event.t === "started") {
      started = true;
      entries.push({ sequence, offsetMs, kind: "started" });
      continue;
    }

    if (event.t === "turn") {
      const n = typeof event.n === "number" ? event.n : 0;
      if (n > assistantMessages) assistantMessages = n;
      entries.push({ sequence, offsetMs, kind: "turn", assistantMessages: n });
      continue;
    }

    if (event.t === "tool") {
      entries.push({
        sequence,
        offsetMs,
        kind: "tool",
        tool: readString(event.name, 40),
        path: readString(event.path, 400),
        command: readString(event.command, 400),
      });
      continue;
    }

    /*
     * The verification plan, as the harness applied it.
     *
     * Two lines and no more: a check it let through, and a check it refused.
     * Both carry a closed-vocabulary name and nothing else — there is no field
     * here a sentence could arrive in, which is the same property every other
     * line of this feed has.
     */
    if (event.t === "verify") {
      entries.push({
        sequence,
        offsetMs,
        kind: "verification",
        check: readString(event.check, 40),
      });
      continue;
    }

    if (event.t === "refused") {
      entries.push({
        sequence,
        offsetMs,
        kind: "verification_refused",
        check: readString(event.check, 40),
        refusalReason: readString(event.reason, 40),
      });
      continue;
    }

    /*
     * A phase change the harness observed — an edit, or a tool that failed.
     *
     * Carried so Vibe can reconstruct where implementation ended and repair
     * began without inferring it from timestamps alone.
     */
    if (event.t === "phase") {
      entries.push({
        sequence,
        offsetMs,
        kind: "phase",
        phase: readString(event.phase, 24),
      });
      continue;
    }

    if (event.t === "finished") {
      finished = true;
      entries.push({ sequence, offsetMs, kind: "finished", subtype: readString(event.subtype, 40) });
    }
  }

  return { assistantMessages, started, finished, entries };
}

/** Bytes of the progress file kept. It is one short JSON object per turn. */
const MAX_PROGRESS_BYTES = 256 * 1024;

/**
 * The harness, running detached in the execution's own microVM.
 *
 * ## Why nothing is remembered between calls
 *
 * Because the three calls happen in three different Vercel function
 * invocations, minutes apart. `start` launches the process and returns; `observe`
 * runs on a timer from a step that has never seen it; `collect` reads what it
 * left behind. So the run's state lives in two places that survive a function
 * dying — the sandbox's filesystem, and the database — and never in this object.
 *
 * ```
 * progress.ndjson   one line per turn, appended by the harness as it works
 * result.json       written once, at the end. Its existence IS "finished".
 * ```
 *
 * The first real run is why. It reached Anthropic 27 times over five minutes
 * and was then killed by the platform's 300-second step ceiling, leaving a run
 * row that said `turns: 0` — every turn had really happened, and the only
 * record of them died with the step that was watching.
 */
export function createSandboxCodingAgentProvider(
  deps: SandboxAgentRuntimeDeps,
): DetachedCodingAgentProvider {
  const progressPath = `${deps.runtimeDir}/progress.ndjson`;
  const resultPath = `${deps.runtimeDir}/result.json`;

  const readProgress = async (): Promise<RuntimeProgress> => {
    const progress = await deps.sandbox.readFile({
      path: progressPath,
      maxBytes: MAX_PROGRESS_BYTES,
    });

    return progress === null
      ? { assistantMessages: 0, started: false, finished: false, entries: [] }
      : parseRuntimeProgress(progress);
  };

  return {
    id: "anthropic",
    harness: "claude_agent_sdk_sandbox",

    async start(request: CodingAgentRequest): Promise<DetachedStartOutcome> {
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
        // Carried, never interpreted. The harness is the only place a shell
        // command can be seen before it runs, so it is the only place this can
        // be applied (Sprint 0042).
        ...(request.verification ? { verification: request.verification } : {}),
        ...(request.completion ? { completion: request.completion } : {}),
      };

      /*
       * The second, independent guard against a second Claude process.
       *
       * The caller's database claim is the primary one and is scoped to a
       * `queued` run, so a retry cannot get past it. This checks the workspace
       * itself, because the failure being prevented — two paid harnesses on one
       * execution — is expensive enough to deserve an answer that does not
       * depend on the database being reachable.
       */
      const existing = await readProgress();
      if (existing.started) {
        return { ok: false, failureDetail: "the agent runtime was already started for this run" };
      }

      const wrote = await writeSandboxTextFile(deps.sandbox, {
        path: `${deps.runtimeDir}/run.mjs`,
        content: AGENT_RUNTIME_PROGRAM,
      });
      if (!wrote) return { ok: false, failureDetail: "the agent runtime program could not be written" };

      const configured = await writeSandboxTextFile(deps.sandbox, {
        path: `${deps.runtimeDir}/request.json`,
        content: JSON.stringify(payload),
      });
      if (!configured) {
        return { ok: false, failureDetail: "the agent runtime request could not be written" };
      }

      // Cancelled before it began. Checked here rather than trusted to the
      // command's own signal handling: a paid loop that starts after a
      // cancellation is the expensive mistake, not a slow one.
      if (request.signal.aborted) return { ok: false, failureDetail: "the run was cancelled" };

      deps.onEvent?.({ kind: "cli_started" });

      try {
        /*
         * Detached, and this is the whole point of the refactor.
         *
         * `runBackground` returns as soon as the process exists, so the step
         * that starts a twenty-minute agent finishes in seconds. The handle it
         * returns is deliberately dropped: it cannot cross a step boundary, and
         * building on it would put the run's liveness in a Vercel function's
         * memory — exactly where the last one died.
         */
        await deps.sandbox.runBackground({
          command: { command: "node", args: [`${deps.runtimeDir}/run.mjs`, deps.runtimeDir] },
          cwd: deps.workspaceCwd,
          env: runtimeEnv(deps),
        });
      } catch (error) {
        return {
          ok: false,
          failureDetail:
            error instanceof Error
              ? `${error.name}: ${error.message.slice(0, 200)}`
              : "the agent runtime could not be started",
        };
      }

      return { ok: true };
    },

    async observe(): Promise<DetachedObservation> {
      /*
       * `result.json` is the completion signal, and it is a *file* rather than
       * a process status deliberately: a process handle does not survive a step
       * boundary, and asking the provider whether a detached command is alive
       * would answer a different question anyway — "still running" is not the
       * same as "did the work".
       */
      const result = await deps.sandbox.readFile({ path: resultPath, maxBytes: 1024 });
      const progress = await readProgress();

      if (progress.assistantMessages > 0) {
        deps.onEvent?.({ kind: "turn_observed", turns: progress.assistantMessages });
      }

      return {
        started: progress.started,
        finished: result !== null,
        assistantMessages: progress.assistantMessages,
        /*
         * The whole feed, every time.
         *
         * Not a delta: the reader is a different function invocation with no
         * memory of the last one, and the durable write is an upsert keyed on
         * the harness's own sequence. Re-offering what has already been stored
         * is therefore free and makes a lost poll cost nothing.
         */
        entries: progress.entries,
      };
    },

    async collect(input: { startedAtMs: number }): Promise<CodingAgentResult> {
      const durationMs = Math.max(0, Date.now() - input.startedAtMs);
      const progress = await readProgress();

      const result = parseAgentRuntimeResult(
        await deps.sandbox.readFile({ path: resultPath, maxBytes: 256 * 1024 }),
      );

      if (!result) {
        /*
         * No result file, or one this runtime does not recognise.
         *
         * Whatever the progress file showed is still reported. §37 forbids
         * resolving a paid ambiguity optimistically, and it forbids the reverse
         * too: a run that took three turns and lost its result did take three
         * turns, and reporting zero would understate what a customer was
         * charged for.
         */
        return {
          outcome: "provider_error",
          runtimeFounderInput: null,
          assistantMessages: progress.assistantMessages,
          sdkLoopIterations: null,
          usage: [],
          sessionId: null,
          providerDeniedToolCalls: 0,
          verificationCommands: null,
          verificationRefusals: null,
          policyDecisions: null,
          repairCycles: null,
          implementationMutations: null,
          convergenceMutations: null,
          requiredVerificationActions: null,
          requiredVerificationOverrides: null,
          durationMs,
          failureDetail: progress.started
            ? "the agent runtime produced no result"
            : "the agent runtime did not start",
        };
      }

      return {
        outcome: outcomeFor(result.subtype),
        runtimeFounderInput: result.runtimeFounderInput,
        /*
         * Both counts, each in its own unit.
         *
         * The message count takes the larger of the harness's terminal figure
         * and what the progress file showed — a run whose result was lost still
         * produced the responses the file recorded. The loop count is whatever
         * the harness reported, or null: it has no observable proxy, and the
         * message count standing in for it is exactly the substitution that
         * made "66 / 40" look like a breach.
         */
        assistantMessages: Math.max(result.assistantMessages, progress.assistantMessages),
        sdkLoopIterations: result.sdkLoopIterations,
        verificationCommands: result.verificationCommands,
        verificationRefusals: result.verificationRefusals,
        policyDecisions: result.policyDecisions,
        repairCycles: result.repairCycles,
        implementationMutations: result.implementationMutations,
        convergenceMutations: result.convergenceMutations,
        requiredVerificationActions: result.requiredVerificationActions,
        requiredVerificationOverrides: result.requiredVerificationOverrides,
        usage: toAgentModelUsage(result.modelUsage),
        sessionId: result.sessionId,
        providerDeniedToolCalls: result.permissionDenials,
        durationMs,
        failureDetail:
          result.subtype === "success" ? null : (result.error ?? `agent run ended: ${result.subtype}`),
      };
    },
  };
}
