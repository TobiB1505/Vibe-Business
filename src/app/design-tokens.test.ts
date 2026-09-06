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
const V2 = readFileSync(join(process.cwd(), "src/app/theme-v2.css"), "utf8");
const FONTS = readFileSync(join(process.cwd(), "src/app/fonts.ts"), "utf8");

/**
 * The palettes this file measures.
 *
 * Two of them since S1 (ADR 0096). v2 is scoped to `[data-vibe="v2"]` and no
 * element carries that attribute yet, which is exactly why it needs measuring
 * now: a palette nobody looks at is how `--color-fg-meta` reached production
 * at 3.38:1 and stayed there for the life of the design system. The arithmetic
 * does not care whether a token is switched on.
 *
 * They are separate *files* rather than two blocks in one, because `token`
 * resolves a name by first match. Two blocks would have left every assertion
 * below still measuring v1 while reporting nothing about v2 — a green test
 * that had stopped testing the thing being shipped.
 */
const PALETTES = [
  { name: "v1", css: CSS },
  { name: "v2", css: V2 },
] as const;

function tokenIn(css: string, name: string, where: string): string {
  const match = css.match(new RegExp(`--color-${name}:\\s*([^;]+);`));
  if (!match) throw new Error(`--color-${name} is not defined in ${where}`);
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

/** The ramp steps that carry text, and are therefore held to AA. */
const TEXT_STEPS = ["fg", "fg-body", "fg-prose", "fg-secondary", "fg-muted", "fg-meta"] as const;

/** The deepest surface a card uses — the hardest background real text sits on. */
function panelOf(css: string, where: string): Rgb {
  const app = parseHex(tokenIn(css, "app", where));
  return composite(parseWhiteAlpha(tokenIn(css, "surface-4", where)), app);
}

describe.each(PALETTES)("the $name foreground ramp is legible on a panel", ({ name, css }) => {
  const PANEL = panelOf(css, name);
  const step = (n: string) => parseHex(tokenIn(css, n, name));

  it.each(TEXT_STEPS)("%s clears 4.5:1 on surface-4", (name_) => {
    expect(contrast(step(name_), PANEL)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the two exempt steps out of the text budget", () => {
    // Named rather than silently skipped. `fg-disabled` is the colour of a
    // control that exists and is not available — WCAG exempts it, and the
    // button primitive pairs it with a border so it never reads as a gap.
    // `fg-faint` is hairlines and dividers, never text.
    for (const exempt of ["fg-disabled", "fg-faint"] as const) {
      expect(contrast(step(exempt), PANEL)).toBeLessThan(4.5);
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
    const lightness = TEXT_STEPS.map((name_) => perceptualLightness(step(name_)));

    for (let i = 1; i < lightness.length; i += 1) {
      expect(
        lightness[i - 1] - lightness[i],
        `${TEXT_STEPS[i - 1]} and ${TEXT_STEPS[i]} are the same colour to a reader`,
      ).toBeGreaterThan(3);
    }
  });
});

describe("v2 redefines the whole colour vocabulary", () => {
  /**
   * A token v1 declares and v2 does not is not a compile error and not a
   * runtime error. It is a colour that quietly keeps its v1 value under a
   * scope meant to replace it — so a v2 screen would render one v1 line
   * colour among thirty-nine v2 ones, and nothing would say so.
   *
   * Parity is the cheap guard: 40 names in, 40 names out. When v1 gains a
   * token, this fails until v2 answers for it.
   */
  const THEME = CSS.slice(CSS.indexOf("@theme {"));
  const names = (css: string) =>
    new Set([...css.matchAll(/--color-([a-z0-9-]+):/g)].map((m) => m[1]));

  it("declares every colour token the base theme declares", () => {
    const missing = [...names(THEME)].filter((name) => !names(V2).has(name));
    expect(missing, `v2 would inherit v1's value for: ${missing.join(", ")}`).toEqual([]);
  });

  it("invents no colour token the base theme has no name for", () => {
    // The other direction, so a v2-only name cannot become a dependency that
    // breaks the moment v2 is lifted into `@theme` and the scope deleted.
    const extra = [...names(V2)].filter((name) => !names(THEME).has(name));
    expect(extra, `v2-only colour tokens: ${extra.join(", ")}`).toEqual([]);
  });

  it("changes nothing until something opts in", () => {
    /*
     * Every v2 declaration is scoped to `[data-vibe="v2"]`. Nothing in the
     * product sets that attribute yet, which is what makes S1 a foundation
     * rather than a redesign — and what makes it reversible by deleting one
     * attribute rather than by reverting 162 files.
     */
    for (const file of walk(join(process.cwd(), "src"))) {
      if (!file.endsWith(".tsx")) continue;
      expect(
        withoutComments(readFileSync(file, "utf8")),
        `${file.slice(process.cwd().length + 1)} opts into v2; S1 ships the tokens unswitched`,
      ).not.toContain('data-vibe="v2"');
    }
  });
});

describe("the interface typography is neutral and local-first", () => {
  it("uses the native SaaS interface stack rather than Space Grotesk", () => {
    expect(CSS).toContain('Inter, "SF Pro Display", "SF Pro Text"');
    expect(CSS).toContain('"Segoe UI Variable"');
    expect(CSS).not.toContain("var(--font-space-grotesk)");
  });

  it("does not preload a sans webfont the interface no longer uses", () => {
    expect(FONTS).not.toContain("spaceGroteskLatin");
    expect(FONTS).toContain("jetBrainsMonoLatin");
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
  const COLOUR_UTILITIES =
    /\b(?:text|bg|border)-((?:fg|mint|amber|coral|surface|line|danger|success|warning|error)(?:-[a-z0-9]+)*)\b/g;

  it("resolves every colour utility used in the app to a token", () => {
    const sources = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
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

describe("the focus ring is never animated", () => {
  /**
   * `transition-colors` includes `outline-color` (UI-6 §9).
   *
   * A control using it fades its focus ring in over 150ms, so a keyboard user
   * pressing Tab sees the indicator arrive after they have already started
   * deciding where they are. `button.tsx` worked this out and wrote the
   * property list by hand — which fixed one control, because a comment in one
   * file is not a mechanism. Twenty others kept the shorthand.
   *
   * `transition-interactive` in `globals.css` is the mechanism. This is what
   * stops the shorthand coming back.
   */
  const ALLOWED = new Set([
    // A progress bar, not a control: it cannot take focus, and it runs at
    // 300ms deliberately because it is reporting movement rather than
    // responding to a pointer.
    "src/app/app/projects/[projectId]/understanding-progress.tsx",
  ]);

  it("is defined once, as a utility", () => {
    expect(CSS).toContain("@utility transition-interactive");
    expect(CSS).not.toMatch(/@utility transition-interactive[\s\S]*?outline-color/);
  });

  it("is what interactive elements use", () => {
    const offenders: string[] = [];

    for (const file of walk(join(process.cwd(), "src"))) {
      if (!file.endsWith(".tsx")) continue;
      const relative = file.slice(process.cwd().length + 1);
      if (ALLOWED.has(relative)) continue;
      if (withoutComments(readFileSync(file, "utf8")).includes("transition-colors")) {
        offenders.push(relative);
      }
    }

    expect(offenders, `use transition-interactive instead: ${offenders.join(", ")}`).toEqual([]);
  });
});

describe("a button that is working says so", () => {
  /**
   * Twenty-seven controls swap their label for "Merging…", "Saving…",
   * "Starting…" while a transition runs (UI-6 §3). A sighted user sees that at
   * once. A screen-reader user was told nothing: the label of a button that
   * already has focus is not re-read, and the app has three live regions in
   * total, none of them near these.
   *
   * `aria-busy` is the fix — on the element the user is already standing on,
   * needing no region to have existed beforehand. This is what keeps the two
   * in step, because the label and the attribute are easy to change apart.
   */
  it("pairs every in-flight label with aria-busy", () => {
    const offenders: string[] = [];

    for (const file of walk(join(process.cwd(), "src"))) {
      if (!file.endsWith(".tsx")) continue;
      const src = withoutComments(readFileSync(file, "utf8"));

      for (const match of src.matchAll(
        /<Button\b((?:[^<>]|\{[^{}]*\})*?)>\s*\{(\w+) \? "[^"]*…"/g,
      )) {
        if (!/\bbusy=\{/.test(match[1])) {
          offenders.push(`${file.slice(process.cwd().length + 1)} (${match[2]})`);
        }
      }
    }

    expect(offenders, `add busy={…}: ${offenders.join(", ")}`).toEqual([]);
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

/**
 * A `text-*` class that names no token renders nothing and says so to nobody.
 *
 * `text-ui-lg` was written on Nova's question and Nova's prompt — two of the
 * most prominent sentences in the product — and is declared in neither
 * palette. Measured in a browser it computed to 16px, which is exactly what no
 * class at all computes to. It survived because 16px happens to be larger than
 * body text, so it looked approximately intentional.
 *
 * Tailwind cannot warn about this: an unknown utility is simply not emitted.
 * Only a comparison of what is written against what is declared can catch it.
 */
describe("every type class names a token that exists", () => {
  const declared = new Set(
    [...CSS.matchAll(/--text-([a-z0-9-]+):/g)]
      .map((match) => match[1])
      // `--text-x--line-height` and friends are modifiers of a size, not sizes.
      .filter((name) => !name.includes("--")),
  );

  /** Tailwind's own scale, which is legitimate even where Vibe has its own. */
  const TAILWIND = new Set([
    "xs",
    "sm",
    "base",
    "lg",
    "xl",
    "2xl",
    "3xl",
    "4xl",
    "5xl",
    "6xl",
    "7xl",
    "8xl",
    "9xl",
  ]);

  it("finds the declared sizes at all", () => {
    expect(declared.size).toBeGreaterThan(6);
    expect(declared).toContain("caption");
  });

  it("writes no size the theme cannot resolve", () => {
    // Colour tokens share the `text-` prefix, so a name is fine if the theme
    // declares it as either a size or a colour.
    const colours = new Set([...CSS.matchAll(/--color-([a-z0-9-]+):/g)].map((m) => m[1]));
    const KEYWORDS = new Set([
      "balance",
      "pretty",
      "wrap",
      "nowrap",
      "clip",
      "ellipsis",
      "left",
      "right",
      "center",
      "justify",
      "start",
      "end",
      "white",
      "black",
      "transparent",
      "current",
      "inherit",
    ]);

    const unknown = new Map<string, string>();
    for (const file of walk(join(process.cwd(), "src"))) {
      if (!file.endsWith(".tsx")) continue;
      const source = readFileSync(file, "utf8");
      // Only inside a className, so an import path like `ui/text-link` is not
      // mistaken for a utility.
      for (const [, attribute] of source.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
        for (const [, name] of (attribute ?? "").matchAll(/\btext-([a-z][a-z0-9-]*)\b/g)) {
          if (declared.has(name) || TAILWIND.has(name)) continue;
          if (colours.has(name) || KEYWORDS.has(name)) continue;
          if (!unknown.has(name)) unknown.set(name, file.replace(process.cwd() + "/", ""));
        }
      }
    }

    expect(
      [...unknown.keys()],
      [...unknown].map(([name, file]) => `text-${name} in ${file}`).join("; "),
    ).toEqual([]);
  });
});

/**
 * The two steps the sweep created must keep rendering what they replaced.
 *
 * `text-sm` and `text-xs` were written 809 times against a scale that had no
 * name for either. `--text-body` and `--text-caption` name them, and the whole
 * argument for the sweep was that it moves nothing — so these values are not
 * free to drift. Changing one is re-typesetting most of the product, which is
 * a decision and belongs in a commit that says so.
 *
 * v2 is deliberately different and is not pinned here: loosening prose is one
 * of the things a second palette is for.
 */
describe("the body and caption steps name what they replaced", () => {
  const value = (name: string) => CSS.match(new RegExp(`--text-${name}:\\s*([^;]+);`))?.[1].trim();
  const leading = (name: string) =>
    CSS.match(new RegExp(`--text-${name}--line-height:\\s*([^;]+);`))?.[1].trim();

  it("is Tailwind's text-sm, exactly", () => {
    expect(value("body")).toBe("0.875rem");
    expect(leading("body")).toBe("1.25rem");
  });

  it("is Tailwind's text-xs, exactly", () => {
    expect(value("caption")).toBe("0.75rem");
    expect(leading("caption")).toBe("1rem");
  });

  it("leaves no raw size behind in the product", () => {
    const stragglers: string[] = [];
    for (const file of walk(join(process.cwd(), "src"))) {
      if (!file.endsWith(".tsx") || file.includes("design-studies")) continue;
      if (/\btext-(sm|xs)\b/.test(readFileSync(file, "utf8"))) {
        stragglers.push(file.replace(process.cwd() + "/", ""));
      }
    }
    expect(
      stragglers,
      "`text-sm` and `text-xs` are Tailwind's names for steps Vibe now owns.",
    ).toEqual([]);
  });
});
