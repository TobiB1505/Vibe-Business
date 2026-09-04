import { describe, expect, it } from "vitest";

import { LIVE_PRODUCT_ANALYZER_VERSION } from "@/modules/live-product-intelligence/schema";
import { ANALYZER_VERSION as REPOSITORY_ANALYZER_VERSION } from "@/modules/repository-intelligence/schema";

import { PROVENANCE_LINKS, buildProvenanceChain, type ProvenanceInputs } from "./chain";

/**
 * The chain, and the one thing it exists to catch.
 *
 * A stale live scan produced an audit whose critical blocker was false, and
 * every screen along the way was internally consistent. The test that matters
 * most in this file is `the profile cannot be more current than its scan`: that
 * is the link where the chain reported green over evidence Vibe already knew
 * was wrong, because `isProfileCurrent` hashes a snapshot's **id** and a
 * corrected analyzer does not move an id.
 */

const WHEN = "2026-09-02T08:00:00.000Z";

/** Everything current, so each test can spoil exactly one thing. */
function healthy(): ProvenanceInputs {
  return {
    repositoryScan: { producedAt: WHEN, analyzerVersion: REPOSITORY_ANALYZER_VERSION },
    liveScan: { producedAt: WHEN, analyzerVersion: LIVE_PRODUCT_ANALYZER_VERSION },
    productProfile: { producedAt: WHEN, current: true },
    businessAudit: { producedAt: WHEN, upToDate: true },
    opportunitySet: { producedAt: WHEN, stale: false },
  };
}

function chain(overrides: Partial<ProvenanceInputs> = {}) {
  return buildProvenanceChain({ ...healthy(), ...overrides });
}

function link(result: ReturnType<typeof chain>, kind: (typeof PROVENANCE_LINKS)[number]) {
  const found = result.links.find((candidate) => candidate.kind === kind);
  if (!found) throw new Error(`the chain must always carry ${kind}`);
  return found;
}

describe("a chain with nothing wrong with it", () => {
  it("carries every link, in the order the evidence was built", () => {
    expect(chain().links.map((entry) => entry.kind)).toEqual([...PROVENANCE_LINKS]);
  });

  it("has no gap", () => {
    expect(chain().firstGap).toBeNull();
  });

  it("offers no remedy for a link that is fine", () => {
    for (const entry of chain().links) expect(entry.remedy, entry.kind).toBeNull();
  });

  it("still reports when and by what each scan was produced", () => {
    expect(link(chain(), "live_scan")).toMatchObject({
      state: "current",
      producedAt: WHEN,
      producedBy: LIVE_PRODUCT_ANALYZER_VERSION,
      runningNow: LIVE_PRODUCT_ANALYZER_VERSION,
    });
  });
});

describe("a scan is judged by the machine that made it", () => {
  it("reads the version from the analyzer running now, not a literal", () => {
    expect(link(chain(), "repository_scan").runningNow).toBe(REPOSITORY_ANALYZER_VERSION);
  });

  it("calls a scan from a corrected analyzer outdated, and says why", () => {
    const result = chain({
      liveScan: { producedAt: WHEN, analyzerVersion: "live-product-analyzer-v3" },
    });

    expect(link(result, "live_scan")).toMatchObject({
      state: "outdated",
      reason: "analyzer_corrected",
      remedy: "product_scan",
      producedBy: "live-product-analyzer-v3",
      runningNow: LIVE_PRODUCT_ANALYZER_VERSION,
    });
  });

  it("calls a scan that was never taken missing, and says that instead", () => {
    expect(link(chain({ repositoryScan: null }), "repository_scan")).toMatchObject({
      state: "missing",
      reason: "never_produced",
      producedAt: null,
      producedBy: null,
    });
  });

  /**
   * Age is a proxy; the version is the fact. A month-old scan of a site that
   * has not changed is perfectly good evidence.
   */
  it("does not care how old a scan is", () => {
    const ancient = chain({
      repositoryScan: {
        producedAt: "2019-01-01T00:00:00.000Z",
        analyzerVersion: REPOSITORY_ANALYZER_VERSION,
      },
    });

    expect(link(ancient, "repository_scan").state).toBe("current");
  });
});

