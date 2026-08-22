import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { UNPRICED_MESSAGE, costLabel } from "./cost-disclosure";

/**
 * Unpriced is not free (UI-8 §4).
 *
 * This is the assertion the whole component exists to protect. Deep Scan and
 * agentic execution are deliberately absent from `RETAIL_OPERATION_KINDS`
 * because neither has an approved price — and a disclosure panel that rendered
 * them as "Free", or as "0 Credits", would make a promise the billing system
 * never made, on the screen where a founder decides whether to spend money.
 *
 * The design this came from printed "60 Credits" beside "Prepare this change".
 * No such price exists. That is the specific mistake these tests refuse.
 */

describe("costLabel", () => {
  it("gives a priced operation the price the reservation will charge", () => {
    expect(costLabel("business_audit")).toBe("35 Credits");
    expect(costLabel("opportunity_generation")).toBe("20 Credits");
    expect(costLabel("action_plan")).toBe("15 Credits");
  });

  /*
   * Free renders no line at all, for the reason `CreditPrice` records: a zero
   * beside a button invites the question of when it might stop being zero.
   */
  it("says nothing about a free operation", () => {
    expect(costLabel("product_understanding")).toBeNull();
  });

  it("says an unpriced action has no price, in words", () => {
    expect(costLabel("unpriced")).toBe(UNPRICED_MESSAGE);
  });

  /*
   * The three ways this could go wrong, named individually so a failure says
   * which promise was broken rather than just "string mismatch".
   */
  it("never renders an unpriced action as free", () => {
    expect(costLabel("unpriced")).not.toMatch(/\bfree\b/i);
  });

  it("never renders an unpriced action as a number", () => {
    expect(costLabel("unpriced")).not.toMatch(/\d/);
  });

  it("never renders an unpriced action as zero credits", () => {
    expect(costLabel("unpriced")).not.toMatch(/\b0\b/);
  });
});

/**
 * The component may not reintroduce a price of its own.
 *
 * `costLabel` is the only route to a number, and it reads the same policy the
 * charge does. A literal "Credits" figure written into the markup would be a
 * second copy of the price, free to drift from the one actually charged — which
 * is exactly what `CreditPrice` was built to prevent.
 */
describe("the panel holds no price of its own", () => {
  const source = readFileSync(join(process.cwd(), "src/components/ui/cost-disclosure.tsx"), "utf8");

  it("writes no credit figure into the markup", () => {
    expect(source).not.toMatch(/\d+\s*Credits/);
  });

  /*
   * Deliberately not asserted here: that the word "free" is absent from the
   * file. It is all over the docblock, correctly — explaining why free and
   * unpriced are different cases is most of the reason this component exists.
   * A source scan cannot tell prose from markup, and `costLabel("unpriced")`
   * above already refuses the only string a founder would ever read.
   */
});
