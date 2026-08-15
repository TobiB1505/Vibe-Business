import type { ExecutionCapability } from "./schema";

/**
 * Why a capability is worth running (Sprint 12C Cleanup §6, §7, §10).
 *
 * ## The three sentences this product must never collapse
 *
 * ```
 * BusinessRationale           why this change should matter
 * ProductOutcome              whether the intended behaviour was observed
 * BusinessOutcomeMeasurement  whether a business metric later moved
 * ```
 *
 * They are separate because each is knowable at a different moment and by
 * different means. A rationale is knowable *before* anything runs, deduced from
 * what the capability deterministically does. A product outcome is knowable
 * minutes after a merge, by asking the public internet. A business measurement
 * needs weeks of data and a connected source, and may never be knowable at all.
 *
 * Collapsing them is the standard way products lie. "This change improved your
 * SEO" reads as a measurement and is usually a rationale — a statement about
 * what the change was *for*, dressed as a finding.
 *
 * ## Why this needs no AI
 *
 * Because a capability's rationale is a property of the capability, not of the
 * customer. `nextjs_seo_foundations_v2` always adds the same two files for the
 * same reason; asking a model to re-explain that per project would spend money
 * to reintroduce variance into a constant, and give the output an authority
 * nothing checked.
 *
 * ## What a rationale may never contain
 *
 * A causal claim, a number, or a promise. It is the argument for doing
 * something, written before it was done — the weakest possible evidence, and it
 * has to sound like it. `business-rationale.test.ts` holds this copy to the same
 * phrase checker the measurement layer uses on measured results.
 */

export const RATIONALE_CATEGORIES = [
  "search_visibility",
  "conversion",
  "performance",
  "trust",
] as const;
export type RationaleCategory = (typeof RATIONALE_CATEGORIES)[number];

export type BusinessRationale = {
  category: RationaleCategory;
  /** The situation before the change, stated as an absence rather than a fault. */
  problem: string;
  /** What Vibe actually did, in the user's terms rather than in file names. */
  changeSummary: string;
  /** The mechanism by which it could matter. Never an assertion that it did. */
  whyItMatters: string;
  /** What should become observable — the product outcome's own subject. */
  expectedOutcome: string;
  /** What this explicitly does not establish. Never omitted (§10). */
  limitations: string;
};

/**
 * The SEO foundations rationale (§10).
 *
 * Every sentence is checkable against what the capability emits. It adds
 * `robots.ts` and `sitemap.ts`; the sitemap lists the homepage and excludes
 * authentication routes. Nothing here reaches beyond that.
 *
 * The limitation is the load-bearing sentence. Without it the paragraph reads
 * as a promise about traffic, which is exactly the claim the whole measurement
 * architecture exists to avoid making for free.
 */
const SEO_FOUNDATIONS: BusinessRationale = {
  category: "search_visibility",
  problem: "Search engines lacked structured discovery foundations.",
  changeSummary: "Vibe added the missing sitemap and search-engine crawling configuration.",
  whyItMatters:
    "This gives search engines a clearer way to discover and understand the public parts of the product.",
  expectedOutcome:
    "The public homepage can be discovered through the sitemap while authentication routes remain excluded.",
  limitations:
    "This establishes a technical foundation for organic visibility but does not guarantee rankings, traffic or revenue.",
};

/**
 * Rationale per capability.
 *
 * Both SEO capability versions share one rationale, deliberately: v2 refined
 * *which routes the sitemap lists*, not why a sitemap is worth having. A
 * rationale describes the intent, and the intent did not change.
 */
const RATIONALE_BY_CAPABILITY: Partial<Record<ExecutionCapability, BusinessRationale>> = {
  nextjs_seo_foundations_v1: SEO_FOUNDATIONS,
  nextjs_seo_foundations_v2: SEO_FOUNDATIONS,
};

/**
 * The rationale for a capability, or null.
 *
 * Null is a real answer and the UI must handle it: a capability with no written
 * rationale gets no "why this matters" section, rather than a generic sentence
 * that would be true of any change and therefore informative about none.
 */
export function businessRationaleFor(capability: string): BusinessRationale | null {
  return RATIONALE_BY_CAPABILITY[capability as ExecutionCapability] ?? null;
}
