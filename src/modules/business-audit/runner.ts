import type { AIProvider, AIUsage, ProviderErrorDiagnostic, StructuredRequest } from "@/modules/ai/provider";
import type { OperationConfig } from "@/modules/ai/operations";
import {
  buildEvidencePackV3,
  evidenceIdSetV3,
  renderEvidencePackV3,
  trimEvidencePackV3,
  type BuildEvidencePackV3Input,
  type EvidencePackV3,
} from "./evidence-v3";
import { PROMPT_VERSION, buildSystemPrompt } from "./prompt";
import { RUBRIC_VERSION } from "./rubric";
import { computeOverallReadiness } from "./scoring";
import {
  AUDIT_CONTRACT_VERSION,
  BUSINESS_AUDIT_SCHEMA_VERSION,
  BUSINESS_AUDIT_VERSION,
  type BusinessReadinessAudit,
} from "./schema";
import { validateAuditOutput, type ValidationReason } from "./validate";
import {
  ANTHROPIC_AUDIT_OUTPUT_SCHEMA,
  normalizeAnthropicAuditOutput,
  type WireNormalizationReason,
} from "./wire-schema";

/**
 * The audit inference pipeline (Sprint 4 §16).
 *
 * Deliberately linear and single-shot:
 *
 *   evidence pack → token count (budget gate) → ONE paid call
 *                 → validate → deterministic scoring → audit
 *
 * There is no agent loop, no self-critique pass, no second opinion. Before
 * measuring what one call produces and what it costs, adding more calls
 * would multiply spend on an unmeasured assumption. If one call proves
 * insufficient, that is a product finding to act on with data.
 *
 * Kept free of database and `server-only` imports so the whole pipeline is
 * unit-testable against a fake provider.
 */

export type AuditRunFailure =
  | "audit_input_budget_exceeded"
  | "token_count_failed"
  | "provider_rate_limited"
  | "provider_auth_error"
  | "provider_billing_error"
  | "provider_timeout"
  | "provider_unavailable"
  | "provider_overloaded"
  | "provider_refusal"
  | "provider_request_rejected"
  | "structured_output_empty"
  | "structured_output_json_invalid"
  | "structured_output_schema_invalid"
  | "output_truncated"
  | "audit_failed";

/**
 * Safe, bounded diagnosis of a failed run, for internal use only.
 *
 * The four ways an audit can fail after a request is built look identical to
 * a user — "the result was not usable" — but need completely different
 * responses from us: fix the request, raise the output budget, fix the
 * prompt, or fix the validator. This carries just enough to tell them apart,
 * and structurally cannot carry model output, provider prose, prompts, or
 * evidence: every field is either a number or a code from a closed set.
 */
export type AuditRunDiagnostic = {
  /**
   * Which post-generation rule rejected the model's JSON — either transport
   * normalization (wrong dimension set) or domain validation.
   */
  validationReason?: ValidationReason | WireNormalizationReason;
  /** Safe provider signals, when the API rejected the request. */
  provider?: ProviderErrorDiagnostic;
};

export type AuditRunOutcome =
  | {
      ok: true;
      audit: BusinessReadinessAudit;
      usage: AIUsage;
      estimatedInputTokens: number;
      latencyMs: number;
    }
  | {
      ok: false;
      error: AuditRunFailure;
      /** Usage genuinely billed before the failure, when any. */
      usage?: AIUsage;
      /** Internal diagnosis. Never rendered in the browser. */
      diagnostic?: AuditRunDiagnostic;
      estimatedInputTokens: number | null;
      latencyMs: number;
    };

export type RunAuditInput = BuildEvidencePackV3Input & {
  provider: AIProvider;
  config: OperationConfig;
};

/**
 * Exported so durable execution can count tokens for the *same* request this
 * runner will send. A reconstruction would drift from the real one, and a
 * budget gate measuring the wrong payload is worse than none.
 */
export function buildAuditRequest(pack: EvidencePackV3, config: OperationConfig): StructuredRequest {
  return {
    operation: config.operation,
    model: config.model,
    // Authored entirely by us. No customer content is ever interpolated
    // into the system prompt (ADR 0011).
    system: buildSystemPrompt(),
    userContent: renderEvidencePackV3(pack),
    outputSchema: ANTHROPIC_AUDIT_OUTPUT_SCHEMA,
    maxOutputTokens: config.maxOutputTokens,
    reasoning: config.reasoning,
  };
}

