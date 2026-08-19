import type { SandboxVerificationPolicy } from "@/modules/execution-context/verification";
import type { AgentProviderOutcome, AgentToolRequestName } from "./schema";

/**
 * The provider-neutral coding agent boundary (EXECUTION CORE-4 §5, §7, §19).
 *
 * ## Why this exists at all
 *
 * The same reason `AIProvider` and `SandboxProvider` exist, and one more.
 *
 * The familiar reason: the execution domain must not learn a vendor's
 * vocabulary, so `@anthropic-ai/claude-agent-sdk` types appear in exactly one
 * directory (`claude/`) and everything above speaks these types. That is what
 * lets the gateway — where every security decision lives — be tested without a
 * network, an API key or a bill.
 *
 * The extra reason is specific to agents: an agent SDK is a *harness*, and
 * harnesses have opinions. Turn accounting, cancellation semantics, session
 * identity, how usage is reported, whether tool errors end the run — all differ
 * between providers, and all of them are things Vibe has policy about. Naming
 * them here forces a second adapter to answer the same questions rather than
 * quietly bringing its own answers.
 *
 * ## What a provider is not allowed to be
 *
 * A provider receives a compiled instruction, a set of tool descriptors and a
 * broker function. It does **not** receive the ExecutionSpec, the Supabase
 * client, the sandbox handle, the repository credential or the project. It
 * cannot reach any of them, so no adapter can widen its own authority by
 * reaching past the interface — the one failure mode a provider abstraction is
 * actually for.
 *
 * ## Core-4 implements exactly one adapter
 *
 * §5: "No speculative second provider." There is Claude, and there is this
 * interface describing what Claude was asked to be.
 */

/**
 * One tool the provider may offer the model.
 *
 * Descriptors rather than implementations: the provider renders these into
 * whatever its SDK calls a tool, and every invocation comes back through
 * {@link CodingAgentRequest.invokeTool}. An adapter that executed a tool itself
 * would be making a policy decision, which is the one thing it must not do.
 */
export type AgentToolDescriptor = {
  name: AgentToolRequestName;
  /** Vibe-authored. Never assembled from repository or model content (Rule 42). */
  description: string;
  /**
   * JSON Schema for the tool's arguments.
   *
   * Provided so a provider can constrain the model's output shape, **not** so
   * it can decide whether a call is legal. The gateway validates arguments
   * again on receipt, because a schema the model was shown is a request and a
   * check the runtime performs is a fact.
   */
  inputSchema: Record<string, unknown>;
};

/**
 * What the gateway hands back for one tool call.
 *
 * `denied` is a first-class outcome rather than an error, and the difference
 * matters: a denial is a normal, expected event that the model should be able
 * to see and route around, while an error would end the turn. §11 wants the
 * runtime to refuse; it does not want every refusal to kill the run.
 */
export type AgentToolOutcome =
  | { kind: "ok"; content: string }
  | { kind: "denied"; reason: string; message: string }
  /** The run must stop now — cancelled, paused on a question, or out of budget. */
  | { kind: "halt"; message: string };

export type AgentInstruction = {
  /** Vibe-authored policy and role. Contains no third-party content (Rule 42). */
  system: string;
  /**
   * The task, with all third-party content fenced and labelled untrusted.
   *
   * Sent as the user turn precisely because it carries Planner prose and
   * customer decisions. Rule 42 forbids interpolating those into a system
   * prompt, where they would read as instructions rather than as data.
   */
  userMessage: string;
  /** Recorded on the run, so two runs of one spec are comparable (§15). */
  compilerVersion: string;
};

export type CodingAgentLimits = {
  maxTurns: number;
  maxWallClockMs: number;
  /** A hard ceiling inside the provider's own loop (§18). */
  maxProviderSpendUsd: number;
};

