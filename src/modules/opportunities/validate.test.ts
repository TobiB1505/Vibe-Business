import { describe, expect, it } from "vitest";
import { MAX_OPPORTUNITIES } from "./schema";
import { FAKE_EVIDENCE_IDS, fakeWireOpportunity } from "./test-support";
import { validateOpportunityOutput } from "./validate";

/**
 * Opportunity validation (Sprint 8 §12, §14, §17, §38).
 *
 * This layer runs on a response we have already paid for, so most cases here
 * are about repairing rather than rejecting — and about being able to say
 * afterwards exactly what was repaired.
 */

function validate(entries: ReturnType<typeof fakeWireOpportunity>[]) {
  return validateOpportunityOutput(entries, FAKE_EVIDENCE_IDS);
}

function expectOk(result: ReturnType<typeof validate>) {
  if (!result.ok) throw new Error(`expected ok, got ${result.reason}`);
  return result.result;
}

describe("counts and ranks", () => {
  it("keeps a well-formed set of three", () => {
    const { opportunities } = expectOk(
      validate([
        fakeWireOpportunity({ rank: 1, category: "monetization", primaryDimension: "monetization" }),
        fakeWireOpportunity({ rank: 2, category: "positioning", primaryDimension: "product" }),
        fakeWireOpportunity({ rank: 3, category: "analytics", primaryDimension: "retention" }),
      ]),
    );

    expect(opportunities).toHaveLength(3);
    expect(opportunities.map((entry) => entry.rank)).toEqual([1, 2, 3]);
  });

  it("caps the set at the maximum", () => {
    const categories = ["monetization", "positioning", "analytics", "seo", "onboarding", "trust"] as const;
    const dimensions = ["monetization", "product", "retention", "distribution", "conversion", "product"] as const;

    const { opportunities, notes } = expectOk(
      validate(
        categories.map((category, index) =>
          fakeWireOpportunity({
            rank: index + 1,
            category,
            primaryDimension: dimensions[index],
          }),
        ),
      ),
    );

    expect(opportunities).toHaveLength(MAX_OPPORTUNITIES);
    expect(notes.join(" ")).toContain("dropped");
  });

  it("renumbers ranks so they are unique and contiguous", () => {
    // The model returned gaps and a tie. Reassigning is safer than trusting:
    // after any discard the model's numbering is stale by construction.
    const { opportunities } = expectOk(
      validate([
        fakeWireOpportunity({ rank: 7, category: "monetization", primaryDimension: "monetization" }),
        fakeWireOpportunity({ rank: 7, category: "positioning", primaryDimension: "product" }),
        fakeWireOpportunity({ rank: 99, category: "seo", primaryDimension: "distribution" }),
      ]),
    );

    expect(opportunities.map((entry) => entry.rank)).toEqual([1, 2, 3]);
    expect(new Set(opportunities.map((entry) => entry.rank)).size).toBe(3);
  });

  it("preserves the model's ordering when renumbering", () => {
    const { opportunities } = expectOk(
      validate([
        fakeWireOpportunity({ rank: 3, title: "Third", category: "seo", primaryDimension: "distribution" }),
        fakeWireOpportunity({ rank: 1, title: "First", category: "monetization", primaryDimension: "monetization" }),
        fakeWireOpportunity({ rank: 2, title: "Second", category: "positioning", primaryDimension: "product" }),
      ]),
    );

    expect(opportunities.map((entry) => entry.title)).toEqual(["First", "Second", "Third"]);
  });
});

