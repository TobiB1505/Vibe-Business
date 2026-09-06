import type { OperationConfig } from "@/modules/ai/operations";
import type {
  AIProvider,
  AIUsage,
  ProviderErrorDiagnostic,
  StructuredRequest,
} from "@/modules/ai/provider";
import { evidenceIdSetV3, type EvidencePackV3 } from "@/modules/business-audit/evidence-v3";
import type { RepositoryIntelligenceSnapshot } from "@/modules/repository-intelligence/schema";
import { selectPlannerEvidence, trimPlannerEvidence } from "./evidence";
import { ACTION_PLANNER_PROMPT_VERSION, buildActionPlannerSystemPrompt } from "./prompt";
import type { PlannerFinding } from "./render";
import { renderActionPlanInput } from "./render";
import { ACTION_PLANNER_RUBRIC_VERSION } from "./rubric";
import {
  ACTION_PLANNER_CONTRACT_VERSION,
  ACTION_PLANNER_VERSION,
  ACTION_PLAN_SCHEMA_VERSION,
  ACTION_PLAN_STEP_SCHEMA_VERSION,
  type ActionPlan,
} from "./schema";
import type { PlannerSource } from "./source";
import {
  validateActionPlanOutput,
  type PlanValidationFinding,
  type PlanValidationReason,
} from "./validate";
import {
  ANTHROPIC_ACTION_PLAN_OUTPUT_SCHEMA,
  normalizeAnthropicActionPlanOutput,
  type PlanWireNormalizationReason,
} from "./wire-schema";

/**
 * The Action Planner inference pipeline (CORE-2b §45).
 *
 * ```
 * Move + conclusion + lenses + focused evidence
 *   → token count (budget gate) → ONE paid call
 *   → normalize → validate → classify → plan
 * ```
 *
 * **One call.** Not planner → summarizer → execution-classifier. The temptation
 * is a second call to decide what Vibe can execute, and it would be the wrong
 * architecture twice over: it would cost a second inference for a question a
 * lookup answers, and it would put a model back in charge of a system fact that
 * only the server may assert (§10, §46). Execution classification is
 * `classify.ts`, it is deterministic, and it is free.
 *
 * Kept free of database and `server-only` imports so the whole pipeline is
 * unit-testable against a fake provider.
 */

export type ActionPlanRunFailure =
  | "action_plan_input_budget_exceeded"
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
  | "action_planning_failed";

export type ActionPlanRunDiagnostic = {
  validationReason?: PlanValidationReason | PlanWireNormalizationReason;
  provider?: ProviderErrorDiagnostic;
};

export type ActionPlanRunOutcome =
  | {
      ok: true;
      plan: ActionPlan;
      findings: PlanValidationFinding[];
      usage: AIUsage;
      estimatedInputTokens: number;
      latencyMs: number;
    }
  | {
      ok: false;
      error: ActionPlanRunFailure;
      usage?: AIUsage;
      diagnostic?: ActionPlanRunDiagnostic;
      estimatedInputTokens: number | null;
      latencyMs: number;
    };

export type RunActionPlanInput = {
  source: PlannerSource;
  /** The audit's own evidence pack, before the planner narrows it (§34). */
  pack: EvidencePackV3;
  /**
   * The newest successful repository snapshot, or null.
   *
   * Used only by capability reconciliation, never by the model — it is not part
   * of the prompt and cannot be. This is the deterministic half of "can Vibe
   * execute this step?" and it belongs on this side of the boundary.
   */
  repository: RepositoryIntelligenceSnapshot | null;
  provider: AIProvider;
  config: OperationConfig;
  /**
   * What the founder established on steps no run could finish (ADR 0093).
   *
   * Passed in rather than read here for the same reason the pack is: the runner
   * makes a request, it does not decide what this project knows.
   */
  findings?: readonly PlannerFinding[];
};

