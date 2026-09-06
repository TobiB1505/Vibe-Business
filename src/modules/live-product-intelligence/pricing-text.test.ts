import { describe, expect, it } from "vitest";
import { observePrices, parseWrittenAmount } from "./pricing-text";

/**
 * Reading a price off a page, and refusing to.
 *
 * The stated principle for the declared path applies harder here: a misparsed
 * price reaches a founder as a statement about their own business. This source
 * is weaker to begin with — a glyph and a number that happened to sit next to
 * each other — so what it declines to read matters more than what it reads.
 */

describe("parseWrittenAmount", () => {
  it.each([
    ["29", 29],
    ["29.99", 29.99],
    ["29,99", 29.99],
    ["1,299", 1299],
    ["1.299", 1299],
    ["1.299,00", 1299],
    ["1,299.00", 1299],
    ["0", 0],
  ])("reads %s as %s", (raw, expected) => {
    expect(parseWrittenAmount(raw)).toBe(expected);
  });

  /**
   * One digit after the separator is the ambiguous case, and it is common.
   * `29,9` is twenty-nine point nine to one reader and something else to
   * another; a price shown as a fact has to be one reading, not the likelier
   * of two.
   */
  it.each(["29,9", "29.9", "1,23456", "", "abc", "29..99", "29,,99"])(
    "refuses %s rather than guessing",
    (raw) => {
      expect(parseWrittenAmount(raw)).toBeNull();
    },
  );
});

describe("observePrices", () => {
  it("reads a symbol before the amount", () => {
    expect(observePrices("<p>Pro plan $29 per month</p>")).toEqual([
      { amount: 29, currencyToken: "$", period: "month" },
    ]);
  });

  it("reads a symbol after the amount", () => {
    expect(observePrices("<p>Pro 29,99 € pro Monat</p>")).toEqual([
      { amount: 29.99, currencyToken: "€", period: "month" },
    ]);
  });

  it.each([
    ["$29/mo", "month"],
    ["$290/yr", "year"],
    ["$9 per week", "week"],
    ["$1 a day", "day"],
    ["$499 one-time", "one_time"],
    ["£19 jährlich", "year"],
  ])("reads the period from %s", (text, period) => {
    expect(observePrices(`<p>${text}</p>`)[0]?.period).toBe(period);
  });

  it("leaves the period null when the page does not state one", () => {
    expect(observePrices("<p>Starting at $29</p>")[0]?.period).toBeNull();
  });

  /**
   * `$` is not USD. It is also CAD, AUD, NZD and more, and a page writing
   * `$29` has not said which. Mapping the glyph to a code would invent the
   * half of the fact the page withheld.
   */
  it("records the token as written rather than a currency code", () => {
    expect(observePrices("<p>$29</p>")[0]?.currencyToken).toBe("$");
    expect(observePrices("<p>USD 29</p>")[0]?.currencyToken).toBe("USD");
  });

  /**
   * An element boundary is not a digit boundary.
   *
   * `<span>29</span><span>€</span>` renders as "29 €", but the markup has no
   * space in it. Replacing tags with a space rather than deleting them is what
   * keeps two unrelated numbers in adjacent cells from fusing into one price.
   */
  it("does not fuse numbers across an element boundary", () => {
    const observed = observePrices("<td>10</td><td>29</td>");
    expect(observed).toEqual([]);
  });

  it("deduplicates the same price seen twice", () => {
    expect(observePrices("<p>$29 a month</p><p>$29 a month</p>")).toHaveLength(1);
  });

  it("caps how many it will record", () => {
    const many = Array.from({ length: 40 }, (_, i) => `<p>$${i + 1}</p>`).join("");
    expect(observePrices(many).length).toBeLessThanOrEqual(12);
  });

  it("finds nothing in a page with no prices", () => {
    expect(observePrices("<h1>Acme</h1><p>Ship faster with Acme.</p>")).toEqual([]);
  });
});

/**
 * The shape every pricing card actually has.
 *
 * An amount and its period are separate elements — a large "€19" beside a
 * small "/ month" — so the extracted text carries a space after the slash.
 * Every lead-in here consumed its own trailing whitespace except the slash,
 * which is why `€19/month` was read and `€19 / month` was not, and why Vibe
 * Business's own three prices were recorded with no period attached. That
 * absence became a large part of an audit finding stating that nothing on the
 * page marked the numbers as prices.
 */
describe("a period separated from its amount by a slash and a space", () => {
  it.each([
    ["€19 / month", "month"],
    ["€19 /month", "month"],
    ["€19/month", "month"],
    ["€19 / mo", "month"],
    ["€49 / year", "year"],
    ["€5 / week", "week"],
  ])("reads %j as %s", (text, expected) => {
    expect(observePrices(`Plan ${text} and some more copy`)[0]?.period).toBe(expected);
  });

  /** The spellings that already worked, kept working. */
  it.each([
    ["€19 per month", "month"],
    ["€19 monthly", "month"],
    ["€19 pro Monat", "month"],
  ])("still reads %j as %s", (text, expected) => {
    expect(observePrices(`Plan ${text} and some more copy`)[0]?.period).toBe(expected);
  });

  /** A slash that is not a period is still not a period. */
  it("does not invent a period from an unrelated slash", () => {
    expect(observePrices("Plan €19 / includes everything")[0]?.period).toBeNull();
  });
});
