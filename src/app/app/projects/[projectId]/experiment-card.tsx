import Link from "next/link";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { Surface } from "@/components/ui/surface";
import { MonoLabel } from "@/components/ui/typography";
import { formatTimestamp } from "@/lib/utils/format-datetime";
import type { ProjectImpactEntry } from "@/modules/business-measurement/project-impact";
import type { OutcomeCardState } from "@/modules/outcome-verification/view";

/**
 * One change Vibe made, and what became true afterwards (CORE-5).
 *
 * ## What an "experiment" is here, and what it is not
 *
 * It is a change that reached the default branch, and the two independent
 * observations Vibe makes about it afterwards: what it could verify in
 * production, and what a business metric says across the two windows.
 *
 * It is **not** a controlled experiment. This product runs none — there is no
 * design, no control group, no randomisation, and
 * `business-measurement/causality.ts` exists to make adding one a deliberate,
 * visible act rather than an accident. So nothing on this card claims a change
 * *caused* a result, and the copy says as much in its own words rather than
 * relying on a reader to infer the limit.
 *
 * ## Two observations, never merged into one verdict
 *
 * `outcome` is what Vibe could see in the deployed product. `businessImpact`
 * is what a metric source says. They answer different questions, they fail
 * independently, and a card that combined them into one "result" would be
 * claiming a link neither of them establishes.
 *
 * Today no metric source is connected for any project, so the business half is
 * `waiting_for_source` everywhere (PRODUCT.md §11, docs/ROADMAP.md). That is a
 * missing connection, not a bad result, and it is written that way.
 */

/**
 * Outcome states as one short phrase each.
 *
 * Deliberately the same words the Outcome panel already uses, rather than new
 * ones: two places describing one state differently is how a product starts
 * disagreeing with itself. In particular `failed` stays a statement about
 * *Vibe* — it never says the customer's product failed.
 */
export const OUTCOME_LABELS: Record<OutcomeCardState, string> = {
  unavailable: "Not applicable",
  not_started: "Not yet verified in production",
  observing: "Checking production…",
  verified: "Production outcome verified",
  partial: "Partly observed",
  not_observed: "Not observed within verification window",
  failed: "Vibe could not check",
};

/**
 * Tone per outcome state.
 *
 * `not_observed` is `waiting`, not `problem`: a check that did not appear in
 * production may simply mean the product has not deployed yet, and colouring
 * that coral tells a founder something failed on the evidence that Vibe looked
 * early (UI-6 §22). Only `failed` — Vibe itself could not run the check — is
 * a problem, and it is a problem with Vibe.
 */
const OUTCOME_TONE: Record<OutcomeCardState, StatusTone> = {
  unavailable: "neutral",
  not_started: "neutral",
  observing: "active",
  verified: "success",
  partial: "waiting",
  not_observed: "waiting",
  failed: "problem",
};

export function ExperimentCard({
  entry,
  agentHref,
}: {
  entry: ProjectImpactEntry;
  /** Where the change itself lives, with every panel behind it. */
  agentHref: string;
}) {
  const merged = formatTimestamp(entry.mergedAt);

  return (
    <Surface level="panel" padding="md" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div className="flex min-w-0 flex-col gap-1">
          <MonoLabel>Change</MonoLabel>
          {/*
            Prose, because the branch is the only name this read model has for
            the change and a founder still has to recognise it. The commit and
            base branch below it are machine output and stay mono.
          */}
          <p className="text-fg-body truncate text-sm font-medium">{entry.branchName}</p>
        </div>
        <StatusPill tone={OUTCOME_TONE[entry.outcome.state]}>
          {OUTCOME_LABELS[entry.outcome.state]}
        </StatusPill>
      </div>

      <dl className="flex flex-wrap gap-x-8 gap-y-2">
        <div className="flex flex-col gap-0.5">
          <dt className="text-fg-meta font-mono text-meta uppercase tracking-[0.14em]">Merged</dt>
          {/* An em dash rather than an empty slot, and never an invented date. */}
          <dd className="text-fg-body font-mono text-ui">{merged ?? "—"}</dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-fg-meta font-mono text-meta uppercase tracking-[0.14em]">Commit</dt>
          <dd className="text-fg-body font-mono text-ui">
            {entry.commitSha ? entry.commitSha.slice(0, 7) : "—"}
          </dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-fg-meta font-mono text-meta uppercase tracking-[0.14em]">Into</dt>
          <dd className="text-fg-body font-mono text-ui">{entry.baseBranch}</dd>
        </div>
      </dl>

      {/*
        The business half, kept separate from the production half above.
        `headline` is written by the measurement view for each state, including
        the one every project is in today — so this renders a sentence about a
        missing connection rather than a missing number.
      */}
      <div className="border-line-1 flex flex-col gap-1 border-t pt-3">
        <MonoLabel>What the business did</MonoLabel>
        <p className="text-fg-prose text-sm leading-relaxed">{entry.businessImpact.headline}</p>
      </div>

      <div>
        <Link
          href={agentHref}
          className="text-fg-muted hover:text-fg-body rounded-sm text-xs underline underline-offset-4 transition-interactive"
        >
          See this change and everything checked about it
        </Link>
      </div>
    </Surface>
  );
}
