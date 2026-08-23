import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sparklineBreakCaption } from "./sparkline";

const source = readFileSync(join(process.cwd(), "src/components/ui/sparkline.tsx"), "utf8");

/**
 * The file with its prose removed.
 *
 * The comments in `sparkline.tsx` legitimately name every piece of chart
 * furniture the component refuses to draw, so a substring match over the whole
 * file would fail on the documentation that explains the rule. Asserted
 * against the code, the rule survives someone deleting the comment.
 */
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

/**
 * What the Business Signal chart is allowed to say (CORE-6).
 *
 * Two things are asserted here and neither is styling. The caption is the only
 * sentence a broken line gets, and the shape of the chart is the difference
 * between a small movement looking small and a rubric change looking like
 * growth.
 */

describe("the caption for a broken line", () => {
  it("says nothing at all when the line is whole", () => {
    // A founder whose audits are all comparable must not read a caveat about
    // something that did not happen to them.
    expect(sparklineBreakCaption(0)).toBeNull();
  });

  it("names what changed as Vibe's scoring, not the business", () => {
    const caption = sparklineBreakCaption(1);

    expect(caption).toContain("changed how it scores");
    expect(caption).toContain("not comparable");
  });

  it("never suggests the reading moved", () => {
    for (const count of [1, 2, 5]) {
      const caption = sparklineBreakCaption(count) ?? "";
      for (const forbidden of ["improved", "declined", "increase", "decrease", "worse", "better"]) {
        expect(caption.toLowerCase(), `caption for ${count} breaks says ${forbidden}`).not.toContain(
          forbidden,
        );
      }
    }
  });

  it("counts the breaks once there is more than one", () => {
    expect(sparklineBreakCaption(3)).toContain("3 times");
  });
});

describe("the chart is a shape, not a diagram", () => {
  /**
   * The reference draws a `0/25/50/75/100` scale and horizontal rules. On the
   * calmest screen in the product that is furniture around a line, and the
   * density rule this sprint is built on says it does not ship.
   */
  it("draws no axis, gridline, legend or tooltip", () => {
    for (const furniture of ["<text", "gridline", "axis", "legend", "tooltip", "onMouseEnter"]) {
      expect(code, `sparkline.tsx contains ${furniture}`).not.toContain(furniture);
    }
  });

  /**
   * The load-bearing one. Auto-scaling to the data would make 39, 43, 45 fill
   * the whole height — and with no axis drawn, nothing on screen would tell
   * the reader that the span is six points rather than a hundred. Fixed to
   * 0–100, a six-point move looks like a six-point move.
   */
  it("fixes the vertical scale to the full range rather than to the data", () => {
    expect(code).toContain("(clamped / 100)");
    for (const derived of ["Math.max(...", "Math.min(...", "reduce("]) {
      expect(code, `sparkline.tsx derives its scale with ${derived}`).not.toContain(derived);
    }
  });

  it("clamps rather than trusting a score to be in range", () => {
    expect(code).toContain("Math.max(0, Math.min(score, 100))");
  });
});
