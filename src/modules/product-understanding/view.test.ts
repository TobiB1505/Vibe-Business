import { describe, expect, it } from "vitest";
import { assembleProfile } from "./assemble";
import { buildUnderstandingPack, understandingEvidenceIds } from "./evidence";
import { validateUnderstanding } from "./validate";
import { normalizeUnderstandingOutput } from "./wire-schema";
import { buildUnderstandingView, confidenceNote, toneFor } from "./view";
import type { ProductProfile } from "./schema";
import {
  FIXED_NOW,
  buildModelOutput,
  fakeLiveSnapshot,
  fakeRepositorySnapshot,
} from "./test-support";

function profileWith(options: { synthesized: boolean; liveProduct?: ReturnType<typeof fakeLiveSnapshot> | null }): ProductProfile {
  const sources = {
    repository: fakeRepositorySnapshot(),
    liveProduct: options.liveProduct === undefined ? fakeLiveSnapshot() : options.liveProduct,
    signedInProduct: null,
  };

  let synthesis = null;
  if (options.synthesized) {
    const known = understandingEvidenceIds(buildUnderstandingPack(sources));
    const normalized = normalizeUnderstandingOutput(buildModelOutput());
    if (!normalized.ok) throw new Error("fixture did not normalize");
    const validated = validateUnderstanding(normalized.data, known);
    if (!validated.ok) throw new Error("fixture did not validate");
    synthesis = validated.understanding;
  }

  return assembleProfile({
    ...sources,
    synthesis,
    corrections: {},
    provider: options.synthesized ? "fake" : null,
    model: options.synthesized ? "claude-haiku-4-5-20251001" : null,
    promptVersion: options.synthesized ? "product-understanding-prompt-v1" : null,
    generatedAt: FIXED_NOW,
  });
}

/**
 * Every string a person could *read*, with object keys excluded.
 *
 * The distinction matters: `synthesisNote` is a field name, not copy, and
 * asserting over `JSON.stringify` would fail on the schema rather than on
 * anything a user sees.
 */
function visibleText(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(visibleText);
  if (value !== null && typeof value === "object") {
    return Object.values(value).flatMap(visibleText);
  }
  return [];
}

describe("confidence never becomes a number", () => {
  it("collapses the two unknown states into one tone for a reader", () => {
    expect(toneFor("confirmed")).toBe("confirmed");
    expect(toneFor("likely")).toBe("likely");
    expect(toneFor("unclear")).toBe("unknown");
    expect(toneFor("not_found")).toBe("unknown");
  });

  it("writes a qualifier in words, with no percentage anywhere", () => {
    const notes = [
      confidenceNote("confirmed", ["live_product"]),
      confidenceNote("confirmed", ["repository"]),
      confidenceNote("likely", ["repository"]),
      confidenceNote("not_found", []),
      confidenceNote("confirmed", ["user_confirmed"]),
    ];

    expect(notes).toEqual([
      "Seen on your live product",
      "Found in your code",
      "Likely, based on several signals",
      "Vibe could not establish this",
      "You confirmed this",
    ]);
    for (const note of notes) expect(note).not.toMatch(/\d/);
  });
});

