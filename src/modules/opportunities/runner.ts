import type { AIProvider, AIUsage, ProviderErrorDiagnostic, StructuredRequest } from "@/modules/ai/provider";
import type { OperationConfig } from "@/modules/ai/operations";
import {
  buildEvidencePackV3,
  evidenceIdSetV3,
  trimEvidencePackV3,
  type BuildEvidencePackV3Input,
  type EvidencePackV3,
} from "@/modules/business-audit/evidence-v3";
import type { BusinessReadinessAudit } from "@/modules/business-audit/schema";
import { OPPORTUNITY_PROMPT_VERSION, buildOpportunitySystemPrompt } from "./prompt";
import { renderOpportunityInput } from "./render";
import { OPPORTUNITY_RUBRIC_VERSION } from "./rubric";
import {
  OPPORTUNITY_ENGINE_VERSION,
  OPPORTUNITY_SCHEMA_VERSION,
  OPPORTUNITY_SET_SCHEMA_VERSION,
  type OpportunitySet,
} from "./schema";
import {
  validateOpportunityOutput,
  type OpportunityValidationReason,
} from "./validate";
import {
  ANTHROPIC_OPPORTUNITY_OUTPUT_SCHEMA,
  normalizeAnthropicOpportunityOutput,
  type WireNormalizationReason,
} from "./wire-schema";

/**
 * The opportunity inference pipeline (Sprint 8 §19, §26).
 *
 * The same shape as the audit runner, for the same reasons:
 *
 *   audit + evidence pack → token count (budget gate) → ONE paid call
 *                         → normalize → validate → opportunity set
 *
 * No agent loop, no self-critique, no second opinion from a larger model.
 * Prioritization is a judgement task where a second pass would double the cost
 * on an unmeasured assumption; if one call proves insufficient that is a
 * product finding to act on with data.
 *
 * Kept free of database and `server-only` imports so the whole pipeline is
 * unit-testable against a fake provider.
 */

export type OpportunityRunFailure =
  | "opportunity_input_budget_exceeded"
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
  | "opportunity_generation_failed";

export type OpportunityRunDiagnostic = {
  validationReason?: OpportunityValidationReason | WireNormalizationReason;
  provider?: ProviderErrorDiagnostic;
};

export type OpportunityRunOutcome =
  | {
      ok: true;
      set: OpportunitySet;
      usage: AIUsage;
      estimatedInputTokens: number;
      latencyMs: number;
    }
  | {
      ok: false;
      error: OpportunityRunFailure;
      usage?: AIUsage;
      diagnostic?: OpportunityRunDiagnostic;
      estimatedInputTokens: number | null;
      latencyMs: number;
    };

export type RunOpportunityInput = BuildEvidencePackV3Input & {
  audit: BusinessReadinessAudit;
  auditId: string;
  provider: AIProvider;
  config: OperationConfig;
};

export function buildOpportunityRequest(
  audit: BusinessReadinessAudit,
  pack: EvidencePackV3,
  config: OperationConfig,
): StructuredRequest {
  return {
    operation: config.operation,
    model: config.model,
    // Authored entirely by us. No customer content is interpolated into the
    // system prompt (ADR 0011).
    system: buildOpportunitySystemPrompt(),
    userContent: renderOpportunityInput({ audit, pack }),
    outputSchema: ANTHROPIC_OPPORTUNITY_OUTPUT_SCHEMA,
    maxOutputTokens: config.maxOutputTokens,
    reasoning: config.reasoning,
  };
}

export async function runOpportunityGeneration(
  input: RunOpportunityInput,
): Promise<OpportunityRunOutcome> {
  const { provider, config, audit } = input;

  let pack = buildEvidencePackV3(input);
  let request = buildOpportunityRequest(audit, pack, config);

  // Cost gate: count before spending.
  const firstCount = await provider.countInputTokens(request);
  if (!firstCount.ok) {
    return { ok: false, error: firstCount.error, estimatedInputTokens: null, latencyMs: 0 };
  }

  let estimatedInputTokens = firstCount.inputTokens;

  // Deterministic reduction, priority band by priority band. The audit is
  // never trimmed — it is the smaller input and the one prioritization
  // depends on most.
  for (const maxPriority of [2, 1] as const) {
    if (estimatedInputTokens <= config.maxInputTokens) break;

    const trimmed = trimEvidencePackV3(pack, maxPriority);
    if (trimmed === pack) continue;

    pack = trimmed;
    request = buildOpportunityRequest(audit, pack, config);

    const recount = await provider.countInputTokens(request);
    if (!recount.ok) {
      return { ok: false, error: recount.error, estimatedInputTokens: null, latencyMs: 0 };
    }
    estimatedInputTokens = recount.inputTokens;
  }

  if (estimatedInputTokens > config.maxInputTokens) {
    return { ok: false, error: "opportunity_input_budget_exceeded", estimatedInputTokens, latencyMs: 0 };
  }

  // The single billable call.
  const result = await provider.generateStructured(request);

  if (!result.ok) {
    return {
      ok: false,
      error: result.error,
      usage: result.usage,
      diagnostic: result.diagnostic ? { provider: result.diagnostic } : undefined,
      estimatedInputTokens,
      latencyMs: result.latencyMs,
    };
  }

  const normalized = normalizeAnthropicOpportunityOutput(result.data);
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

  const validation = validateOpportunityOutput(normalized.opportunities, evidenceIdSetV3(pack));
  if (!validation.ok) {
    // Tokens were billed even though the output is unusable. Recording that
    // honestly is the point of the usage ledger, and the reason travels with
    // the failure so it is diagnosable without replaying a paid call.
    return {
      ok: false,
      error: validation.error,
      usage: result.usage,
      diagnostic: { validationReason: validation.reason },
      estimatedInputTokens,
      latencyMs: result.latencyMs,
    };
  }

  const validationNotes = [...validation.result.notes];
  if (pack.trimmed) {
    validationNotes.push("Lower-priority evidence was trimmed to fit the input budget.");
  }

  const set: OpportunitySet = {
    schemaVersion: OPPORTUNITY_SET_SCHEMA_VERSION,
    opportunitySchemaVersion: OPPORTUNITY_SCHEMA_VERSION,
    engineVersion: OPPORTUNITY_ENGINE_VERSION,
    promptVersion: OPPORTUNITY_PROMPT_VERSION,
    rubricVersion: OPPORTUNITY_RUBRIC_VERSION,
    evidencePackVersion: pack.version,
    auditId: input.auditId,
    provider: provider.name,
    model: result.model,
    opportunities: validation.result.opportunities,
    validationNotes,
    generatedAt: new Date().toISOString(),
  };

  return {
    ok: true,
    set,
    usage: result.usage,
    estimatedInputTokens,
    latencyMs: result.latencyMs,
  };
}
