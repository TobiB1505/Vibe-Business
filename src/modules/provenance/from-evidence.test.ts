import { describe, expect, it } from "vitest";

import type { AuditEvidence } from "@/modules/business-audit/service";
import type { OpportunitySetView } from "@/modules/opportunities/service";

import { provenanceInputsFrom } from "./from-evidence";

/**
 * The rename, and the two places it could quietly lie.
 *
 * A row that carries no document is not evidence, and a date the panel shows
 * has to be the instant the document became what it is. Everything else here
 * is field plumbing — which is exactly why it is worth a test: plumbing is
 * where a panel comes to describe a different snapshot than the audit reads.
 */

const STARTED = "2026-09-02T00:21:00.000Z";
const FINISHED = "2026-09-02T00:23:00.000Z";

/** Only the fields the adapter reads; the documents themselves are opaque to it. */
function evidence(overrides: Partial<AuditEvidence> = {}): AuditEvidence {
  return {
    repository: {
      result: {},
      analyzerVersion: "repo-intelligence-v7",
      createdAt: STARTED,
      completedAt: FINISHED,
    },
    live: {
      result: {},
      analyzerVersion: "live-product-analyzer-v3",
      createdAt: STARTED,
      completedAt: FINISHED,
    },
    authenticated: null,
    profile: { stored: { createdAt: STARTED, completedAt: FINISHED } },
    latestAudit: { result: {}, createdAt: STARTED, completedAt: FINISHED },
    founderIntent: { intentHash: "x" },
    ...overrides,
  } as unknown as AuditEvidence;
}

function moves(stale: boolean): OpportunitySetView {
  return {
    set: { createdAt: STARTED, completedAt: FINISHED },
    stale,
  } as unknown as OpportunitySetView;
}

function build(overrides: Partial<AuditEvidence> = {}, opportunities = moves(false)) {
  return provenanceInputsFrom({
    evidence: evidence(overrides),
    readiness: { productProfileCurrent: true } as never,
    currency: { upToDate: true } as never,
    opportunities,
  });
}

describe("it renames, and decides nothing", () => {
  it("passes each scan's analyzer version through untouched", () => {
    expect(build().liveScan?.analyzerVersion).toBe("live-product-analyzer-v3");
  });

  it("takes the profile's currency from the readiness the page computed", () => {
    const inputs = provenanceInputsFrom({
      evidence: evidence(),
      readiness: { productProfileCurrent: false } as never,
      currency: { upToDate: true } as never,
      opportunities: null,
    });

    expect(inputs.productProfile?.current).toBe(false);
  });

  it("takes the audit's from the currency the page computed", () => {
    const inputs = provenanceInputsFrom({
      evidence: evidence(),
      readiness: { productProfileCurrent: true } as never,
      currency: { upToDate: false } as never,
      opportunities: null,
    });

    expect(inputs.businessAudit?.upToDate).toBe(false);
  });

  it("takes the Move set's staleness from the view the page computed", () => {
    expect(build({}, moves(true)).opportunitySet?.stale).toBe(true);
  });
});

describe("a row without a document is not evidence", () => {
  /** The same guard `outdatedScans` uses, and for the same reason. */
  it("treats a scan carrying no snapshot as absent", () => {
    expect(build({ live: { result: null } as never }).liveScan).toBeNull();
  });

  it("treats an audit carrying no document as absent", () => {
    expect(build({ latestAudit: { result: null } as never }).businessAudit).toBeNull();
  });

  it("reports nothing at all for a project with no Moves", () => {
    expect(
      provenanceInputsFrom({
        evidence: evidence(),
        readiness: { productProfileCurrent: true } as never,
        currency: { upToDate: true } as never,
        opportunities: null,
      }).opportunitySet,
    ).toBeNull();
  });
});

describe("the date is when the document became what it is", () => {
  it("prefers the moment it finished", () => {
    expect(build().repositoryScan?.producedAt).toBe(FINISHED);
  });

  it("falls back to when it started rather than showing nothing", () => {
    const unfinished = build({
      repository: {
        result: {},
        analyzerVersion: "repo-intelligence-v7",
        createdAt: STARTED,
        completedAt: null,
      } as never,
    });

    expect(unfinished.repositoryScan?.producedAt).toBe(STARTED);
  });
});
