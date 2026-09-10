import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The ground has to be worn, not merely written.
 *
 * ## What this exists to catch
 *
 * `theme-v2.css` carried a `.vibe-atmosphere` rule and nothing in the
 * repository wore the class. Every unit test passed, the palette test passed,
 * the browser tests passed, and the product drew its glass over a flat field
 * for as long as it took somebody to ask about the background directly.
 *
 * A stylesheet cannot notice that. Nor can a component test, because the
 * component was correct — it did not exist. The only assertion that would have
 * caught it is this one: **every ground class the palette defines is rendered
 * by some component.**
 *
 * ## Why it reads source text
 *
 * The same reason the material tests do. A rendered snapshot of one component
 * proves that component renders; the claim here is about the whole repository,
 * and the only cheap way to ask "does anything at all use this" is to look.
 */

const CSS = readFileSync("src/app/theme-v2.css", "utf8");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (path.endsWith(".tsx") && !path.endsWith(".test.tsx")) out.push(path);
  }
  return out;
}

const TSX = sourceFiles("src").map((path) => ({ path, text: readFileSync(path, "utf8") }));

/** Every `.vibe-*` class the palette styles as a fixed ground layer. */
const GROUND_CLASSES = [...CSS.matchAll(/\.(vibe-(?:atmosphere|grain)[\w-]*)\s*\{/g)].map(
  (match) => match[1],
);

describe("the ground is connected, not just defined", () => {
  it("finds the ground classes in the palette at all", () => {
    // If this drops to zero the assertions below stop being assertions —
    // the same failure mode the class was in when it was dead.
    expect(GROUND_CLASSES.length).toBeGreaterThanOrEqual(3);
    expect(GROUND_CLASSES).toContain("vibe-atmosphere");
    expect(GROUND_CLASSES).toContain("vibe-atmosphere-field");
    expect(GROUND_CLASSES).toContain("vibe-grain");
  });

  it.each(GROUND_CLASSES)("%s is rendered by a component", (className) => {
    const wearers = TSX.filter(({ text }) => text.includes(`"${className}"`));
    expect(
      wearers.map(({ path }) => path),
      `${className} is styled in theme-v2.css and no .tsx renders it. ` +
        "A ground nothing wears is a ground the product does not have.",
    ).not.toHaveLength(0);
  });

  it("puts the ground everywhere, once, above the tree it sits under", () => {
    const layout = readFileSync("src/app/layout.tsx", "utf8");
    expect(layout).toContain("<Atmosphere />");
    // Before the children, so it is behind them in paint order as well as in
    // `z-index` — a ground rendered after the content is a ground on top of it.
    expect(layout.indexOf("<Atmosphere />")).toBeLessThan(layout.indexOf("{children}"));
  });

  it("keeps the contained field opt-in rather than global", () => {
    const wearers = TSX.filter(({ text }) => text.includes("<AtmosphereField />"));
    // Exactly the screens that earned it. If this grows, the split has
    // quietly become "every route", which is treatment 1 with extra steps.
    expect(wearers.map(({ path }) => path).sort()).toEqual(
      [
        // The fixture composes Nova Home's parts by hand, so it has to mirror
        // the opt-in or no browser test ever sees the field.
        "src/app/e2e/[scenario]/page.tsx",
        "src/app/app/projects/[projectId]/nova/nova-home.tsx",
      ].sort(),
    );
  });

  it("leaves the ground inert", () => {
    const source = readFileSync("src/components/layout/atmosphere.tsx", "utf8");
    // Every element it renders, and every one announced to nobody. Counted
    // as JSX rather than as occurrences of the word: the docblock says
    // `aria-hidden` too, and a test that counts prose fails on an edit to a
    // comment.
    const elements = [...source.matchAll(/<div\s([^>]*)\/>/g)].map((match) => match[1]);
    expect(elements).toHaveLength(3);
    for (const attributes of elements) {
      expect(attributes).toContain("aria-hidden");
      expect(attributes).toContain("vibe-");
    }
    // A ground that takes a pointer or a tab stop is furniture in the way of
    // the product.
    expect(source).not.toContain("onClick");
    expect(source).not.toContain("tabIndex");
  });

  it("scopes every ground rule to the second palette", () => {
    for (const className of GROUND_CLASSES) {
      const rule = new RegExp(`([^\\n]*)\\.${className}\\s*\\{`, "g");
      for (const [, prefix] of CSS.matchAll(rule)) {
        expect(prefix, `.${className} must not style v1`).toContain('[data-vibe="v2"]');
      }
    }
  });
});
