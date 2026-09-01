/**
 * The line diff itself (Sprint 0055 §1).
 *
 * ## Why this is written rather than installed
 *
 * `package.json` carries no diff library, and that is not an oversight — a
 * dependency is infrastructure, and infrastructure is a recorded decision
 * (CLAUDE.md rule 3). A line diff is a well-understood algorithm that fits in
 * one file, has no runtime, no transitive tree, and no way to reach the network
 * or the filesystem. Installing one to avoid writing one would trade a hundred
 * auditable lines for a supply-chain surface, on the exact path that renders
 * untrusted customer source.
 *
 * ## What it computes, and what it deliberately does not
 *
 * Lines, not words. A word-level diff inside a changed line is a real
 * improvement to *reading* a diff and it is a different problem: it needs a
 * second algorithm, a second renderer, and a decision about how to show a line
 * that is both added and removed. Lines are what `git diff` shows by default and
 * what a reviewer already knows how to read.
 *
 * Nothing here knows what a file *means*. It never parses, never highlights,
 * never evaluates. Repository content arrives as two strings and leaves as
 * labelled strings — which is what makes rule 25 hold at this layer rather than
 * being a promise the renderer has to keep alone.
 */

/** How a line relates to the two sides being compared. */
export type DiffLineKind = "context" | "added" | "removed";

export type DiffLine = {
  kind: DiffLineKind;
  /** The line's text, without its newline. Untrusted; rendered as text only. */
  text: string;
};

/**
 * One run of changes plus its surrounding context.
 *
 * `baseStart` and `headStart` are 1-based line numbers, so the renderer can
 * print a gutter without recounting. A hunk that is entirely additions still
 * carries a `baseStart`: it is where the addition lands.
 */
export type DiffHunk = {
  baseStart: number;
  headStart: number;
  lines: DiffLine[];
};

export const DIFF_LINE_BUDGETS = {
  /** Unchanged lines kept on each side of a change. `git diff`'s own default. */
  contextLines: 3,
  /**
   * The ceiling on the LCS table.
   *
   * The algorithm below is O(n·m) in time and O(m) in space. At 500 lines a
   * side — `DIFF_LIMITS.maxLinesPerFile` — that is a quarter of a million
   * comparisons, which is nothing. The product is bounded anyway rather than
   * inferred from the caller's limits, because "the caller already clipped it"
   * is exactly the assumption that stops being true when a second caller
   * appears (rule 27).
   */
  maxCellProduct: 500 * 500,
} as const;

/**
 * Split that does not invent a trailing line.
 *
 * `"a\n".split("\n")` is `["a", ""]`, and that empty string is not a line — it
 * is the newline that ended the last one. Left in, every file that ends the
 * normal way grows a phantom final line, and a change to the real last line
 * renders one line too low.
 *
 * `\r` is stripped so a CRLF file does not read as though every single line
 * changed when compared against an LF one. The carriage returns are not
 * restored: this output is for reading, never for writing back.
 */
