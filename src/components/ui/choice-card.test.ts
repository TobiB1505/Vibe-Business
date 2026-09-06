import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * There is one way to pick one thing.
 *
 * ## What this exists to catch
 *
 * Not a broken control — all six worked. The defect was that the product had
 * *two conventions for the same question*: three screens hid the input and
 * drew a card with a mint dot, three rendered the platform's radio with
 * `accent-mint` on a bordered row. Which one a founder saw depended on which
 * screen they were on, and nobody had decided that.
 *
 * A component alone does not settle it, because the next screen can write its
 * own `<input type="radio">` next to whatever is nearby — which is precisely
 * how there came to be six. So a raw radio outside this file fails here.
 *
 * ## Why the mark is asserted, not just the component
 *
 * Because the decision was specifically "the card, with the dot it has today".
 * The card's border carries a *comparative* signal — it reads as selected only
 * against the unselected ones beside it. The dot is absolute. Quietly dropping
 * it later would leave every test passing and the one screen where a founder
 * commits to an action with a weaker answer to "which did I pick".
 */

const CARD = "src/components/ui/choice-card.tsx";

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (path.endsWith(".tsx") && !path.endsWith(".test.tsx")) out.push(path);
  }
  return out;
}

/**
 * The studies are excluded for the reason they are excluded in
 * `field.test.ts`: a study renders the replaced thing beside the replacement
 * on purpose, and the fixture route is a 404 in production.
 */
const STUDIES = "src/app/e2e/design-studies/";

/**
 * The segmented control is radios too, and is not a choice.
 *
 * Same mechanism, opposite job: it filters a list rather than committing to
 * one of a few authored alternatives, so it has no card, no dot and no
 * consequence. It uses real radios for the same reason `ChoiceCard` does —
 * grouping, arrow keys and the announcement come from the browser — and that
 * is worth one named line here rather than a second hand-rolled keyboard
 * implementation.
 */
const NOT_CHOICES = ["src/components/ui/list-controls.tsx"];

const TSX = sourceFiles("src")
  .filter((path) => path !== CARD && !path.startsWith(STUDIES))
  .map((path) => ({ path, text: readFileSync(path, "utf8") }));

const SOURCE = readFileSync(CARD, "utf8");

describe("picking one thing looks the same everywhere", () => {
  it("leaves no hand-written radio in the product", () => {
    const offenders = TSX.filter(
      ({ path, text }) => text.includes('type="radio"') && !NOT_CHOICES.includes(path),
    ).map(({ path }) => path);
    expect(
      offenders,
      `A radio is written by hand here. Use ChoiceCard from ${CARD} — ` +
        "six hand-written ones is how the product ended up with two conventions.",
    ).toEqual([]);
  });

  it("keeps the mark that says selected without needing a comparison", () => {
    // The ring is always drawn; the dot is drawn only when checked. Both
    // halves matter — a ring with no dot says nothing, and a dot with no ring
    // has nowhere to be absent from.
    expect(SOURCE).toContain("rounded-full border");
    expect(SOURCE).toMatch(/checked && <span className="bg-mint size-2\.5 rounded-full" \/>/);
  });

  it("keeps the named exception honest", () => {
    for (const path of NOT_CHOICES) {
      const file = TSX.find((entry) => entry.path === path);
      expect(file?.text, `${path} is listed as an exception and does not exist`).toBeDefined();
      expect(file?.text, `${path} no longer writes a raw radio — drop it`).toContain(
        'type="radio"',
      );
    }
  });

  it("draws the focus ring on the part that can be seen", () => {
    // The input is `sr-only`, so the browser's own outline lands on a 1px
    // clipped box. Before this, tabbing through three choices moved nothing
    // on screen.
    expect(SOURCE).toContain("sr-only");
    expect(SOURCE).toContain("has-[:focus-visible]:ring");
  });
});
