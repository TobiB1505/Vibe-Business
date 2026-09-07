import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The material layer, and the promise that it changes nothing yet (S2).
 *
 * ## What this file is defending
 *
 * S2 gave every primitive a `vibe-*` class and gave those classes material in
 * `theme-v2.css`. The whole value of that shape is that v1 is untouched — 51
 * files, 289 label uses, every card and every control in the product, all
 * rendering exactly as before. That promise is invisible: nothing fails if a
 * rule leaks out of the scope, and nobody would notice until a screen somebody
 * was not looking at moved.
 *
 * So the promise is a test rather than a sentence in a commit message.
 */

const GLOBALS = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
const V2 = readFileSync(join(process.cwd(), "src/app/theme-v2.css"), "utf8");
const LAYOUT = readFileSync(join(process.cwd(), "src/app/layout.tsx"), "utf8");
const SURFACE = readFileSync(join(process.cwd(), "src/components/ui/surface.tsx"), "utf8");
const BUTTON = readFileSync(join(process.cwd(), "src/components/ui/button.tsx"), "utf8");
const SHEET = readFileSync(join(process.cwd(), "src/components/ui/sheet.tsx"), "utf8");

/** Every selector in a stylesheet, with its block. */
function rules(css: string): { selector: string; body: string }[] {
  const out: { selector: string; body: string }[] = [];
  // Comments first: several of them name `.vibe-control` while explaining it,
  // and a scanner that read those would report the explanation as the defect.
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, " ");
  for (const match of stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    out.push({ selector: match[1].trim(), body: match[2] });
  }
  return out;
}

const HOOKS = [
  "vibe-surface-card",
  "vibe-surface-panel",
  "vibe-surface-section",
  "vibe-well",
  "vibe-control",
  "vibe-control-text",
  "vibe-overlay",
  "vibe-chrome",
] as const;

describe("the primitives emit the material hooks", () => {
  it.each(["vibe-surface-section", "vibe-surface-panel", "vibe-surface-card"])(
    "Surface emits %s",
    (hook) => {
      expect(SURFACE).toContain(hook);
    },
  );

  it("Well emits its own hook", () => {
    expect(SURFACE).toContain("vibe-well");
  });

  it("Sheet emits the overlay hook", () => {
    expect(SHEET).toContain("vibe-overlay");
  });

  it("the rails emit the chrome hook", () => {
    // Both of them. A product where one rail is a pane and the other is a
    // fill has two frames, and a founder moves between them constantly.
    for (const shell of ["account-shell", "project-shell"]) {
      expect(
        readFileSync(join(process.cwd(), `src/components/layout/${shell}.tsx`), "utf8"),
        `${shell} does not wear vibe-chrome`,
      ).toContain("vibe-chrome");
    }
  });

  it("emits the control hook from buttonClasses, not from the component", () => {
    /*
     * `<Link className={buttonClasses()}>` call sites render no Button, so a
     * hook added in the component would reach the buttons and miss every link
     * styled as one — which is most of the primary actions in the product.
     */
    const base = BUTTON.slice(
      BUTTON.indexOf("const BASE_CLASSES"),
      BUTTON.indexOf("export function buttonClasses"),
    );
    expect(base).toContain("vibe-control");
  });
});