export function splitLines(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

type Op = { kind: DiffLineKind; text: string };

/**
 * The LCS length table for two line arrays, one row per base line.
 *
 * Classic dynamic programming. The whole table is retained because the
 * backtrack below reads it in both directions, so this is O(n·m) in space as
 * well as time — bounded by `maxCellProduct`, which is why that ceiling exists
 * and is enforced before this is called rather than inside it.
 *
 * `Uint32Array` rather than `number[]`: the values are small non-negative
 * integers and a typed row is one contiguous allocation instead of 501 boxed
 * ones.
 */
function lcsLengths(base: readonly string[], head: readonly string[]): Uint32Array[] {
  const rows: Uint32Array[] = [new Uint32Array(head.length + 1)];

  for (let i = 0; i < base.length; i += 1) {
    const previous = rows[i];
    const current = new Uint32Array(head.length + 1);

    for (let j = 0; j < head.length; j += 1) {
      current[j + 1] =
        base[i] === head[j]
          ? previous[j] + 1
          : Math.max(previous[j + 1], current[j]);
    }

    rows.push(current);
  }

  return rows;
}

/**
 * Every line of both sides, labelled, in reading order.
 *
 * Degrades rather than refuses when the table would be too large: the file
 * becomes a wholesale replacement — every base line removed, then every head
 * line added. That is a true diff, just an uninformative one, and it is the
 * honest answer for a file this function cannot afford to compare properly. It
 * is never silently truncated into something that looks complete (rule 27).
 */
export function diffLines(base: readonly string[], head: readonly string[]): DiffLine[] {
  if (base.length === 0 && head.length === 0) return [];
  if (base.length === 0) return head.map((text) => ({ kind: "added" as const, text }));
  if (head.length === 0) return base.map((text) => ({ kind: "removed" as const, text }));

  if (base.length * head.length > DIFF_LINE_BUDGETS.maxCellProduct) {
    return [
      ...base.map((text) => ({ kind: "removed" as const, text })),
      ...head.map((text) => ({ kind: "added" as const, text })),
    ];
  }

  const rows = lcsLengths(base, head);
  const ops: Op[] = [];

  let i = base.length;
  let j = head.length;

  /*
   * Walked backwards and reversed at the end, because the table is built
   * forwards. The tie between "removed" and "added" is broken towards removals
   * first, so a replaced line reads `- old` then `+ new` — the order every diff
   * tool prints and the order a reader expects.
   */
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && base[i - 1] === head[j - 1]) {
      ops.push({ kind: "context", text: base[i - 1] });
      i -= 1;
      j -= 1;
      continue;
    }

    if (j > 0 && (i === 0 || rows[i][j - 1] >= rows[i - 1][j])) {
      ops.push({ kind: "added", text: head[j - 1] });
      j -= 1;
      continue;
    }

    ops.push({ kind: "removed", text: base[i - 1] });
    i -= 1;
  }

  return ops.reverse();
}

/**
 * The labelled lines, grouped into hunks with bounded context.
 *
 * A file with no changes produces no hunks at all — not one empty hunk, and not
 * the whole file as context. "Nothing changed here" is a thing the caller has to
 * be able to detect, and an empty array is how it says so.
 */
export function toHunks(
  lines: readonly DiffLine[],
  contextLines: number = DIFF_LINE_BUDGETS.contextLines,
): DiffHunk[] {
  const changedIndexes = lines
    .map((line, index) => (line.kind === "context" ? -1 : index))
    .filter((index) => index >= 0);

  if (changedIndexes.length === 0) return [];

  /*
   * Ranges first, merged second. Two changes four lines apart with three lines
   * of context on each side produce overlapping windows, and emitting them as
   * two hunks would print the lines between them twice.
   */
  const ranges: { start: number; end: number }[] = [];
  for (const index of changedIndexes) {
    const start = Math.max(0, index - contextLines);
    const end = Math.min(lines.length - 1, index + contextLines);
    const last = ranges[ranges.length - 1];

    if (last && start <= last.end + 1) last.end = Math.max(last.end, end);
    else ranges.push({ start, end });
  }

  // Line numbers are accumulated across the whole file, so each hunk can state
  // where it begins on both sides without a second pass.
  const baseNumbers: number[] = [];
  const headNumbers: number[] = [];
  let baseLine = 1;
  let headLine = 1;

  for (const line of lines) {
    baseNumbers.push(baseLine);
    headNumbers.push(headLine);
    if (line.kind !== "added") baseLine += 1;
    if (line.kind !== "removed") headLine += 1;
  }

  return ranges.map((range) => ({
    baseStart: baseNumbers[range.start],
    headStart: headNumbers[range.start],
    lines: lines.slice(range.start, range.end + 1).map((line) => ({ ...line })),
  }));
}

export type LineDiff = {
  hunks: DiffHunk[];
  added: number;
  removed: number;
};

/**
 * The whole comparison for one file's two versions.
 *
 * The counts are taken from the full labelled list rather than from the hunks,
 * so `+X/−Y` describes the file even when the hunks were clipped for display.
 */
export function computeLineDiff(
  baseText: string,
  headText: string,
  contextLines: number = DIFF_LINE_BUDGETS.contextLines,
): LineDiff {
  const lines = diffLines(splitLines(baseText), splitLines(headText));

  return {
    hunks: toHunks(lines, contextLines),
    added: lines.filter((line) => line.kind === "added").length,
    removed: lines.filter((line) => line.kind === "removed").length,
  };
}
