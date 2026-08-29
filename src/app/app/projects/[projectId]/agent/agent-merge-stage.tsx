"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { buttonClasses } from "@/components/ui/button";
import { MonoLabel } from "@/components/ui/typography";
import { cn } from "@/lib/utils/cn";

/**
 * Stage five — review and merge (UI-19, artboard 2e).
 *
 * ## Three columns, three questions
 *
 * What the change costs, which files it touches, and the change itself as
 * GitHub will receive it. That is the design's composition and it is the right
 * one: a founder deciding whether to merge is asking those three things in
 * that order.
 *
 * ## What the button says, and why it is not what the mockup drew
 *
 * The reference draws "Merge & deploy" over "the changes will be deployed
 * automatically". Vibe does neither. It fast-forwards the default branch to one
 * exact approved commit and reads it back, and it calls no deployment provider
 * — CLAUDE.md rule 74 says `merged` means that one sentence and never
 * "deployed". The design's own author note raises this and offers the swap.
 *
 * The opposite claim would be just as wrong, so the consequence line does not
 * say "nothing happens" either: moving a default branch can trigger the
 * customer's own CI/CD, and they are entitled to know that before the click.
 *
 * ## Numbers that are not here
 *
 * The source-code diff snippet and pull-request conversation counts are not
 * here: Vibe does not open a pull request or persist customer source for this
 * screen. Line totals and per-file counts appear only where preparation
 * measured both sides of the change; an unmeasured file stays unmeasured.
 */

export type MergeFile = {
  path: string;
  /**
   * What this file gained and lost.
   *
   * Optional, because not every change can be measured: the counts come from
   * comparing both sides at preparation time, and a change written without
   * reading what it replaced has none. Absent renders as nothing beside the
   * path, never as `+0 −0`.
   */
  added?: number;
  removed?: number;
};

export type MergeSummary = {
  filesChanged: number;
  linesAdded?: number;
  linesRemoved?: number;
  /** From the validation run, when one exists. */
  tests?: "passing" | "failing" | "not_run";
  build?: "successful" | "failed" | "not_run";
};

const VERDICT = {
  passing: { label: "All passing", tone: "text-mint" },
  failing: { label: "Failing", tone: "text-coral" },
  not_run: { label: "Not run", tone: "text-fg-muted" },
  successful: { label: "Successful", tone: "text-mint" },
  failed: { label: "Failed", tone: "text-coral" },
} as const;

function extensionOf(path: string): string {
  const name = path.split("/").pop() ?? path;
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "?" : name.slice(dot + 1).toUpperCase();
}

