import { describe, expect, it } from "vitest";
import {
  MONETIZATION_MODELS,
  PRIMARY_GOALS,
  PROJECT_STAGES,
  type FounderIntent,
} from "@/modules/projects/founder-intent";
import {
  checkCustomerLanguage,
  customerFacingStrings,
  describeFounderIntent,
  findInternalVocabulary,
  INTERNAL_VOCABULARY,
} from "./customer-language";
import { AUDIT_SYNTHESIS_VERSION, type AuditSynthesis, type BusinessConclusion } from "./schema";
import { validateAuditOutput } from "./validate";
import { buildModelOutput } from "./test-support";
import { normalizeAnthropicAuditOutput } from "./wire-schema";

/**
 * The customer-language boundary (CORE-2a.2).
 *
 * The leak this file exists to prevent was real, not hypothetical. The first
 * synthesis dogfood wrote "You've told Vibe there is no monetization model yet"
 * into a customer-facing explanation, because the evidence pack had handed it
 * "Founder states the intended monetization model is: No monetization".
 */

describe("founder intent reaches the model as sentences, not taxonomy", () => {
  const full: FounderIntent = {
    stage: "prototype",
    monetizationModel: "none",
    primaryGoal: "monetize",
  };

  it("never emits the vocabulary the leak was made of", () => {
    const text = describeFounderIntent(full)
      .map((entry) => entry.text)
      .join(" ");

    expect(text.toLowerCase()).not.toContain("monetization");
    expect(text.toLowerCase()).not.toContain("primary goal");
    expect(text.toLowerCase()).not.toContain("stage:");
  });

  it("says what the value means rather than naming it", () => {
    const byId = new Map(describeFounderIntent(full).map((e) => [e.id, e.text]));

    expect(byId.get("intent.how_it_earns")).toBe(
      "They have not decided how the product will make money.",
    );
    expect(byId.get("intent.stage")).toContain("early prototype");
  });

  /**
   * Exhaustive by construction: a new enum value that nobody wrote a sentence
   * for would produce `undefined` here, and the model would be told the founder
   * said "undefined".
   */
  it("has a sentence for every value of every enum", () => {
    for (const stage of PROJECT_STAGES) {
      const [entry] = describeFounderIntent({ stage, monetizationModel: null, primaryGoal: null });
      expect(entry?.text).toBeTypeOf("string");
      expect(entry?.text).not.toContain("undefined");
    }
    for (const monetizationModel of MONETIZATION_MODELS) {
      const [entry] = describeFounderIntent({ stage: null, monetizationModel, primaryGoal: null });
      expect(entry?.text).toBeTypeOf("string");
      expect(entry?.text).not.toContain("undefined");
    }
    for (const primaryGoal of PRIMARY_GOALS) {
      const [entry] = describeFounderIntent({ stage: null, monetizationModel: null, primaryGoal });
      expect(entry?.text).toBeTypeOf("string");
      expect(entry?.text).not.toContain("undefined");
    }
  });

  it("says nothing about a field the founder left blank", () => {
    expect(describeFounderIntent({ stage: null, monetizationModel: null, primaryGoal: null })).toEqual(
      [],
    );
  });

  /** No sentence may itself trip the output safety net. */
  it("produces language that passes its own check", () => {
    for (const stage of PROJECT_STAGES) {
      for (const monetizationModel of MONETIZATION_MODELS) {
        for (const primaryGoal of PRIMARY_GOALS) {
          const text = describeFounderIntent({ stage, monetizationModel, primaryGoal })
            .map((entry) => entry.text)
            .join(" ");
          expect(findInternalVocabulary(text)).toEqual([]);
        }
      }
    }
  });
});

describe("findInternalVocabulary", () => {
  it("is case-insensitive", () => {
    expect(findInternalVocabulary("No Monetization Model was found")).toEqual([
      "monetization model",
    ]);
  });

  it("finds the phrase that actually leaked", () => {
    expect(
      findInternalVocabulary("You've told Vibe there is no monetization model yet"),
    ).toContain("monetization model");
  });

  it("leaves ordinary business English alone", () => {
    const founderly =
      "People still don't have a clear way to pay you. There are no prices anywhere, " +
      "and nothing to buy, so visitors who sign up can't become customers or bring in revenue.";

    expect(findInternalVocabulary(founderly)).toEqual([]);
  });

  it("stays small enough to be maintainable", () => {
    // A 200-word blacklist is brittle and catches innocent prose. If this
    // grows past a couple of dozen, the input boundary is the thing to fix.
    expect(INTERNAL_VOCABULARY.length).toBeLessThanOrEqual(30);
  });
});

