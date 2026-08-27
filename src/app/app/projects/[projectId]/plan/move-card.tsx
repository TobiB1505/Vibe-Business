"use client";

import { AlertIcon, BoltIcon, TargetIcon, UserIcon } from "@/components/ui/dashboard-icons";
import { RatingChip, StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { Surface } from "@/components/ui/surface";
import { cn } from "@/lib/utils/cn";
import {
  EFFORT_LABELS,
  IMPACT_LABELS,
  type BusinessOpportunity,
} from "@/modules/opportunities/schema";
import { moveHeadline, moveLensLabel, type MoveHeadlineKind } from "@/modules/opportunities/view";
import type { OpportunityActionState } from "@/modules/execution/view";

const HEADLINE_TONE: Record<MoveHeadlineKind, StatusTone> = {
  ready: "success",
  needs_input: "waiting",
  not_automated: "neutral",
  low_priority: "neutral",
};

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
          detail: "Vibe can still guide the work step by step.",
        };
  }

  switch (execution.kind) {
    case "preparable":
      return { icon: "bolt", headline: "Ready for Vibe", detail: "Vibe can prepare this change for you." };
    case "already_prepared":
      return { icon: "bolt", headline: "Change prepared", detail: "Review what Vibe wrote on its isolated branch." };
    case "preparing":
      return { icon: "bolt", headline: "Vibe is working on this", detail: "You can leave this page while Vibe continues." };
    case "failed":
      return { icon: "alert", headline: "The last attempt failed", detail: "Nothing was written to your repository." };
    case "blocked":
      return { icon: "alert", headline: "Something needs to change first", detail: "The detail below explains the blocker." };
    case "needs_user_input":
      return { icon: "user", headline: "Needs your input", detail: "Answer the question below so Vibe can continue." };
    case "not_automated":
      return { icon: "target", headline: "Not automated yet", detail: "Vibe can still guide the work step by step." };
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

/** The one Move currently in focus. Action and evidence live below it. */
export function MoveCard({
  opportunity,
  execution,
}: {
  opportunity: BusinessOpportunity;
  execution: OpportunityActionState | null;
}) {
  const headline = moveHeadline(opportunity);
  const lens = moveLensLabel(opportunity);
  const responsibility = responsibilityOf(execution, opportunity);
  const ResponsibilityIcon = RESPONSIBILITY_ICONS[responsibility.icon];

  return (
    <Surface
      as="article"
      level="panel"
      padding="lg"
      tone="mint"
      className="action-plan-move action-plan-move-selected flex flex-col gap-5 overflow-hidden sm:p-7"
      data-testid="move-card"
      data-rank={opportunity.rank}
      data-selected="true"
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-mint font-mono text-base tabular-nums">
            {String(opportunity.rank).padStart(2, "0")}
          </span>
          <StatusPill tone={HEADLINE_TONE[headline.kind]}>{headline.label}</StatusPill>
        </div>

        <div className="max-w-4xl">
          <h2 className="text-fg text-headline leading-tight font-bold" aria-current="step">
            {opportunity.title}
          </h2>
          <p className="text-fg-prose mt-2 text-base leading-relaxed">{opportunity.problem}</p>
        </div>

        {opportunity.dependencies.length > 0 ? (
          <p className="text-fg-secondary text-xs leading-relaxed" data-testid="move-dependencies">
            <span className="text-fg-meta">Do this after: </span>
            {opportunity.dependencies.join(" · ")}
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {lens ? (
          <span className="text-fg-secondary mr-1 inline-flex items-center gap-2 text-ui">
            <TargetIcon size={15} className="text-fg-meta shrink-0" />
            {lens}
          </span>
        ) : null}
        <RatingChip>{IMPACT_LABELS[opportunity.impact]}</RatingChip>
        <RatingChip>{EFFORT_LABELS[opportunity.effort]}</RatingChip>
      </div>

      <div className="border-line-2 flex items-start gap-3 border-t pt-4">
        <span
          aria-hidden
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-full border",
            RESPONSIBILITY_ICON_TONE[responsibility.icon],
          )}
        >
          <ResponsibilityIcon size={17} />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="text-fg-body text-sm font-semibold">{responsibility.headline}</p>
          <p className="text-fg-muted text-xs leading-relaxed">{responsibility.detail}</p>
        </div>
      </div>
    </Surface>
  );
}