describe("the incident, as a property of the chain", () => {
  const outdatedScan = {
    liveScan: { producedAt: WHEN, analyzerVersion: "live-product-analyzer-v3" },
  };

  /**
   * The regression. `productProfile.current` is `true` here — which is exactly
   * what the real reader returns, because the snapshot id did not move. A chain
   * that took that at face value would show green over the wrong evidence,
   * which is what happened.
   */
  it("the profile cannot be more current than its scan", () => {
    expect(link(chain(outdatedScan), "product_profile")).toMatchObject({
      state: "outdated",
      reason: "built_on_outdated",
      remedy: "product_scan",
    });
  });

  it("and neither can the audit, or the Moves under it", () => {
    const result = chain(outdatedScan);

    expect(link(result, "business_audit").reason).toBe("built_on_outdated");
    expect(link(result, "opportunity_set").reason).toBe("built_on_outdated");
  });

  /** One thing to fix, and it is the top one — the rest follow from it. */
  it("names the scan as the gap, not the four things derived from it", () => {
    expect(chain(outdatedScan).firstGap?.kind).toBe("live_scan");
  });

  it("is the first in chain order when two links are broken", () => {
    const result = chain({ ...outdatedScan, repositoryScan: null });

    expect(result.firstGap?.kind).toBe("repository_scan");
  });
});

describe("a derived document is judged by what it was derived from", () => {
  it("says so, rather than showing a version it does not have", () => {
    const entry = link(chain(), "business_audit");

    expect(entry.judgedBy).toBe("input_identity");
    expect(entry.producedBy).toBeNull();
    expect(entry.runningNow).toBeNull();
  });

  it("a scan says the opposite", () => {
    expect(link(chain(), "live_scan").judgedBy).toBe("analyzer_version");
  });

  it("reports a moved input as its own reason, not as poisoning", () => {
    const result = chain({ businessAudit: { producedAt: WHEN, upToDate: false } });

    expect(link(result, "business_audit")).toMatchObject({
      state: "outdated",
      reason: "inputs_moved",
      remedy: "business_audit",
    });
  });

  it("a stale Move set names the run that replaces it", () => {
    const result = chain({ opportunitySet: { producedAt: WHEN, stale: true } });

    expect(link(result, "opportunity_set")).toMatchObject({
      reason: "inputs_moved",
      remedy: "opportunity_generation",
    });
  });

  /**
   * A Product Scan refreshes the sources and assembles the profile in one run
   * (ADR 0052), so a founder whose scans and profile all lag is asked to press
   * once — not three times, in an order they have to work out.
   */
  it("points the two scans and the profile at the same single run", () => {
    const result = chain({ repositoryScan: null, liveScan: null, productProfile: null });

    for (const kind of ["repository_scan", "live_scan", "product_profile"] as const) {
      expect(link(result, kind).remedy, kind).toBe("product_scan");
    }
  });
});

describe("a project at the very beginning", () => {
  const nothing: ProvenanceInputs = {
    repositoryScan: null,
    liveScan: null,
    productProfile: null,
    businessAudit: null,
    opportunitySet: null,
  };

  it("reports every link missing rather than outdated", () => {
    for (const entry of buildProvenanceChain(nothing).links) {
      expect(entry, entry.kind).toMatchObject({ state: "missing", reason: "never_produced" });
    }
  });

  /** "Never produced" is a truer thing to show than "built on something old". */
  it("does not describe an absent document as poisoned", () => {
    const result = buildProvenanceChain(nothing);

    expect(result.links.map((entry) => entry.reason)).not.toContain("built_on_outdated");
  });
});
