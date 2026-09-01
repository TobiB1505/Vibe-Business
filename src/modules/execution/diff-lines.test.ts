import { describe, expect, it } from "vitest";
import {
  DIFF_LINE_BUDGETS,
  computeLineDiff,
  diffLines,
  splitLines,
  toHunks,
} from "./diff-lines";

/**
 * The line diff (Sprint 0055 §1).
 *
 * The properties worth holding are the ones a reviewer would notice being
 * wrong: an unchanged file produces nothing, a replaced line reads removal
 * first, line numbers point at the right lines, and a file too large to compare
 * degrades to something true rather than something plausible.
 */

const kinds = (text: string[], other: string[]) =>
  diffLines(text, other).map((line) => `${line.kind[0]}:${line.text}`);

describe("splitLines", () => {
  it("does not invent a trailing line for a file that ends with a newline", () => {
    expect(splitLines("a\nb\n")).toEqual(["a", "b"]);
  });

  it("keeps the last line of a file that does not end with a newline", () => {
    expect(splitLines("a\nb")).toEqual(["a", "b"]);
  });

  it("normalises CRLF so a line-ending change is not a whole-file change", () => {
    expect(splitLines("a\r\nb\r\n")).toEqual(splitLines("a\nb\n"));
  });

  it("keeps genuinely blank lines inside a file", () => {
    expect(splitLines("a\n\nb\n")).toEqual(["a", "", "b"]);
  });

  it("treats the empty file as no lines rather than one empty line", () => {
    expect(splitLines("")).toEqual([]);
  });
});

describe("diffLines", () => {
  it("labels an identical file entirely as context", () => {
    expect(kinds(["a", "b"], ["a", "b"])).toEqual(["c:a", "c:b"]);
  });

  it("labels a new file entirely as additions", () => {
    expect(kinds([], ["a", "b"])).toEqual(["a:a", "a:b"]);
  });

  it("labels a deleted file entirely as removals", () => {
    expect(kinds(["a", "b"], [])).toEqual(["r:a", "r:b"]);
  });

  it("reads a replaced line as the removal before the addition", () => {
    expect(kinds(["a"], ["b"])).toEqual(["r:a", "a:b"]);
  });

  it("keeps the unchanged lines around an insertion", () => {
    expect(kinds(["a", "c"], ["a", "b", "c"])).toEqual(["c:a", "a:b", "c:c"]);
  });

  it("finds the common subsequence rather than restating the whole file", () => {
    const result = diffLines(["a", "b", "c", "d"], ["a", "x", "c", "d"]);
    expect(result.filter((line) => line.kind === "context").map((l) => l.text)).toEqual([
      "a",
      "c",
      "d",
    ]);
  });

  it("degrades a file too large to compare into a wholesale replacement", () => {
    const size = Math.ceil(Math.sqrt(DIFF_LINE_BUDGETS.maxCellProduct)) + 10;
    const base = Array.from({ length: size }, (_, i) => `base ${i}`);
    const head = Array.from({ length: size }, (_, i) => `head ${i}`);

    const result = diffLines(base, head);

    // True, just uninformative — and never a partial comparison wearing a
    // complete one's clothes.
    expect(result).toHaveLength(base.length + head.length);
    expect(result.slice(0, base.length).every((line) => line.kind === "removed")).toBe(true);
    expect(result.slice(base.length).every((line) => line.kind === "added")).toBe(true);
  });
});

describe("toHunks", () => {
  it("produces nothing at all for a file with no changes", () => {
    expect(toHunks(diffLines(["a", "b"], ["a", "b"]))).toEqual([]);
  });

  it("bounds the context around a change", () => {
    const base = Array.from({ length: 20 }, (_, i) => `line ${i}`);
    const head = [...base];
    head[10] = "changed";

    const hunks = toHunks(diffLines(base, head), 3);

    expect(hunks).toHaveLength(1);
    // 3 context, the removal, the addition, 3 context.
    expect(hunks[0].lines).toHaveLength(8);
    expect(hunks[0].baseStart).toBe(8);
    expect(hunks[0].headStart).toBe(8);
  });

  it("merges two nearby changes rather than printing shared context twice", () => {
    const base = Array.from({ length: 20 }, (_, i) => `line ${i}`);
    const head = [...base];
    head[5] = "first";
    head[8] = "second";

    const hunks = toHunks(diffLines(base, head), 3);

    expect(hunks).toHaveLength(1);
  });

  it("keeps distant changes apart", () => {
    const base = Array.from({ length: 40 }, (_, i) => `line ${i}`);
    const head = [...base];
    head[2] = "first";
    head[30] = "second";

    expect(toHunks(diffLines(base, head), 3)).toHaveLength(2);
  });

  it("numbers the two sides independently when a line was inserted", () => {
    const base = ["a", "b", "c"];
    const head = ["a", "new", "b", "c"];

    const [hunk] = toHunks(diffLines(base, head), 1);

    expect(hunk.baseStart).toBe(1);
    expect(hunk.headStart).toBe(1);
  });
});

describe("computeLineDiff", () => {
  it("counts additions and removals across the whole file", () => {
    const result = computeLineDiff("a\nb\nc\n", "a\nx\ny\nc\n");

    expect(result.added).toBe(2);
    expect(result.removed).toBe(1);
  });

  it("reports an unchanged file as no hunks and no counts", () => {
    expect(computeLineDiff("a\nb\n", "a\nb\n")).toEqual({ hunks: [], added: 0, removed: 0 });
  });

  it("reports a CRLF-only change as no change at all", () => {
    expect(computeLineDiff("a\nb\n", "a\r\nb\r\n").hunks).toEqual([]);
  });

  it("returns repository text verbatim, never parsed or transformed", () => {
    // Untrusted content reaches the renderer exactly as it was read (rule 25).
    const hostile = '<script>alert(1)</script>\n';
    const [hunk] = computeLineDiff("", hostile).hunks;

    expect(hunk.lines[0]).toEqual({ kind: "added", text: "<script>alert(1)</script>" });
  });
});
