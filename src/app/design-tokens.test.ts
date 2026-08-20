import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The colour tokens, measured rather than trusted (UI-6 §7).
 *
 * ## Why this file exists
 *
 * Because `--color-fg-meta` sat at **3.38:1 on a panel** for the whole life of
 * the design system, and nothing could tell. It is the default colour of the
 * brand's signature eyebrow — ninety `MonoLabel` uses plus raw ones — so the
 * one token that failed was also one of the most-used, on every screen in the
 * product. A ramp is a set of numbers with jobs; whether a number can do its
 * job is arithmetic, and arithmetic belongs in a test.
 *
 * ## Why contrast is measured against a surface, not the page
 *
 * The surfaces are white at low alpha over the frame, so a panel is *lighter*
 * than the page behind it and text on a panel has less contrast than the same
 * text on the page. `fg-meta` cleared 4.5:1 against `--color-app` at one point
 * in this sprint and still failed on every card that used it. The floor here is
 * `--color-surface-4`, the deepest surface a card uses.
 *
 * `--color-surface-hover` is deliberately not the reference. It is a hover
 * fill, not a text background, and holding the whole ramp to a transient state
 * would lift every colour in the product to buy nothing.
 */

const CSS = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

function token(name: string): string {
  const match = CSS.match(new RegExp(`--color-${name}:\\s*([^;]+);`));
  if (!match) throw new Error(`--color-${name} is not defined in globals.css`);
  return match[1].trim();
}

type Rgb = [number, number, number];

function parseHex(value: string): Rgb {
  const hex = value.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
}

/** `rgb(255 255 255 / 0.05)` composited over an opaque base. */
function parseWhiteAlpha(value: string): number {
  const match = value.match(/rgb\(255 255 255 \/ ([\d.]+)\)/);
  if (!match) throw new Error(`not a white-alpha surface: ${value}`);
  return Number(match[1]);
}

function composite(alpha: number, base: Rgb): Rgb {
  return base.map((channel) => alpha * 255 + (1 - alpha) * channel) as Rgb;
}

function relativeLuminance([r, g, b]: Rgb): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** CIE L*, so "how different do these look" survives the top of the ramp. */
function perceptualLightness(rgb: Rgb): number {
  const y = relativeLuminance(rgb);
  return y > 0.008856 ? 116 * y ** (1 / 3) - 16 : 903.3 * y;
}

function contrast(a: Rgb, b: Rgb): number {
  const [high, low] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

const APP = parseHex(token("app"));
/** The deepest surface a card uses — the hardest background real text sits on. */
const PANEL = composite(parseWhiteAlpha(token("surface-4")), APP);

/** The ramp steps that carry text, and are therefore held to AA. */
const TEXT_STEPS = ["fg", "fg-body", "fg-prose", "fg-secondary", "fg-muted", "fg-meta"] as const;

describe("the foreground ramp is legible on a panel", () => {
  it.each(TEXT_STEPS)("%s clears 4.5:1 on surface-4", (step) => {
    expect(contrast(parseHex(token(step)), PANEL)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the two exempt steps out of the text budget", () => {
    // Named rather than silently skipped. `fg-disabled` is the colour of a
    // control that exists and is not available — WCAG exempts it, and the
    // button primitive pairs it with a border so it never reads as a gap.
    // `fg-faint` is hairlines and dividers, never text.
    for (const step of ["fg-disabled", "fg-faint"] as const) {
      expect(contrast(parseHex(token(step)), PANEL)).toBeLessThan(4.5);
    }
  });

  it("descends without a step nobody can see", () => {
    /*
     * Measured in L*, not in contrast ratio.
     *
     * Contrast ratio is the wrong instrument for this question and says so
     * loudly at the top of the ramp: `fg` and `fg-body` are two visibly
     * different near-whites whose *ratios* differ by 1.09x, because the ratio
     * curve flattens as both colours approach white. L* is perceptual
     * lightness and stays meaningful across the whole range.
     *
     * The threshold is deliberately low. `fg` -> `fg-body` is a designed
     * micro-step — headline against body text, both near-white — and a test
     * that forbade it would be policing the design rather than protecting it.
     * What this catches is a step collapsing to nothing, which is how a ramp
     * quietly becomes seven names for six colours.
     */
    const lightness = TEXT_STEPS.map((step) => perceptualLightness(parseHex(token(step))));

    for (let i = 1; i < lightness.length; i += 1) {
      expect(
        lightness[i - 1] - lightness[i],
        `${TEXT_STEPS[i - 1]} and ${TEXT_STEPS[i]} are the same colour to a reader`,
      ).toBeGreaterThan(3);
    }
  });
});

describe("every colour a class name asks for exists", () => {
  /**
   * `text-danger` was written in a `role="alert"`, and no `--color-danger`
   * has ever existed — so the product's save-error rendered in whatever
   * colour it inherited. Tailwind resolves colour utilities from the tokens,
   * so a name with no token is not a compile error and not a runtime error:
   * it is a silent no-op on exactly the text that most needed to be seen.
   */
  const COLOUR_UTILITIES = /\b(?:text|bg|border)-((?:fg|mint|amber|coral|surface|line|danger|success|warning|error)(?:-[a-z0-9]+)*)\b/g;

  it("resolves every colour utility used in the app to a token", () => {
    const sources = readFileSync(
      join(process.cwd(), "src/app/globals.css"),
      "utf8",
    );
    const declared = new Set(
      [...sources.matchAll(/--color-([a-z0-9-]+):/g)].map((match) => match[1]),
    );

    // Utilities Tailwind resolves from its own scale rather than ours.
    const BUILT_IN = new Set(["surface", "line"]);

    const used = new Set<string>();
    for (const file of walk(join(process.cwd(), "src"))) {
      if (!file.endsWith(".tsx")) continue;
      // Comments stripped first. The comment explaining why `text-danger` was
      // wrong contains `text-danger`, and a scanner that read it would report
      // the explanation as the defect — the same trap the copy assertions in
      // `outcome-ui.test.ts` document.
      for (const match of withoutComments(readFileSync(file, "utf8")).matchAll(COLOUR_UTILITIES)) {
        used.add(match[1]);
      }
    }

    const missing = [...used].filter((name) => !declared.has(name) && !BUILT_IN.has(name));
    expect(missing, `colour utilities with no token: ${missing.join(", ")}`).toEqual([]);
  });
});

function withoutComments(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");
}

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else yield path;
  }
}