// ---------------------------------------------------------------------

function conclusion(overrides: Partial<BusinessConclusion> = {}): BusinessConclusion {
  return {
    rootProblem: "The business has not decided how value becomes revenue.",
    headline: "People still don't have a clear way to pay you.",
    explanation: "Vibe couldn't find prices or anything to buy.",
    whyItMatters: null,
    evidenceIds: ["live.surface.pricing"],
    dimensions: ["monetization"],
    lenses: ["revenue_economics"],
    tone: "critical",
    confidence: "high",
    ...overrides,
  };
}

function synthesis(overrides: Partial<AuditSynthesis> = {}): AuditSynthesis {
  return {
    version: AUDIT_SYNTHESIS_VERSION,
    lenses: [],
    overall: "You have a real product, but nobody can pay for it.",
    strengths: [],
    blockers: [conclusion()],
    ...overrides,
  };
}

describe("the boundary covers customer-facing fields only", () => {
  it("checks the overall conclusion, headlines, explanations and why-it-matters", () => {
    const strings = customerFacingStrings(
      synthesis({
        blockers: [
          conclusion({
            headline: "H",
            explanation: "E",
            whyItMatters: "W",
          }),
        ],
      }),
    );

    expect(strings).toContain("H");
    expect(strings).toContain("E");
    expect(strings).toContain("W");
    expect(strings).toContain("You have a real product, but nobody can pay for it.");
  });

  it.each([
    ["the overall conclusion", { overall: "There is no pricing surface here." }],
    ["a headline", { blockers: [conclusion({ headline: "No pricing surface exists." })] }],
    [
      "an explanation",
      { blockers: [conclusion({ explanation: "The checkout surface is absent." })] },
    ],
    [
      "why it matters",
      { blockers: [conclusion({ whyItMatters: "The evidence pack says otherwise." })] },
    ],
    [
      "a strength",
      {
        strengths: [conclusion({ tone: "positive", headline: "A product surface was detected." })],
      },
    ],
  ])("rejects meaning-destroying vocabulary in %s", (_label, override) => {
    expect(checkCustomerLanguage(synthesis(override)).ok).toBe(false);
  });

  /**
   * The recalibration. Three real refreshes were discarded over exactly this
   * phrase while the reasoning underneath was good — and `monetization` is a
   * required dimension key the model must emit five times per run, so
   * forbidding its natural collocation was a rule fighting the schema.
   */
  it.each([
    ["monetization model", "You have no monetization model yet."],
    ["conversion path", "Your conversion path is incomplete."],
    ["retention capability", "Retention capability was detected."],
  ])("records but does not reject startup-speak: %s", (term, text) => {
    const check = checkCustomerLanguage(synthesis({ overall: text }));

    expect(check.ok).toBe(true);
    expect(check.discouraged).toContain(term);
  });

  it("reports which terms leaked, so the failure is diagnosable", () => {
    const check = checkCustomerLanguage(
      synthesis({ overall: "No monetization model, and no pricing surface." }),
    );

    // Blocking rejects; discouraged is reported alongside rather than lost.
    expect(check.ok).toBe(false);
    expect(check.blocking).toEqual(["pricing surface"]);
    expect(check.discouraged).toEqual(["monetization model"]);
  });

  it("passes prose written in the founder's language", () => {
    expect(checkCustomerLanguage(synthesis()).ok).toBe(true);
  });
});

/**
 * The counter-test (§8, §16). We want simple default language *and* precise
 * technical detail — not technical information destroyed.
 */
