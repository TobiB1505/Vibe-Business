import type { StepChangeKind } from "@/modules/action-plans/schema";
import type { ExecutionRiskClass } from "./schema";

/**
 * Risk classification (EXECUTION CORE-3 §19).
 *
 * ## What this is allowed to read
 *
 * Structured step fields only: the change kind, and the evidence ids the step
 * cites. Never the title, description, purpose or completion criteria.
 *
 * That restriction is the same one `action-plans/capability-registry.ts`
 * imposes on capability matching, and for the same reason: **model wording is
 * not a machine API.** A risk model keyed on prose would let a reworded step
 * downgrade itself from `high` to `moderate`, which is the single most valuable
 * thing a prompt injection in a customer's repository could achieve.
 *
 * Evidence ids are safe to read because they are *ours*. `repo.surface.*`,
 * `live.surface.*` and `live.conversion.*` are minted by
 * `business-audit/evidence.ts` from deterministic detectors, and the planner is
 * validated to cite only ids that exist in the pack. A model can choose which
 * of our ids to cite; it cannot invent one.
 *
 * ## Why over-inclusive is the correct error
 *
 * A step that only *links to* a login page cites `live.surface.login` and is
 * classified `high`, which puts it outside the V1 agentic boundary even though
 * the change itself is a hyperlink. That is deliberate. The cost of being wrong
 * in the permissive direction is an agent editing an authentication flow; the
 * cost of being wrong in the conservative direction is a step Vibe declines to
 * automate and truthfully says so. Those are not comparable.
 */

/**
 * Surfaces that carry financial authority.
 *
 * A step touching these is `prohibited` outright rather than `high`, because
 * "an agent should be careful here" is the wrong sentence: Vibe does not modify
 * payment architecture at all, at any risk tolerance, and §15 lists payment
 * actions among the default-deny set.
 */
const FINANCIAL_SURFACES: readonly string[] = ["payments", "checkout_billing"];

/**
 * Surfaces that carry authentication, session or account-boundary semantics.
 *
 * `high`, not `prohibited`: these are legitimate future work for a Coding Agent
 * and §20 lists auth/security rewrites as *initially* unsupported rather than
 * permanently forbidden. Widening this is an ADR, not a constant.
 */
const SECURITY_SURFACES: readonly string[] = ["authentication", "login", "signup"];

/**
 * Change kinds that actually alter something outside Vibe.
 *
 * Risk is a statement about *consequence*, not about subject matter, so only
 * these can be escalated. A step that produces a written comparison of
 * authentication options is low risk even though authentication is what it is
 * about — see the note in `classifyExecutionRisk`.
 */
const MUTATING_CHANGE_KINDS: readonly StepChangeKind[] = ["product_change", "external_setup"];

/** `repo.surface.<id>` / `live.surface.<id>` → `<id>`, or null for other ids. */
function surfaceIdOf(evidenceId: string): string | null {
  for (const prefix of ["repo.surface.", "live.surface."]) {
    if (evidenceId.startsWith(prefix)) return evidenceId.slice(prefix.length);
  }
  return null;
}

function citesSurface(evidenceIds: readonly string[], surfaces: readonly string[]): boolean {
  return evidenceIds.some((id) => {
    const surface = surfaceIdOf(id);
    return surface !== null && surfaces.includes(surface);
  });
}

export type RiskClassificationInput = {
  changeKind: StepChangeKind;
  evidenceIds: readonly string[];
};

/**
 * The risk class of one step (§19).
 *
 * Ordered most-severe-first, so a step that is both financial and a product
 * change lands on the stricter answer rather than on whichever branch happened
 * to be written first.
 */
export function classifyExecutionRisk(step: RiskClassificationInput): ExecutionRiskClass {
  // Deciding, analysing, measuring, researching. Nothing outside Vibe changes,
  // so nothing can go wrong outside Vibe either — whatever the step cites.
  //
  // This gate is first, and it was moved here after the real dogfood: step 1 of
  // the persisted plan is *"lay out the access options for staff"*, an analysis
  // step that cites `repo.surface.authentication` because that is the evidence
  // it reasons about. Classifying it `high` was a category error — it described
  // the subject matter rather than the consequence — and it would have put
  // "touches sign-in" beside a step whose entire output is a written comparison.
  //
  // Nothing about safety is relaxed by this: the escalations below are the only
  // thing risk gates, and the only branch that consults them requires
  // `product_change`.
  if (!MUTATING_CHANGE_KINDS.includes(step.changeKind)) return "low";

  if (citesSurface(step.evidenceIds, FINANCIAL_SURFACES)) return "prohibited";
  if (citesSurface(step.evidenceIds, SECURITY_SURFACES)) return "high";

  // Setting up an account, an integration or a listing is work outside the
  // product, against a third party, usually with credentials attached. It is
  // outside the V1 boundary whatever it cites (§20).
  if (step.changeKind === "external_setup") return "high";

  // A real change to how the product behaves: reviewable, revertible, and the
  // shape the first Coding Agent is being built for.
  return "moderate";
}