export type CodingAgentRequest = {
  /** The AgentExecutionRun this belongs to. Binds usage and audit (§22). */
  runId: string;
  instruction: AgentInstruction;
  /** Chosen by configuration, never by a user or a model (§39, Rule 46). */
  model: string;
  effort: "low" | "medium" | "high";
  tools: readonly AgentToolDescriptor[];
  limits: CodingAgentLimits;
  /**
   * The single door to every effect the agent can have.
   *
   * Supplied by the caller, implemented by the tool gateway. A provider calls
   * it and reports what came back; it never inspects, second-guesses or
   * bypasses it.
   */
  invokeTool(name: string, input: unknown): Promise<AgentToolOutcome>;
  /**
   * How much self-checking this task is allowed (Sprint 0042).
   *
   * A provider carries it to wherever the harness runs and never interprets it.
   * Optional because a provider that has no place to enforce it — anything not
   * hosting the agent's own shell — correctly ignores it, and because a run
   * without one behaves exactly as it did before the plan existed.
   */
  verification?: SandboxVerificationPolicy;
  /** Cancellation and wall-clock enforcement (§36). */
  signal: AbortSignal;
};

/**
 * Provider-reported usage for one model, as observable units (§19).
 *
 * Token counts, not dollars. §19 is explicit that a client-side aggregate cost
 * is not billing authority when the provider does not guarantee it, so the
 * authoritative figures are the ones a provider counts and Vibe prices through
 * its own effective-dated price book. `reportedCostUsd` is carried alongside
 * — never instead — so the two can be compared once there is real data.
 */
export type AgentModelUsage = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  /** The provider's own estimate, when it offers one. Never the billing source. */
  reportedCostUsd: number | null;
};

export type CodingAgentResult = {
  outcome: AgentProviderOutcome;
  /**
   * Model responses the run produced. Observed, never self-reported.
   *
   * **Not** the unit the budget's turn ceiling is in. That bounds the harness's
   * own loop, which advances on tool results too — see `sdkLoopIterations`.
   * Run `b33635a1` recorded 66 of these against a ceiling of 40 and overran
   * nothing, because the number shown and the number bounded were different
   * quantities sharing one name.
   */
  assistantMessages: number;
  /**
   * The harness's own loop count, in the unit the ceiling is in.
   *
   * Null when the harness never reported one. Null is the honest answer there;
   * the message count is not a stand-in for it.
   */
  sdkLoopIterations: number | null;
  usage: readonly AgentModelUsage[];
  /**
   * The provider's session identity, when it exposes one (§38).
   *
   * Stored only if it is an identifier rather than a bearer credential — see
   * the adapter. Null when the provider offers nothing safe to keep.
   */
  sessionId: string | null;
  /** How many tool calls the provider's own permission layer refused. */
  providerDeniedToolCalls: number;
  /**
   * Check commands the harness let through and refused, counted at the point
   * the decision was made (Sprint 0042).
   *
   * Null for a provider that hosts no shell, and — importantly — null is not
   * zero. Run #5 recorded zero verification commands while running a permitted
   * targeted test, because `allowedTools` had auto-allowed Bash past the
   * permission handler entirely. A counter written where the decision happens
   * is the only thing that can disagree with one derived from the feed, and a
   * disagreement is the bug report.
   */
  verificationCommands: number | null;
  verificationRefusals: number | null;
  durationMs: number;
  /**
   * A sanitized description of a provider failure. Never surfaced to a user,
   * never a raw provider object, never model text.
   */
  failureDetail: string | null;
};

/**
 * A harness that outlives the step which started it
 * (EXECUTION CORE-4 runtime placement, ADR 0029).
 *
 * ## Why this is a different interface rather than a longer `run()`
 *
 * Because the shape of the work changed, not just its duration.
 * `CodingAgentProvider.run()` is one awaited call: whoever starts the agent
 * stays alive until it finishes. That is exactly what a Vercel step cannot do —
 * the first real run proved it by being killed at 300 seconds with the harness
 * still working and the run row still reading `turns: 0`.
 *
 * Under this interface the three moments are three separate calls, each short
 * enough to be its own durable step, and **none of them holds state between
 * calls**. Every implementation must be reconstructible from scratch: the step
 * that observes a run is a different function invocation from the one that
 * started it, on a different machine, minutes later. What persists lives in the
 * sandbox and in the database, never in this object.
 *
 * ## What each call may and may not do
 *
 * `start` may launch exactly one process, and must be safe to call after a
 * retry — the caller's claim is the primary guard, and an implementation is
 * expected to check the workspace as an independent second one.
 *
 * `observe` must be cheap and read-only. It is called on a timer for the whole
 * length of a run, so anything expensive here is paid for tens of times.
 *
 * `collect` reads the finished result. It never waits for one.
 */
