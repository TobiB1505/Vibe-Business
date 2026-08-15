import { describe, expect, it } from "vitest";
import { contextFrom } from "../test-support";
import {
  assignColorRoles,
  colorFamily,
  detectBrand,
  detectBrandAssets,
  firstConcreteFamily,
  humanizeFontToken,
  parseCustomProperties,
  servedPathFor,
} from "./brand";

describe("brand assets", () => {
  it("recognises a conventionally named logo in a web root with high confidence", () => {
    const assets = detectBrandAssets(contextFrom([{ path: "public/logo.svg" }]));

    expect(assets).toHaveLength(1);
    expect(assets[0]).toMatchObject({
      role: "logo",
      path: "public/logo.svg",
      servedPath: "/logo.svg",
      confidence: "high",
    });
  });

  it("does not treat an arbitrary SVG as a logo", () => {
    const assets = detectBrandAssets(
      contextFrom([
        { path: "public/hero-illustration.svg" },
        { path: "public/chart-background.png" },
        { path: "src/components/arrow.svg" },
      ]),
    );

    expect(assets).toEqual([]);
  });

  it("separates a logo variant from the primary mark", () => {
    const assets = detectBrandAssets(
      contextFrom([{ path: "public/brand/logo.svg" }, { path: "public/brand/logo-mono.svg" }]),
    );

    expect(assets.map((asset) => [asset.role, asset.path])).toEqual([
      ["logo", "public/brand/logo.svg"],
      ["logo_alternate", "public/brand/logo-mono.svg"],
    ]);
  });

  it("recognises framework metadata assets that are served without a web root", () => {
    const assets = detectBrandAssets(
      contextFrom([{ path: "src/app/icon.svg" }, { path: "src/app/opengraph-image.png" }]),
    );

    expect(assets).toEqual([
      expect.objectContaining({ role: "app_icon", confidence: "high", servedPath: null }),
      expect.objectContaining({ role: "open_graph_image", confidence: "high" }),
    ]);
  });

  it("downgrades a name match found nowhere assets belong", () => {
    const assets = detectBrandAssets(contextFrom([{ path: "docs/marketing/partner-logo-usage.png" }]));

    expect(assets[0]?.confidence).toBe("low");
  });

  it("maps served paths only for real web roots", () => {
    expect(servedPathFor("public/brand/logo.svg")).toBe("/brand/logo.svg");
    expect(servedPathFor("static/logo.png")).toBe("/logo.png");
    // Bundled, therefore served at a hashed URL we cannot predict.
    expect(servedPathFor("src/assets/logo.svg")).toBeNull();
  });
});

describe("design token parsing", () => {
  it("extracts custom property declarations from a theme block", () => {
    const tokens = parseCustomProperties(`
      @theme {
        --color-primary: #00e5a0;
        --color-app: #0a0908;
        --radius-panel: 12px;
      }
    `);

    expect(tokens).toEqual([
      { name: "--color-primary", value: "#00e5a0" },
      { name: "--color-app", value: "#0a0908" },
      { name: "--radius-panel", value: "12px" },
    ]);
  });

  it("groups tokens into colour families by their leading word", () => {
    expect(colorFamily("--color-mint-tint-soft")).toBe("mint");
    expect(colorFamily("--brand-indigo")).toBe("indigo");
  });
});

