import { describe, expect, it } from "vitest";
import { applyCorrections, assembleProfile, preferBySource, rankCapabilities } from "./assemble";
import { normalizeUnderstandingOutput } from "./wire-schema";
import { validateUnderstanding } from "./validate";
import { buildUnderstandingPack, understandingEvidenceIds } from "./evidence";
import type { Attributed, ProductProfile } from "./schema";
import {
  FIXED_NOW,
  buildModelOutput,
  fakeLiveSnapshot,
  fakeRepositorySnapshot,
} from "./test-support";

function synthesis(overrides: Parameters<typeof buildModelOutput>[0] = {}) {
  const sources = {
    repository: fakeRepositorySnapshot(),
    liveProduct: fakeLiveSnapshot(),
    signedInProduct: null,
  };
  const known = understandingEvidenceIds(buildUnderstandingPack(sources));
  const normalized = normalizeUnderstandingOutput(buildModelOutput(overrides));
  if (!normalized.ok) throw new Error("fixture did not normalize");
  const validated = validateUnderstanding(normalized.data, known);
  if (!validated.ok) throw new Error("fixture did not validate");
  return validated.understanding;
}

function profile(
  options: {
    corrections?: ProductProfile extends never ? never : Parameters<typeof assembleProfile>[0]["corrections"];
    withSynthesis?: boolean;
    liveProduct?: ReturnType<typeof fakeLiveSnapshot> | null;
  } = {},
): ProductProfile {
  return assembleProfile({
    repository: fakeRepositorySnapshot(),
    liveProduct: options.liveProduct === undefined ? fakeLiveSnapshot() : options.liveProduct,
    signedInProduct: null,
    synthesis: options.withSynthesis === false ? null : synthesis(),
    corrections: options.corrections ?? {},
    provider: "fake",
    model: "claude-haiku-4-5-20251001",
    promptVersion: "product-understanding-prompt-v1",
    generatedAt: FIXED_NOW,
  });
}

describe("source priority", () => {
  const at = (value: string | null, sources: Attributed<string>["sources"]): Attributed<string> => ({
    value,
    confidence: "likely",
    sources,
    evidence: [],
  });

  it("puts a person's own words above every derived source", () => {
    const chosen = preferBySource([
      at("Freelancers", ["ai_inferred"]),
      at("Restaurant owners", ["user_confirmed"]),
      at("Small teams", ["live_product"]),
    ]);

    expect(chosen.value).toBe("Restaurant owners");
  });

  it("puts a direct observation above a model's reading", () => {
    const chosen = preferBySource([
      at("Acme Inc.", ["ai_inferred"]),
      at("Acme", ["live_product"]),
    ]);

    expect(chosen.value).toBe("Acme");
  });

  it("never lets an empty higher-priority candidate win", () => {
    const chosen = preferBySource([at(null, ["user_confirmed"]), at("Acme", ["ai_inferred"])]);
    expect(chosen.value).toBe("Acme");
  });

  it("reports the most informative absence when nothing has a value", () => {
    const chosen = preferBySource<string>([
      { value: null, confidence: "not_found", sources: [], evidence: [] },
      { value: null, confidence: "unclear", sources: ["ai_inferred"], evidence: [] },
    ]);

    expect(chosen.confidence).toBe("unclear");
  });
});

describe("the name", () => {
  it("takes a name the site declares over one a model guessed", () => {
    // The fixture's model output says "Acme"; so does og:site_name. What
    // matters is that the *source* recorded is the site, not the model.
    expect(profile().identity.name).toMatchObject({
      value: "Acme",
      confidence: "confirmed",
      sources: ["live_product"],
    });
  });

  it("does not let a repository name become the product name on its own", () => {
    const derived = assembleProfile({
      repository: fakeRepositorySnapshot(),
      liveProduct: null,
      signedInProduct: null,
      synthesis: null,
      corrections: {},
      provider: null,
      model: null,
      promptVersion: null,
      generatedAt: FIXED_NOW,
    });

    // "shifts" is what the code is called. It is offered, but only as a likely
    // claim, so a model or the user can override it without a fight.
    expect(derived.identity.name).toMatchObject({ value: "shifts", confidence: "likely" });
  });
});

