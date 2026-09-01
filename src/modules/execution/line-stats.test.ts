import { describe, expect, it } from "vitest";
import { LINE_STATS_MAX_CELLS, countChangedLines, totalChangedLines } from "./line-stats";

/**
 * The two numbers under a prepared change (UI-19).
 *
 * ## Why this is tested at all
 *
 * Because it is arithmetic whose wrongness is invisible. "+312 −45" beside a
 * change looks equally authoritative whether or not it is true, and there is no
 * screen state that reveals a miscount. The only defence is that the counts
 * match what a line diff reports, case by case.
 */

const text = (...rows: string[]) => rows.join("\n");

describe("counting one file's changed lines", () => {
  it("counts every line of a new file as added", () => {
    expect(countChangedLines(null, text("a", "b", "c"))).toEqual({ added: 3, removed: 0 });
  });

  it("counts nothing for a file that did not change", () => {
    const same = text("import x", "", "export default x");
    expect(countChangedLines(same, same)).toEqual({ added: 0, removed: 0 });
  });

  it("counts an emptied file as pure removal", () => {
    expect(countChangedLines(text("a", "b"), "")).toEqual({ added: 0, removed: 2 });
  });

  it("counts an inserted line as one addition and nothing removed", () => {
    expect(countChangedLines(text("a", "b"), text("a", "new", "b"))).toEqual({
      added: 1,
      removed: 0,
    });
  });

  it("counts a deleted line as one removal and nothing added", () => {
    expect(countChangedLines(text("a", "gone", "b"), text("a", "b"))).toEqual({
      added: 0,
      removed: 1,
    });
  });

  /** What `git diff --numstat` reports: a replaced line is both. */
  it("counts a replaced line as one of each", () => {
    expect(countChangedLines(text("a", "old", "c"), text("a", "new", "c"))).toEqual({
      added: 1,
      removed: 1,
    });
  });

  /**
   * The property that makes this a diff rather than a subtraction. Comparing
   * lengths would report nothing at all here, because both files have three
   * lines and none of them are in the same place.
   */
  it("sees a reordering as changed lines rather than as no change", () => {
    const stats = countChangedLines(text("a", "b", "c"), text("c", "b", "a"));
    expect(stats).not.toEqual({ added: 0, removed: 0 });
    expect(stats).toEqual({ added: 2, removed: 2 });
  });

  it("does not report every line as changed for a file written on Windows", () => {
    expect(countChangedLines("a\nb\nc\n", "a\r\nb\r\nc\r\n")).toEqual({ added: 0, removed: 0 });
  });

  /** A trailing newline ends the last line; it does not begin an empty one. */
  it("reads a one-line file as one line, with or without a trailing newline", () => {
    expect(countChangedLines(null, "only")).toEqual({ added: 1, removed: 0 });
    expect(countChangedLines(null, "only\n")).toEqual({ added: 1, removed: 0 });
  });

  it("counts a blank line inside a file", () => {
    expect(countChangedLines(text("a", "c"), text("a", "", "c"))).toEqual({
      added: 1,
      removed: 0,
    });
  });
});

describe("the bound", () => {
  /**
   * Absent, not zero, and not a wrong number.
   *
   * The whole point of the ceiling is that exactness has a cost. Returning
   * anything but `null` past it would mean the screen showed a count nobody
   * computed (rule 44).
   */
  it("declines to count rather than guessing when a file is too large", () => {
    const size = Math.ceil(Math.sqrt(LINE_STATS_MAX_CELLS)) + 1;
    const base = Array.from({ length: size }, (_, i) => `base ${i}`).join("\n");
    const next = Array.from({ length: size }, (_, i) => `next ${i}`).join("\n");

    expect(countChangedLines(base, next)).toBeNull();
  });

  /** But a huge *new* file still counts, because nothing is compared. */
  it("still counts a new file of any size", () => {
    const size = Math.ceil(Math.sqrt(LINE_STATS_MAX_CELLS)) + 1;
    const next = Array.from({ length: size }, (_, i) => `line ${i}`).join("\n");

    expect(countChangedLines(null, next)).toEqual({ added: size, removed: 0 });
  });
});

describe("a change's totals", () => {
  it("sums the files it was given", () => {
    expect(
      totalChangedLines([
        { linesAdded: 10, linesRemoved: 2 },
        { linesAdded: 5, linesRemoved: 0 },
      ]),
    ).toEqual({ added: 15, removed: 2 });
  });

  /**
   * One unmeasurable file makes the total unmeasurable.
   *
   * Summing the rest produces a number that looks complete and is not, and the
   * screen has no way to say "at least this much" without the reader taking it
   * as the answer.
   */
  it("reports nothing at all when one file could not be counted", () => {
    expect(
      totalChangedLines([{ linesAdded: 10, linesRemoved: 2 }, { linesAdded: null }]),
    ).toBeNull();

    expect(totalChangedLines([{ linesAdded: 10, linesRemoved: 2 }, {}])).toBeNull();
  });

  /** A change with no files has no total, rather than a total of zero. */
  it("reports nothing for an empty file list", () => {
    expect(totalChangedLines([])).toBeNull();
  });
});
