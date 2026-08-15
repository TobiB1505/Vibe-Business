import type { OperationConfig } from "@/modules/ai/operations";
import type {
  AIProvider,
  AIUsage,
  ProviderErrorDiagnostic,
  StructuredRequest,
} from "@/modules/ai/provider";
import { assembleProfile } from "./assemble";
import {
  buildUnderstandingPack,
  renderUnderstandingPack,
  trimUnderstandingPack,
  understandingEvidenceIds,
  type BuildUnderstandingPackInput,
  type UnderstandingEvidencePack,
} from "./evidence";
import { PROMPT_VERSION, buildSystemPrompt } from "./prompt";
import type { ProductProfile } from "./schema";
import { validateUnderstanding, type ValidationReason } from "./validate";
import {
  PRODUCT_UNDERSTANDING_OUTPUT_SCHEMA,
  normalizeUnderstandingOutput,
  type WireNormalizationReason,
} from "./wire-schema";

/**
 * The Product Understanding pipeline (CORE-1 §19, §21, §50).
 *
 * Deliberately the same shape as the Business Audit's, because the properties
 * that shape bought are the ones this needs too:
 *
 *   evidence pack → token count (budget gate) → ONE paid call
 *                 → normalize → validate → assemble → profile
 *
 * No agent loop, no second opinion, no self-critique. One call per new
 * understanding, and CORE-1 §50 makes that a tested property rather than an
 * intention.
 *
 * ## Why a failed call is not a failed profile
 *
 * The audit refuses outright when inference fails, and it is right to: there
 * is no audit without a model. This is different. Capabilities, the journey,
 * business signals, brand and the technical profile are all derived
 * deterministically *before* the call, so a provider outage costs the semantic
 * paragraph and nothing else.
 *
 * So `runProductUnderstanding` returns a profile either way, and reports the
 * failure alongside it. A founder whose provider was rate-limited still sees
 * what Vibe found; they just do not see the sentence about what it means
 * (CORE-1 §43).
 *
 * Kept free of database and `server-only` imports, so the whole pipeline is
 * unit-testable against a fake provider.
 */

export type UnderstandingFailure =
  | "understanding_input_budget_exceeded"
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
  | "understanding_failed";

export type UnderstandingDiagnostic = {
  validationReason?: ValidationReason | WireNormalizationReason;
  provider?: ProviderErrorDiagnostic;
};

export type UnderstandingOutcome = {
  /** Always present. Deterministic-only when `synthesis` did not succeed. */
  profile: ProductProfile;
  /** Whether the paid call produced a usable result. */
  synthesized: boolean;
  /** Set when synthesis failed. The profile is still usable. */
  error?: UnderstandingFailure;
  diagnostic?: UnderstandingDiagnostic;
  /** Billed usage, when the provider reported any. */
  usage?: AIUsage;
  estimatedInputTokens: number | null;
  latencyMs: number;
};

export type RunUnderstandingInput = BuildUnderstandingPackInput & {
  provider: AIProvider;
  config: OperationConfig;
  /** Injected so the pipeline stays deterministic under test. */
  now: () => string;
};

/**
 * A derived profile carries **no** corrections.
 *
 * The user's own words are stored separately and overlaid when a profile is
 * read (`store.ts`). Baking them in here would mean a correction the user
 * later deletes lives on inside every profile derived while it existed, and
 * "the derived half is replaced wholesale" would stop being true.
 */
const NO_CORRECTIONS = {} as const;

/**
 * Exported so durable execution can count tokens for the *same* request the
 * runner will send. A reconstruction would drift, and a budget gate measuring
 * the wrong payload is worse than none.
 */
export function buildUnderstandingRequest(
  pack: UnderstandingEvidencePack,
  config: OperationConfig,
): StructuredRequest {
  return {
    operation: config.operation,
    model: config.model,
    // Authored entirely by us. No customer content is ever interpolated into
    // the system prompt (CLAUDE.md rule 42).
    system: buildSystemPrompt(),
    userContent: renderUnderstandingPack(pack),
    outputSchema: PRODUCT_UNDERSTANDING_OUTPUT_SCHEMA,
    maxOutputTokens: config.maxOutputTokens,
    effort: config.effort,
  };
}

