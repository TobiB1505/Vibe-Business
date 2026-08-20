import type { StepChangeKind } from "@/modules/action-plans/schema";
import type { ExecutionRiskClass } from "@/modules/execution-contract/schema";
import { SENSITIVE_EVIDENCE_PREFIXES } from "@/modules/validation/depth";

/**
 * Execution Pricing Class — the pricing input, not a cost report (Sprint
 * 0052, Credit Economics v1, PART A/C).
 *
 * ## Naming note
 *
 * `execution-contract/schema.ts` already exports `ExecutionClass` /
 * `EXECUTION_CLASSES` for an unrelated concept — the *capability* class of a
 * change (today, exactly one: `"application_code_change"`), used to gate
 * what the agent is permitted to touch. That is a policy question decided
 * before this file's kind of class even applies. This module names its own
 * three-tier pricing concept `ExecutionPricingClass` specifically so the two
 * can be imported in the same file without a collision, and so nobody reads
 * "Execution Class" in a future billing screen and goes looking for it in
 * the wrong module.
 *
 * ## What Vibe sells
 *
 * Not tokens, not model time, not sandbox minutes, not changed bytes. Vibe
 * sells a `validated_agent_improvement` — a Planner Step, executed by the
 * agent, prepared as a change, and independently validated. The price a
 * customer sees for that must be knowable **before** the agent spends a
 * cent, or the number would depend on how inefficiently the agent happened
 * to work internally — the one thing PART A of this sprint forbids as a
 * pricing input.
 *
 * ## Why this file reads only three fields
 *
 * `riskClass`, `changeKind` and `evidenceIds` (plus `surfaces`, itself
 * derived from `evidenceIds`) are the only step-level facts that are (a)
 * resolved before agent execution starts and (b) resistant to prompt
 * injection, because they are computed from Vibe-minted evidence ids rather
 * than model prose. This is not a new trust boundary — it is the same one
 * `execution-contract/risk.ts` and `execution-context/surface.ts` already
 * rely on for exactly this reason, reused here rather than re-argued.
 *
 * Two real candidates were considered and rejected as inputs:
 *
 * - **`resolveValidationDepth`'s full depth** (`validation/depth.ts`) is
 *   *not* purely pre-execution — its strongest signal,
 *   `sensitiveDomainsIn(changedPaths)`, only exists after a Prepared Change
 *   has changed paths. Using it here would make the price depend on what the
 *   agent actually touched, breaking PART L's price-stability requirement.
 *   What *is* reusable pre-execution is the evidence-prefix sensitivity list
 *   (`SENSITIVE_EVIDENCE_PREFIXES`, exported from `depth.ts` for exactly this
 *   reuse) — the same taxonomy, checked against the same evidence ids a step
 *   already cites before any agent runs.
 * - **Actual token/duration/tool-call/file-count metrics** are explicitly out
 *   of bounds by the sprint's own charter: they exist only after the run,
 *   they measure how the agent worked rather than what was asked for, and
 *   `economy/run-economics.ts`'s own finding (Sprint 0050 PART D) is that
 *   changed-file count correlates *negatively* with cost. A classifier built
 *   on them would price agent inefficiency, not customer value.
 *
 * ## Three classes, not ten
 *
 * The sprint explicitly forbids a scoring engine. `surfaces.length` — the
 * count of named business surfaces the cited evidence implies, from
 * `execution-context/surface.ts`'s `ExecutionSurfaceRequirement` — is the one
 * genuinely pre-execution signal that varies across Vibe's own six historical
 * runs, and it is a count already computed for an unrelated purpose (routing
 * the Execution Brief), not a number invented for pricing.
 *
 * ## Escalate-first, same doctrine as `risk.ts` / `depth.ts`
 *
 * No combination of inputs may talk a genuinely risky or broad step down to a
 * cheaper class. Missing or absent evidence never buys the cheapest tier
 * either — see rule 6 below, which mirrors `resolveValidationDepth`'s
 * `unclassified_default` never landing on `fast`.
 */

export const EXECUTION_PRICING_CLASS_POLICY_VERSION = "execution-pricing-class.v1" as const;

export const EXECUTION_PRICING_CLASSES = ["small", "standard", "complex"] as const;
export type ExecutionPricingClass = (typeof EXECUTION_PRICING_CLASSES)[number];

/**
 * Why a step got the class it got. A closed vocabulary, mirroring
 * `ValidationDepthReason` — so a stored classification can be explained
 * without anyone writing prose per case, and so a UI or a report can render
 * "why" without re-deriving it.
 */
