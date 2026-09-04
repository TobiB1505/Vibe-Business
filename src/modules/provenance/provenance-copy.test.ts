import { describe, expect, it } from "vitest";

import { findCausalClaims } from "@/modules/business-measurement/causality";
import { RETAIL_OPERATION_KINDS, retailChargeFor } from "@/modules/credits/retail";

import { PROVENANCE_LINKS } from "./chain";
import {
  FREE_REMEDIES,
  PROVENANCE_LINK_LABELS,
  PROVENANCE_REASONS,
  PROVENANCE_REMEDY_LABELS,
} from "./view";

/**
 * Every sentence a founder reads on the provenance panel, swept.
 *
 * The panel exists because a customer paid for four documents built on a
 * reading Vibe had already corrected. A surface that explains that had better
 * not itself overclaim — so the copy is held to the same rules as Nova's:
 * no figures, no causal claims, no promise about what a re-run will produce.
 */

const ALL_COPY = [
  ...Object.values(PROVENANCE_LINK_LABELS),
  ...Object.values(PROVENANCE_REASONS),
  ...Object.values(PROVENANCE_REMEDY_LABELS),
];

describe("every case has words", () => {
  it("names every link", () => {
    expect(Object.keys(PROVENANCE_LINK_LABELS).sort()).toEqual([...PROVENANCE_LINKS].sort());
  });

  it("leaves no sentence empty", () => {
    for (const text of ALL_COPY) expect(text.trim().length).toBeGreaterThan(3);
  });

  it("says each thing once", () => {
    expect(new Set(ALL_COPY).size).toBe(ALL_COPY.length);
  });
});

describe("the copy claims nothing it cannot show", () => {
  it("carries no figures", () => {
    for (const text of ALL_COPY) expect(text, text).not.toMatch(/\d/);
  });

  it("claims no causes", () => {
    /* Proved live first: an empty result means nothing if the detector is broken. */
    expect(findCausalClaims("This change caused conversions to rise.")).not.toEqual([]);

    for (const text of ALL_COPY) expect(findCausalClaims(text), text).toEqual([]);
  });

  /**
   * A fresh scan may find exactly what the old one did. Promising an
   * improvement would make a free remedy into a sales pitch for a paid one.
   */
  it("promises no better result from a re-run", () => {
    for (const text of ALL_COPY) {
      expect(text, text).not.toMatch(/\b(better|improve[ds]?|fix(es|ed)? your|more accurate)\b/i);
    }
  });

  it("does not tell the founder something is broken", () => {
    for (const text of ALL_COPY) {
      expect(text, text).not.toMatch(/\b(broken|wrong|invalid|failed|error)\b/i);
    }
  });
});

/**
 * The one price claim on the panel, checked against the authority that makes
 * it true rather than repeated from it.
 */
describe("the free remedy is actually free", () => {
  it("offers exactly one of them", () => {
    expect(FREE_REMEDIES).toEqual(["product_scan"]);
  });

  it("is free because it has no retail price at all", () => {
    expect([...RETAIL_OPERATION_KINDS]).not.toContain("product_scan");
  });

  /** And because the one priced thing it runs is priced `free`. */
  it("is free because the understanding it assembles is", () => {
    expect(retailChargeFor("product_understanding", new Date()).kind).toBe("free");
  });

  /** The two that cost are not quietly in the free list. */
  it("claims nothing about the two that charge", () => {
    for (const paid of ["business_audit", "opportunity_generation"] as const) {
      expect(FREE_REMEDIES, paid).not.toContain(paid);
      expect(retailChargeFor(paid, new Date()).kind, paid).toBe("charge");
    }
  });
});