export async function runBusinessReadinessAudit(input: RunAuditInput): Promise<AuditRunOutcome> {
  const { provider, config } = input;

  let pack = buildEvidencePackV3(input);
  let request = buildAuditRequest(pack, config);

  // Cost gate: count before spending (Sprint 4 §14). The provider's own
  // classification is passed through rather than flattened: a count that
  // failed because the account has no credit is not the same operational
  // problem as one that failed for an unknown reason.
  const firstCount = await provider.countInputTokens(request);
  if (!firstCount.ok) {
    return { ok: false, error: firstCount.error, estimatedInputTokens: null, latencyMs: 0 };
  }

  let estimatedInputTokens = firstCount.inputTokens;

  // Deterministic reduction: drop priority-3 evidence, then priority-2,
  // re-counting after each step. Priority-1 facts are never dropped, so a
  // pack that still does not fit is refused rather than silently gutted.
  for (const maxPriority of [2, 1] as const) {
    if (estimatedInputTokens <= config.maxInputTokens) break;

    const trimmed = trimEvidencePackV3(pack, maxPriority);
    if (trimmed === pack) continue;

    pack = trimmed;
    request = buildAuditRequest(pack, config);

    const recount = await provider.countInputTokens(request);
    if (!recount.ok) {
      return { ok: false, error: recount.error, estimatedInputTokens: null, latencyMs: 0 };
    }
    estimatedInputTokens = recount.inputTokens;
  }

  if (estimatedInputTokens > config.maxInputTokens) {
    return { ok: false, error: "audit_input_budget_exceeded", estimatedInputTokens, latencyMs: 0 };
  }

  // The single billable call.
  const result = await provider.generateStructured(request);

  if (!result.ok) {
    return {
      ok: false,
      error: result.error,
      usage: result.usage,
      // Present only for a rejected request; absent for every other
      // provider failure, which the code already fully describes.
      diagnostic: result.diagnostic ? { provider: result.diagnostic } : undefined,
      estimatedInputTokens,
      latencyMs: result.latencyMs,
    };
  }

  // Transport → domain, before any business rule runs. The provider's array
  // form is converted to the dimension-keyed shape and the guarantees the
  // array gave up (exactly five, each once, none unknown) are enforced here.
  // Tokens were billed either way, so a failure is reported with its usage.
  const normalized = normalizeAnthropicAuditOutput(result.data);
  if (!normalized.ok) {
    return {
      ok: false,
      error: "structured_output_schema_invalid",
      usage: result.usage,
      diagnostic: { validationReason: normalized.reason },
      estimatedInputTokens,
      latencyMs: result.latencyMs,
    };
  }

  const validation = validateAuditOutput(normalized.data, evidenceIdSetV3(pack));
  if (!validation.ok) {
    // The tokens were still billed even though the output is unusable —
    // recording that honestly is the point of the usage ledger. The reason
    // is carried through so a schema mismatch is diagnosable from the
    // failure record alone, without replaying a paid call.
    return {
      ok: false,
      error: validation.error,
      usage: result.usage,
      diagnostic: { validationReason: validation.reason },
      estimatedInputTokens,
      latencyMs: result.latencyMs,
    };
  }

  const { dimensions, synthesis, keyFindings, limitations, notes } = validation.audit;

  const validationNotes = [...notes];
  if (pack.trimmed) {
    validationNotes.push("Lower-priority evidence was trimmed to fit the input budget.");
  }

  const audit: BusinessReadinessAudit = {
    schemaVersion: BUSINESS_AUDIT_SCHEMA_VERSION,
    auditVersion: BUSINESS_AUDIT_VERSION,
    contractVersion: AUDIT_CONTRACT_VERSION,
    evidencePackVersion: pack.version,
    promptVersion: PROMPT_VERSION,
    rubricVersion: RUBRIC_VERSION,
    provider: provider.name,
    model: result.model,
    dimensions,
    // Computed here, never taken from the model (Sprint 4 §7).
    overall: computeOverallReadiness(dimensions),
    synthesis,
    keyFindings,
    limitations,
    validationNotes,
    generatedAt: new Date().toISOString(),
  };

  return {
    ok: true,
    audit,
    usage: result.usage,
    estimatedInputTokens,
    latencyMs: result.latencyMs,
  };
}
