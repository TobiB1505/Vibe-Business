/**
 * The formatting ground truth. It is not enforced, and that is deliberate.
 *
 * ## What this file is for
 *
 * There was no formatter and no config, so a tool asked to format anything
 * here used its own defaults — 80 columns — and rewrote whatever it touched.
 * That happened during the audit's third phase: one `prettier --write` over a
 * handful of paths reformatted 84 files at a width nobody had chosen, and had
 * to be reverted wholesale. Nothing was wrong with the tool; there was simply
 * nothing for it to read.
 *
 * So this file exists to answer one question — *what width is this repository
 * written to* — for anyone, human or agent, who formats a file they are
 * already editing. It is the anchor, not a gate.
 *
 * ## Why nothing is reformatted and CI does not check
 *
 * Because the repository is not written to one width. Measured at the best
 * fit, 100, Prettier would still rewrite **719 of 1,214 source files and
 * 16,269 lines** — and in both directions, joining imports in files formatted
 * narrower and splitting lines in files formatted wider. That is a real
 * reformat, not a handful of stragglers.
 *
 * The cost of doing it lands somewhere unusual here: `git blame` on 59% of the
 * source, and every `file:line` citation moving. This repository leans on
 * `file:line` evidence harder than most — the [performance
 * audit](docs/audits/2026-09-01-performance-code-health/README.md) is built
 * out of them and its later phases are still to be worked from it.
 * `.git-blame-ignore-revs` answers the first; nothing answers the second while
 * that document is still being used.
 *
 * The one-time reformat and a `format:check` in CI are worth doing once those
 * phases are finished — in their own commit, with a `.git-blame-ignore-revs`
 * naming it. Until then, `pnpm format` takes a path and refuses to run without
 * one, so it cannot be aimed at the whole repository by accident.
 *
 * ## Why 100
 *
 * Measured, not chosen: 90, 95, 100 and 105 disagree with the existing source
 * in 974, 859, 719 and 735 files. 100 is the closest thing this repository has
 * to a width it already uses.
 *
 * ## What it does not touch
 *
 * Comment content. Prettier does not reflow prose inside a block comment, so
 * the docblocks that carry this repository's reasoning survive formatting
 * intact — 79 of those 16,269 lines are docblock prose, and all of them are
 * indentation. That was the risk worth checking before adding this at all.
 *
 * @type {import("prettier").Config}
 */
const config = {
  printWidth: 100,
};

export default config;