describe("colour roles", () => {
  const at = (path: string) => (name: string, value: string) => ({ name, value, path });
  const token = at("src/app/globals.css");

  it("takes a declared primary at high confidence", () => {
    const [primary] = assignColorRoles([token("--color-primary", "#3355ff")]);

    expect(primary).toMatchObject({
      role: "primary",
      value: "#3355ff",
      token: "--color-primary",
      confidence: "high",
    });
  });

  it("resolves one level of var() aliasing", () => {
    const colors = assignColorRoles([
      token("--indigo-500", "#3355ff"),
      token("--color-primary", "var(--indigo-500)"),
    ]);

    expect(colors.find((color) => color.role === "primary")?.value).toBe("#3355ff");
  });

  it("does not mistake --color-ground for a background declaration", () => {
    const colors = assignColorRoles([token("--color-ground", "#050505")]);

    expect(colors.find((color) => color.role === "background")).toBeUndefined();
  });

  it("promotes the leading saturated family when nothing is named, at medium confidence", () => {
    const colors = assignColorRoles([
      token("--color-mint", "#00e5a0"),
      token("--color-mint-deep", "#00a97a"),
      token("--color-mint-dim", "#0e8c67"),
      token("--color-fg", "#f7f5f1"),
      token("--color-app", "#0a0908"),
    ]);

    expect(colors.find((color) => color.role === "primary")).toMatchObject({
      value: "#00e5a0",
      token: "--color-mint",
      confidence: "medium",
    });
  });

  it("refuses to be confident when several saturated families are tied", () => {
    const colors = assignColorRoles([
      token("--color-mint", "#00e5a0"),
      token("--color-mint-deep", "#00a97a"),
      token("--color-amber", "#e8b54a"),
      token("--color-amber-deep", "#9a7420"),
    ]);

    expect(colors.find((color) => color.role === "primary")).toMatchObject({ confidence: "low" });
  });

  it("ignores greyscale and state tokens when guessing a brand colour", () => {
    const colors = assignColorRoles([
      token("--color-fg", "#f7f5f1"),
      token("--color-surface", "#141414"),
      token("--color-error", "#ff3355"),
      token("--color-success", "#22cc88"),
    ]);

    expect(colors).toEqual([expect.objectContaining({ role: "foreground", value: "#f7f5f1" })]);
  });
});

describe("typography", () => {
  it("derives a family name from a next/font loader variable", () => {
    expect(humanizeFontToken("--font-space-grotesk")).toBe("Space Grotesk");
    // A role word is not a family.
    expect(humanizeFontToken("--font-sans")).toBeNull();
  });

  it("skips generic fallbacks when reading a font stack", () => {
    expect(firstConcreteFamily('ui-sans-serif, "Inter", system-ui')).toBe("Inter");
    expect(firstConcreteFamily("ui-sans-serif, system-ui, sans-serif")).toBeNull();
  });

  it("reads role and family from a token system", () => {
    const brand = detectBrand(
      contextFrom([
        {
          path: "src/app/globals.css",
          content: `@theme {
            --font-sans: var(--font-space-grotesk), ui-sans-serif, sans-serif;
            --font-mono: var(--font-jetbrains-mono), ui-monospace, monospace;
          }`,
        },
      ]),
    );

    expect(brand.typefaces).toEqual([
      { role: "body", family: "Space Grotesk", confidence: "high", evidence: expect.any(Array) },
      // Title-cased from the loader variable, so the product's own spelling
      // ("JetBrains Mono") is lost. The live layer, which reads a real
      // `font-family` stack, is what restores it when both sources exist.
      { role: "mono", family: "Jetbrains Mono", confidence: "high", evidence: expect.any(Array) },
    ]);
    expect(brand.tokenSources).toEqual(["src/app/globals.css"]);
  });

  it("falls back to a plain font-family declaration at low confidence", () => {
    const brand = detectBrand(
      contextFrom([{ path: "styles.css", content: "body { font-family: 'Inter', sans-serif; }" }]),
    );

    expect(brand.typefaces).toEqual([
      { role: "body", family: "Inter", confidence: "low", evidence: expect.any(Array) },
    ]);
  });
});

describe("detectBrand", () => {
  it("reports empty brand intelligence when a repository declares none", () => {
    const brand = detectBrand(contextFrom([{ path: "src/index.ts" }]));

    expect(brand).toEqual({ assets: [], colors: [], typefaces: [], tokenSources: [] });
  });

  it("never reads a stylesheet it was not given", () => {
    // No content means the analyzer did not fetch it; the detector must not
    // invent tokens from a path alone.
    const brand = detectBrand(contextFrom([{ path: "src/app/globals.css" }]));

    expect(brand.colors).toEqual([]);
    expect(brand.tokenSources).toEqual([]);
  });
});