export function buildActionPlanRequest(
  source: PlannerSource,
  pack: EvidencePackV3,
  config: OperationConfig,
  findings: readonly PlannerFinding[] = [],
): StructuredRequest {
  return {
    operation: config.operation,
    model: config.model,
    // Authored entirely by us. No customer content is interpolated into the
    // system prompt (ADR 0011, Rule 42).
    system: buildActionPlannerSystemPrompt(),
    userContent: renderActionPlanInput({ source, pack, findings }),
    outputSchema: ANTHROPIC_ACTION_PLAN_OUTPUT_SCHEMA,
    maxOutputTokens: config.maxOutputTokens,
    reasoning: config.reasoning,
    timeoutMs: config.timeoutMs,
  };
}

/** The pack the planner actually sends, narrowed from the audit's own (§34). */
export function buildPlannerPack(input: {
  source: PlannerSource;
  pack: EvidencePackV3;
}): EvidencePackV3 {
  return selectPlannerEvidence({
    pack: input.pack,
    citedIds: input.source.citedEvidenceIds,
  });
}

export async function runActionPlanning(
  input: RunActionPlanInput,
): Promise<ActionPlanRunOutcome> {
  const { provider, config, source } = input;
  const findings = input.findings ?? [];

  let pack = buildPlannerPack(input);
  let request = buildActionPlanRequest(source, pack, config, findings);

  // Cost gate: count before spending.
  const firstCount = await provider.countInputTokens(request);
  if (!firstCount.ok) {
    return { ok: false, error: firstCount.error, estimatedInputTokens: null, latencyMs: 0 };
  }

  let estimatedInputTokens = firstCount.inputTokens;

  // One reduction step, not a ladder. The focused pack is already small; if it
  // does not fit, the only remaining honest cut is scanner detail, and beyond
  // that the request is refused rather than stripped of the understanding that
  // makes a plan this product's plan.
  if (estimatedInputTokens > config.maxInputTokens) {
    const trimmed = trimPlannerEvidence(pack);
    if (trimmed !== pack) {
      pack = trimmed;
      request = buildActionPlanRequest(source, pack, config, findings);

      const recount = await provider.countInputTokens(request);
      if (!recount.ok) {
        return { ok: false, error: recount.error, estimatedInputTokens: null, latencyMs: 0 };
      }
      estimatedInputTokens = recount.inputTokens;
    }
  }

  if (estimatedInputTokens > config.maxInputTokens) {
    return {
      ok: false,
      error: "action_plan_input_budget_exceeded",
      estimatedInputTokens,
      latencyMs: 0,
    };
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

  const normalized = normalizeAnthropicActionPlanOutput(result.data);
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

  const validation = validateActionPlanOutput(normalized.plan, evidenceIdSetV3(pack), {
    repository: input.repository,
  });

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

  const plan: ActionPlan = {
    schemaVersion: ACTION_PLAN_SCHEMA_VERSION,
    stepSchemaVersion: ACTION_PLAN_STEP_SCHEMA_VERSION,
    contractVersion: ACTION_PLANNER_CONTRACT_VERSION,
    plannerVersion: ACTION_PLANNER_VERSION,
    promptVersion: ACTION_PLANNER_PROMPT_VERSION,
    rubricVersion: ACTION_PLANNER_RUBRIC_VERSION,
    evidencePackVersion: pack.version,
    provider: provider.name,
    model: result.model,
    goal: validation.result.goal,
    whyNow: validation.result.whyNow,
    expectedOutcome: validation.result.expectedOutcome,
    addressesRootProblem: validation.result.addressesRootProblem,
    assumptions: validation.result.assumptions,
    steps: validation.result.steps,
    validationNotes,
    generatedAt: new Date().toISOString(),
  };

  return {
    ok: true,
    plan,
    findings: validation.result.findings,
    usage: result.usage,
    estimatedInputTokens,
    latencyMs: result.latencyMs,
  };
}
