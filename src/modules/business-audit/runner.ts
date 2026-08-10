import type { AIProvider, AIUsage, StructuredRequest } from "@/modules/ai/provider";
import type { OperationConfig } from "@/modules/ai/operations";
import { buildEvidencePack, evidenceIdSet, renderEvidencePack, trimEvidencePack, type BuildEvidencePackInput, type EvidencePack } from "./evidence";
import { AUDIT_OUTPUT_SCHEMA, PROMPT_VERSION, buildSystemPrompt } from "./prompt";
import { RUBRIC_VERSION } from "./rubric";
import { computeOverallReadiness } from "./scoring";
import { BUSINESS_AUDIT_SCHEMA_VERSION, BUSINESS_AUDIT_VERSION, type BusinessReadinessAudit } from "./schema";
import { validateAuditOutput } from "./validate";

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
  | "structured_output_invalid"
  | "output_truncated"
  | "audit_failed";

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
      estimatedInputTokens: number | null;
      latencyMs: number;
    };

export type RunAuditInput = BuildEvidencePackInput & {
  provider: AIProvider;
  config: OperationConfig;
};

function buildRequest(pack: EvidencePack, config: OperationConfig): StructuredRequest {
  return {
    operation: config.operation,
    model: config.model,
    // Authored entirely by us. No customer content is ever interpolated
    // into the system prompt (ADR 0011).
    system: buildSystemPrompt(),
    userContent: renderEvidencePack(pack),
    outputSchema: AUDIT_OUTPUT_SCHEMA,
    maxOutputTokens: config.maxOutputTokens,
    effort: config.effort,
  };
}

export async function runBusinessReadinessAudit(input: RunAuditInput): Promise<AuditRunOutcome> {
  const { provider, config } = input;

  let pack = buildEvidencePack(input);
  let request = buildRequest(pack, config);

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

    const trimmed = trimEvidencePack(pack, maxPriority);
    if (trimmed === pack) continue;

    pack = trimmed;
    request = buildRequest(pack, config);

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
      estimatedInputTokens,
      latencyMs: result.latencyMs,
    };
  }

  const validation = validateAuditOutput(result.data, evidenceIdSet(pack));
  if (!validation.ok) {
    // The tokens were still billed even though the output is unusable —
    // recording that honestly is the point of the usage ledger.
    return {
      ok: false,
      error: "structured_output_invalid",
      usage: result.usage,
      estimatedInputTokens,
      latencyMs: result.latencyMs,
    };
  }

  const { dimensions, keyFindings, limitations, notes } = validation.audit;

  const validationNotes = [...notes];
  if (pack.trimmed) {
    validationNotes.push("Lower-priority evidence was trimmed to fit the input budget.");
  }

  const audit: BusinessReadinessAudit = {
    schemaVersion: BUSINESS_AUDIT_SCHEMA_VERSION,
    auditVersion: BUSINESS_AUDIT_VERSION,
    evidencePackVersion: pack.version,
    promptVersion: PROMPT_VERSION,
    rubricVersion: RUBRIC_VERSION,
    provider: provider.name,
    model: result.model,
    dimensions,
    // Computed here, never taken from the model (Sprint 4 §7).
    overall: computeOverallReadiness(dimensions),
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