describe("v1 is untouched", () => {
  /*
   * One hook is styled in `globals.css` on purpose: the card's blur.
   *
   * It used to come from a Tailwind blur utility hard-coded in the primitive,
   * which meant `--glass-blur` could say 14px while the card rendered 24 — a
   * token that lies, found by measuring the rendered page rather than by
   * reading the file. The blur now comes from the palette, so it has to be
   * declared where both palettes can answer it.
   *
   * The exemption is narrow and the two assertions below are what keep it
   * narrow: the rule may only set the blur, and only from `var(--glass-*)`.
   */
  const GLOBAL_EXEMPT = ["vibe-surface-card", "vibe-overlay"];

  it.each(HOOKS.filter((hook) => !GLOBAL_EXEMPT.includes(hook)))(
    "%s carries no rule outside the v2 scope",
    (hook) => {
      const leaked = rules(GLOBALS)
        .map((rule) => rule.selector)
        .filter((selector) => selector.includes(hook));
      expect(leaked, `${hook} is styled in globals.css, so v1 is not unchanged`).toEqual([]);
    },
  );

  it("styles the two glass surfaces in globals for the blur and nothing else", () => {
    const global = rules(GLOBALS).filter((rule) =>
      GLOBAL_EXEMPT.some((hook) => rule.selector.includes(hook)),
    );
    expect(global).toHaveLength(1);
    // One rule for both, so the card and the sheet cannot drift into two
    // different blurs — which is how a product ends up with two glasses.
    for (const hook of GLOBAL_EXEMPT) expect(global[0].selector).toContain(hook);
    const properties = [...global[0].body.matchAll(/([a-z-]+):/g)].map((m) => m[1]);
    expect(new Set(properties)).toEqual(new Set(["backdrop-filter"]));
    // Values from tokens only: a literal here would put the number back in two
    // places, which is the defect this rule exists to remove.
    expect(global[0].body).not.toMatch(/\d+px/);
  });

  it("writes no vendor prefix by hand", () => {
    /*
     * `-webkit-backdrop-filter` written beside the standard property made
     * Lightning CSS keep the prefixed declaration and drop the standard one,
     * so the card computed `backdrop-filter: none` in both palettes. The build
     * prefixes from the configured targets; a hand-written twin fights it, and
     * fails silently in a way only a rendered page shows.
     */
    for (const css of [GLOBALS, V2]) {
      expect(css).not.toContain("-webkit-backdrop-filter");
    }
  });

  it("declares v1's glass values as the ones the utility produced", () => {
    // `backdrop-blur-xl` is 24px and no saturation. If these drift, v1 stops
    // rendering as it shipped and nothing else would say so.
    expect(GLOBALS).toMatch(/--glass-blur:\s*24px/);
    expect(GLOBALS).toMatch(/--glass-sat:\s*100%/);
  });

  it.each(HOOKS)("%s is only ever styled under [data-vibe='v2']", (hook) => {
    const unscoped = rules(V2)
      .map((rule) => rule.selector)
      .filter((selector) => selector.includes(hook))
      .filter((selector) =>
        selector
          .split(",")
          .map((part) => part.trim())
          .some((part) => part.includes(hook) && !part.includes('[data-vibe="v2"]')),
      );
    expect(unscoped, `unscoped rule would reach v1: ${unscoped.join(" | ")}`).toEqual([]);
  });
});

describe("the three motion obligations are structural", () => {
  it("reserves geometry: the keyframes animate opacity and transform only", () => {
    /*
     * The obligation that cannot be met by remembering. A keyframe set with no
     * layout property in it cannot move a sibling, whoever writes the
     * component that uses it.
     */
    const frames = GLOBALS.slice(GLOBALS.indexOf("@keyframes vibe-reveal"));
    const body = frames.slice(0, frames.indexOf("}\n}") + 3);
    const properties = [...body.matchAll(/^\s*([a-z-]+):/gm)].map((m) => m[1]);
    expect(new Set(properties)).toEqual(new Set(["opacity", "transform"]));
  });

  it("pauses on a hidden tab, from one attribute rather than per component", () => {
    expect(GLOBALS).toContain('[data-motion="paused"]');
    expect(GLOBALS).toContain("animation-play-state: paused");
    // The attribute has to be stamped by something, or the rule is decoration.
    expect(LAYOUT).toContain("<MotionProvider />");
  });

  it("honours reduced motion for the animation and for the press", () => {
    const blocks = [...GLOBALS.matchAll(/@media \(prefers-reduced-motion: reduce\)/g)];
    expect(blocks.length).toBeGreaterThan(0);
    expect(GLOBALS).toMatch(/prefers-reduced-motion: reduce\)[\s\S]*?\.vibe-reveal/);

    /*
     * The press is a transition, not an animation, so globals' reduced-motion
     * block does not reach it. This is the half that is easy to miss, and the
     * reason it is asserted separately rather than trusted to the one above.
     */
    expect(V2).toMatch(/prefers-reduced-motion: reduce\)[\s\S]*?\.vibe-control/);
    expect(V2).toMatch(/prefers-reduced-motion: reduce\)[\s\S]*?transform: none/);
  });

  it("never leaves a reduced-motion reader with a hidden element", () => {
    /*
     * `animation: none` on an entrance whose `from` is `opacity: 0` leaves the
     * element invisible forever — a blank page rather than a still one, which
     * is the most common way this obligation is met wrongly.
     */
    const reduced = GLOBALS.slice(GLOBALS.indexOf("@media (prefers-reduced-motion: reduce)"));
    const block = reduced.slice(0, reduced.indexOf("\n}\n", reduced.indexOf(".vibe-reveal")) + 3);
    expect(block).toContain("opacity: 1");
  });
});

