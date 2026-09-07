import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The working agreement's index describes the working agreement.
 *
 * ## Why an index needs a test at all
 *
 * [CLAUDE.md](../../../CLAUDE.md) is eighty-five numbered rules in the order they were written.
 * That order is permanent on purpose — rule 83 forbids renumbering, because a
 * rule number is cited from ADRs, sprint records, docblocks and commit
 * messages, and moving one would silently invalidate every citation. The cost
 * is that the list has no shape: nothing groups the four rules about spending
 * money, and nothing tells a reader which eleven govern running a customer's
 * code.
 *
 * The index at the top of that file supplies the shape without moving
 * anything. But an index is a second description of the same thing, and this
 * repository has now been bitten four times by exactly that: two descriptions,
 * no test between them, and one of them quietly stops being true. A rule added
 * as number 86 and never indexed would be invisible to the reader who trusts
 * the table — which is the whole point of having one.
 *
 * So: every rule appears in the index exactly once, and the index names no
 * rule that does not exist.
 */

const CLAUDE_MD = readFileSync(join(process.cwd(), "CLAUDE.md"), "utf8");

/** The numbered rules themselves — a line that starts with `<n>. `. */
const RULES = [...CLAUDE_MD.matchAll(/^(\d+)\. /gm)].map((match) => Number(match[1]));

/**
 * The rule numbers cited by the index table.
 *
 * Read from the table's second column only. Taking every number in the file
 * would sweep up rule text — dates, budgets, ADR numbers — and make the test
 * pass for the wrong reason.
 */
const INDEXED = [...CLAUDE_MD.matchAll(/^\| \*\*.+?\*\*.*?\|([\d, ]+)\|$/gm)].flatMap((row) =>
  row[1]!
    .split(",")
    .map((entry) => Number(entry.trim()))
    .filter((value) => Number.isFinite(value)),
);

describe("the CLAUDE.md rule index", () => {
  it("finds both the rules and the table", () => {
    // A regex that matched nothing would make every assertion below pass while
    // checking nothing.
    expect(RULES.length).toBeGreaterThan(80);
    expect(INDEXED.length).toBeGreaterThan(80);
  });

  it("numbers the rules 1..n with no gap and no repeat", () => {
    expect(RULES).toEqual(Array.from({ length: RULES.length }, (_, i) => i + 1));
  });

  it("indexes every rule exactly once", () => {
    const counts = new Map<number, number>();
    for (const rule of INDEXED) counts.set(rule, (counts.get(rule) ?? 0) + 1);

    const missing = RULES.filter((rule) => !counts.has(rule));
    const twice = [...counts.entries()].filter(([, count]) => count > 1).map(([rule]) => rule);

    expect({ missing, twice }).toEqual({ missing: [], twice: [] });
  });

  it("names no rule that does not exist", () => {
    const highest = RULES.length;
    expect(INDEXED.filter((rule) => rule < 1 || rule > highest)).toEqual([]);
  });
});
