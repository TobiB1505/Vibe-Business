import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Gold is the Credit, and metal is never flat.
 *
 * Introducing gold put a colour next to amber, and amber is spoken for:
 * DESIGN.md reserves it for incomplete and waiting states and `StatusPill`
 * paints `waiting` with it. A flat gold disc would be a warning dot.
 *
 * The rule that keeps them apart is about material rather than hue — **a
 * status is always a flat fill, metal always has a ramp and a rim** — and a
 * rule that lives only in a docblock is a rule until somebody is in a hurry.
 * These are the two halves of it that can be checked cheaply.
 */

const COIN = "src/components/ui/credit-coin.tsx";

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path)) out.push(path);
  }
  return out;
}

describe("gold belongs to the Credit alone", () => {
  it("is spent in no component but the coin", () => {
    const spenders = sourceFiles("src")
      .filter((path) => path !== COIN)
      .filter((path) =>
        // The token, or a utility built from it — not the word, which turns
        // up as "gold standard" in prose this guard has no business reading.
        /--color-gold\b|\b(?:text|bg|border|from|to|via|fill|stroke)-gold\b/.test(
          readFileSync(path, "utf8"),
        ),
      );
    expect(
      spenders,
      "Gold is the Credit and nothing else. A second thing in gold is a second " +
        "thing that looks like money, and the amber it sits beside already " +
        "means something.",
    ).toEqual([]);
  });

  it("draws the coin with a ramp and a rim rather than a fill", () => {
    const source = readFileSync(COIN, "utf8");
    // The material is the whole argument: this is what makes a coin
    // unmistakable beside an amber status at any size.
    expect(source).toContain("<linearGradient");
    expect(source).toContain("--color-gold-rim");
    expect(source).toContain("--color-gold-light");
  });

  it("gives every coin its own gradient ids", () => {
    const source = readFileSync(COIN, "utf8");
    // Gradient ids are document-scoped. Two coins sharing one id renders the
    // first lit and the rest flat — which would be a list of prices where one
    // is metal and eleven are amber dots.
    expect(source).toContain("useId()");
  });

  it("keeps the coin out of the accessibility tree", () => {
    const source = readFileSync(COIN, "utf8");
    // The number beside it is the information. "coin, 35 Credits" reads the
    // decoration twice.
    expect(source).toContain("aria-hidden");
  });
});
