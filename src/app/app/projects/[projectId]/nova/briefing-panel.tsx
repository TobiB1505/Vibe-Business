import Link from "next/link";

import { projectSectionHref, type WorkspaceSectionId } from "@/components/layout/project-shell";
import { Surface, Well } from "@/components/ui/surface";
import { MonoLabel } from "@/components/ui/typography";
import { statusToneText, type StatusTone } from "@/components/ui/status-pill";
import { formatDate } from "@/lib/utils/format-datetime";
import { cn } from "@/lib/utils/cn";
import type { ProvenanceRemedy, ProvenanceState } from "@/modules/provenance/chain";
import {
  BRIEFING_GOAL_PREFIX,
  BRIEFING_HEADING,
  BRIEFING_SOURCE_NOTE,
  type BriefingRow,
  type BriefingView,
} from "@/modules/nova/briefing/view";

/**
 * The briefing — where a founder stands, in one panel.
 *
 * ## The gap it fills
 *
 * Every other surface in the product answers one question about one document:
 * the audit screen shows the audit, the plan shows the plan, My Product shows
 * the scan. Nothing said "given all of it, here is the situation", and the
 * founder was left to hold five screens in their head and work out for
 * themselves that the audit they were about to re-run rested on a scan from
 * three weeks ago.
 *
 * ## Why it is a list of facts with one sentence under it
 *
 * The same argument the provenance panel makes: a summary a founder cannot
 * check is worth less than the facts it summarises. So the chain is drawn with
 * real dates, and Nova's read sits *beneath* it — visibly derived from what is
 * above, rather than replacing it.
 *
 * ## What it does not do
 *
 * Re-rank anything, restate the Focus Card's sentence, or offer more than one
 * thing to do. `buildBriefingView` decided the read; the Focus Card above owns
 * what is open, and this only points at it.
 */
const REMEDY_SECTION: Record<ProvenanceRemedy, WorkspaceSectionId> = {
  product_scan: "my-product",
  business_audit: "business-audit",
  opportunity_generation: "action-plan",
};

/**
 * How a link's state reads in colour.
 *
 * `missing` is deliberately neutral rather than a problem. A project that has
 * not been scanned yet has nothing wrong with it, and painting five grey rows
 * amber on a founder's first visit would make an alarm out of a beginning.
 */
const STATE_TONE: Record<ProvenanceState, StatusTone> = {
  current: "neutral",
  outdated: "waiting",
  missing: "neutral",
};

/** What the right-hand column says when there is no age, because nothing ran. */
const NOT_PRODUCED = "not yet";

function EvidenceRow({ row }: { row: BriefingRow }) {
  const produced = formatDate(row.producedAt);

  return (
    <li
      className={cn(
        "border-line-2 border-t py-2 first:border-t-0 first:pt-0",
        row.subject && "border-l-mint -ml-3 border-l-2 pl-3",
      )}
      data-briefing-link={row.kind}
      data-briefing-state={row.state}
      data-briefing-subject={row.subject ? "" : undefined}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
        <span className="text-fg-prose text-sm">{row.label}</span>
        <span className="flex items-baseline gap-3">
          {/*
            The exact date, computed on every draw from the timestamp — which
            is what lets the words beside it stay a bucket. A number in a
            sentence Nova stores would be a lie with a delay on it; a number
            the screen renders cannot be.
          */}
          <span className="text-fg-meta font-mono text-[0.65rem] tabular-nums">
            {produced ?? "—"}
          </span>
          <span className={cn("text-xs", statusToneText(STATE_TONE[row.state]))}>
            {row.age ?? NOT_PRODUCED}
          </span>
        </span>
      </div>

      {row.reason !== null && (
        <p className="text-fg-muted mt-1 text-xs leading-relaxed">{row.reason}</p>
      )}
    </li>
  );
}

/**
 * Nova's read, and the one thing she offers.
 *
 * One offer, at the top of the chain, for the reason the provenance panel
 * gives: everything below a broken link is derived from it, so replacing the
 * third while the first is wrong buys a fresh document built on the same
 * mistake. A row of buttons would invite exactly that.
 */
function Read({ view, projectId }: { view: BriefingView; projectId: string }) {
  const read = view.read;

  return (
    <Well className="flex flex-col gap-2">
      <p className="text-fg-body text-sm leading-relaxed">{read.sentence}</p>

      {read.kind === "repair" && read.because !== null && (
        <p className="text-fg-muted text-xs leading-relaxed">{read.because}</p>
      )}

      {read.kind === "age" && (
        <p className="text-fg-muted text-xs leading-relaxed">{read.advice}</p>
      )}

      {read.kind === "move" && (
        <>
          {/* The engine's own words, quoted. Nova never rewrites a Move. */}
          <p className="text-fg text-sm font-semibold">{read.title}</p>
          <p className="text-fg-muted text-xs leading-relaxed">{read.whyNow}</p>
        </>
      )}

      {(read.kind === "repair" || read.kind === "age") && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5">
          <Link
            href={projectSectionHref(projectId, REMEDY_SECTION[read.remedy])}
            className="text-fg-prose hover:text-fg text-sm underline underline-offset-4 transition-interactive"
            data-testid="briefing-remedy"
          >
            {read.remedyLabel}
          </Link>
          {read.free && <MonoLabel>Free</MonoLabel>}
        </div>
      )}
    </Well>
  );
}

export function BriefingPanel({
  view,
  projectId,
  className,
}: {
  view: BriefingView;
  projectId: string;
  className?: string;
}) {
  return (
    <Surface
      as="section"
      aria-labelledby="nova-briefing"
      level="section"
      padding="md"
      className={cn("flex flex-col gap-3", className)}
      data-testid="briefing-panel"
      data-briefing-read={view.read.kind}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <MonoLabel as="h2" id="nova-briefing">
          {BRIEFING_HEADING}
        </MonoLabel>
        {/*
          Addressed, when Vibe has been told what to call them. No placeholder
          and no "there" — an account that has not given a name is a normal
          state, and the panel simply names the product instead.
        */}
        <span className="text-fg-meta text-xs">
          {view.founderName ? `${view.founderName} · ${view.projectName}` : view.projectName}
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <p className="text-fg-body text-sm">{view.standing}</p>
        {view.goalLabel !== null && (
          <p className="text-fg-muted text-xs">
            {BRIEFING_GOAL_PREFIX} · <span className="text-fg-prose">{view.goalLabel}</span>
          </p>
        )}
      </div>

      <ul className="mt-1">
        {view.rows.map((row) => (
          <EvidenceRow key={row.kind} row={row} />
        ))}
      </ul>

      <Read view={view} projectId={projectId} />

      {/*
        What Nova is, on every render rather than only when something is wrong.
        A note that appears only in trouble teaches a founder that silence
        means live monitoring, which is the opposite of true.
      */}
      <p className="text-fg-meta text-[0.7rem] leading-relaxed">{BRIEFING_SOURCE_NOTE}</p>
    </Surface>
  );
}
