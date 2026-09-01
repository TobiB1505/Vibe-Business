import {
  readAuthSurfaceCitation,
  readIntegrationCitation,
  SURFACE_NAMESPACES,
} from "@/modules/business-audit/evidence-ids";
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
 * Signed-in surfaces that carry financial authority.
 *
 * The `auth.` family is the Deep Scan's, and it is *not* a statement that a
 * step changes authentication — `auth.surface.dashboard` is a dashboard seen
 * while signed in. Only billing is escalated, and only because a billing area
 * is a payment surface wherever it was observed from.
 *
 * Widening this beyond billing would put every signed-in-product change outside
 * the V1 boundary, which is a decision with an ADR behind it and not a constant
 * somebody lengthens.
 */
const FINANCIAL_AUTH_SURFACES: readonly string[] = ["billing"];

/**
 * Change kinds that actually alter something outside Vibe.
 *
 * Risk is a statement about *consequence*, not about subject matter, so only
 * these can be escalated. A step that produces a written comparison of
 * authentication options is low risk even though authentication is what it is
 * about — see the note in `classifyExecutionRisk`.
 */
const MUTATING_CHANGE_KINDS: readonly StepChangeKind[] = ["product_change", "external_setup"];

/**
 * `repo.surface.<id>` / `live.surface.<id>` → `<id>`, or null for other ids.
 *
 * **Polarity is deliberately ignored.** Since `business-evidence.v4` a surface
 * that was *not* found is cited under its own namespace
 * (`repo.surface_absent.payments`), and a step citing that is a step about
 * adding payments — which is exactly as prohibited as a step modifying one.
 * Risk here is a statement about the surface, not about which direction the
 * change runs.
 *
 * Getting this wrong is the whole reason Sprint 0073 refused to rename the ids
 * on its own: `payments` matched the financial list, `payments_missing` would
 * not have, and a payments change would have fallen from `prohibited` to
 * `moderate` with nothing failing.
 */
function surfaceIdOf(evidenceId: string): string | null {
  for (const namespace of ["repo", "live"] as const) {
    const { present, absent } = SURFACE_NAMESPACES[namespace];
    if (evidenceId.startsWith(absent)) return evidenceId.slice(absent.length);
    if (evidenceId.startsWith(present)) return evidenceId.slice(present.length);
  }
  return null;
}

/**
 * What one evidence id says about consequence, across every family that can say it.
 *
 * Reading only `repo.surface.*` / `live.surface.*` was a hole with a real step
 * in it: the live plan's *"Wire the pricing page to a working Stripe checkout
 * and surface billing to signed-in users"* cites `repo.integration.stripe` and
 * `auth.surface.billing_not_observed` — payment work, in both of the two
 * families this function did not read, classified `moderate` and eligible for
 * an agent. `FINANCIAL_SURFACES` said "at any risk tolerance"; the parser
 * disagreed with it silently.
 *
 * Still keyed on **our** ids and never on prose, and polarity is still ignored
 * everywhere: a step adding payments is exactly as prohibited as one changing
 * them.
 */
type RiskMeaning = "financial" | "security" | null;

function meaningOf(evidenceId: string): RiskMeaning {
  const surface = surfaceIdOf(evidenceId);
  if (surface !== null) {
    if (FINANCIAL_SURFACES.includes(surface)) return "financial";
    if (SECURITY_SURFACES.includes(surface)) return "security";
    return null;
  }

  const auth = readAuthSurfaceCitation(evidenceId);
  if (auth !== null) {
    return FINANCIAL_AUTH_SURFACES.includes(auth.surfaceId) ? "financial" : null;
  }

  const integration = readIntegrationCitation(evidenceId);
  if (integration !== null) {
    if (integration.category === "payments") return "financial";
    if (integration.category === "auth") return "security";
  }

  return null;
}

function cites(evidenceIds: readonly string[], meaning: RiskMeaning): boolean {
  return evidenceIds.some((id) => meaningOf(id) === meaning);
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

  if (cites(step.evidenceIds, "financial")) return "prohibited";
  if (cites(step.evidenceIds, "security")) return "high";

  // Setting up an account, an integration or a listing is work outside the
  // product, against a third party, usually with credentials attached. It is
  // outside the V1 boundary whatever it cites (§20).
  if (step.changeKind === "external_setup") return "high";

  // A real change to how the product behaves: reviewable, revertible, and the
  // shape the first Coding Agent is being built for.
  return "moderate";
}