describe("raw evidence and technical detail are not censored", () => {
  const KNOWN = new Set([
    "live.site.title",
    "profile.signal.pricing_surface",
    "live.seo.canonical_missing",
  ]);

  function run(overrides: Record<string, unknown>) {
    const normalized = normalizeAnthropicAuditOutput(buildModelOutput(overrides.dimensions ?? {}, overrides.extras ?? {}));
    if (!normalized.ok) throw new Error("fixture failed normalization");
    return validateAuditOutput(normalized.data, KNOWN);
  }

  it("accepts an audit whose DIMENSION findings use precise technical terms", () => {
    const result = run({
      dimensions: {
        distribution: {
          assessmentStatus: "assessable",
          score: 40,
          strengths: [],
          gaps: ["Canonical URL and structured data are absent"],
          unknowns: [],
          evidenceIds: ["live.seo.canonical_missing"],
        },
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const distribution = result.audit.dimensions.find((d) => d.id === "distribution");
    // The precision survives exactly as written — this is the technical record.
    expect(distribution?.gaps).toEqual(["Canonical URL and structured data are absent"]);
  });

  it("does not reject an audit because an evidence id looks like jargon", () => {
    // `profile.signal.pricing_surface` is a real id and is cited constantly.
    const result = run({
      extras: {
        conclusions: [
          {
            headline: "People can't tell what it costs.",
            explanation: "Vibe couldn't find prices anywhere.",
            whyItMatters: "",
            tone: "critical",
            confidence: "high",
            dimensions: ["monetization"],
            evidenceIds: ["profile.signal.pricing_surface"],
          },
        ],
      },
    });

    expect(result.ok).toBe(true);
  });

  it("rejects the same jargon when it appears in the customer-facing copy", () => {
    const result = run({
      extras: {
        conclusions: [
          {
            headline: "No pricing surface was detected.",
            explanation: "Vibe couldn't find prices anywhere.",
            whyItMatters: "",
            tone: "critical",
            confidence: "high",
            dimensions: ["monetization"],
            evidenceIds: ["profile.signal.pricing_surface"],
          },
        ],
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("customer_language_violation");
    expect(result.terms).toEqual(["pricing surface"]);
  });
});

/**
 * The language contract at production cardinality (CORE-2a.2 §14, §15).
 *
 * The earlier cases in this file use one or two conclusions, which is enough to
 * test the rule and not enough to test it against the shape a real audit has.
 * This fixture mirrors the real Vibe Business synthesis: three strengths, three
 * blockers, multi-evidence conclusions spanning several dimensions, and prose
 * of realistic length.
 *
 * The reason to bother is the lesson from CORE-2a.1's dogfood — a fixture
 * easier than production tests the code against a world that does not exist.
 */
describe("the contract holds at real audit cardinality", () => {
  const REAL_SHAPED: AuditSynthesis = {
    version: AUDIT_SYNTHESIS_VERSION,
    lenses: [],
    overall:
      "Vibe Business is a working early-stage prototype with a clear message and a real " +
      "signed-in area people can log into and use, but right now there is no way for anyone " +
      "to actually pay for it.",
    strengths: [
      conclusion({
        tone: "positive",
        headline: "People can understand what your product is for and sign into a real app.",
        explanation:
          "Your homepage leads with a clear message and a single Create account action, and " +
          "Vibe reached a dashboard and a project workspace behind the login.",
        whyItMatters: null,
        evidenceIds: ["a", "b", "c", "d", "e", "f", "g"],
        dimensions: ["product", "conversion", "retention"],
      }),
      conclusion({
        tone: "positive",
        headline: "Customers already have something to come back to.",
        explanation: "There is a signed-in workspace, not just a landing page.",
        whyItMatters: null,
        evidenceIds: ["h", "i"],
        dimensions: ["retention"],
      }),
      conclusion({
        tone: "positive",
        headline: "The basics that help search engines find your site are in place.",
        explanation: "Your site has a title, a description and a sitemap.",
        whyItMatters: null,
        evidenceIds: ["j", "k", "l"],
        dimensions: ["distribution"],
      }),
    ],
    blockers: [
      conclusion({
        tone: "critical",
        headline: "You don't yet have a clear way to charge people for this.",
        explanation:
          "Vibe couldn't find a price, a way to buy, or any billing setup anywhere on your " +
          "site, in your code, or inside the signed-in product, and you've told Vibe you " +
          "haven't decided how this will make money yet.",
        whyItMatters:
          "Without a visible price or way to pay, even an interested visitor has no path to " +
          "becoming a paying customer.",
        evidenceIds: ["m", "n", "o", "p", "q", "r", "s", "t"],
        dimensions: ["monetization", "conversion"],
      }),
      conclusion({
        tone: "attention",
        headline: "Not much is helping new people discover you beyond the homepage.",
        explanation: "There's no blog or docs, and no stated way you're bringing people in.",
        whyItMatters: "Growth is likely to depend entirely on traffic you drive yourself.",
        evidenceIds: ["u", "v", "w"],
        dimensions: ["distribution"],
      }),
      conclusion({
        tone: "attention",
        headline: "You can't see what visitors or signed-in users are actually doing.",
        explanation: "Nothing measuring usage was found in your code or in the signed-in app.",
        whyItMatters: "It will be hard to know whether the changes you make actually help.",
        evidenceIds: ["x", "y", "z"],
        dimensions: ["retention", "conversion"],
      }),
    ],
  };

  it("passes on prose written the way the real audit writes it", () => {
    expect(checkCustomerLanguage(REAL_SHAPED).ok).toBe(true);
  });

  /**
   * One word, in one of eighteen customer-facing strings, in the middle of a
   * realistic audit. This is the case the E2E jargon assertion could not catch,
   * because it ran against rendered fixture markup rather than the boundary.
   */
  it.each([
    ["the overall conclusion", (s: AuditSynthesis) => ({ ...s, overall: `${s.overall} No pricing surface exists.` })],
    [
      "a strength buried in the middle",
      (s: AuditSynthesis) => ({
        ...s,
        strengths: s.strengths.map((c, i) =>
          i === 1 ? { ...c, explanation: `${c.explanation} The evidence pack says so.` } : c,
        ),
      }),
    ],
    [
      "the last blocker's why-it-matters",
      (s: AuditSynthesis) => ({
        ...s,
        blockers: s.blockers.map((c, i) =>
          i === 2 ? { ...c, whyItMatters: "The checkout surface is absent." } : c,
        ),
      }),
    ],
  ])("catches meaning-destroying vocabulary in %s", (_label, mutate) => {
    expect(checkCustomerLanguage(mutate(REAL_SHAPED)).ok).toBe(false);
  });

  /** Eighteen strings, and every one of them is checked. */
  it("checks every customer-facing string, not just the first of each kind", () => {
    const strings = customerFacingStrings(REAL_SHAPED);

    // 1 overall + 3 strengths (headline + explanation, no whyItMatters)
    // + 3 blockers (headline + explanation + whyItMatters)
    expect(strings).toHaveLength(1 + 3 * 2 + 3 * 3);
  });
});

/**
 * The diagnostic carries the terms (added after the first real rejection).
 *
 * A $0.146 failure that says only "the language net fired" is a failure you
 * cannot act on. CORE-2a.2 established these terms are safe to persist — our
 * own closed vocabulary, never model prose — and then did not persist them.
 */
describe("a language rejection says which words leaked", () => {
  it("reports the terms through the runner's diagnostic", async () => {
    const { runBusinessReadinessAudit } = await import("./runner");
    const { BUSINESS_READINESS_AUDIT_CONFIG } = await import("@/modules/ai/operations");
    const { FakeProvider, fakeFounderIntent, fakeLiveSnapshot, fakeRepositorySnapshot, buildModelOutput } =
      await import("./test-support");
    const { fakeProductProfile } = await import("@/modules/product-understanding/test-support");

    const provider = new FakeProvider({
      result: {
        ok: true,
        data: buildModelOutput(
          {},
          {
            overallConclusion: "There is no pricing surface and no checkout surface.",
          },
        ),
        usage: { inputTokens: 100, outputTokens: 100, thinkingTokens: 0 },
        model: "claude-sonnet-5",
        latencyMs: 10,
      },
    });

    const outcome = await runBusinessReadinessAudit({
      provider,
      config: BUSINESS_READINESS_AUDIT_CONFIG,
      productProfile: fakeProductProfile(),
      founderIntent: fakeFounderIntent(),
      repository: fakeRepositorySnapshot(),
      liveProduct: fakeLiveSnapshot(),
      authenticatedProduct: null,
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;

    expect(outcome.diagnostic?.validationReason).toBe("customer_language_violation");
    expect(outcome.diagnostic?.languageTerms).toEqual(["checkout surface", "pricing surface"]);
  });

  it("still reports the usage, because those tokens were billed", async () => {
    // The rejection happens after generation. The money is spent either way and
    // the ledger has to say so.
    const { runBusinessReadinessAudit } = await import("./runner");
    const { BUSINESS_READINESS_AUDIT_CONFIG } = await import("@/modules/ai/operations");
    const { FakeProvider, fakeFounderIntent, fakeLiveSnapshot, fakeRepositorySnapshot, buildModelOutput } =
      await import("./test-support");
    const { fakeProductProfile } = await import("@/modules/product-understanding/test-support");

    const provider = new FakeProvider({
      result: {
        ok: true,
        data: buildModelOutput({}, { overallConclusion: "No pricing surface exists." }),
        usage: { inputTokens: 4_000, outputTokens: 9_000, thinkingTokens: 3_000 },
        model: "claude-sonnet-5",
        latencyMs: 90_000,
      },
    });

    const outcome = await runBusinessReadinessAudit({
      provider,
      config: BUSINESS_READINESS_AUDIT_CONFIG,
      productProfile: fakeProductProfile(),
      founderIntent: fakeFounderIntent(),
      repository: fakeRepositorySnapshot(),
      liveProduct: fakeLiveSnapshot(),
      authenticatedProduct: null,
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.usage).toEqual({ inputTokens: 4_000, outputTokens: 9_000, thinkingTokens: 3_000 });
  });
});

/**
 * Where "monetization model" actually came from (CORE-2a.3.2 §25, §54).
 *
 * It leaked twice after CORE-2a.2 supposedly fixed it, and the fix each time
 * was suspected to be the founder-intent serialization. It was not. The phrase
 * is *legitimate* in a dimension assessment — that layer is the technical
 * record and is explicitly exempt — and the v4 audit wrote it there, in the
 * Monetization gaps, and then paraphrased its own gaps into the customer-facing
 * explanation.
 *
 * So the leak was never a vocabulary problem. It was a generation-order
 * problem, and the fix is in `wire-schema.ts`: conclusions are written before
 * the dimensions exist. These tests pin the two halves of that reasoning so the
 * next sighting is not misdiagnosed a third time.
 */
describe("the jargon leak path, not just the jargon (§25, §54)", () => {
  it("still permits the phrase in a dimension finding, which is why it existed to be copied", () => {
    // The real v4 Monetization gap, verbatim. This is correct output for the
    // technical layer and must not start failing.
    const gap = "Founder states the monetization model is undecided";
    expect(findInternalVocabulary(gap)).toEqual(["monetization model"]);

    // …and the language check never sees it, because it reads the synthesis only.
    const clean = checkCustomerLanguage({
      version: AUDIT_SYNTHESIS_VERSION,
      lenses: [],
      overall: "You haven't decided how this will make money yet.",
      strengths: [],
      blockers: [],
    });
    expect(clean.ok).toBe(true);
    expect(clean.discouraged).toEqual([]);
  });

  it("catches it in a customer-facing field, where copying it up lands", () => {
    const leaked = checkCustomerLanguage({
      version: AUDIT_SYNTHESIS_VERSION,
      lenses: [],
      overall: "There is no monetization model yet.",
      strengths: [],
      blockers: [],
    });

    expect(leaked.discouraged).toEqual(["monetization model"]);
    // Still not a rejection: the founder understands the sentence.
    expect(leaked.ok).toBe(true);
  });

  /** The structural half. Order is the fix; the blocklist is only the alarm. */
  it("generates the conclusions before the dimensions that carry the phrase", async () => {
    const { ANTHROPIC_AUDIT_OUTPUT_SCHEMA } = await import("./wire-schema");
    const keys = Object.keys(ANTHROPIC_AUDIT_OUTPUT_SCHEMA.properties as Record<string, unknown>);

    expect(keys.indexOf("conclusions")).toBeLessThan(keys.indexOf("dimensions"));
  });
});
