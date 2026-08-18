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
  /** Turns the provider actually took. Observed, never self-reported by the model. */
  turns: number;
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
  durationMs: number;
  /**
   * A sanitized description of a provider failure. Never surfaced to a user,
   * never a raw provider object, never model text.
   */
  failureDetail: string | null;
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
