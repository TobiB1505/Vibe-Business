import { describe, expect, it } from "vitest";
import { buildBrandProfile, deriveRecurringPhrases, resolveDisplayUrl } from "./brand";
import { selectLogo } from "./view";
import { fakeLiveSnapshot, fakeRepositorySnapshot } from "./test-support";

describe("resolveDisplayUrl", () => {
  it("renders an asset on the product's own https origin", () => {
    expect(resolveDisplayUrl("/logo.svg", "https://acme.test")).toBe("https://acme.test/logo.svg");
  });

  it("refuses when there is no origin to serve it from", () => {
    // A project with no production URL: Vibe will not guess where the logo
    // would live rather than render a broken image.
    expect(resolveDisplayUrl("/logo.svg", null)).toBeNull();
  });

  it("refuses an asset hosted anywhere but the product's own origin", () => {
    expect(resolveDisplayUrl("https://cdn.other.test/logo.svg", "https://acme.test")).toBeNull();
  });

  it("refuses a non-https origin", () => {
    expect(resolveDisplayUrl("/logo.svg", "http://acme.test")).toBeNull();
  });
});

describe("brand assets", () => {
  it("confirms an asset both collectors saw, and keeps the served reference", () => {
    const brand = buildBrandProfile({
      repository: fakeRepositorySnapshot(),
      liveProduct: fakeLiveSnapshot(),
    });

    const logo = brand.assets.find((asset) => asset.role === "logo");
    expect(logo).toMatchObject({
      confidence: "confirmed",
      reference: "/logo.svg",
      displayUrl: "https://acme.test/logo.svg",
    });
    expect(logo?.sources).toEqual(["live_product", "repository"]);
  });

  it("will not confirm an asset that only exists in the repository", () => {
    const brand = buildBrandProfile({
      repository: fakeRepositorySnapshot(),
      liveProduct: null,
    });

    // Declared in code, never seen being served — and with no origin, not
    // renderable either.
    expect(brand.assets.find((asset) => asset.role === "logo")).toMatchObject({
      confidence: "likely",
      displayUrl: null,
    });
  });

  it("reveals nothing when no asset can actually be rendered", () => {
    const brand = buildBrandProfile({ repository: fakeRepositorySnapshot(), liveProduct: null });
    expect(selectLogo(brand.assets)).toBeNull();
  });

  it("prefers a real logo over an icon when both are renderable", () => {
    const brand = buildBrandProfile({
      repository: fakeRepositorySnapshot(),
      liveProduct: fakeLiveSnapshot(),
    });

    expect(selectLogo(brand.assets)?.role).toBe("logo");
  });

  it("falls back to an icon when there is no logo", () => {
    const noLogo = fakeLiveSnapshot();
    noLogo.brandSignals.assets = noLogo.brandSignals.assets.filter(
      (asset) => asset.role !== "logo",
    );

    const brand = buildBrandProfile({ repository: null, liveProduct: noLogo });
    expect(selectLogo(brand.assets)?.role).toBe("favicon");
  });
});

describe("brand colour", () => {
  it("prefers the colour the page declares to a browser", () => {
    const brand = buildBrandProfile({
      repository: fakeRepositorySnapshot(),
      liveProduct: fakeLiveSnapshot(),
    });

    expect(brand.colors[0]).toMatchObject({
      role: "primary",
      value: "#3355ff",
      confidence: "confirmed",
      sources: ["live_product"],
    });
  });

  it("does not list the same colour twice when both sources agree", () => {
    const brand = buildBrandProfile({
      repository: fakeRepositorySnapshot(),
      liveProduct: fakeLiveSnapshot(),
    });

    const values = brand.colors.map((color) => color.value);
    expect(new Set(values).size).toBe(values.length);
  });

  it("carries a design token's own confidence through when only code has it", () => {
    const uncertain = fakeRepositorySnapshot();
    uncertain.brand.colors = [
      {
        role: "primary",
        value: "#00e5a0",
        token: "--color-mint",
        confidence: "low",
        evidence: [],
      },
    ];

    const brand = buildBrandProfile({ repository: uncertain, liveProduct: null });
    expect(brand.colors[0]).toMatchObject({ value: "#00e5a0", confidence: "unclear" });
  });
});

describe("typography", () => {
  it("takes the role from the code and the spelling from the page", () => {
    const repository = fakeRepositorySnapshot();
    // The `next/font` variable title-cases badly; the page's own stack does not.
    repository.brand.typefaces = [
      { role: "mono", family: "Jetbrains Mono", confidence: "high", evidence: [] },
    ];

    const liveProduct = fakeLiveSnapshot();
    liveProduct.brandSignals.typefaces = ["JetBrains Mono"];

    const brand = buildBrandProfile({ repository, liveProduct });

    expect(brand.typefaces[0]).toMatchObject({
      role: "mono",
      family: "JetBrains Mono",
      confidence: "confirmed",
      sources: ["repository", "live_product"],
    });
  });

  it("keeps a family only the page named, without guessing its role", () => {
    const liveProduct = fakeLiveSnapshot();
    liveProduct.brandSignals.typefaces = ["Söhne"];

    const brand = buildBrandProfile({ repository: null, liveProduct });
    expect(brand.typefaces).toEqual([
      { role: "body", family: "Söhne", confidence: "likely", sources: ["live_product"], evidence: ["live.brand.typeface.0"] },
    ]);
  });
});

describe("voice", () => {
  it("collects the phrases the site repeats, most frequent first", () => {
    const liveProduct = fakeLiveSnapshot();
    liveProduct.pages = liveProduct.pages.map((page) => ({
      ...page,
      ctas: ["Start free", "Start free", "Talk to us"],
    }));

    expect(deriveRecurringPhrases(liveProduct)).toEqual(["Start free", "Talk to us"]);
  });

  it("leaves tone unset until a model fills it in", () => {
    const brand = buildBrandProfile({
      repository: fakeRepositorySnapshot(),
      liveProduct: fakeLiveSnapshot(),
    });

    expect(brand.voice.tone).toEqual({
      value: null,
      confidence: "not_found",
      sources: [],
      evidence: [],
    });
  });

  it("has no phrases when there is no live product", () => {
    expect(deriveRecurringPhrases(null)).toEqual([]);
  });
});

describe("no brand at all", () => {
  it("produces an empty profile rather than inventing one", () => {
    const bare = fakeRepositorySnapshot();
    bare.brand = { assets: [], colors: [], typefaces: [], tokenSources: [] };

    const brand = buildBrandProfile({ repository: bare, liveProduct: null });

    expect(brand.assets).toEqual([]);
    expect(brand.colors).toEqual([]);
    expect(brand.typefaces).toEqual([]);
  });

  it("tolerates a snapshot written before brand detection existed", () => {
    // A row stored by an older analyzer genuinely has no `brand` key. A crash
    // here would be a worse outcome than an empty brand section.
    const legacy = fakeRepositorySnapshot();
    delete (legacy as { brand?: unknown }).brand;

    expect(() => buildBrandProfile({ repository: legacy, liveProduct: null })).not.toThrow();
  });
});
