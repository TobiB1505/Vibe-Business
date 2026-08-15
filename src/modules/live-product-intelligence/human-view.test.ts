import { describe, expect, it } from "vitest";
import { buildLiveProductHumanView } from "./human-view";
import type { LiveProductIntelligenceSnapshot } from "./schema";

/**
 * The human-facing live product check (Sprint UI-3.5).
 *
 * Two properties, and the second is the one that matters most:
 *
 * 1. **It is a translation, not a generator.** Every sentence is derived from
 *    the snapshot. Given no gaps it says so; given gaps it names them.
 * 2. **It never softens.** "Human-friendly" is the failure mode this product
 *    is built against if it slips into "reassuring". A missing pricing path is
 *    reported as missing, and the headline counts the problems rather than
 *    congratulating anyone.
 */

function snapshot(overrides: Partial<LiveProductIntelligenceSnapshot> = {}) {
  return {
    schemaVersion: "live-product-intelligence.v1",
    source: { effectiveOrigin: "https://example.com", redirected: false },
    crawl: { pagesInspected: 3 },
    siteMetadata: { title: "Example", description: "A product", language: "en" },
    pages: [{ path: "/" }, { path: "/login" }],
    productSurfaces: [
      { id: "homepage", name: "Homepage", detected: true, confidence: "high", evidence: [] },
      { id: "login", name: "Login", detected: true, confidence: "high", evidence: [] },
      { id: "pricing", name: "Pricing", detected: false, confidence: "none", evidence: [] },
    ],
    seoSignals: [
      { id: "title", name: "Title", present: true, evidence: [] },
      { id: "canonical", name: "Canonical", present: false, evidence: [] },
    ],
    conversionSignals: {
      primaryCta: { label: "Get started", category: "get_started", path: "/" },
      ctas: [],
      signupCtaPresent: true,
      pricingCtaPresent: false,
      contactCtaPresent: false,
      formCount: 1,
      forms: [],
    },
    metrics: { requestCount: 3, bytesFetched: 27_000, durationMs: 1081 },
    completeness: { status: "complete", reasons: [] },
    warnings: [],
    ...overrides,
  } as unknown as LiveProductIntelligenceSnapshot;
}

describe("the answer comes first", () => {
  it("opens with a conclusion, not a category name", () => {
    const view = buildLiveProductHumanView(snapshot());

    expect(view.headline).toMatch(/^Your product is online/);
    // The scanner's own vocabulary must not lead.
    for (const jargon of ["surface", "canonical", "SEO", "signal", "crawl"]) {
      expect(view.headline.toLowerCase()).not.toContain(jargon.toLowerCase());
    }
  });

  it("says what each finding means for the business", () => {
    const view = buildLiveProductHumanView(snapshot());
    const conversion = view.findings.find((finding) => finding.id === "becoming-a-customer");

    expect(conversion?.whyItMatters).toBeTruthy();
    expect(conversion?.whyItMatters).toContain("pay");
  });

  it("names the specific gap this audience most often has", () => {
    // Signed up but no way to pay. The most common shape of this product's
    // customer's problem, so it is stated rather than left to be inferred.
    const view = buildLiveProductHumanView(snapshot());
    const conversion = view.findings.find((finding) => finding.id === "becoming-a-customer");

    expect(conversion?.title).toContain("path to paying is unclear");
    expect(conversion?.tone).toBe("attention");
  });
});

