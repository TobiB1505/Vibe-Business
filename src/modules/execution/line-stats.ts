/**
 * How many lines a prepared change added and removed (UI-19).
 *
 * ## Why this is computed and not fetched
 *
 * GitHub's compare endpoint reports the same two numbers, and asking it would
 * mean another authenticated call per change on a route that already makes
 * four. It would also make the count *GitHub's* account of the change rather
 * than Vibe's own — and the agentic path already holds both sides in memory at
 * verification time, which is the same observation the branch write is built
 * from (rule 77).
 *
 * ## Why counts may be stored when content may not
 *
 * Rule 26 forbids persisting a copy of a customer's repository — source files,
 * README bodies, manifests, configs. Two integers per file are derived
 * intelligence, not a copy: nothing about the source can be reconstructed from
 * "eleven lines were added". The content itself stays on the branch.
 *
 * ## Absent rather than wrong
 *
 * A file too large to diff inside the bound returns `null`, and a null is
 * carried all the way to the screen as *nothing shown* — never as zero. Rule 44
 * makes that the rule for unassessable evidence, and a confident "+0 −0" beside
 * a change that rewrote a file is exactly the kind of quiet lie it exists to
 * prevent.
 */

export type LineStats = { added: number; removed: number };

/**
 * The ceiling, in cells of the comparison table.
 *
 * The count is exact, and exactness costs `base × next` steps. Four million is
 * roughly two two-thousand-line files against each other — far above anything
 * this product writes, and small enough that the worst case stays a few
 * milliseconds. Past it the answer is `null`.
 */
export const LINE_STATS_MAX_CELLS = 4_000_000;

/**
 * Split into the lines a diff would compare.
 *
 * A trailing newline ends the last line rather than starting an empty one, so
 * a one-line file reads as one line whether or not it ends in `\n`. `\r\n` is
 * normalized because a repository written on Windows must not report every
 * line as changed.
 */
function lines(text: string): string[] {
  if (text === "") return [];
  const normalized = text.replace(/\r\n/g, "\n");
  const split = normalized.split("\n");
  if (split[split.length - 1] === "") split.pop();
  return split;
}

/**
 * Added and removed line counts between two versions of one file.
 *
 * `base` is `null` for a file that did not exist, which makes every line an
 * addition and nothing a removal — no comparison needed.
 *
 * The count is the one a line diff reports: lines outside the longest common
 * subsequence. A line that moved counts as one removal and one addition, which
 * is what `git diff --numstat` says too.
 */
export function countChangedLines(base: string | null, next: string): LineStats | null {
  const a = base === null ? [] : lines(base);
  const b = lines(next);

  if (a.length === 0) return { added: b.length, removed: 0 };
  if (b.length === 0) return { added: 0, removed: a.length };
  if (a.length * b.length > LINE_STATS_MAX_CELLS) return null;

  /*
   * Longest common subsequence by length only, over a rolling row.
   *
   * The subsequence itself is never needed — only how much of the file
   * survived — so one row of counts is the whole state. That keeps the memory
   * proportional to the shorter file rather than to their product.
   */
  const previous = new Uint32Array(b.length + 1);
  const current = new Uint32Array(b.length + 1);

  for (let i = 0; i < a.length; i += 1) {
    current[0] = 0;
    for (let j = 0; j < b.length; j += 1) {
      current[j + 1] =
        a[i] === b[j]
          ? previous[j] + 1
          : Math.max(previous[j + 1] as number, current[j] as number);
    }
    previous.set(current);
  }

  const common = previous[b.length] as number;
  return { added: b.length - common, removed: a.length - common };
}

/**
 * One change's totals, from its files' own counts.
 *
 * A single unmeasurable file makes the whole total `null`. Summing the rest
 * would produce a number that looks complete and is not, and there is no way
 * for the screen to say "at least this much" without inviting the reader to
 * treat it as the answer.
 */
export function totalChangedLines(
  files: readonly { linesAdded?: number | null; linesRemoved?: number | null }[],
): LineStats | null {
  if (files.length === 0) return null;

  let added = 0;
  let removed = 0;
  for (const file of files) {
    if (
      file.linesAdded === undefined ||
      file.linesAdded === null ||
      file.linesRemoved === undefined ||
      file.linesRemoved === null
    ) {
      return null;
    }
    added += file.linesAdded;
    removed += file.linesRemoved;
  }
  return { added, removed };
}