describe("evidence discipline (§14)", () => {
  it("drops a hallucinated evidence id and says so", () => {
    const { opportunities, notes } = expectOk(
      validate([
        fakeWireOpportunity({
          evidenceIds: ["business.monetization_model", "repo.completely.invented"],
        }),
      ]),
    );

    expect(opportunities[0].evidenceIds).toEqual(["business.monetization_model"]);
    expect(notes.join(" ")).toContain("did not exist");
  });

  it("discards an opportunity whose evidence was entirely invented", () => {
    // An opportunity with no verifiable support is an assertion, and this
    // product's whole claim is that it does not make those.
    const result = validate([
      fakeWireOpportunity({ evidenceIds: ["made.up.entirely", "also.invented"] }),
    ]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("all_opportunities_unsupported");
  });

  it("keeps the valid opportunities when only one is unsupported", () => {
    const { opportunities } = expectOk(
      validate([
        fakeWireOpportunity({ rank: 1, category: "monetization", primaryDimension: "monetization" }),
        fakeWireOpportunity({ rank: 2, category: "seo", primaryDimension: "distribution", evidenceIds: ["nope"] }),
      ]),
    );

    expect(opportunities).toHaveLength(1);
    expect(opportunities[0].rank).toBe(1);
  });
});

describe("duplicate protection (§17)", () => {
  it("merges two attempts at the same work, keeping the higher-ranked one", () => {
    const { opportunities, notes } = expectOk(
      validate([
        fakeWireOpportunity({ rank: 1, title: "Add pricing", category: "monetization", primaryDimension: "monetization" }),
        fakeWireOpportunity({ rank: 2, title: "Create a pricing page", category: "monetization", primaryDimension: "monetization" }),
        fakeWireOpportunity({ rank: 3, title: "Instrument retention", category: "analytics", primaryDimension: "retention" }),
      ]),
    );

    expect(opportunities.map((entry) => entry.title)).toEqual(["Add pricing", "Instrument retention"]);
    expect(notes.join(" ")).toContain("duplicate");
  });

  it("does not merge the same category applied to different dimensions", () => {
    const { opportunities } = expectOk(
      validate([
        fakeWireOpportunity({ rank: 1, category: "analytics", primaryDimension: "retention" }),
        fakeWireOpportunity({ rank: 2, category: "analytics", primaryDimension: "distribution" }),
      ]),
    );

    expect(opportunities).toHaveLength(2);
  });
});

describe("field validity (§38)", () => {
  it.each([
    ["impact", { impact: "enormous" }],
    ["effort", { effort: "2.5 hours" }],
    ["confidence", { confidence: "certain" }],
    ["category", { category: "growth-hacking" }],
    ["primary dimension", { primaryDimension: "virality" }],
    ["execution type", { executionType: "deploy_to_production" }],
    ["execution readiness", { executionReadiness: "automatic" }],
  ])("rejects an opportunity with an invalid %s", (_label, override) => {
    const result = validate([fakeWireOpportunity(override as never)]);
    expect(result.ok).toBe(false);
  });

  it("rejects an opportunity missing its narrative fields", () => {
    expect(validate([fakeWireOpportunity({ whyNow: "   " })]).ok).toBe(false);
    expect(validate([fakeWireOpportunity({ title: null })]).ok).toBe(false);
  });

  it("drops a secondary dimension that repeats the primary one", () => {
    const { opportunities } = expectOk(
      validate([fakeWireOpportunity({ primaryDimension: "monetization", secondaryDimensions: ["monetization", "conversion"] })]),
    );

    expect(opportunities[0].secondaryDimensions).toEqual(["conversion"]);
  });

  it("keeps dependencies as stated, capped", () => {
    const { opportunities } = expectOk(
      validate([fakeWireOpportunity({ dependencies: ["Choose a pricing model", "Opportunity 1", "a", "b", "c"] })]),
    );

    expect(opportunities[0].dependencies).toHaveLength(3);
    expect(opportunities[0].dependencies[0]).toBe("Choose a pricing model");
  });
});

describe("determinism", () => {
  it("produces identical output for identical input", () => {
    const entries = [
      fakeWireOpportunity({ rank: 1, category: "monetization", primaryDimension: "monetization" }),
      fakeWireOpportunity({ rank: 2, category: "positioning", primaryDimension: "product" }),
    ];

    expect(expectOk(validate(entries))).toEqual(expectOk(validate(entries)));
  });
});
