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
