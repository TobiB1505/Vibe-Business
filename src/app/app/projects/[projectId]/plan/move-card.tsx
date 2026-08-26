"use client";

import Link from "next/link";
import {
  AlertIcon,
  BoltIcon,
  TargetIcon,
  UserIcon,
} from "@/components/ui/dashboard-icons";
import { buttonClasses } from "@/components/ui/button";
import { RatingChip, StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { Surface } from "@/components/ui/surface";
import { Disclosure } from "@/components/ui/disclosure";
import { MonoLabel } from "@/components/ui/typography";
import { cn } from "@/lib/utils/cn";
import { describeEvidenceId } from "@/modules/business-audit/evidence-labels";
import {
  CONFIDENCE_LABELS,
  EFFORT_LABELS,
  IMPACT_LABELS,
  type BusinessOpportunity,
} from "@/modules/opportunities/schema";
import { moveHeadline, moveLensLabel, type MoveHeadlineKind } from "@/modules/opportunities/view";
import { planMoveHref } from "@/modules/action-plans/source";
import type {
  BlockedActionDestinations,
  OpportunityActionState,
} from "@/modules/execution/view";
import { PrepareChangePanel } from "../prepare-change-panel";
import type { ValidationSummary } from "../validation-panel";

/**
 * One Move, as a card in the Action Plan's list (ACTION PLAN UI-2).
 *
 * The rules it inherits from the panel it replaces, unchanged:
 *
 *  - **Promise nothing.** The headline pill is a statement about a category of
 *    work. Whether anything can be done is decided by whether
 *    `PrepareChangePanel` renders a control at all, which is decided on the
 *    server from a real executor (§54, ADR 0014).
 *  - **Show no internals.** Evidence ids are resolved into the product's own
 *    language and `sourceConclusionKey` never reaches the screen.
 *  - **Imply no certainty.** Impact and effort stay the coarse labels they
 *    are. The slot the reference design fills with "~1–2 hours" carries the
 *    effort label instead, because no duration exists in the domain and one
 *    printed here would be invented (`opportunities/schema.ts` §6).
 *
 * What is new is selection: a card links to `?plan=<id>`, which is what the
 * panel beside the list is about. That parameter already existed (ADR 0028)
 * and still means the same thing — a founder's own explicit choice of Move,
 * never Vibe's substitution.
 *
 * Every string rendered here originates from an AI response about untrusted
 * customer content. React escapes it; nothing is rendered as markup.
 */

const HEADLINE_TONE: Record<MoveHeadlineKind, StatusTone> = {
  // Deliberately not mint: mint is Vibe's action colour, and a badge that
  // borrows it reads as a button that can be pressed.
  ready: "success",
  needs_input: "waiting",
  not_automated: "neutral",
  low_priority: "neutral",
};

/**
 * Whose move it is, in one line, from state the server resolved.
 *
 * Never from `executionReadiness` alone: an absent executor says "Vibe can
 * plan this with you", which is true, rather than "Vibe can implement this",
 * which would be a promise no capability backs.
 */
type Responsibility = { icon: "bolt" | "user" | "alert" | "target"; headline: string; detail: string };

function responsibilityOf(
  execution: OpportunityActionState | null,
  opportunity: BusinessOpportunity,
): Responsibility {
  if (execution === null) {
    return opportunity.executionReadiness === "needs_user_input"
      ? {
          icon: "user",
          headline: "Needs your input",
          detail: "Vibe needs a decision from you before this can move.",
        }
      : {
          icon: "target",
          headline: "Not automated yet",
          detail: "Vibe can plan this with you, step by step.",
        };
  }

  switch (execution.kind) {
    case "preparable":
      return {
        icon: "bolt",
        headline: "Ready for Vibe",
        detail: "Vibe can implement this change for you.",
      };
    case "already_prepared":
      return {
        icon: "bolt",
        headline: "Change prepared",
        detail: "Review what Vibe wrote on its own branch.",
      };
    case "preparing":
      return { icon: "bolt", headline: "Vibe is working on this", detail: "You can leave this page." };
    case "failed":
      return {
        icon: "alert",
        headline: "The last attempt failed",
        detail: "Nothing was written to your repository.",
      };
    case "blocked":
      return {
        icon: "alert",
        headline: "Something needs to change first",
        detail: "Vibe explains what below.",
      };
    case "needs_user_input":
      return {
        icon: "user",
        headline: "Needs your input",
        detail: "Vibe needs a decision from you before it can start.",
      };
    case "not_automated":
      return {
        icon: "target",
        headline: "Not automated yet",
        detail: "Vibe can plan this with you, step by step.",
      };
  }
}

const RESPONSIBILITY_ICONS = {
  bolt: BoltIcon,
  user: UserIcon,
  alert: AlertIcon,
  target: TargetIcon,
} as const;

const RESPONSIBILITY_ICON_TONE: Record<Responsibility["icon"], string> = {
  bolt: "border-mint-line bg-mint-tint text-mint",
  user: "border-amber-line bg-amber-tint text-amber",
  alert: "border-coral-line bg-coral-tint text-coral",
  target: "border-line-3 bg-surface-2 text-fg-secondary",
};

export function MoveCard({
  projectId,
  opportunity,
  execution,
  branchUrl,
  validationSummary,
  lineageHeadline,
  preparedHref,
  blockedDestinations,
  movesHref,
  selected,
  /**
   * The founder-question call to action for this exact Move, when its plan has
   * open questions. Null everywhere else — a card never offers to answer
   * questions that do not exist.
   */
  questionCta,
  planPanelHref,
}: {
  projectId: string;
  opportunity: BusinessOpportunity;
  /** Derived server-side. Null when Vibe has no executor for this Move. */
  execution: OpportunityActionState | null;
  branchUrl: string | null;
  validationSummary: ValidationSummary | null;
  /** The audit finding this Move answers, in the audit's words. */
  lineageHeadline: string | null;
  preparedHref: string;
  blockedDestinations: BlockedActionDestinations;
  movesHref: string;
  selected: boolean;
  questionCta: string | null;
  planPanelHref: string;
}) {
  const headline = moveHeadline(opportunity);
  const lens = moveLensLabel(opportunity);
  const responsibility = responsibilityOf(execution, opportunity);
  const ResponsibilityIcon = RESPONSIBILITY_ICONS[responsibility.icon];
  const selectHref = planMoveHref(movesHref, opportunity.id);

  /*
   * One control per card, and only where it is real.
   *
   * `PrepareChangePanel` is the sole owner of what a Move with an executor
   * offers. Its `preparable` state is a single button, so it belongs beside the
   * responsibility line; every other state is prose about a change that already
   * exists and belongs under it. Its two silent states — a Move waiting on the
   * founder, and one Vibe cannot do at all — render nothing, and a card that
   * would otherwise carry no action at all offers selection instead.
   */
  const executionPanel = execution ? (
    <PrepareChangePanel
      projectId={projectId}
      opportunityId={opportunity.id}
      actionState={execution}
      branchUrl={branchUrl}
      validationSummary={validationSummary}
      preparedHref={preparedHref}
      blockedDestinations={blockedDestinations}
    />
  ) : null;

  const silentExecution =
    execution === null ||
    execution.kind === "needs_user_input" ||
    execution.kind === "not_automated";

  const selectionLink = selected ? null : (
    <Link href={selectHref} className={buttonClasses({ variant: "secondary", size: "sm" })}>
      Plan this move
    </Link>
  );

  const compactAction = questionCta ? (
    <Link
      href={selected ? planPanelHref : `${selectHref}${planPanelHref}`}
      className={buttonClasses({ variant: "secondary", size: "sm" })}
    >
      {questionCta}
    </Link>
  ) : silentExecution ? (
    selectionLink
  ) : execution?.kind === "preparable" ? (
    executionPanel
  ) : null;

  const richAction =
    !questionCta && !silentExecution && execution?.kind !== "preparable" ? executionPanel : null;

  return (
    <Surface
      as="article"
      level="panel"
      padding="lg"
      /* The surface's own tone, not a border override: `cn` is a join, so two
         border-colour utilities in one class list are decided by stylesheet
         order rather than by which was written last. */
      tone={selected ? "mint" : "neutral"}
      className="flex flex-col gap-4 transition-interactive"
      data-testid="move-card"
      data-rank={opportunity.rank}
      data-selected={selected}
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          {/* The engine's own ordering. Shown, never recomputed on the client. */}
          <span className="text-fg-meta font-mono text-ui tabular-nums">
            {String(opportunity.rank).padStart(2, "0")}
          </span>
          <StatusPill tone={HEADLINE_TONE[headline.kind]}>{headline.label}</StatusPill>
        </div>

        {/* Selecting a Move is what the panel beside the list is about, so the
            title is the link. The selected card does not link to itself. */}
        {selected ? (
          <h3 className="text-fg text-title font-bold" aria-current="true">
            {opportunity.title}
          </h3>
        ) : (
          <h3 className="text-title font-bold">
            <Link
              href={selectHref}
              className="text-fg hover:text-mint rounded-sm transition-interactive"
            >
              {opportunity.title}
            </Link>
          </h3>
        )}

        <p className="text-fg-prose text-sm leading-relaxed">{opportunity.problem}</p>

        {/* Visible rather than buried: a founder should not discover an
            ordering constraint only after pressing a button. */}
        {opportunity.dependencies.length > 0 && (
          <p className="text-fg-secondary text-xs leading-relaxed" data-testid="move-dependencies">
            <span className="text-fg-meta">Do this after: </span>
            {opportunity.dependencies.join(" · ")}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {lens && (
          <span className="text-fg-secondary inline-flex items-center gap-2 text-ui">
            <TargetIcon size={15} className="text-fg-meta shrink-0" />
            {lens}
          </span>
        )}
        {/* Two, not five. Readiness leads above; impact is the one other
            signal worth reading at a glance, and effort is stated once — in
            the slot below the action, where the reference design puts a
            duration the domain does not have. */}
        <RatingChip>{IMPACT_LABELS[opportunity.impact]}</RatingChip>
      </div>

      <Disclosure label="Why this matters">
        <div className="flex flex-col gap-4">
          <p className="text-fg-prose text-sm leading-relaxed">{opportunity.whyNow}</p>

          {/* The seam between a finding and the Move that answers it. The key
              that resolved it is never shown. */}
          {lineageHeadline && (
            <p className="text-fg-muted text-xs leading-relaxed" data-testid="move-lineage">
              <span className="text-fg-meta">From your audit: </span>
              <span className="text-fg-secondary">{lineageHeadline}</span>
            </p>
          )}

          <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
            <div className="flex gap-2">
              <dt className="text-fg-meta">Confidence</dt>
              <dd className="text-fg-secondary">{CONFIDENCE_LABELS[opportunity.confidence]}</dd>
            </div>
          </dl>

          {opportunity.evidenceIds.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <MonoLabel className="tracking-[0.14em]">Why Vibe thinks this</MonoLabel>
              <ul className="flex flex-col gap-1">
                {opportunity.evidenceIds.map((id) => {
                  const { source, detail } = describeEvidenceId(id);
                  return (
                    <li key={id} className="text-fg-muted text-xs leading-relaxed" title={id}>
                      <span className="text-fg-secondary font-mono">{source}:</span> {detail}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      </Disclosure>

      <div className="border-line-2 flex flex-wrap items-end justify-between gap-4 border-t pt-4">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span
            aria-hidden
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-full border",
              RESPONSIBILITY_ICON_TONE[responsibility.icon],
            )}
          >
            <ResponsibilityIcon size={16} />
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="text-fg-body text-sm font-semibold">{responsibility.headline}</p>
            <p className="text-fg-muted text-xs leading-relaxed">{responsibility.detail}</p>
          </div>
        </div>

        <div className="flex w-full flex-col gap-1.5 sm:w-auto sm:items-end">
          {compactAction}
          {/* The reference design's duration slot. Effort is what the domain
              actually knows. */}
          <span className="text-fg-meta text-meta">{EFFORT_LABELS[opportunity.effort]}</span>
        </div>
      </div>

      {/* Everything a prepared, running, failed or blocked change has to say.
          Full width and below the row, because it is prose and a status, not a
          control that belongs in a right-hand column. */}
      {richAction}
    </Surface>
  );
}
