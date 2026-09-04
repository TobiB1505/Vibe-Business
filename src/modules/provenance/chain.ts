import { LIVE_PRODUCT_ANALYZER_VERSION } from "@/modules/live-product-intelligence/schema";
import { ANALYZER_VERSION as REPOSITORY_ANALYZER_VERSION } from "@/modules/repository-intelligence/schema";

/**
 * What a paid action will be built on, said out loud before it is bought.
 *
 * ## The complaint this answers
 *
 * "Warum warnt mich nichts, ob alles aktuell ist, bevor wir den Kunden den
 * Scan und Geld ausgeben lassen? Es baut alles aufeinander auf — ein falscher
 * Product Scan macht alle anderen Sachen danach kaputt und falsch."
 *
 * That is the correct diagnosis of a real incident. A live scan taken before a
 * classifier fix said a page with three prices had no pricing surface; the
 * profile, the audit, the Moves and the plan were all derived from it, and the
 * founder paid for every one of them. Each screen was internally consistent.
 * Nothing anywhere said "this rests on a reading Vibe has since corrected".
 *
 * ## Why this is provenance and not a green light
 *
 * The obvious build is a badge: run every version check, show a tick, enable
 * the button. It is the wrong shape, for a reason this repository has already
 * paid to learn — **a light is only as trustworthy as the version behind it**.
 * On 2026-09-02 the analyzer version was stale and the code was fixed, so a
 * light comparing v3 to v3 would have shown green over exactly the evidence
 * that was wrong. `src/lib/versions/analyzer-versions.test.ts` closes that
 * particular hole, and it cannot close the general one: a tick is a claim the
 * customer has no way to check.
 *
 * So this shows the facts instead — what Vibe holds, when it produced it, and
 * which machine produced it — and lets a founder read the gap themselves. A
 * date and a version string are checkable; "everything is current" is not.
 *
 * ## It adds no reads and no second opinion
 *
 * Every judgment here comes from a decision some other module already made and
 * some caller already computed: the scans' analyzer versions from
 * `outdatedScans`, the profile from `getAuditReadiness`, the audit from
 * `getAuditCurrency`, the Move set from `getLatestOpportunities`. This file
 * rearranges them into "what does this rest on"; it never re-decides one.
 * A panel that could disagree with the button beside it would be worse than no
 * panel — that is the same reason the prerequisite sentence on Business Health
 * is built from `auditReadiness.missing` rather than re-derived in the page.
 */

/** The evidence chain, in the order each link is derived from the one above. */
export const PROVENANCE_LINKS = [
  "repository_scan",
  "live_scan",
  "product_profile",
  "business_audit",
  "opportunity_set",
] as const;
export type ProvenanceLinkKind = (typeof PROVENANCE_LINKS)[number];

/**
 * Three states, because a founder has three decisions.
 *
 * The reason is a separate field: it is what makes the state actionable, and
 * folding it in would produce a dozen states nobody can hold in their head.
 */
export type ProvenanceState = "missing" | "outdated" | "current";

export type ProvenanceReason =
  /** Vibe has never produced this. */
  | "never_produced"
  /** The machine that produced it has since been corrected. */
  | "analyzer_corrected"
  /** It is internally current, but what it was derived from has moved. */
  | "inputs_moved"
  /**
   * It reports itself current, and rests on something that does not.
   *
   * The one judgment this file makes that its inputs do not hand it — and it
   * is not a new one. `getAuditReadiness` already checks `outdatedScans`
   * *before* the profile for exactly this reason: `isProfileCurrent` hashes a
   * snapshot's **id**, and a corrected analyzer does not move an id. So a
   * profile built on a scan Vibe knows is wrong hashes identical and reports
   * itself current. Saying so is the whole point of drawing a chain.
   */
  | "built_on_outdated";

/**
 * What decides whether a link is still good — and the two answers differ.
 *
 * A **scan** is judged by the version of the analyzer that made it: a month-old
 * scan of a site that has not changed is perfectly good evidence, and a scan
 * from this morning made by a detector corrected at lunchtime is not. Age is a
 * proxy; the version is the fact.
 *
 * A **derived document** is judged by its input identity — a hash over every
 * source and version that produced it. There is no single version string to
 * show a founder, and inventing one would be the traffic light again.
 *
 * Naming the difference is more honest than flattening it, because the two
 * cannot be repaired the same way.
 */
export type ProvenanceCurrency = "analyzer_version" | "input_identity";

/** The free work that replaces a link, for the caller to price and to offer. */
export type ProvenanceRemedy = "product_scan" | "business_audit" | "opportunity_generation";

export type ProvenanceLink = {
  kind: ProvenanceLinkKind;
  state: ProvenanceState;
  reason: ProvenanceReason | null;
  judgedBy: ProvenanceCurrency;
  /** When Vibe produced what it holds; null when it holds nothing. */
  producedAt: string | null;
  /**
   * The version that produced it and the one running now — both non-null only
   * where the version *is* the currency fact, which is the two scans.
   */
  producedBy: string | null;
  runningNow: string | null;
  /** What produces a replacement. Null when nothing is wrong with this link. */
  remedy: ProvenanceRemedy | null;
};

