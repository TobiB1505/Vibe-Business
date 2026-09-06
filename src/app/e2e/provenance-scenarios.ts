import { LIVE_PRODUCT_ANALYZER_VERSION } from "@/modules/live-product-intelligence/schema";
import { ANALYZER_VERSION as REPOSITORY_ANALYZER_VERSION } from "@/modules/repository-intelligence/schema";
import { provenanceForAction } from "@/modules/provenance/actions";
import { buildProvenanceChain, type ProvenanceInputs } from "@/modules/provenance/chain";

/**
 * The provenance panel, in the states a founder actually meets it in.
 *
 * ## Why these need a browser
 *
 * Because the claim under test is not a string, it is what somebody about to
 * spend 35 Credits can see. The incident this panel exists for produced four
 * documents built on a live scan Vibe had already corrected, and every screen
 * along the way was internally consistent and green. So what has to be true
 * here is a property of a rendered page: the outdated link is visible, it says
 * which reader produced it and which one runs now, and the free remedy is
 * offered exactly once — at the top of the chain rather than beside each row.
 *
 * The chain is built by the **real** `buildProvenanceChain` from inputs shaped
 * like the real evidence, and the versions come from the real constants — so a
 * bumped analyzer or a changed rule reaches the browser rather than leaving a
 * fixture agreeing with itself.
 */

const SCANNED = "2026-09-02T00:23:00.000Z";
const BUILT = "2026-09-02T09:41:00.000Z";

function current(): ProvenanceInputs {
  return {
    repositoryScan: { producedAt: SCANNED, analyzerVersion: REPOSITORY_ANALYZER_VERSION },
    liveScan: { producedAt: SCANNED, analyzerVersion: LIVE_PRODUCT_ANALYZER_VERSION },
    productProfile: { producedAt: BUILT, current: true },
    businessAudit: { producedAt: BUILT, upToDate: true },
    opportunitySet: { producedAt: BUILT, stale: false },
  };
}

const SCENARIOS = {
  /** Nothing to fix: the panel is provenance, not an alarm, and still shows. */
  "provenance-current": current(),

  /**
   * The incident, exactly as it happened: a live scan from the analyzer before
   * the pricing fix, with a profile that still reports itself current because
   * the snapshot's id never moved.
   */
  "provenance-stale-scan": {
    ...current(),
    liveScan: { producedAt: SCANNED, analyzerVersion: "live-product-analyzer-v3" },
  },

  /** A project at the very beginning, where nothing is outdated — only absent. */
  "provenance-nothing-yet": {
    repositoryScan: null,
    liveScan: null,
    productProfile: null,
    businessAudit: null,
    opportunitySet: null,
  },
} as const satisfies Record<string, ProvenanceInputs>;

export const E2E_PROVENANCE_SCENARIOS = SCENARIOS;
export type E2eProvenanceScenario = keyof typeof SCENARIOS;

export function isE2eProvenanceScenario(value: string): value is E2eProvenanceScenario {
  return Object.hasOwn(SCENARIOS, value);
}

/** The audit's own narrowed chain, assembled by the code the page uses. */
export function e2eProvenance(scenario: E2eProvenanceScenario) {
  return provenanceForAction(buildProvenanceChain(SCENARIOS[scenario]), "business_audit");
}
