import type { ProvenanceLinkKind, ProvenanceReason, ProvenanceRemedy } from "./chain";

/**
 * What the chain is called on a founder's screen.
 *
 * Here rather than in the component for the reason the Nova slots give: a
 * sentence typed into JSX is a sentence no value test sweeps, and the ones
 * below make claims about a customer's evidence. `provenance-copy.test.ts`
 * reads every string in this file — that it names no figure, promises no
 * outcome, and covers every member of every union.
 *
 * These are **things**, not error codes, and the same phrasing discipline
 * `AUDIT_PREREQUISITE_LABELS` uses: a founder reads "your website", not
 * "live_product_intelligence".
 */
export const PROVENANCE_LINK_LABELS: Record<ProvenanceLinkKind, string> = {
  repository_scan: "Your code",
  live_scan: "Your website",
  product_profile: "What Vibe understands about your product",
  business_audit: "Your business audit",
  opportunity_set: "Your Moves",
};

/**
 * Why a link is not current, in one sentence each.
 *
 * The two outdated reasons are kept apart because they are different facts
 * about Vibe, and a founder can act on the difference. `analyzer_corrected`
 * says Vibe's own reader was wrong and has been fixed; `inputs_moved` says the
 * evidence underneath moved and nothing was wrong with anything.
 * `built_on_outdated` is the one that names the chain itself, and it is the
 * sentence that was missing when an audit's critical blocker turned out to
 * rest on a page Vibe had misread hours earlier.
 */
export const PROVENANCE_REASONS: Record<ProvenanceReason, string> = {
  never_produced: "Vibe has not produced this yet.",
  analyzer_corrected: "Vibe has corrected how it reads this since the last run.",
  inputs_moved: "What this was built from has changed since.",
  built_on_outdated: "This rests on a reading Vibe has since corrected.",
};

/**
 * What replaces a link, named as the run a founder would recognise.
 *
 * A Product Scan is the remedy for all three of the links above the audit
 * because it refreshes the sources and rebuilds the understanding in one run
 * (ADR 0052) — so somebody whose whole chain lags is asked to press once.
 */
export const PROVENANCE_REMEDY_LABELS: Record<ProvenanceRemedy, string> = {
  product_scan: "Run a fresh Product Scan",
  business_audit: "Run a new business audit",
  opportunity_generation: "Generate new Moves",
};

/**
 * The one remedy that costs a founder nothing.
 *
 * Asserted against the rate card rather than stated: `product_scan` is not a
 * `RetailOperationKind` at all, and the understanding it assembles is priced
 * `free`. Both are checked in `provenance-copy.test.ts`, so this sentence
 * cannot outlive the price that makes it true.
 */
export const FREE_REMEDIES: readonly ProvenanceRemedy[] = ["product_scan"];
