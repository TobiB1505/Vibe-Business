import type { AgentModelUsage } from "../provider";
import type { SandboxVerificationPolicy } from "@/modules/execution-context/verification";
import type { SandboxCompletionPolicy } from "@/modules/execution-context/completion";

/**
 * The contract between Vibe and the program that runs inside the agent sandbox
 * (EXECUTION CORE-4 runtime placement).
 *
 * ## Why there is a protocol at all
 *
 * Because the two sides are in different trust domains. The Claude Agent SDK
 * spawns a ~325 MB native binary and needs real file, edit and shell tools, so
 * it runs in an ephemeral microVM; Vibe's orchestrator, its Credits, its GitHub
 * credential and its Anthropic key stay outside. Everything that crosses that
 * line crosses as JSON described here, and every field is a count, an
 * identifier or a Vibe-authored string.
 *
 * ## What deliberately has no field
 *
 * The agent's account of its own work (Rule 77). There is no `summary`, no
 * `finalMessage`, no `filesChanged` and no `reasoning` — not "we ignore them",
 * but no place to put them. What the run changed is established afterwards by
 * reading the workspace back against the pinned base commit, which is a fact
 * about the filesystem rather than a claim by the model.
 *
 * Reasoning text likewise never crosses (Rule 43). Token counts do, because
 * they are billed.
 */

/**
 * The runtime identity, bumped whenever the program's semantics change.
 *
 * Both sides carry it and Vibe refuses a result that does not match. A stale
 * program left in a reused sandbox would otherwise answer a request it never
 * understood — and the reply would look perfectly well-formed.
 */
export const AGENT_RUNTIME_VERSION = "vibe-agent-runtime-v3" as const;

/**
 * The SDK version installed in the sandbox, pinned rather than floating.
 *
 * Kept equal to the version in `package.json` so the harness Vibe develops
 * against is the harness that runs. `npm install <name>@latest` inside a
 * customer's execution would make "what did this run actually use" a question
 * with no answer.
 */
export const AGENT_SDK_VERSION = "0.3.233" as const;

/**
 * Built-in tools the agent may use inside its workspace.
 *
 * The complete list, and every entry is local. There is no `WebFetch`, no
 * `WebSearch`, no `Task` and no MCP server: Rule 41 says capabilities — not
 * prompt wording — are what bound prompt injection, and the sandbox's egress
 * policy allows exactly one host, so a network tool would have nothing to reach
 * even if it existed.
 *
 * `Bash` is here because the user's instruction is explicit that the agent runs
 * local build and test commands. It is the reason the whole runtime moved into
 * a VM: a shell is precisely what must not exist on Vibe's own machine.
 */
export const AGENT_RUNTIME_TOOLS: readonly string[] = [
  "Read",
  "Write",
  "Edit",
  "Glob",
  "Grep",
  "Bash",
];

/** What Vibe writes into the sandbox before starting the program. */
export type AgentRuntimeRequest = {
  version: typeof AGENT_RUNTIME_VERSION;
  /** Vibe-authored policy and role. Never third-party content (Rule 42). */
  systemPrompt: string;
  /** The task, with all third-party content fenced and labelled untrusted. */
  userMessage: string;
  model: string;
  effort: "low" | "medium" | "high";
  maxTurns: number;
  maxBudgetUsd: number;
  tools: readonly string[];
  /** Absolute path of the repository workspace inside the sandbox. */
  cwd: string;
  /**
   * How much self-checking this task is allowed (Sprint 0042).
   *
   * Rules and integers, carried as data in `request.json` and never
   * interpolated into program text — the property ADR 0029 gives the runtime
   * program, preserved. The harness rebuilds the category matchers from
   * `categoryRules`, which are Vibe's own constants, so the sandbox classifies
   * a command by exactly the table Vibe's timeline classifies it by.
   *
   * Optional so that a request without one behaves as v2 did: unbounded
   * self-checking. Absence must never mean "forbid everything" — a policy that
   * fails closed on a missing field would turn a deploy skew into a run that
   * cannot check anything at all.
   */
  verification?: SandboxVerificationPolicy;
  /**
   * How much work is allowed after the code is written (Sprint 0043).
   *
   * Optional and permissive-when-absent, exactly like `verification`. A run
   * without one behaves as run #5 did: unbounded post-implementation
   * exploration.
   */
  completion?: SandboxCompletionPolicy;
};

/**
 * What the program writes back.
 *
 * `subtype` is the SDK's own terminal classification, carried through rather
 * than translated inside the sandbox: a mapping performed by untrusted-adjacent
 * code is a mapping Vibe cannot audit. Vibe maps it in `provider.ts`.
 */
