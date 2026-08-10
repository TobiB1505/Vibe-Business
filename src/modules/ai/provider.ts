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
  | "provider_billing_error"
  | "provider_timeout"
  | "provider_unavailable"
  | "provider_refusal"
  | "provider_overloaded"
  /**
   * The API rejected the request before producing any output — a payload we
   * built wrong. Deliberately distinct from the output-handling codes below:
   * a rejected request is our bug and nothing was generated or billed, while
   * a malformed output means a generation happened and was paid for.
   */
  | "provider_request_rejected"
  /** 200 response, but the expected text block was absent or empty. */
  | "structured_output_empty"
  /** 200 response with text that would not parse as JSON. */
  | "structured_output_json_invalid"
  | "output_truncated";

/**
 * Safe provider signals kept for internal diagnosis of a rejected request
 * (ADR 0011, Sprint 4 §27).
 *
 * Deliberately a fixed set of low-cardinality, non-sensitive fields. The raw
 * error message, the response body, the request payload, the prompt, the
 * evidence pack, and the API key are never represented here — there is no
 * field they could occupy. Values are validated against strict character
 * patterns in the adapter rather than trusted, so a provider that returns
 * something unexpected cannot smuggle prose through this channel.
 */
export type ProviderErrorDiagnostic = {
  /** HTTP status, when the failure carried one. */
  httpStatus: number | null;
  /** The API's own typed error discriminator, e.g. "invalid_request_error". */
  providerErrorType: string | null;
  /** Opaque provider request id, for support escalation. Not a secret. */
  requestId: string | null;
};

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
  /**
   * Safe provider signals, present only for `provider_request_rejected`.
   * Absent means there was nothing safe to report — never that the failure
   * was unremarkable.
   */
  diagnostic?: ProviderErrorDiagnostic;
  model: string;
  latencyMs: number;
};

export type StructuredResult = StructuredSuccess | StructuredFailure;

/**
 * How a token count can fail.
 *
 * Token counting is free, but it talks to the same API as the billable call
 * and therefore hits the same provider states — no credit, a bad key, a rate
 * limit. Collapsing all of them into `token_count_failed` was a real
 * production defect: an account with no usage credit reported "the audit
 * could not be prepared", which reads as a transient glitch and hides an
 * operator-actionable billing problem.
 *
 * A subset of `AIFailureCode` rather than the whole union: a count cannot be
 * refused, truncated, or return malformed structured output, so those codes
 * are not representable here.
 */
export type TokenCountFailureCode = Extract<
  AIFailureCode,
  | "token_count_failed"
  | "provider_rate_limited"
  | "provider_auth_error"
  | "provider_billing_error"
  | "provider_timeout"
  | "provider_unavailable"
  | "provider_overloaded"
>;

export type TokenCountResult =
  | { ok: true; inputTokens: number }
  /**
   * `token_count_failed` is the last resort — it means counting failed for a
   * reason that maps onto no known provider state, not merely that counting
   * is what failed.
   */
  | { ok: false; error: TokenCountFailureCode };

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
