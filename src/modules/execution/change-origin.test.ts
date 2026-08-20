import { describe, expect, it } from "vitest";
import { changeOriginFrom } from "./change-origin";
import type { BusinessOpportunity } from "@/modules/opportunities/schema";

/**
 * The origin DTO (UI-5 dogfood).
 *
 * What this file protects is a boundary, not a transformation. Three fields
 * cross into the browser and the rest of a `BusinessOpportunity` — evidence
 * ids, audit dimensions, readiness, confidence, dependencies — must not,
 * because a card has no use for any of it and shipping it would put a model's
 * internal reasoning trail in a page's payload.
 */

function opportunity(overrides: Partial<BusinessOpportunity> = {}): BusinessOpportunity {
  return {
    id: "growth_1",
    sourceConclusionKey: "discovery.sitemap_missing",
    rank: 1,
    title: "Make the landing page findable",
    problem: "Search engines have no structured way to discover the public pages.",
    whyNow: "Every week without it is a week of organic discovery that cannot start.",
    impact: "high",
    effort: "low",
    confidence: "high",
    category: "discovery",
    primaryDimension: "discoverability",
    secondaryDimensions: ["conversion"],
    evidenceIds: ["repo:app/sitemap", "site:robots"],
    executionType: "code_change",
    executionReadiness: "ready",
    dependencies: [],
    ...overrides,
  } as unknown as BusinessOpportunity;
}

describe("changeOriginFrom", () => {
  it("carries the three fields a person reads", () => {
    const origin = changeOriginFrom(opportunity());

    expect(origin).toEqual({
      title: "Make the landing page findable",
      problem: "Search engines have no structured way to discover the public pages.",
      whyNow: "Every week without it is a week of organic discovery that cannot start.",
    });
  });

  it("carries nothing else", () => {
    // Asserted as the whole key set rather than field by field, so a later
    // addition has to be a decision. Everything omitted here is either a
    // model's working — evidence ids, dimensions, confidence — or a scheduling
    // fact that says nothing about this change.
    expect(Object.keys(changeOriginFrom(opportunity())!).sort()).toEqual([
      "problem",
      "title",
      "whyNow",
    ]);
  });

  it("answers null when there is no Move to show", () => {
    // A prepared change whose set is gone, or whose ids were never recorded,
    // has no origin — the same answer `businessRationaleFor` gives for a
    // capability with no written rationale, and for the same reason: a generic
    // sentence would be true of any change and informative about none.
    expect(changeOriginFrom(null)).toBeNull();
  });

  it("passes the text through unchanged", () => {
    // Deliberately not sanitized, trimmed, truncated or rewritten. This is
    // model output the user has already read on Next moves; a second view of
    // it that silently differed from the first would be worse than either.
    const raw = opportunity({ problem: "  Two  spaces and a trailing newline\n" });

    expect(changeOriginFrom(raw)!.problem).toBe("  Two  spaces and a trailing newline\n");
  });
});