describe("capabilities", () => {
  it("lets the model reorder, but never add", () => {
    const derived = [
      { id: "sign_in" as const, label: "Sign in", confidence: "confirmed" as const, sources: [], evidence: ["a"] },
      { id: "purchase" as const, label: "Buy", confidence: "likely" as const, sources: [], evidence: ["b"] },
    ];

    const ranked = rankCapabilities(derived, [
      { id: "purchase", evidence: ["c"] },
      // Never found deterministically: the model cannot conjure it.
      { id: "book_appointment", evidence: ["d"] },
    ]);

    expect(ranked.map((capability) => capability.id)).toEqual(["purchase", "sign_in"]);
    expect(ranked[0].evidence).toEqual(["b", "c"]);
  });

  it("keeps capabilities the model did not rank, after the ones it did", () => {
    const built = profile();
    const ids = built.capabilities.map((capability) => capability.id);

    expect(ids.slice(0, 2)).toEqual(["create_account", "use_dashboard"]);
    expect(ids).toContain("sign_in");
  });
});

describe("user corrections", () => {
  it("replaces a model's reading with the user's own words, marked as theirs", () => {
    const corrected = profile({ corrections: { primaryAudience: "Restaurant owners" } });

    expect(corrected.audience.primaryAudience).toEqual({
      value: "Restaurant owners",
      confidence: "confirmed",
      sources: ["user_confirmed"],
      evidence: [],
    });
  });

  it("survives a re-derivation from new scanner evidence", () => {
    // The exact scenario CORE-1 §25 names: a fresh scan produces a fresh
    // derived profile, and the founder's correction must still be on top.
    const rescanned = profile();
    expect(rescanned.audience.primaryAudience.value).toBe("Small teams that work in shifts");

    const withCorrection = applyCorrections(rescanned, { primaryAudience: "Restaurant owners" });
    expect(withCorrection.audience.primaryAudience).toMatchObject({
      value: "Restaurant owners",
      sources: ["user_confirmed"],
    });
  });

  it("ignores a correction that is blank or a pasted document", () => {
    const built = profile({ corrections: { name: "   ", understanding: "x".repeat(2_000) } });

    expect(built.identity.name.value).toBe("Acme");
    expect(built.identity.understanding.value).toContain("You've built");
  });

  it("leaves untouched fields alone", () => {
    const built = applyCorrections(profile(), { name: "Shiftly" });

    expect(built.identity.name.value).toBe("Shiftly");
    expect(built.identity.understanding.value).toContain("You've built");
  });
});

describe("partial evidence", () => {
  it("still produces a usable profile with no live product", () => {
    const built = profile({ liveProduct: null });

    expect(built.completeness).toBe("partial");
    expect(built.capabilities.length).toBeGreaterThan(0);
    expect(built.limitations.join(" ")).toContain("has not checked your public product");
    expect(built.sources.find((source) => source.source === "live_product")?.used).toBe(false);
  });

  it("is complete only when both public sources contributed", () => {
    expect(profile().completeness).toBe("complete");
  });

  it("says a Deep Scan is unseen without counting it against the product", () => {
    const built = profile();

    expect(built.sources.find((source) => source.source === "deep_scan")?.used).toBe(false);
    expect(built.limitations.join(" ")).toContain("behind your login");
  });
});

describe("a profile with no model at all", () => {
  it("carries no prompt, provider or model, and no invented sentences", () => {
    const built = assembleProfile({
      repository: fakeRepositorySnapshot(),
      liveProduct: fakeLiveSnapshot(),
      signedInProduct: null,
      synthesis: null,
      corrections: {},
      provider: null,
      model: null,
      promptVersion: null,
      generatedAt: FIXED_NOW,
    });

    expect(built.promptVersion).toBeNull();
    expect(built.model).toBeNull();
    expect(built.identity.understanding.value).toBeNull();
    // Everything the rules can answer is still there.
    expect(built.capabilities.length).toBeGreaterThan(0);
    expect(built.brand.colors.length).toBeGreaterThan(0);
    expect(built.journey).toHaveLength(8);
  });
});

describe("determinism", () => {
  it("produces an identical profile for identical inputs", () => {
    expect(JSON.stringify(profile())).toBe(JSON.stringify(profile()));
  });
});
