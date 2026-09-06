import Link from "next/link";

import { projectSectionHref, type WorkspaceSectionId } from "@/components/layout/project-shell";
import { Disclosure } from "@/components/ui/disclosure";
import { Surface } from "@/components/ui/surface";
import { MonoLabel } from "@/components/ui/typography";
import { statusToneText, type StatusTone } from "@/components/ui/status-pill";
import { formatDate } from "@/lib/utils/format-datetime";
import { cn } from "@/lib/utils/cn";
import type { ProvenanceRemedy, ProvenanceState } from "@/modules/provenance/chain";
import {
  BRIEFING_EVIDENCE_LABEL,
  BRIEFING_GOAL_PREFIX,
  BRIEFING_HEADING,
  BRIEFING_SOURCE_NOTE,
  type BriefingRow,
  type BriefingView,
} from "@/modules/nova/briefing/view";

/**
 * The briefing — where a founder stands, said in a paragraph.
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
 * ## Why a paragraph and not a table
 *
 * Because the first build of this panel was a table, and the founder's reaction
 * to it settled the question: five labelled rows with dates on them is the raw
 * material for the answer, not the answer. What was asked for was somebody
 * saying it — "we're through your Moves, your audit is about a week old, a
 * fresh scan first would give it something newer to read". Every fact in that
 * sentence was already on the table; none of it was being *said*.
 *
 * So Nova speaks first and the facts sit behind a disclosure, where somebody
 * who wants to check her can open them. Nothing is hidden — it is ordered
 * behind what the founder actually asked.
 *
 * ## What it does not do
 *
 * Re-rank anything, restate the Focus Card's sentence, or offer more than one
 * thing to do. `buildBriefingView` composed the paragraph and chose the read;
 * this draws it.
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

export function BriefingPanel({
  view,
  projectId,
  className,
}: {
  view: BriefingView;
  projectId: string;
  className?: string;
}) {
  const read = view.read;
  const offer = read.kind === "repair" || read.kind === "age" ? read : null;

  return (
    <Surface
      as="section"
      aria-labelledby="nova-briefing"
      level="section"
      padding="md"
      className={cn("flex flex-col gap-3", className)}
      data-testid="briefing-panel"
      data-briefing-read={read.kind}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <MonoLabel as="h2" id="nova-briefing">
          {BRIEFING_HEADING}
        </MonoLabel>
        <span className="text-fg-meta text-xs">{view.projectName}</span>
      </div>

      {/*
        Nova's own paragraph, addressed. The name is a lead-in here rather than
        part of the sentence so that every word `buildBriefingView` produces
        stays Vibe's own and stays sweepable; an account that has not given one
        simply starts at the sentence, with no placeholder and no "there".
      */}
      <p className="text-fg-body text-sm leading-relaxed" data-testid="briefing-paragraph">
        {view.founderName !== null && (
          <span className="text-fg font-semibold">{view.founderName} — </span>
        )}
        {view.paragraph}
      </p>

      {read.kind === "move" && (
        /* The engine's words, set apart because they are quoted rather than
           written. Nova points at the Move; she never rewrites it. */
        <div className="border-line-3 flex flex-col gap-1 border-l-2 pl-3">
          <p className="text-fg text-sm font-semibold">{read.title}</p>
          <p className="text-fg-muted text-xs leading-relaxed">{read.whyNow}</p>
        </div>
      )}

      {offer !== null && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Link
            href={projectSectionHref(projectId, REMEDY_SECTION[offer.remedy])}
            className="text-fg-prose hover:text-fg text-sm underline underline-offset-4 transition-interactive"
            data-testid="briefing-remedy"
          >
            {offer.remedyLabel}
          </Link>
          {offer.free && <MonoLabel>Free</MonoLabel>}
        </div>
      )}

      {view.goalLabel !== null && (
        <p className="text-fg-meta text-xs">
          {BRIEFING_GOAL_PREFIX} · <span className="text-fg-muted">{view.goalLabel}</span>
        </p>
      )}

      {/*
        The facts, behind the answer rather than instead of it. Closed by
        default: this is the layer somebody opens to check Nova, and a founder
        who trusts the paragraph should not have to scroll past its evidence
        every time they open Home.
      */}
      <Disclosure label={BRIEFING_EVIDENCE_LABEL} className="pt-1">
        <ul>
          {view.rows.map((row) => (
            <EvidenceRow key={row.kind} row={row} />
          ))}
        </ul>
      </Disclosure>

      {/*
        What Nova is, on every render rather than only when something is wrong.
        A note that appears only in trouble teaches a founder that silence
        means live monitoring, which is the opposite of true.
      */}
      <p className="text-fg-meta text-[0.7rem] leading-relaxed">{BRIEFING_SOURCE_NOTE}</p>
    </Surface>
  );
}