describe("the card-title token exists rather than eleven literals", () => {
  /**
   * Decision D5 in the UI Sourcing Spec: a heading token at 15px.
   *
   * `--text-lead` is already 15px but carries prose leading (1.7), so eleven
   * card headings write `text-[0.9375rem] leading-snug` instead. The size was
   * never the problem; the leading was, and one token cannot serve both.
   */
  it("declares the size and a heading's leading", () => {
    expect(GLOBALS).toMatch(/--text-card-title:\s*0\.9375rem/);
    // 1.375 is `leading-snug`, which is what those eleven already render.
    // Naming what ships makes this a rename rather than a redesign.
    expect(GLOBALS).toMatch(/--text-card-title--line-height:\s*1\.375/);
  });

  it("lets v2 take the number the spec actually asked for", () => {
    expect(V2).toMatch(/--text-card-title--line-height:\s*1\.35/);
  });
});

describe("motion uses one vocabulary", () => {
  it("v2 answers v1's motion tokens rather than inventing new names", () => {
    /*
     * An earlier draft of `theme-v2.css` declared `--ease-out`,
     * `--dur-entrance` and `--dur-press` beside v1's `--ease-vibe` and
     * `--duration-*`, which would have left two ways to say the same thing and
     * no rule for choosing. The colour tokens are held to this by their own
     * parity test; motion had drifted from it inside one file.
     */
    for (const invented of ["--ease-out:", "--dur-entrance:", "--dur-press:"]) {
      expect(V2, `${invented} duplicates a name v1 already has`).not.toContain(invented);
    }
    expect(V2).toContain("--ease-vibe:");
    expect(V2).toContain("--duration-reveal:");
  });

  it("declares the one new curve in both palettes", () => {
    // A primitive that needs the scope switched on before it moves is a
    // primitive nobody can use on a v1 screen.
    expect(GLOBALS).toContain("--ease-emphasis:");
    expect(V2).toContain("--ease-emphasis:");
  });
});

/**
 * A rating is one object, and the tone table has one home.
 *
 * ## What this exists to catch
 *
 * The same rating — impact and effort, from `IMPACT_LABELS` and
 * `EFFORT_LABELS` — was drawn five ways across five files: `RatingChip` in
 * one, a mint-and-amber bordered pill in two, a borderless `bg-mint/10` pill
 * in a third, plain text with the effort in amber in a fourth, and mono text
 * in a fifth.
 *
 * The colour was the tell. Impact was always mint and effort always amber
 * whatever the *value*, so "Low impact" arrived in Vibe's success colour and
 * "Low effort" — good news — in the waiting colour. The tone was a column,
 * not a reading, and `RatingChip`'s own docblock had already argued why:
 * "low is not a problem and high is not a success".
 *
 * ## And the tone table
 *
 * Two call sites had retyped `TONE_CLASSES` character for character in a
 * local `cn()`. A change to the coral tint would reach `StatusPill` and miss
 * them, with nothing to say so.
 */