export async function runProductUnderstanding(
  input: RunUnderstandingInput,
): Promise<UnderstandingOutcome> {
  const { provider, config } = input;

  /** The profile Vibe can produce with no model at all. Always the floor. */
  const deterministicProfile = (): ProductProfile =>
    assembleProfile({
      repository: input.repository,
      liveProduct: input.liveProduct,
      signedInProduct: input.signedInProduct,
      synthesis: null,
      corrections: NO_CORRECTIONS,
      provider: null,
      model: null,
      promptVersion: null,
      generatedAt: input.now(),
    });

  function failed(
    error: UnderstandingFailure,
    extra: Partial<UnderstandingOutcome> = {},
  ): UnderstandingOutcome {
    return {
      profile: deterministicProfile(),
      synthesized: false,
      error,
      estimatedInputTokens: null,
      latencyMs: 0,
      ...extra,
    };
  }

  let pack = buildUnderstandingPack(input);
  let request = buildUnderstandingRequest(pack, config);

  // Cost gate: count before spending. The provider's own classification is
  // passed through rather than flattened, so "no credit on the account" stays
  // distinguishable from "counting failed for an unknown reason".
  const firstCount = await provider.countInputTokens(request);
  if (!firstCount.ok) return failed(firstCount.error);

  let estimatedInputTokens = firstCount.inputTokens;

  // Deterministic reduction: drop priority-3 evidence, then priority-2,
  // recounting after each step. Priority-1 facts are never dropped, so a pack
  // that still does not fit is refused rather than silently gutted.
  for (const maxPriority of [2, 1] as const) {
    if (estimatedInputTokens <= config.maxInputTokens) break;

    const trimmed = trimUnderstandingPack(pack, maxPriority);
    if (trimmed === pack) continue;

    pack = trimmed;
    request = buildUnderstandingRequest(pack, config);

    const recount = await provider.countInputTokens(request);
    if (!recount.ok) return failed(recount.error);
    estimatedInputTokens = recount.inputTokens;
  }

  if (estimatedInputTokens > config.maxInputTokens) {
    return failed("understanding_input_budget_exceeded", { estimatedInputTokens });
  }

  // The single billable call.
  const result = await provider.generateStructured(request);

  if (!result.ok) {
    return failed(result.error, {
      usage: result.usage,
      diagnostic: result.diagnostic ? { provider: result.diagnostic } : undefined,
      estimatedInputTokens,
      latencyMs: result.latencyMs,
    });
  }

  const normalized = normalizeUnderstandingOutput(result.data);
  if (!normalized.ok) {
    return failed("structured_output_schema_invalid", {
      usage: result.usage,
      diagnostic: { validationReason: normalized.reason },
      estimatedInputTokens,
      latencyMs: result.latencyMs,
    });
  }

  const validation = validateUnderstanding(normalized.data, understandingEvidenceIds(pack));
  if (!validation.ok) {
    // Tokens were billed even though the output is unusable. Reporting that
    // honestly is the point of the usage ledger.
    return failed(validation.error, {
      usage: result.usage,
      diagnostic: { validationReason: validation.reason },
      estimatedInputTokens,
      latencyMs: result.latencyMs,
    });
  }

  const understanding = validation.understanding;
  if (pack.trimmed) {
    understanding.notes.push("Lower-priority evidence was trimmed to fit the input budget.");
  }

  const profile = assembleProfile({
    repository: input.repository,
    liveProduct: input.liveProduct,
    signedInProduct: input.signedInProduct,
    synthesis: understanding,
    corrections: NO_CORRECTIONS,
    provider: provider.name,
    model: result.model,
    promptVersion: PROMPT_VERSION,
    generatedAt: input.now(),
  });

  return {
    profile,
    synthesized: true,
    usage: result.usage,
    estimatedInputTokens,
    latencyMs: result.latencyMs,
  };
}