describe("the final screen", () => {
  const view = buildUnderstandingView(profileWith({ synthesized: true }), true);

  it("leads with a claim about understanding, not about analysis", () => {
    expect(view.headline.title).toBe("I understand what you built.");
    expect(view.headline.understanding).toContain("You've built");
    expect(view.headline.synthesisNote).toBeNull();
  });

  it("names the product", () => {
    expect(view.headline.productName).toBe("Acme");
    expect(view.headline.category).toBe("SaaS application");
  });

  it("builds Product DNA only from attributed profile fields", () => {
    expect(view.dna.map((fact) => fact.label)).toEqual([
      "What it does",
      "Who it's for",
      "Main promise",
      "Problem solved",
    ]);
    expect(view.dna.find((fact) => fact.id === "purpose")?.value).toBe(
      "Keep a team's schedule in one place.",
    );
    expect(view.dna.find((fact) => fact.id === "audience")?.note).toBe(
      "Likely, based on several signals",
    );
  });

  it("says what people can do, not what components exist", () => {
    const labels = view.capabilities.map((capability) => capability.label);

    expect(labels).toContain("Sign in");
    expect(labels).toContain("Use a signed-in workspace");
    for (const label of labels) {
      expect(label).not.toMatch(/route|component|endpoint|snapshot|detector/i);
    }
  });

  it("never states a count of files, routes or detections", () => {
    const rendered = visibleText(view).join(" ");
    expect(rendered).not.toMatch(/\d+\s+(files?|routes?|detections?|surfaces? found)/i);
  });

  it("uses product words for its sources, never module names", () => {
    expect(view.sources.map((source) => source.label)).toEqual([
      "Your code",
      "Your public product",
      "Your signed-in product has not been checked yet",
    ]);

    const rendered = visibleText(view).join(" ").toLowerCase();
    for (const internal of [
      "repository intelligence",
      "live product intelligence",
      "deep scan v2",
      "synthesis",
      "evidence pack",
      "snapshot",
      "analyzer",
    ]) {
      expect(rendered, `internal vocabulary leaked: ${internal}`).not.toContain(internal);
    }
  });
});

describe("absence is never a deficiency", () => {
  const view = buildUnderstandingView(profileWith({ synthesized: true }), true);

  it("says Vibe did not find a stage, rather than that the product lacks it", () => {
    const checkout = view.journey.find((stage) => stage.id === "checkout");
    expect(checkout?.detail).toBe("Vibe didn't find this.");
  });

  it("distinguishes a stage in code from one seen live", () => {
    const pricing = view.journey.find((stage) => stage.id === "pricing");
    expect(pricing?.detail).toBe("Your code has this, but Vibe hasn't seen it live.");
  });

  it("never uses judgement words about the business", () => {
    const rendered = visibleText(view).join(" ").toLowerCase();
    for (const verdict of ["weak", "poor", "bad ", "you should", "you need to", "failing"]) {
      expect(rendered, `a verdict leaked: ${verdict}`).not.toContain(verdict);
    }
  });

  it("does not claim revenue from a payments dependency", () => {
    const payment = view.businessSignals.find((signal) => signal.id === "payment_capability");
    expect(payment?.statement).toBe("Payment functionality appears to be present.");
  });
});

describe("brand", () => {
  it("reveals a real logo when one can actually be rendered", () => {
    const view = buildUnderstandingView(profileWith({ synthesized: true }), true);

    expect(view.brand.logo).toEqual({
      url: "https://acme.test/logo.svg",
      alt: "Acme logo",
    });
    expect(view.brand.logoNote).toBeNull();
  });

  it("says so plainly rather than showing a wrong asset", () => {
    // No live product means no origin to serve the repository's logo from —
    // and Vibe will not guess one (CORE-1 §29).
    const view = buildUnderstandingView(profileWith({ synthesized: false, liveProduct: null }), false);

    expect(view.brand.logo).toBeNull();
    expect(view.brand.logoNote).toBe(
      "Vibe found a logo in your project but can't show it from here yet.",
    );
  });
});

describe("a profile with no model behind it", () => {
  const view = buildUnderstandingView(profileWith({ synthesized: false }), false);

  it("changes its headline rather than claiming an understanding it does not have", () => {
    expect(view.headline.title).toBe("Here's what Vibe found.");
    expect(view.headline.understanding).toBeNull();
  });

  it("explains what did not run, in the user's language", () => {
    expect(view.headline.synthesisNote).toContain("didn't run this time");
    expect(view.headline.synthesisNote).not.toMatch(/model|provider|inference|token/i);
  });

  it("still shows everything the rules established", () => {
    expect(view.capabilities.length).toBeGreaterThan(0);
    expect(view.journey).toHaveLength(8);
    expect(view.brand.colors.length).toBeGreaterThan(0);
    expect(view.technical.length).toBeGreaterThan(0);
  });
});