describe("it never flatters", () => {
  it("counts problems in the headline instead of congratulating", () => {
    const view = buildLiveProductHumanView(snapshot());

    expect(view.headline).toMatch(/needs? attention/);
    for (const forbidden of ["great", "awesome", "perfect", "all good", "looking good"]) {
      expect(view.headline.toLowerCase()).not.toContain(forbidden);
    }
  });

  it("only says the basics are in place when nothing needs attention", () => {
    const clean = buildLiveProductHumanView(
      snapshot({
        seoSignals: [{ id: "title", name: "Title", present: true, evidence: [] }],
        conversionSignals: {
          primaryCta: { label: "Buy", category: "purchase", path: "/" },
          ctas: [],
          signupCtaPresent: true,
          pricingCtaPresent: true,
          contactCtaPresent: true,
          formCount: 1,
          forms: [],
        },
      } as unknown as Partial<LiveProductIntelligenceSnapshot>),
    );

    expect(clean.headline).toContain("basics are in place");
    expect(clean.tone).toBe("good");
  });

  it("says plainly when it could not read the product at all", () => {
    const blind = buildLiveProductHumanView(
      snapshot({
        productSurfaces: [
          { id: "homepage", name: "Homepage", detected: false, confidence: "none", evidence: [] },
        ],
      } as unknown as Partial<LiveProductIntelligenceSnapshot>),
    );

    expect(blind.headline).toContain("could not read");
    expect(blind.tone).toBe("attention");
  });

  it("surfaces an unfinished check rather than presenting partial results as whole", () => {
    const partial = buildLiveProductHumanView(
      snapshot({
        completeness: { status: "partial", reasons: ["page_budget_reached"] },
      } as unknown as Partial<LiveProductIntelligenceSnapshot>),
    );

    expect(partial.incompleteReason).toContain("did not finish");
    expect(partial.incompleteReason).toContain("page_budget_reached");
  });
});

describe("nothing technical is lost", () => {
  it("carries every raw signal id and its value into the technical layer", () => {
    const view = buildLiveProductHumanView(snapshot());
    const keys = view.technical.map((entry) => entry.key);

    // The scanner's own identifiers, namespaced so a signal id cannot be
    // mistaken for a metadata value of the same name.
    expect(keys).toContain("signal.canonical");
    expect(keys).toContain("signal.title");
    expect(keys).toContain("title");
    expect(keys).toContain("surface.pricing");
    expect(keys).toContain("requests");
    expect(keys).toContain("durationMs");
    expect(keys).toContain("bytesFetched");
  });

  it("preserves exact values rather than rounding them for display", () => {
    const view = buildLiveProductHumanView(snapshot());
    const byKey = new Map(view.technical.map((entry) => [entry.key, entry.value]));

    expect(byKey.get("durationMs")).toBe(1081);
    expect(byKey.get("bytesFetched")).toBe(27_000);
    expect(byKey.get("signal.canonical")).toBe(false);
  });

  it("gives every technical entry a unique key", () => {
    // Duplicates would collide in the rendered list and silently show one
    // value where the reader expected another.
    const view = buildLiveProductHumanView(snapshot());
    const keys = view.technical.map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keeps a null as a null rather than an em dash", () => {
    const view = buildLiveProductHumanView(
      snapshot({
        siteMetadata: { title: null, description: null, language: null },
      } as unknown as Partial<LiveProductIntelligenceSnapshot>),
    );
    const byKey = new Map(view.technical.map((entry) => [entry.key, entry.value]));

    expect(byKey.get("title")).toBeNull();
  });
});

describe("the middle layer is readable but concrete", () => {
  it("names pages the way a person would, not by their ids", () => {
    const view = buildLiveProductHumanView(snapshot());
    const surfaces = view.findings.find((finding) => finding.id === "what-exists");

    expect(surfaces?.found).toContain("Homepage");
    expect(surfaces?.found).toContain("Sign-in page");
    expect(surfaces?.missing).toContain("Pricing page");
    expect(surfaces?.found.join(" ")).not.toContain("dashboard_app");
  });

  it("explains search signals by their consequence, not their mechanism", () => {
    const view = buildLiveProductHumanView(snapshot());
    const search = view.findings.find((finding) => finding.id === "being-found");

    expect(search?.missing).toContain("Which version of a page is the real one");
    expect(search?.missing.join(" ")).not.toContain("canonical");
  });
});

describe("it is deterministic", () => {
  it("produces identical output for identical input", () => {
    const a = buildLiveProductHumanView(snapshot());
    const b = buildLiveProductHumanView(snapshot());
    expect(a).toEqual(b);
  });
});