export interface DetachedCodingAgentProvider {
  readonly id: string;
  readonly harness: string;

  /** Launches the harness and returns as soon as it is running. */
  start(request: CodingAgentRequest): Promise<DetachedStartOutcome>;

  /** What Vibe can see of the run right now. Never the agent's own account. */
  observe(): Promise<DetachedObservation>;

  /**
   * The finished result.
   *
   * `startedAtMs` is passed in rather than remembered, because the object that
   * started the run no longer exists — the duration belongs to the run, not to
   * any one invocation of this provider.
   */
  collect(input: { startedAtMs: number }): Promise<CodingAgentResult>;
}

export type DetachedStartOutcome =
  | { ok: true }
  /** Sanitized. Never a raw provider object and never model text. */
  | { ok: false; failureDetail: string };

/**
 * One line of the harness's progress feed, as Vibe read it back.
 *
 * Structurally incapable of carrying narration: a closed tag, a sequence, and
 * bounded identifiers. Telemetry only — what the run actually changed is still
 * established by comparing the workspace to the pinned commit (Rule 77).
 */
export type ObservedRuntimeEntry = {
  sequence: number;
  /**
   * Milliseconds since the harness started.
   *
   * Relative, because the sandbox's clock is not this system's. Vibe adds it to
   * the start time it recorded itself, which survives skew and gives a feed
   * with real per-step durations rather than one timestamp per poll batch.
   */
  offsetMs?: number;
  kind: "started" | "turn" | "tool" | "finished" | "verification" | "verification_refused";
  /** Model responses so far, on a `turn` line. */
  assistantMessages?: number;
  tool?: string;
  path?: string;
  command?: string;
  subtype?: string;
  /** Which check a verification line was about. Closed vocabulary (Sprint 0042). */
  check?: string;
  /** Why a check command was refused. Closed vocabulary. */
  refusalReason?: string;
};

export type DetachedObservation = {
  /** True once the harness has written anything at all. */
  started: boolean;
  /** True once it has written its result. The loop is over. */
  finished: boolean;
  /**
   * Model responses Vibe has observed, from the harness's own progress file.
   *
   * An observation, not a claim: the file records that a response *happened*,
   * which is a fact about what was billed. It is deliberately not the model's
   * description of what it did (Rule 77) — and deliberately not comparable to
   * the budget's turn ceiling, which counts the harness's loop instead.
   */
  assistantMessages: number;
  /**
   * The whole feed, every time — never a delta.
   *
   * The reader is a different function invocation with no memory of the last
   * one, and the durable write is an upsert keyed on the harness's own
   * sequence. Re-offering what is already stored is therefore free, and makes a
   * lost poll cost nothing.
   */
  entries?: readonly ObservedRuntimeEntry[];
};

export interface CodingAgentProvider {
  /** Stable identifier persisted with every usage event, e.g. "anthropic". */
  readonly id: string;
  /** The harness, distinct from the inference provider. e.g. "claude_agent_sdk". */
  readonly harness: string;

  /**
   * Runs one bounded agent loop to completion.
   *
   * Never throws for a provider fault: an untyped exception hands the durable
   * layer an unclassifiable outcome and a retry decision, which is precisely
   * the ambiguity §37 forbids resolving optimistically. Every failure comes
   * back as a `CodingAgentResult` carrying whatever usage was observed first.
   */
  run(request: CodingAgentRequest): Promise<CodingAgentResult>;
}