export function AgentMergeStage({
  summary,
  files,
  allChecksPassed,
  branchName,
  baseBranch,
  commitSha,
  compareUrl,
  backHref,
  decision,
  canMerge,
}: {
  summary: MergeSummary;
  files: readonly MergeFile[];
  allChecksPassed: boolean;
  branchName: string;
  baseBranch: string;
  commitSha: string | null;
  compareUrl: string | null;
  /** Return to the Move that created this task. */
  backHref: string;
  /** Canonical approval and merge controls for this exact artifact. */
  decision?: React.ReactNode;
  canMerge: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const measuredLines =
    summary.linesAdded !== undefined && summary.linesRemoved !== undefined
      ? summary.linesAdded + summary.linesRemoved
      : null;
  const addedShare =
    measuredLines !== null && measuredLines > 0
      ? Math.round((summary.linesAdded! / measuredLines) * 100)
      : null;

  return (
    <div className="flex min-w-0 flex-col gap-7" data-testid="agent-merge">
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div className="flex min-w-0 flex-col gap-2">
          <MonoLabel className="text-mint">Stage 5 of 5</MonoLabel>
          <h3 className="text-fg text-2xl leading-tight font-bold tracking-[-0.03em]">
            Review and merge with your GitHub repository
          </h3>
          <p className="text-fg-muted max-w-[52ch] text-[0.9375rem] leading-relaxed">
            Review the changes and merge when you&rsquo;re ready.
          </p>
        </div>
        {canMerge && (
          <span className="border-mint-line bg-mint-tint text-mint flex-none rounded-full border px-3 py-1 text-xs font-semibold">
            Ready to merge
          </span>
        )}
      </div>

      <div className="grid min-w-0 gap-7 xl:grid-cols-[18.75rem_minmax(0,1.15fr)_minmax(20rem,1fr)]">
        <section className="flex min-w-0 flex-col gap-5">
          <MonoLabel as="h4" className="text-fg-secondary">
            Change summary
          </MonoLabel>
          <dl className="flex flex-col text-sm">
            <div className="border-line-2 flex items-baseline justify-between gap-3 border-b py-3">
              <dt className="text-fg-muted">Files changed</dt>
              <dd className="text-fg font-mono">{summary.filesChanged}</dd>
            </div>
            {summary.linesAdded !== undefined && (
              <div className="border-line-2 flex items-baseline justify-between gap-3 border-b py-3">
                <dt className="text-fg-muted">Lines added</dt>
                <dd className="text-mint font-mono">+{summary.linesAdded}</dd>
              </div>
            )}
            {summary.linesRemoved !== undefined && (
              <div className="border-line-2 flex items-baseline justify-between gap-3 border-b py-3">
                <dt className="text-fg-muted">Lines removed</dt>
                <dd className="text-coral font-mono">−{summary.linesRemoved}</dd>
              </div>
            )}
            {summary.tests !== undefined && (
              <div className="border-line-2 flex items-baseline justify-between gap-3 border-b py-3">
                <dt className="text-fg-muted">Tests</dt>
                <dd className={cn("font-medium", VERDICT[summary.tests].tone)}>
                  {VERDICT[summary.tests].label}
                </dd>
              </div>
            )}
            {summary.build !== undefined && (
              <div className="flex items-baseline justify-between gap-3 py-3">
                <dt className="text-fg-muted">Build</dt>
                <dd className={cn("font-medium", VERDICT[summary.build].tone)}>
                  {VERDICT[summary.build].label}
                </dd>
              </div>
            )}
          </dl>

          {allChecksPassed && (
            <div className="rounded-well border-mint-line bg-mint-tint/40 flex gap-3 border p-4">
              <svg
                viewBox="0 0 24 24"
                width="19"
                height="19"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-mint mt-px flex-none"
                aria-hidden="true"
              >
                <path d="M12 3.2 5 6v5.6c0 4 2.9 7.6 7 9.2 4.1-1.6 7-5.2 7-9.2V6l-7-2.8Z" />
                <path d="m9 12.2 2.2 2.2 4-4.4" />
              </svg>
              <span className="flex flex-col gap-1">
                <span className="text-fg-body text-[0.9375rem] font-semibold">
                  All checks passed
                </span>
                {/*
                  Deliberately narrower than the mockup's "safe to merge".
                  A passing validation means a profile's commands exited zero
                  in an isolated VM — never that a change is safe, correct or
                  production ready (rule 66).
                */}
                <span className="text-fg-muted text-sm leading-relaxed">
                  Every check Vibe ran on this change exited cleanly.
                </span>
              </span>
            </div>
          )}
        </section>

        <section className="border-line-3 bg-surface-3 rounded-panel flex min-w-0 flex-col overflow-hidden border">
          <div className="border-line-3 flex items-baseline justify-between gap-3 border-b px-4.5 py-4">
            <MonoLabel as="h4" className="text-fg-secondary">
              Files changed ({summary.filesChanged})
            </MonoLabel>
            {compareUrl !== null && (
              <Link
                href={compareUrl}
                target="_blank"
                rel="noreferrer"
                className="text-mint hover:text-mint-hover text-[0.8125rem] underline underline-offset-4"
              >
                View all files
              </Link>
            )}
          </div>
          <ul className="flex flex-col divide-y divide-[var(--color-line-1)]">
            {files.map((file, index) => (
              <motion.li
                key={file.path}
                className="flex items-center gap-3 px-4.5 py-2.5"
                initial={reduceMotion ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: 0.35,
                  ease: [0.2, 0.7, 0.2, 1],
                  delay: reduceMotion ? 0 : Math.min(index, 8) * 0.05,
                }}
              >
                <span className="border-line-2 bg-well text-fg-meta flex-none rounded border px-1.5 py-0.5 font-mono text-[0.625rem]">
                  {extensionOf(file.path)}
                </span>
                <span className="text-fg-body min-w-0 flex-1 truncate font-mono text-[0.8125rem]">
                  {file.path}
                </span>
                {file.added !== undefined && (
                  <span className="text-mint flex-none font-mono text-[0.75rem]">
                    +{file.added}
                  </span>
                )}
                {file.removed !== undefined && (
                  <span className="text-coral flex-none font-mono text-[0.75rem]">
                    −{file.removed}
                  </span>
                )}
              </motion.li>
            ))}
          </ul>
        </section>

        <section className="rounded-panel border-line-3 bg-surface-3 flex min-w-0 flex-col gap-4 border p-5">
          <div className="flex items-center justify-between gap-3">
            <MonoLabel as="h4" className="text-fg-secondary">
              The change on GitHub
            </MonoLabel>
            <svg
              viewBox="0 0 24 24"
              width="19"
              height="19"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-fg-secondary"
              aria-hidden="true"
            >
              <circle cx="7" cy="5" r="2" />
              <circle cx="17" cy="7" r="2" />
              <circle cx="7" cy="19" r="2" />
              <path d="M7 7v10M9 11h3a5 5 0 0 0 5-2" />
            </svg>
          </div>
          <p className="text-fg text-[1.0625rem] leading-snug font-semibold tracking-[-0.02em] text-pretty">
            {branchName}
          </p>
          <p className="text-fg-muted text-sm leading-relaxed">
            Vibe prepared one exact change for{" "}
            <span className="border-line-2 bg-well text-fg-body rounded-full border px-2 py-0.5 font-mono text-[0.6875rem]">
              {baseBranch}
            </span>
            .
          </p>
          {commitSha !== null && (
            <div className="border-line-3 flex items-center justify-between gap-3 border-y py-3">
              <MonoLabel>Prepared commit</MonoLabel>
              <span className="text-fg-body font-mono text-[0.8125rem]">
                {commitSha.slice(0, 12)}
              </span>
            </div>
          )}
          {addedShare !== null && (
            <div className="flex flex-col gap-2.5">
              <div className="flex items-center justify-between gap-3 font-mono text-[0.6875rem]">
                <span className="text-mint">+{summary.linesAdded} additions</span>
                <span className="text-coral">−{summary.linesRemoved} deletions</span>
              </div>
              <div className="bg-line-track flex h-1.5 overflow-hidden rounded-full">
                <motion.span
                  className="bg-mint h-full"
                  initial={reduceMotion ? false : { scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ duration: 0.7, ease: [0.2, 0.7, 0.2, 1] }}
                  style={{ width: `${addedShare}%`, transformOrigin: "left" }}
                />
                <motion.span
                  className="bg-coral h-full"
                  initial={reduceMotion ? false : { scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{
                    duration: 0.7,
                    delay: reduceMotion ? 0 : 0.18,
                    ease: [0.2, 0.7, 0.2, 1],
                  }}
                  style={{ width: `${100 - addedShare}%`, transformOrigin: "left" }}
                />
              </div>
            </div>
          )}
          {files[0] !== undefined && (
            <div className="rounded-well border-line-2 bg-well overflow-hidden border">
              <div className="border-line-2 flex items-center justify-between gap-3 border-b px-3 py-2.5">
                <span className="text-fg-prose min-w-0 truncate font-mono text-[0.6875rem]">
                  {files[0].path}
                </span>
                <span className="flex-none font-mono text-[0.625rem]">
                  {files[0].added !== undefined && (
                    <span className="text-mint">+{files[0].added} </span>
                  )}
                  {files[0].removed !== undefined && (
                    <span className="text-coral">−{files[0].removed}</span>
                  )}
                </span>
              </div>
              <p className="text-fg-meta px-3 py-4 text-xs leading-relaxed">
                Open the comparison to inspect the exact source diff on GitHub.
              </p>
            </div>
          )}
          {compareUrl !== null && (
            <Link
              href={compareUrl}
              target="_blank"
              rel="noreferrer"
              className={cn(
                buttonClasses({ variant: "secondary", size: "sm" }),
                "justify-center",
              )}
            >
              Open the comparison on GitHub
            </Link>
          )}
        </section>
      </div>

      {decision}

      <div className="border-line-2 flex flex-wrap items-center justify-between gap-5 border-t pt-6">
        <div className="flex min-w-0 max-w-[52ch] flex-col gap-1.5">
          <span className="text-fg-body text-[0.9375rem] font-semibold">What happens next?</span>
          {/*
            Neither of the two easy lies. Vibe does not deploy — it moves the
            default branch and reads it back. But "nothing happens" is equally
            untrue, because moving that branch can trigger the customer's own
            pipeline, and they are entitled to know before the click.
          */}
          <span className="text-fg-muted text-sm leading-relaxed">
            Merging moves {baseBranch} to this commit. Vibe does not deploy anything — but if your
            repository builds or releases from {baseBranch}, merging will start it.
          </span>
        </div>

        <Link href={backHref} className={buttonClasses({ variant: "secondary" })}>
          Back to this Move
        </Link>
      </div>

      <p className="text-fg-meta text-center text-xs">
        You&rsquo;re in control. Nothing is merged without your approval.
      </p>
    </div>
  );
}
