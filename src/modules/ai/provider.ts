/**
 * The domain-owned AI provider boundary (ADR 0005, ADR 0011).
 *
 * Nothing in this file references Anthropic. Callers depend on these types
 * only, so swapping or adding a provider later means writing one adapter —
 * not rewriting the Business Audit layer.
 *
 * The capability offered is deliberately **generic structured generation**
 * rather than a `businessReadinessAudit()` method. A provider that knew
 * about business audits would have to change every time a new AI operation
 * is added (Sprint 5's Opportunity Engine being the immediate example), and
 * would invert the dependency: the infrastructure adapter would import
 * domain types. ADR 0005 names "structured generation" as an `AIProvider`
 * responsibility, which is exactly what this is.
 *
 * Three properties are load-bearing for the trust model (ADR 0011):
 *
 *  1. **No tools.** There is no field here for tools, web search, URL
 *     fetching, code execution, or file access. The provider adapter must
 *     not add them. A model that receives untrusted evidence and has no
 *     ability to act cannot be made to act by that evidence.
 *  2. **Schema-constrained output.** The response is validated against a
 *     JSON Schema by the provider, so a prose answer is a typed failure
 *     rather than something to parse hopefully.
 *  3. **No reasoning is returned.** The result carries structured output
 *     and usage only. Thinking blocks are never surfaced, so they can never
 *     be persisted or displayed (Sprint 4 §21).
 */

/** Operation identifiers, used for usage accounting and configuration lookup. */
export type AIOperation = "business_readiness_audit";

/** Effort levels supported by the configured model family. */
export type AIEffort = "low" | "medium" | "high";

export type StructuredRequest = {
  operation: AIOperation;
  model: string;
  /** Instructions and rubric. Authored by us — never assembled from user data. */
  system: string;
  /** The evidence payload. Untrusted DATA (ADR 0011). */
  userContent: string;
  /** JSON Schema the response must satisfy. */
  outputSchema: Record<string, unknown>;
  maxOutputTokens: number;
  effort: AIEffort;
};

export type AIUsage = {
  inputTokens: number;
  outputTokens: number;
  /**
   * Reasoning tokens billed as output, reported for cost transparency only.
   * The reasoning *text* is never requested, returned, or stored.
   */
  thinkingTokens: number;
};

export type StructuredSuccess = {
  ok: true;
  /** Parsed JSON matching `outputSchema`. Still validated by the domain layer. */
  data: unknown;
  usage: AIUsage;
  model: string;
  latencyMs: number;
};

/**
 * Every way a provider call can fail, as domain vocabulary. A raw provider
 * error must never escape the adapter (Sprint 4 §27).
 */
export type AIFailureCode =
  | "token_count_failed"
  | "provider_rate_limited"
  | "provider_auth_error"
  | "provider_timeout"
  | "provider_unavailable"
  | "provider_refusal"
  | "provider_overloaded"
  | "structured_output_invalid"
  | "output_truncated";

export type StructuredFailure = {
  ok: false;
  error: AIFailureCode;
  /**
   * Usage actually incurred before the failure, when the provider reported
   * any. Absent means no tokens were billed — a distinction that matters,
   * because recording cost that was never charged corrupts the ledger
   * (Sprint 4 §27).
   */
  usage?: AIUsage;
  model: string;
  latencyMs: number;
};

export type StructuredResult = StructuredSuccess | StructuredFailure;

export type TokenCountResult = { ok: true; inputTokens: number } | { ok: false; error: "token_count_failed" };

export interface AIProvider {
  /** Stable identifier persisted with every usage event, e.g. "anthropic". */
  readonly name: string;

  /**
   * Counts input tokens for the exact request that would be sent, before
   * any billable call. This is the input-budget gate (Sprint 4 §14).
   */
  countInputTokens(request: StructuredRequest): Promise<TokenCountResult>;

  /** Performs one billable structured-generation call. No retries, no loops. */
  generateStructured(request: StructuredRequest): Promise<StructuredResult>;
}
