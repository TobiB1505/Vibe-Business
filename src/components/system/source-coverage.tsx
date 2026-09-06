import Link from "next/link";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { formatTimestamp } from "@/lib/utils/format-datetime";
import { cn } from "@/lib/utils/cn";
import type { SourceCoverage, SourceCoverageState } from "@/modules/provenance/source-coverage";
import { firstCoverageGap } from "@/modules/provenance/source-coverage";
import { CostDisclosure, type CostBalance } from "./cost-disclosure";

/**
 * What Vibe's understanding rests on (audit R6, sourcing spec S8).
 *
 * ## What it was adapted from, and what was left behind
 *
 * The row is 21st.dev's *Integrations 02* (22082), which the specification
 * names for one reason: `mark · name · connected badge or connect button` is
 * structurally the same row as `source · state · remedy`. What did not come
 * across is everything that made it a directory of vendors — the favicons
 * fetched from Google, the "Connect" primary button, the card-in-a-card frame.
 * Vibe's sources are not services with logos. They are four things a founder
 * already understands, named in words: your code, your public product, your
 * signed-in product, what you told Vibe.
 *
 * ## What this adds that the pattern has no place for
 *
 * A source is not connected or unconnected. It was read completely, or read
 * and not finished, or attempted and failed, or never attempted — and when it
 * stopped short, the founder is owed the reason, the amount that *was* read,
 * and when. Those three are the difference between "Vibe doesn't know" and
 * "Vibe couldn't find out", and a badge cannot carry them.
 *
 * ## Two densities, one truth
 *
 * `list` is the full account, on My Product. `strip` is one line under a
 * priced control — what the reading about to be paid for rests on — and it
 * leads with the first gap, because the three sources that are fine are not
 * what changes the decision.
 */

const STATE_TONE: Record<SourceCoverageState, StatusTone> = {
  ready: "success",
  partial: "waiting",
  failed: "problem",
  none: "neutral",
  running: "active",
};

const STATE_WORD: Record<SourceCoverageState, string> = {
  ready: "Read",
  partial: "Partly read",
  failed: "Couldn't read",
  none: "Not read",
  running: "Reading",
};

/** "12 files" / "4 pages", and nothing at all when nothing was counted. */
function measuredPhrase(measured: SourceCoverage["measured"]): string | null {
  const parts: string[] = [];
  if (typeof measured.files === "number") {
    parts.push(measured.files === 1 ? "1 file" : `${measured.files} files`);
  }
  if (typeof measured.pages === "number") {
    parts.push(measured.pages === 1 ? "1 page" : `${measured.pages} pages`);
  }
  return parts.length === 0 ? null : parts.join(" · ");
}

export function SourceCoverageList({
  sources,
  balance,
  className,
}: {
  sources: readonly SourceCoverage[];
  balance?: CostBalance | null;
  className?: string;
}) {
  return (
    <ul className={cn("flex flex-col gap-2", className)} data-testid="source-coverage">
      {sources.map((source) => {
        const measured = measuredPhrase(source.measured);
        const read = formatTimestamp(source.at);

        return (
          <li
            key={source.source}
            data-source={source.source}
            data-state={source.state}
            className="border-line-1 bg-surface-2 rounded-well flex flex-col gap-2 border p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <h3 className="text-fg text-ui font-semibold">{source.label}</h3>
              <StatusPill tone={STATE_TONE[source.state]}>{STATE_WORD[source.state]}</StatusPill>
            </div>

            <p className="text-fg-prose max-w-[62ch] text-sm leading-relaxed">{source.detail}</p>

            {/*
              Why it stopped short. Already worded by the module that owns the
              vocabulary — never an enum, and never a sentence written here.
            */}
            {source.reasons.map((reason) => (
              <p key={reason} className="text-fg-muted max-w-[62ch] text-ui leading-relaxed">
                {reason}
              </p>
            ))}

            {/*
              What was measured, and when. Absent rather than zero: "0 files"
              would read as a finding about the repository instead of an
              absence of measurement.
            */}
            {(measured || read) && (
              <p className="text-fg-meta text-ui tabular-nums">
                {[measured, read && `read ${read}`].filter(Boolean).join(" · ")}
              </p>
            )}

            {source.remedy && (
              <div className="flex flex-col gap-1">
                <Link
                  href={source.remedy.href}
                  className="text-fg-secondary hover:text-fg w-fit rounded-sm text-sm underline underline-offset-4 transition-interactive"
                >
                  {source.remedy.label}
                </Link>
                <CostDisclosure operation={source.remedy.operation} balance={balance} />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * One line: what this rests on, and the first thing missing from it.
 *
 * A paragraph rather than a list, because it is a sentence — and the gap is
 * never truncated, however narrow the viewport gets. If the line has to wrap
 * to two, it wraps.
 */
/**
 * The label as it reads mid-sentence.
 *
 * "Rests on code ✓ · public product ✓" — the possessive is already carried by
 * "rests on", and only the first letter is lowered, so "What you told Vibe"
 * keeps its Vibe.
 */
function stripLabel(label: string): string {
  const withoutPossessive = label.replace(/^Your /, "");
  return withoutPossessive.charAt(0).toLowerCase() + withoutPossessive.slice(1);
}

export function SourceCoverageStrip({
  sources,
  className,
}: {
  sources: readonly SourceCoverage[];
  className?: string;
}) {
  const gap = firstCoverageGap(sources);

  return (
    <p
      className={cn("text-fg-muted flex flex-wrap items-baseline gap-x-2 text-ui", className)}
      data-testid="source-coverage-strip"
      data-gap={gap?.source ?? "none"}
    >
      <span>Rests on</span>
      {sources.map((source, index) => (
        <span key={source.source} className="whitespace-nowrap">
          {stripLabel(source.label)}
          <span className={cn("ml-1", source.state === "ready" ? "text-mint" : "text-fg-meta")}>
            {source.state === "ready" ? "✓" : "—"}
          </span>
          {index < sources.length - 1 && <span aria-hidden> ·</span>}
        </span>
      ))}
      {gap?.remedy && (
        <Link
          href={gap.remedy.href}
          className="text-fg-secondary hover:text-fg rounded-sm underline underline-offset-4 transition-interactive"
        >
          {gap.remedy.label}
        </Link>
      )}
    </p>
  );
}
