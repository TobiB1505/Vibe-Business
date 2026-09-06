import { describe, expect, it } from "vitest";

import { RETAIL_OPERATION_KINDS } from "@/modules/credits/retail";
import { LIVE_PRODUCT_ANALYZER_VERSION } from "@/modules/live-product-intelligence/schema";
import { ANALYZER_VERSION as REPOSITORY_ANALYZER_VERSION } from "@/modules/repository-intelligence/schema";

import { PROVENANCE_CHAINS, provenanceForAction } from "./actions";
import { PROVENANCE_LINKS, buildProvenanceChain, type ProvenanceInputs } from "./chain";

const WHEN = "2026-09-02T08:00:00.000Z";

function inputs(overrides: Partial<ProvenanceInputs> = {}): ProvenanceInputs {
  return {
    repositoryScan: { producedAt: WHEN, analyzerVersion: REPOSITORY_ANALYZER_VERSION },
    liveScan: { producedAt: WHEN, analyzerVersion: LIVE_PRODUCT_ANALYZER_VERSION },
    productProfile: { producedAt: WHEN, current: true },
    businessAudit: { producedAt: WHEN, upToDate: true },
    opportunitySet: { producedAt: WHEN, stale: false },
    ...overrides,
  };
}

describe("every priced action says what it rests on", () => {
  it("covers the whole rate card", () => {
    expect(Object.keys(PROVENANCE_CHAINS).sort()).toEqual([...RETAIL_OPERATION_KINDS].sort());
  });

  it("names only links the chain actually produces", () => {
    for (const [action, links] of Object.entries(PROVENANCE_CHAINS)) {
      for (const kind of links) {
        expect(PROVENANCE_LINKS, `${action} → ${kind}`).toContain(kind);
      }
    }
  });

  /** A chain out of order would make `firstGap` name the wrong thing to fix. */
  it("lists each chain in the order the evidence is built", () => {
    for (const [action, links] of Object.entries(PROVENANCE_CHAINS)) {
      const positions = links.map((kind) => PROVENANCE_LINKS.indexOf(kind));

      expect(positions, action).toEqual([...positions].sort((a, b) => a - b));
    }
  });

  it("names no link twice", () => {
    for (const [action, links] of Object.entries(PROVENANCE_CHAINS)) {
      expect(new Set(links).size, action).toBe(links.length);
    }
  });

  /**
   * Empty is a real answer, and the only one. A Deep Scan observes the
   * authenticated product: there is nothing upstream of it to be out of date.
   * Any *other* empty chain would be a forgotten entry wearing the same shape.
   */
  it("leaves exactly one chain empty, and it is the one that produces evidence", () => {
    const empty = Object.entries(PROVENANCE_CHAINS)
      .filter(([, links]) => links.length === 0)
      .map(([action]) => action);

    expect(empty).toEqual(["deep_scan"]);
  });

  it("puts the audit under everything that reads an audit", () => {
    for (const action of ["opportunity_generation", "action_plan", "agent_execution"] as const) {
      expect(PROVENANCE_CHAINS[action], action).toContain("business_audit");
    }
  });
});

describe("an action is told about its own evidence and no more", () => {
  const chain = () => buildProvenanceChain(inputs());

  it("narrows to the links it reads", () => {
    expect(provenanceForAction(chain(), "business_audit").links.map((link) => link.kind)).toEqual([
      "repository_scan",
      "live_scan",
      "product_profile",
    ]);
  });

  it("hands a Deep Scan nothing to worry about", () => {
    const result = provenanceForAction(chain(), "deep_scan");

    expect(result.links).toEqual([]);
    expect(result.firstGap).toBeNull();
  });

  /**
   * The narrowing earning its place. A stale Move set is a real gap in the
   * chain — and it is not this button's business. Reporting it here would put a
   * wall in front of an audit for a reason the audit does not read.
   */
  it("does not report a stale Move set as an audit's gap", () => {
    const stale = buildProvenanceChain(
      inputs({ opportunitySet: { producedAt: WHEN, stale: true } }),
    );

    expect(stale.firstGap?.kind).toBe("opportunity_set");
    expect(provenanceForAction(stale, "business_audit").firstGap).toBeNull();
  });

  it("does report it to the plan that reads it", () => {
    const stale = buildProvenanceChain(
      inputs({ opportunitySet: { producedAt: WHEN, stale: true } }),
    );

    expect(provenanceForAction(stale, "action_plan").firstGap?.kind).toBe("opportunity_set");
  });

  it("names the topmost gap among the links the action reads", () => {
    const broken = buildProvenanceChain(
      inputs({
        liveScan: { producedAt: WHEN, analyzerVersion: "live-product-analyzer-v3" },
        opportunitySet: { producedAt: WHEN, stale: true },
      }),
    );

    expect(provenanceForAction(broken, "action_plan").firstGap?.kind).toBe("live_scan");
  });

  it("keeps chain order after narrowing", () => {
    const links = provenanceForAction(chain(), "agent_execution").links.map((link) => link.kind);

    expect(links).toEqual([...PROVENANCE_LINKS]);
  });
});
