import type { EvidencePackV3 } from "@/modules/business-audit/evidence-v3";

/**
 * The planner's evidence selection (CORE-2b §34, §36, §98).
 *
 * ## Why the planner does not get the whole pack
 *
 * The audit already did the broad reasoning. Re-sending everything it read
 * would pay a second time for the same breadth and produce the failure §36
 * names: a plan that turns into an inventory of what the scanner did not find —
 * no Stripe, no pricing, no checkout, no analytics — instead of a path through
 * one business problem.
 *
 * So the planner receives:
 *
 *  - **everything Vibe understands about the product**, always. The profile and
 *    the founder's own statements are what make a plan *this product's* plan
 *    rather than a template (§33), and they are the cheapest lines in the pack.
 *  - **the evidence the source judgment actually rested on** — the ids cited by
 *    the Move and by the audit conclusion and lenses behind it.
 *
 * and nothing else. Scanner detail that no part of the source judgment cited is
 * detail the plan has no business planning around.
 *
 * ## The consequence for citations
 *
 * The ids in the selected pack are exactly the ids validation will accept
 * (`validate.ts`). That is deliberate: a plan step cannot ground itself in a
 * fact the planner was never shown, and a model reaching for one gets the
 * citation dropped rather than displayed as justification (Rule 45).
 */

/** Categories that travel in full, regardless of what anything cited (§33). */
const ALWAYS_INCLUDED = new Set(["product_profile", "founder_intent"]);

export type SelectPlannerEvidenceInput = {
  pack: EvidencePackV3;
  /** Ids the Move, the conclusion and the lenses behind it cited. */
  citedIds: readonly string[];
};

/**
 * A narrowed pack, in the same shape so it renders through the same fence.
 *
 * Reusing `EvidencePackV3` rather than inventing a planner pack format keeps
 * one evidence contract in the system: the ids mean the same thing, the fence
 * wording carries the same untrusted-data warning, and the version recorded on
 * a plan is comparable with the version recorded on the audit it came from.
 */
export function selectPlannerEvidence(input: SelectPlannerEvidenceInput): EvidencePackV3 {
  const cited = new Set(input.citedIds);

  const items = input.pack.items.filter(
    (entry) => ALWAYS_INCLUDED.has(entry.category) || cited.has(entry.id),
  );

  return {
    ...input.pack,
    items,
    // `trimmed` means "the budget forced something out", which is not what
    // happened here. This narrowing is the intended contract, not a degradation,
    // and conflating the two would put a budget warning on every plan.
    trimmed: input.pack.trimmed,
  };
}

/**
 * Deterministic reduction when even the focused pack is too large.
 *
 * Drops scanner detail before it drops understanding, exactly as the audit's
 * own trimming does — a plan without the product profile is the thing this
 * layer exists to prevent.
 */
export function trimPlannerEvidence(pack: EvidencePackV3): EvidencePackV3 {
  const kept = pack.items.filter((entry) => ALWAYS_INCLUDED.has(entry.category));
  if (kept.length === pack.items.length) return pack;
  return { ...pack, items: kept, trimmed: true };
}
