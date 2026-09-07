import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The Move's invariants, asserted against its source.
 *
 * ## Why a source test rather than a rendered one
 *
 * Every claim below is about *what the markup is allowed to contain* — which
 * classes are conditional on which props, and which slot a state may write
 * into. A rendering harness would let all of them pass while the surface was
 * quietly written a second time, because two copies of the same classes render
 * the same picture on the day they are copied.
 *
 * ## What is being protected
 *
 * `study-move` compared three designs for this control in all four states the
 * product produces, and B was chosen: dark surface, one lit edge, mint as line
 * and label, and the price *inside* the control. Then the product needed two
 * states no sheet had to draw — busy and disabled — and that is exactly the
 * moment a chosen design turns back into three slightly different controls.
 */

const SOURCE = readFileSync(join(process.cwd(), "src/components/nova/nova-move.tsx"), "utf8");

/** Comments quote the rules the assertions forbid. What is left is what renders. */
const RENDERED = SOURCE.replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/^\s*\/\/.*$/gm, " ");

describe("the Move is one surface", () => {
  /**
   * A picture, a button and a link, and only one of them describes the
   * surface. The lab draws the span and the product presses the button; if
   * either carried its own class list they would drift, and the drift would
   * be invisible — both would still look like a Move.
   */
  it("gives all three elements their classes from one function", () => {
    for (const element of ["<span", "<button", "<Link"]) {
      expect(RENDERED, element).toContain(`${element}`);
    }
    expect(RENDERED.match(/moveSurface\(/g)?.length).toBeGreaterThanOrEqual(4);
    // The literal classes appear once: inside `moveSurface`.
    expect(RENDERED.match(/move-lit relative/g)).toHaveLength(1);
  });

  /**
   * Geometry does not depend on state.
   *
   * A Move that changed size when its price disappeared, or shrank while it
   * was starting, would reflow under the cursor that just pressed it — which
   * is the reserved-geometry obligation every animation in this product
   * carries. The mechanism is that state cannot reach the function: it takes
   * the layout and a caller's extra classes, and nothing else.
   */
  it("keeps state out of the surface function", () => {
    const signature = RENDERED.slice(
      RENDERED.indexOf("function moveSurface("),
      RENDERED.indexOf("{", RENDERED.indexOf("function moveSurface(")),
    );
    /* A slice that missed would let every assertion below pass on an empty
       string, which is the way a sweep like this stops testing anything. */
    expect(signature).toContain("layout");
    for (const state of ["busy", "disabled", "status", "operation", "balance"]) {
      expect(signature, state).not.toContain(state);
    }
  });
});

describe("the Move's states", () => {
  /**
   * The verb is what was pressed. A control that renamed itself mid-press
   * leaves a founder unsure what they started — so the status word goes into
   * the right-hand slot, where the price was, and the price is the thing that
   * yields: it was a claim about a decision that has now been made.
   */
  it("puts the busy word in the cost slot, never in the label", () => {
    expect(RENDERED).toMatch(/status=\{busy \? busyLabel : undefined\}/);
    expect(RENDERED).not.toMatch(/\{busy \?[^}]*\}\s*<\/span>\s*\{?\s*$/m);
    expect(RENDERED).toMatch(/label=\{label\}/);
  });

  /**
   * A disabled control still reads as a control. The border stays and the
   * label drops to the disabled ramp, which is the same rule `Button` holds —
   * the failure it prevents is a control that becomes an invisible gap.
   */
  it("keeps the border on a disabled Move", () => {
    expect(RENDERED).toContain("disabled:pointer-events-none");
    expect(RENDERED).toContain("disabled:border-line-2");
    expect(RENDERED).not.toMatch(/disabled:border-(0|none)/);
    expect(RENDERED).toContain("text-fg-disabled");
  });

  /**
   * Only one thing is ever on the right. A price beside a "leaves the product"
   * note would be two claims about one press, and the four states the study
   * enumerated are mutually exclusive by construction rather than by care.
   */
  it("resolves the right-hand slot to exactly one thing", () => {
    const face = RENDERED.slice(
      RENDERED.indexOf("function MoveFace("),
      RENDERED.indexOf("export function NovaMove("),
    );
    expect(face).toContain("move-lit-band");
    expect(face).toMatch(/status \?[\s\S]*?: leavesTo \?[\s\S]*?: \(/);
    expect(face.match(/<CostDisclosure/g)).toHaveLength(1);
  });
});

describe("the Move states no price of its own", () => {
  /**
   * `CostDisclosure` resolves a retail kind to a figure, and it is the only
   * thing that does — including for the states where the answer is "nothing":
   * a free operation says so, and `agent_execution` stays silent because its
   * cost depends on a pricing class this control does not hold.
   */
  it("formats no credits by hand", () => {
    expect(RENDERED).not.toMatch(/Credits`|formatCredits|\bUSD\b|\$\d/);
  });
});