export const EXECUTION_PRICING_CLASS_REASONS = [
  /** Non-mutating step. Never reaches agent execution, so it has no class. */
  "not_mutating",
  /** The spec's own risk class is high or prohibited. */
  "high_risk_class",
  /** A cited evidence family names a sensitive business surface. */
  "sensitive_surface_evidence",
  /** Cited evidence implies two or more distinct named business surfaces. */
  "multi_surface",
  /** Cited evidence implies exactly one named business surface. */
  "single_surface",
  /** A mutating step cites no recognisable evidence at all. Escalate on silence. */
  "no_evidence_cited",
  /** Public-pages-only scope, no named surface. The narrowest real case. */
  "public_pages_only",
] as const;
export type ExecutionPricingClassReason = (typeof EXECUTION_PRICING_CLASS_REASONS)[number];

const MUTATING_CHANGE_KINDS: readonly StepChangeKind[] = ["product_change", "external_setup"];

export type ClassifyExecutionPricingClassInput = {
  riskClass: ExecutionRiskClass;
  changeKind: StepChangeKind;
  /** Vibe-minted ids the step cites. Never free text. */
  evidenceIds: readonly string[];
  /**
   * Named business surfaces the cited evidence implies, from
   * `deriveExecutionSurfaceRequirement(...).surfaces`. Passed in rather than
   * recomputed here so this module never needs its own copy of
   * `implicationOf`'s evidence-namespace table.
   */
  surfaces: readonly string[];
};

export type ExecutionPricingClassResolution = {
  /** Null for a non-mutating step — it never reaches agent execution, so it is never priced. */
  pricingClass: ExecutionPricingClass | null;
  reason: ExecutionPricingClassReason;
  policyVersion: typeof EXECUTION_PRICING_CLASS_POLICY_VERSION;
};

function resolution(
  pricingClass: ExecutionPricingClass | null,
  reason: ExecutionPricingClassReason,
): ExecutionPricingClassResolution {
  return { pricingClass, reason, policyVersion: EXECUTION_PRICING_CLASS_POLICY_VERSION };
}

/**
 * The Execution Pricing Class for one step, from trusted pre-execution data
 * only.
 *
 * Order is the policy, exactly as `resolveValidationDepth` documents its own
 * order: escalation is checked before anything that could lower the answer,
 * so no combination of inputs can talk a sensitive or broad step down to
 * `small`.
 *
 * 1. non-mutating change kind        → no class (never executes)
 * 2. high/prohibited risk class      → `complex`
 * 3. sensitive evidence cited        → `complex`
 * 4. two or more named surfaces      → `complex`
 * 5. exactly one named surface       → `standard`
 * 6. no evidence cited at all        → `standard` (escalate on silence)
 * 7. public-pages-only, zero named surfaces → `small`
 *
 * Deterministic and order-independent: the same three inputs always produce
 * the same class, whatever order `evidenceIds` or `surfaces` arrived in.
 */
export function classifyExecutionPricingClass(
  input: ClassifyExecutionPricingClassInput,
): ExecutionPricingClassResolution {
  if (!MUTATING_CHANGE_KINDS.includes(input.changeKind)) {
    return resolution(null, "not_mutating");
  }

  if (input.riskClass === "high" || input.riskClass === "prohibited") {
    return resolution("complex", "high_risk_class");
  }

  const citesSensitive = input.evidenceIds.some((id) =>
    SENSITIVE_EVIDENCE_PREFIXES.some((prefix) => id.startsWith(prefix)),
  );
  if (citesSensitive) return resolution("complex", "sensitive_surface_evidence");

  if (input.surfaces.length >= 2) return resolution("complex", "multi_surface");
  if (input.surfaces.length === 1) return resolution("standard", "single_surface");

  if (input.evidenceIds.length === 0) return resolution("standard", "no_evidence_cited");

  return resolution("small", "public_pages_only");
}

export const EXECUTION_PRICING_CLASS_LABELS: Record<ExecutionPricingClass, string> = {
  small: "Small",
  standard: "Standard",
  complex: "Complex",
};

export const EXECUTION_PRICING_CLASS_REASON_LABELS: Record<ExecutionPricingClassReason, string> = {
  not_mutating: "This step changes nothing outside Vibe — not priced",
  high_risk_class: "High-risk change",
  sensitive_surface_evidence: "The step cites a sensitive business surface",
  multi_surface: "The change spans multiple named business surfaces",
  single_surface: "The change targets one named business surface",
  no_evidence_cited: "No structured evidence cited; validated in full",
  public_pages_only: "A narrow, public-pages-only change",
};