describe("a rating is drawn one way", () => {
  const CHIP_FAMILY = "src/components/ui/status-pill.tsx";

  function productFiles(): { path: string; text: string }[] {
    const out: { path: string; text: string }[] = [];
    for (const file of walkTsx(join(process.cwd(), "src"))) {
      const path = file.replace(process.cwd() + "/", "");
      if (path.startsWith("src/app/e2e/design-studies/")) continue;
      out.push({ path, text: readFileSync(file, "utf8") });
    }
    return out;
  }

  it("renders every impact and effort label through RatingChip", () => {
    const wrong = productFiles()
      .filter(({ text }) => /(IMPACT|EFFORT)_LABELS\[/.test(text))
      .filter(({ text }) => {
        // Every line that renders one must be inside a RatingChip.
        return [...text.matchAll(/[^\n]*(?:IMPACT|EFFORT)_LABELS\[[^\n]*/g)].some(
          ([line]) => !line.includes("RatingChip"),
        );
      })
      .map(({ path }) => path);
    expect(
      wrong,
      "A coarse rating is a RatingChip. Painting impact mint and effort amber " +
        "makes the tone a column rather than a reading, and puts good news in " +
        "the waiting colour.",
    ).toEqual([]);
  });

  it("keeps the chip tone table in one place", () => {
    // The two halves that were retyped. If either appears outside the chip
    // family, the table has been copied again.
    const copies = productFiles()
      .filter(({ path }) => path !== CHIP_FAMILY)
      .filter(({ text }) => /"bg-mint-tint border-mint-line text-mint"/.test(text))
      .map(({ path }) => path);
    expect(copies, `use statusToneChip from ${CHIP_FAMILY}`).toEqual([]);
  });
});

/** Every `.tsx` under a directory, tests excluded. */
function* walkTsx(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* walkTsx(path);
    else if (path.endsWith(".tsx") && !path.endsWith(".test.tsx")) yield path;
  }
}

/**
 * "Nothing here yet" is one component.
 *
 * ## What this exists to catch
 *
 * Twelve empty states, and four of them were written by hand. `EmptyState`
 * was left-aligned with no icon; the four were centred, carried a mark, and
 * reserved `min-h-52`, `min-h-56`, `min-h-72` and `min-h-48` — four heights,
 * none of them chosen. Two of them said the same sentence about a search that
 * matched nothing, in two layouts.
 *
 * Most of why they were hand-written is that the component had nowhere to put
 * the mark. It has one now, and an `as` for the heading — a screen whose whole
 * content is "No products yet" belongs in the outline rather than as a styled
 * paragraph, which is the same argument `MonoLabel` records.
 *
 * ## Why left, and asserted
 *
 * Centred is a different rhetorical register: it states "nothing here" as a
 * poster, where the rest of the product states the situation and gives one way
 * forward as a sentence. Nine of the twelve were already left. If the default
 * flips, twelve screens change register at once and nothing else fails.
 */
describe("an empty state is one component", () => {
  const STATES = "src/components/ui/states.tsx";

  it("stays left-aligned, with a slot for the mark that made three hand-roll it", () => {
    const source = readFileSync(STATES, "utf8");
    const body = source.slice(source.indexOf("export function EmptyState"));
    // To the next top-level declaration: the props object closes with `\n}` of
    // its own, so stopping there would read the signature and call it the
    // render.
    const end = body.indexOf("\n/**", 1);
    const render = end === -1 ? body : body.slice(0, end);
    expect(render).toContain("items-start");
    expect(render).not.toContain("text-center");
    // Rendered, not merely accepted: a prop that is destructured and dropped
    // reads the same in a signature and puts the mark nowhere.
    expect(render).toContain("{icon && (");
    // The heading escape hatch. Without it the title is always a `<p>`.
    expect(render).toContain("as: Title");
  });

  it("leaves no centred, height-reserving empty block anywhere else", () => {
    const CENTRED =
      /className="[^"]*(?:min-h-\d+[^"]*justify-center[^"]*text-center|justify-center[^"]*text-center[^"]*min-h-\d+)[^"]*"/;
    const offenders: string[] = [];
    for (const file of walkTsx(join(process.cwd(), "src"))) {
      const path = file.replace(process.cwd() + "/", "");
      if (path === STATES || path.startsWith("src/app/e2e/design-studies/")) continue;
      if (CENTRED.test(readFileSync(file, "utf8"))) offenders.push(path);
    }
    expect(
      offenders,
      `Use EmptyState from ${STATES}. Four hand-written ones is how the ` +
        "product ended up with four reserved heights and two registers.",
    ).toEqual([]);
  });
});

describe("the ground is reachable", () => {
  /**
   * A shell may not paint the page background over the whole viewport.
   *
   * `.vibe-atmosphere` is `position: fixed; z-index: -1`. That puts it above
   * the canvas and below everything in flow — including a block background on
   * a full-height shell root. Every shell carried `bg-app` there, which is the
   * colour `body` already paints, so the product looked correct and the ramp
   * was covered on every signed-in route. Measured on the dashboard: 11.79
   * luminance top and bottom, which is `--color-app` exactly.
   *
   * `bg-app` on a *bounded* element is fine and there are many — a menu panel,
   * a diff well, a chip. The defect is specifically the pair: a viewport-tall
   * root that also fills.
   */
  it("no full-height shell root fills the viewport with bg-app", () => {
    const dir = join(process.cwd(), "src/components/layout");
    const offenders: string[] = [];
    for (const entry of readdirSync(dir)) {
      if (!entry.endsWith(".tsx") || entry.endsWith(".test.tsx")) continue;
      const text = readFileSync(join(dir, entry), "utf8");
      for (const [line] of text.matchAll(/[^\n]*min-h-dvh[^\n]*/g)) {
        if (/\bbg-app\b/.test(line)) offenders.push(`${entry}: ${line.trim().slice(0, 90)}`);
      }
    }
    expect(
      offenders,
      "body already paints --color-app. A viewport-tall element painting it " +
        "again hides the ground, and the glass then has a flat field to refract.",
    ).toEqual([]);
  });
});