export type ProvenanceChain = {
  links: readonly ProvenanceLink[];
  /**
   * The first link that is not current, and the only one worth fixing first.
   *
   * Everything below a broken link is derived from it, so repairing the third
   * while the first is wrong buys a fresh document built on the same mistake.
   */
  firstGap: ProvenanceLink | null;
};

/**
 * Exactly what reaches the chain, named in one place.
 *
 * Narrow on purpose rather than taking `AuditEvidence` wholesale: every field
 * here is a fact some other module decided, and a wide input would let a
 * caller quietly hand this file a judgment of its own making.
 */
export type ProvenanceInputs = {
  repositoryScan: { producedAt: string | null; analyzerVersion: string } | null;
  liveScan: { producedAt: string | null; analyzerVersion: string } | null;
  /** `current` is `getAuditReadiness`'s `productProfileCurrent`. */
  productProfile: { producedAt: string | null; current: boolean } | null;
  /** `upToDate` is `getAuditCurrency`'s. */
  businessAudit: { producedAt: string | null; upToDate: boolean } | null;
  /** `stale` is `getLatestOpportunities`'s: a newer audit exists than this set saw. */
  opportunitySet: { producedAt: string | null; stale: boolean } | null;
};

function scanLink(
  kind: "repository_scan" | "live_scan",
  scan: { producedAt: string | null; analyzerVersion: string } | null,
  runningNow: string,
): ProvenanceLink {
  const base = {
    kind,
    judgedBy: "analyzer_version" as const,
    producedAt: scan?.producedAt ?? null,
    producedBy: scan?.analyzerVersion ?? null,
    runningNow,
  };

  if (!scan) {
    return { ...base, state: "missing", reason: "never_produced", remedy: "product_scan" };
  }

  if (scan.analyzerVersion !== runningNow) {
    return { ...base, state: "outdated", reason: "analyzer_corrected", remedy: "product_scan" };
  }

  return { ...base, state: "current", reason: null, remedy: null };
}

/**
 * A derived document, which is current only if it is *and* what it rests on is.
 *
 * `restsOnGap` is the state of everything above it, already decided. Passing it
 * in rather than recomputing keeps the poisoning rule in one place: a document
 * cannot be more current than its own evidence.
 */
function derivedLink(
  kind: "product_profile" | "business_audit" | "opportunity_set",
  held: { producedAt: string | null; ownCurrency: boolean } | null,
  remedy: ProvenanceRemedy,
  restsOnGap: boolean,
): ProvenanceLink {
  const base = {
    kind,
    judgedBy: "input_identity" as const,
    producedAt: held?.producedAt ?? null,
    producedBy: null,
    runningNow: null,
  };

  if (!held) {
    return { ...base, state: "missing", reason: "never_produced", remedy };
  }

  if (restsOnGap) {
    return { ...base, state: "outdated", reason: "built_on_outdated", remedy };
  }

  if (!held.ownCurrency) {
    return { ...base, state: "outdated", reason: "inputs_moved", remedy };
  }

  return { ...base, state: "current", reason: null, remedy: null };
}

/**
 * The chain, in the order the evidence was built.
 *
 * Order is not cosmetic. It is what makes `firstGap` meaningful, and it is what
 * lets a founder read one sentence instead of five: repair the top one, and the
 * ones below it are replaced by the same run or by the run that follows it.
 */
export function buildProvenanceChain(inputs: ProvenanceInputs): ProvenanceChain {
  const repository = scanLink(
    "repository_scan",
    inputs.repositoryScan,
    REPOSITORY_ANALYZER_VERSION,
  );
  const live = scanLink("live_scan", inputs.liveScan, LIVE_PRODUCT_ANALYZER_VERSION);

  const scansGood = repository.state === "current" && live.state === "current";

  const profile = derivedLink(
    "product_profile",
    inputs.productProfile
      ? { producedAt: inputs.productProfile.producedAt, ownCurrency: inputs.productProfile.current }
      : null,
    /*
     * A Product Scan, not a separate understanding run. It refreshes the
     * connected sources *and* assembles the profile as one customer-visible
     * run (ADR 0052), so it is the one remedy that repairs all three of the
     * links above — which is why a founder is only ever asked to press once.
     */
    "product_scan",
    !scansGood,
  );

  const audit = derivedLink(
    "business_audit",
    inputs.businessAudit
      ? { producedAt: inputs.businessAudit.producedAt, ownCurrency: inputs.businessAudit.upToDate }
      : null,
    "business_audit",
    profile.state !== "current",
  );

  const opportunities = derivedLink(
    "opportunity_set",
    inputs.opportunitySet
      ? { producedAt: inputs.opportunitySet.producedAt, ownCurrency: !inputs.opportunitySet.stale }
      : null,
    "opportunity_generation",
    audit.state !== "current",
  );

  const links = [repository, live, profile, audit, opportunities];

  return { links, firstGap: links.find((link) => link.state !== "current") ?? null };
}
