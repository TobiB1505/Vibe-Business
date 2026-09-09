import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A number that is the subject comes from one place.
 *
 * ## What this exists to catch
 *
 * Not a broken render — all ten drew a number. The defect was that between
 * them they had **eight sizes, four tracking values and two weights**, and the
 * same object was two of them: a business-map node's score was 20px in the
 * grid and 21.6px in the detail view.
 *
 * Worse, four of the ten never set `leading-none`. A digit has no descender,
 * so an 18px figure sat in a 22.5px line box reserving space nothing in it can
 * reach. That is invisible in a screenshot until something draws the edge of
 * the line, which is why it survived ten reviews.
 *
 * ## Why the tokens are asserted, not just the component
 *
 * Because the whole argument for M2 was that a figure's leading and tracking
 * belong in the palette rather than in a call site. A `--text-figure-*` that
 * loses `line-height: 1` puts the descender bug back in every figure at once,
 * with every test still passing.
 */

const CSS = readFileSync("src/app/globals.css", "utf8");
const V2 = readFileSync("src/app/theme-v2.css", "utf8");
const SOURCE = readFileSync("src/components/ui/figure.tsx", "utf8");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (path.endsWith(".tsx") && !path.endsWith(".test.tsx")) out.push(path);
  }
  return out;
}

/** A study draws the replaced thing beside the replacement, on purpose. */
const STUDIES = "src/app/e2e/design-studies/";

const TIERS = ["figure-sm", "figure", "figure-lg"] as const;

describe("a figure is one object with three sizes", () => {
  it.each([...TIERS])("%s carries line-height 1 in both palettes", (tier) => {
    // The property four of the ten call sites forgot. If a token loses it the
    // bug comes back everywhere at once and nothing else fails.
    for (const [name, css] of [
      ["globals.css", CSS],
      ["theme-v2.css", V2],
    ] as const) {
      expect(css, `--text-${tier} missing from ${name}`).toContain(`--text-${tier}:`);
      expect(css, `--text-${tier} must set line-height 1 in ${name}`).toMatch(
        new RegExp(`--text-${tier}--line-height:\\s*1;`),
      );
    }
  });

  it("tightens the tracking as the figure grows", () => {
    // The relationship the hand-written values did not have: -0.04em appeared
    // at 21.6px, at 30px and at 50.4px, and then 52px took -0.06em. Optical
    // tracking is a function of size, and a scale is where that lives.
    const tracking = TIERS.map((tier) => {
      const match = CSS.match(new RegExp(`--text-${tier}--letter-spacing:\\s*(-?[0-9.]+)em;`));
      expect(match, `--text-${tier} has no letter-spacing`).not.toBeNull();
      return Number.parseFloat(match![1]);
    });
    expect(tracking[0]).toBeGreaterThan(tracking[1]);
    expect(tracking[1]).toBeGreaterThan(tracking[2]);
  });

  it("always sets tabular-nums, so the digits do not shift as a value changes", () => {
    // A score animating from 68 to 72 with proportional figures re-lays out
    // the line under it. Every tier, from one place.
    const classes = SOURCE.slice(SOURCE.indexOf("export function figureClasses"));
    expect(classes.slice(0, classes.indexOf("\n}"))).toContain("tabular-nums");
  });

  it("keeps one weight, because the tracking was chosen for one", () => {
    // Five of the ten were bold and five semibold, with no pattern — the same
    // tier appeared as both. At 52px a heavier weight wants tighter tracking,
    // and the tracking now belongs to the token.
    //
    // Read from the code rather than the file: the docblock above says
    // `font-bold` while explaining why it is gone, and a test that counts
    // prose fails on an edit to a comment.
    const code = SOURCE.split("*/").slice(1).join("*/");
    expect(code).toContain("font-semibold");
    expect(code).not.toContain("font-bold");
  });

  it("leaves no figure sized by hand", () => {
    const offenders: string[] = [];
    for (const path of sourceFiles("src")) {
      if (path.startsWith(STUDIES) || path === "src/components/ui/figure.tsx") continue;
      const text = readFileSync(path, "utf8");
      for (const [line] of text.matchAll(/[^\n]*tabular-nums[^\n]*/g)) {
        // A figure is a number set at a *display* size. An inline number in a
        // row inherits its size and is not one — that is `Metric`'s job, and
        // it is used seventy-three times. So is a 10px mono counter: an
        // arbitrary size only counts here at or above the smallest figure
        // step, which is 1.25rem.
        const arbitrary = line.match(/text-\[([0-9.]+)(rem|px)\]/);
        const big = arbitrary
          ? Number.parseFloat(arbitrary[1]) / (arbitrary[2] === "px" ? 16 : 1) >= 1.25
          : false;
        const named = /\btext-(?:lg|xl|2xl|3xl|4xl|display|hero|headline)\b/.test(line);
        if (big || named) offenders.push(`${path}: ${line.trim().slice(0, 80)}`);
      }
    }
    expect(
      offenders,
      "A number the screen is about takes Figure or figureClasses. " +
        "Ten hand-written ones is how the product ended up with eight sizes.",
    ).toEqual([]);
  });

  it("is worn, not merely written", () => {
    // The `.vibe-atmosphere` failure: a component that exists and renders
    // nowhere is a decision the product does not actually have.
    //
    // Seven, down from eight in UI-33: the products page had a row of metric
    // tiles counting the list directly beneath it, and they went. A floor is
    // the point of this test — it catches a component going dark — so the
    // number moves when a deliberate deletion moves it, and never quietly.
    const wearers = sourceFiles("src").filter(
      (path) =>
        !path.startsWith(STUDIES) &&
        path !== "src/components/ui/figure.tsx" &&
        /\bFigure\b|figureClasses/.test(readFileSync(path, "utf8")),
    );
    expect(wearers.length).toBeGreaterThanOrEqual(7);
  });
});