export type AgentRuntimeResult = {
  version: string;
  subtype: string;
  /**
   * Model responses. One per `assistant` message in the SDK's stream.
   *
   * **Not** comparable to the budget's turn ceiling, which bounds the harness's
   * own loop — see `sdkLoopIterations`. The two used to be one field that
   * switched units at the end of a run, which is how run `b33635a1` came to
   * record 66 against a limit of 40 while overrunning nothing.
   */
  assistantMessages: number;
  /**
   * The harness's own loop count, in the unit `maxSdkIterations` bounds.
   *
   * Null when the SDK did not report one — a run that died before its terminal
   * message has no honest value here, and the message count is not a substitute.
   */
  sdkLoopIterations: number | null;
  /** Check commands the harness let through, counted at the decision point. */
  verificationCommands: number;
  /** Check commands it refused. Zero is only meaningful beside the first. */
  verificationRefusals: number;
  /**
   * Every tool call the policy hook saw.
   *
   * The number that would have caught run #5 immediately: a run with thirty
   * tool calls and zero decisions has a policy that is not running, which is
   * otherwise indistinguishable from a policy that had nothing to refuse.
   */
  policyDecisions: number;
  /** Mutations that answered an observed failure. A real repair. */
  repairCycles: number;
  /**
   * Files written while the change was still being implemented.
   *
   * Breadth, and never charged against anything. Run #7 legitimately needed
   * eight, and the counter this replaces reported that as seven convergence
   * windows against a ceiling of four.
   */
  implementationMutations: number;
  /** Files written after the run had already converged. Each cost a window. */
  convergenceMutations: number;
  /** Required verification operations the runtime allowed. */
  requiredVerificationActions: number;
  /** Of those, the ones a completion budget alone would have refused. */
  requiredVerificationOverrides: number;
  sessionId: string | null;
  permissionDenials: number;
  /** Per-model token counts, keyed by model id. Never a cost claim. */
  modelUsage: Record<string, unknown>;
  /** A bounded description of a failure inside the program. Never model text. */
  error: string | null;
};

const MAX_ERROR_CHARS = 400;

function nonNegativeInt(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0;
}

/**
 * Parses what came back out of the sandbox.
 *
 * Every field is re-derived rather than trusted: this JSON was produced inside
 * a VM running a customer's repository, so a hostile or merely broken program
 * could return any shape at all. A result that does not parse, or that carries
 * the wrong runtime version, is `null` — which the provider reports as a
 * provider error rather than as a run that did nothing.
 */
export function parseAgentRuntimeResult(payload: string | null): AgentRuntimeResult | null {
  if (payload === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) return null;
  const raw = parsed as Record<string, unknown>;

  if (raw.version !== AGENT_RUNTIME_VERSION) return null;

  return {
    version: AGENT_RUNTIME_VERSION,
    subtype: typeof raw.subtype === "string" ? raw.subtype.slice(0, 64) : "unknown",
    assistantMessages: nonNegativeInt(raw.assistantMessages),
    sdkLoopIterations:
      typeof raw.sdkLoopIterations === "number" && Number.isFinite(raw.sdkLoopIterations)
        ? Math.max(0, Math.trunc(raw.sdkLoopIterations))
        : null,
    // An identifier, never a credential — the transcript it would resume was
    // never written, because `persistSession` is off.
    sessionId: typeof raw.sessionId === "string" ? raw.sessionId.slice(0, 128) : null,
    permissionDenials: nonNegativeInt(raw.permissionDenials),
    /*
     * Counted where the decision was made, not where it was inferred.
     *
     * Vibe also derives these from the progress feed, and keeping both is the
     * point: the feed can lose a poll, and — as run #5 proved — a decision path
     * that is never reached emits nothing at all while looking perfectly
     * healthy. Two counters that disagree are a bug report; one counter is a
     * belief.
     */
    verificationCommands: nonNegativeInt(raw.verificationCommands),
    verificationRefusals: nonNegativeInt(raw.verificationRefusals),
    policyDecisions: nonNegativeInt(raw.policyDecisions),
    repairCycles: nonNegativeInt(raw.repairCycles),
    implementationMutations: nonNegativeInt(raw.implementationMutations),
    convergenceMutations: nonNegativeInt(raw.convergenceMutations),
    requiredVerificationActions: nonNegativeInt(raw.requiredVerificationActions),
    requiredVerificationOverrides: nonNegativeInt(raw.requiredVerificationOverrides),
    modelUsage:
      typeof raw.modelUsage === "object" && raw.modelUsage !== null
        ? (raw.modelUsage as Record<string, unknown>)
        : {},
    error:
      typeof raw.error === "string" && raw.error.trim().length > 0
        ? raw.error.replace(/\s+/g, " ").trim().slice(0, MAX_ERROR_CHARS)
        : null,
  };
}

/**
 * The per-model token counts, re-derived in Vibe's process.
 *
 * Shared with the in-process adapter's reading of the same SDK field, and
 * deliberately not shared *code* with it — this one is parsing a value that
 * crossed a trust boundary, so every number is coerced rather than cast.
 */
export function toAgentModelUsage(modelUsage: Record<string, unknown>): AgentModelUsage[] {
  const usage: AgentModelUsage[] = [];

  for (const [model, raw] of Object.entries(modelUsage)) {
    if (typeof raw !== "object" || raw === null) continue;
    const entry = raw as Record<string, unknown>;

    usage.push({
      model: model.slice(0, 128),
      inputTokens: nonNegativeInt(entry.inputTokens),
      outputTokens: nonNegativeInt(entry.outputTokens),
      cacheReadInputTokens: nonNegativeInt(entry.cacheReadInputTokens),
      cacheCreationInputTokens: nonNegativeInt(entry.cacheCreationInputTokens),
      // Carried, never trusted as the billing figure — and here it arrived from
      // inside the sandbox, which is one more reason it could not be.
      reportedCostUsd:
        typeof entry.costUSD === "number" && Number.isFinite(entry.costUSD) ? entry.costUSD : null,
    });
  }

  return usage;
}
