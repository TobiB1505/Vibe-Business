import { readFileSync } from "node:fs";
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
  const GLOBAL_EXEMPT = "vibe-surface-card";

  it.each(HOOKS.filter((hook) => hook !== GLOBAL_EXEMPT))(
    "%s carries no rule outside the v2 scope",
    (hook) => {
      const leaked = rules(GLOBALS)
        .map((rule) => rule.selector)
        .filter((selector) => selector.includes(hook));
      expect(leaked, `${hook} is styled in globals.css, so v1 is not unchanged`).toEqual([]);
    },
  );

  it("styles the card in globals for the blur and nothing else", () => {
    const global = rules(GLOBALS).filter((rule) => rule.selector === `.${GLOBAL_EXEMPT}`);
    expect(global).toHaveLength(1);
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
