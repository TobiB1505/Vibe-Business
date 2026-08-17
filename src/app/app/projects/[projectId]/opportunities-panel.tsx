"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { CategoryChip, StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { Surface } from "@/components/ui/surface";
import { MonoLabel } from "@/components/ui/typography";
import { Notice } from "@/components/ui/states";
import { describeEvidenceId } from "@/modules/business-audit/evidence-labels";
import { OPERATION_FAILURE_MESSAGES } from "@/modules/operations/messages";
import { OPERATION_STAGE_LABELS, type OperationView } from "@/modules/operations/view";
import { buildOpportunityBlockNotice } from "@/modules/opportunities/view";
import {
  partitionByContext,
  type MoveLineageMap,
  type MovesContext,
} from "@/modules/opportunities/lineage";
import type { OpportunityActionState } from "@/modules/execution/view";
import { PrepareChangePanel } from "./prepare-change-panel";
import type { ValidationSummary } from "./validation-panel";
import {
  CONFIDENCE_LABELS,
  EFFORT_LABELS,
  EXECUTION_READINESS_LABELS,
  IMPACT_LABELS,
  type BusinessOpportunity,
  type ExecutionReadiness,
} from "@/modules/opportunities/schema";
import { getOperationStatusAction } from "./run-audit-action";
import {
  startOpportunitiesAction,
  type StartOpportunitiesActionState,
} from "./opportunities-action";

/**
 * The Moves section (Sprint 8 §30, §31; reworked in UI-S2 §12–§18).
 *
 * Three rules it must not break:
 *
 *  - **Promise nothing.** The readiness badge is a statement about a
 *    capability, not an affordance. Whether anything can be done is decided by
 *    whether `PrepareChangePanel` renders at all, which is decided on the
 *    server from a real executor.
 *  - **Show no internals.** Evidence ids are resolved into the product's own
 *    language, and `sourceConclusionKey` never reaches the screen — a founder
 *    reads the audit's own headline, never `blocker-1` (§5).
 *  - **Imply no certainty.** Impact, effort and confidence stay the coarse
 *    labels they are. No percentages, no time estimates.
 *
 * ## What UI-S2 changed, and why
 *
 * A card carried five chips of equal visual weight — impact, effort,
 * confidence, business dimension and readiness — so the one that decides what
 * a founder can actually do sat in a row with four that do not. Worse, the
 * dimension chip competed with the audit lineage for the same job: *why is this
 * here?* Now readiness leads, impact keeps it company, and effort and
 * confidence moved under "Why now?" where they inform rather than compete.
 * The dimension is unchanged in the domain and simply no longer drawn (§14).
 *
 * Every string rendered here originates from an AI response about untrusted
 * customer content. React escapes it; nothing is rendered as markup.
 */

const POLL_INTERVAL_MS = 3_000;

/**
 * Readiness is a statement about a future capability, not an affordance — so
 * `ready` is deliberately NOT mint. Mint is Vibe's primary action, and a badge
 * that borrows it reads as a button that can be pressed.
 */
const READINESS_TONE: Record<ExecutionReadiness, StatusTone> = {
  ready: "success",
  needs_user_input: "waiting",
  not_supported_yet: "neutral",
};

function OpportunityCard({
  projectId,
  opportunity,
  execution,
  branchUrl,
  validationSummary,
  lineageHeadline,
  preparedHref,
  emphasis,
}: {
  projectId: string;
  opportunity: BusinessOpportunity;
  /** Derived server-side. Null when this project has no execution state yet. */
  execution: OpportunityActionState | null;
  branchUrl: string | null;
  validationSummary: ValidationSummary | null;
  /** The audit finding this Move answers, in the audit's words. Null if unresolved. */
  lineageHeadline: string | null;
  preparedHref: string;
  /** The engine's rank 1, or the top of a contextual group. */
  emphasis: boolean;
}) {
  return (
    <Surface
      as="li"
      level="panel"
      padding="lg"
      className={`flex flex-col gap-4 ${emphasis ? "border-mint/35" : ""}`}
      data-testid="move-card"
      data-rank={opportunity.rank}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {/* The engine's own ordering. Shown, never recomputed on the client,
            and identical whether or not the page was entered from the audit
            (§44). */}
        <span className="text-fg-meta font-mono text-sm">#{opportunity.rank}</span>
        {emphasis && (
          <MonoLabel className="text-mint">Best next move</MonoLabel>
        )}
        <h3 className="text-fg w-full text-base font-semibold tracking-[-0.01em]">
          {opportunity.title}
        </h3>
      </div>

      {/* The seam this sprint exists for: a Move is the continuation of a
          finding, and saying which one is what makes the two screens one
          story (§4). The key that resolved it is never shown (§5). */}
      {lineageHeadline && (
        <p className="text-fg-muted text-xs leading-relaxed" data-testid="move-lineage">
          <span className="text-fg-meta">From your audit: </span>
          <span className="text-fg-secondary">{lineageHeadline}</span>
        </p>
      )}

      {/* Two, not five (§13). Readiness decides what a founder can do; impact
          is the one other signal worth reading at a glance. */}
      <div className="flex flex-wrap gap-2">
        <StatusPill tone={READINESS_TONE[opportunity.executionReadiness]}>
          {EXECUTION_READINESS_LABELS[opportunity.executionReadiness]}
        </StatusPill>
        <CategoryChip>{IMPACT_LABELS[opportunity.impact]}</CategoryChip>
      </div>

      <p className="text-fg-prose text-sm leading-relaxed">{opportunity.problem}</p>

      {/* Visible rather than buried: a founder should not discover an ordering
          constraint only after pressing a button (§18). */}
      {opportunity.dependencies.length > 0 && (
        <p className="text-fg-secondary text-xs leading-relaxed" data-testid="move-dependencies">
          <span className="text-fg-meta">Do this after: </span>
          {opportunity.dependencies.join(" · ")}
        </p>
      )}

      <details className="group">
        <summary className="text-fg-muted hover:text-fg-body cursor-pointer rounded-sm text-xs transition-colors">
          Why now?
        </summary>
        <div className="mt-3 flex flex-col gap-4">
          <p className="text-fg-prose text-sm leading-relaxed">{opportunity.whyNow}</p>

          {/* Demoted from the chip row (§13, §17). Still here, still exact —
              they inform a decision rather than competing to be the headline. */}
          <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
            <div className="flex gap-2">
              <dt className="text-fg-meta">Effort</dt>
              <dd className="text-fg-secondary">{EFFORT_LABELS[opportunity.effort]}</dd>
            </div>
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
      </details>

      {/* The execution affordance renders only where Vibe genuinely has an
          executor. A "ready" badge alone never produces a button (§2, §35). */}
      {execution && (
        <PrepareChangePanel
          projectId={projectId}
          opportunityId={opportunity.id}
          actionState={execution}
          branchUrl={branchUrl}
          validationSummary={validationSummary}
          preparedHref={preparedHref}
        />
      )}
    </Surface>
  );
}

const initialState: StartOpportunitiesActionState = null;

export function OpportunitiesPanel({
  projectId,
  opportunities,
  executionStates,
  branchUrls,
  validationSummaries,
  stale,
  activeOperation,
  blockedReason,
  auditHref,
  lineage,
  movesContext,
  movesHref,
  preparedHref,
}: {
  projectId: string;
  opportunities: BusinessOpportunity[];
  /** Per-opportunity execution state, resolved on the server (§2). */
  executionStates: Record<string, OpportunityActionState>;
  branchUrls: Record<string, string>;
  validationSummaries: Record<string, ValidationSummary>;
  /** A newer audit exists than the one these were prioritized from (§35). */
  stale: boolean;
  activeOperation: OperationView | null;
  /** Why generation cannot be offered, when it cannot (§34). */
  blockedReason: "audit_missing" | "audit_stale" | null;
  auditHref: string;
  /** Which audit finding each Move answers. Resolved server-side (UI-S2 §6). */
  lineage: MoveLineageMap;
  /** The finding the founder arrived for, when they came from the audit (§9). */
  movesContext: MovesContext | null;
  movesHref: string;
  preparedHref: string;
}) {
  const action = startOpportunitiesAction.bind(null, projectId);
  const [state, formAction, pending] = useActionState(action, initialState);
  const [polled, setPolled] = useState<OperationView | null>(activeOperation);

  const startedOperation = state?.ok && state.kind === "running" ? state.operation : null;
  const operation =
    startedOperation && polled?.operationId !== startedOperation.operationId ? startedOperation : polled;

  const operationId = operation?.operationId ?? null;
  const shouldPoll = operation?.shouldPoll ?? false;

  useEffect(() => {
    if (!operationId || !shouldPoll) return;

    let cancelled = false;
    const timer = setInterval(async () => {
      const result = await getOperationStatusAction(projectId, operationId);
      if (cancelled) return;
      if (result.ok) setPolled(result.operation);
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [projectId, operationId, shouldPoll]);

  const running = operation !== null && (operation.status === "queued" || operation.status === "running");
  const hasOpportunities = opportunities.length > 0;
  const blockNotice = buildOpportunityBlockNotice(blockedReason);

  // Elevation, never reranking. Both groups keep the engine's order and every
  // card keeps its persisted number (§44).
  const { addressing, others } = partitionByContext(opportunities, movesContext);

  /*
   * `inContext` suppresses the card's own lineage line (§5).
   *
   * Found by looking at it: in a contextual entry the header already states the
   * finding, so every elevated card repeated the same sentence directly under
   * its title — three copies of one line on one screen. The label earns its
   * place on the default list, where each card answers a different finding,
   * and nowhere else.
   */
  const renderCard = (
    opportunity: BusinessOpportunity,
    { emphasis, inContext }: { emphasis: boolean; inContext: boolean },
  ) => (
    <OpportunityCard
      key={opportunity.id}
      projectId={projectId}
      opportunity={opportunity}
      execution={executionStates[opportunity.id] ?? null}
      branchUrl={branchUrls[opportunity.id] ?? null}
      validationSummary={validationSummaries[opportunity.id] ?? null}
      lineageHeadline={inContext ? null : (lineage[opportunity.id]?.headline ?? null)}
      preparedHref={preparedHref}
      emphasis={emphasis}
    />
  );

  return (
    <div className="flex flex-col gap-4">
      {/*
        Arrived from one audit finding (§10).
        Orientation, not a second audit surface: the finding in the audit's own
        words, how many Moves answer it, and a way back to the whole list.
      */}
      {movesContext && (
        <Surface
          level="section"
          padding="md"
          className="border-mint/25 flex flex-col gap-2"
          data-testid="moves-context"
        >
          <MonoLabel className="text-mint">From your audit</MonoLabel>
          <p className="text-fg-body text-sm leading-relaxed">{movesContext.headline}</p>
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <p className="text-fg-muted text-xs">
              {movesContext.moveIds.length === 1
                ? "1 way Vibe can help"
                : `${movesContext.moveIds.length} ways Vibe can help`}
            </p>
            <Link
              href={movesHref}
              className="text-fg-muted hover:text-fg-body rounded-sm text-xs underline underline-offset-4"
            >
              See all next moves
            </Link>
          </div>
        </Surface>
      )}

      {hasOpportunities && (
        <ol className="flex flex-col gap-4">
          {movesContext
            ? addressing.map((opportunity, index) =>
                renderCard(opportunity, { emphasis: index === 0, inContext: true }),
              )
            : others.map((opportunity) =>
                renderCard(opportunity, { emphasis: opportunity.rank === 1, inContext: false }),
              )}
        </ol>
      )}

      {/* The rest of the ranked list stays reachable when the page was entered
          from a finding — filtered away would be a smaller product, not a
          clearer one (§11). */}
      {movesContext && others.length > 0 && (
        <div className="flex flex-col gap-3 pt-2">
          <MonoLabel as="h3" className="text-fg-secondary">
            Your other moves
          </MonoLabel>
          <ol className="flex flex-col gap-4">
            {others.map((opportunity) =>
              renderCard(opportunity, { emphasis: false, inContext: false }),
            )}
          </ol>
        </div>
      )}

      {stale && hasOpportunities && (
        <Notice tone="waiting" label="New business evidence is available">
          These were prioritized from an earlier audit, and still say what they addressed then.
          Refreshing spends another AI call and may change the order.
        </Notice>
      )}

      {running && operation && (
        <Surface level="section" padding="md" role="status" className="flex flex-col gap-1">
          <p className="text-fg-body text-sm">
            {operation.stalled ? "Still working…" : `${OPERATION_STAGE_LABELS[operation.stage]}…`}
          </p>
          <p className="text-fg-muted text-sm">
            {operation.stalled
              ? "This is taking much longer than expected. You can start again if it never finishes."
              : "You can leave this page. Vibe will continue."}
          </p>
        </Surface>
      )}

      {!running && blockNotice !== null && (
        // Never a heading with a disabled button and no way forward.
        <Notice
          tone="waiting"
          label="Why this is blocked"
          action={
            <a
              href={`${auditHref}${blockNotice.anchor}`}
              className="text-fg-prose hover:text-fg rounded-sm text-sm underline underline-offset-4 transition-colors"
            >
              {blockNotice.actionLabel}
            </a>
          }
        >
          {OPERATION_FAILURE_MESSAGES[blockNotice.reason]}
        </Notice>
      )}

      {!running && !hasOpportunities && blockedReason === null && (
        <p className="text-fg-muted text-sm">
          Vibe can work out the highest-impact things to do next from your business audit.
        </p>
      )}

      {!running && blockNotice === null && (
        <form action={formAction} className="flex items-center gap-3">
          <input type="hidden" name="force" value={hasOpportunities ? "true" : "false"} />
          {/* Refreshing an existing set is secondary — the primary action in
              this section is whatever a move itself offers. Finding them the
              first time is the section's own primary. */}
          <Button
            type="submit"
            disabled={pending}
            variant={hasOpportunities ? "secondary" : "primary"}
          >
            {pending
              ? "Starting…"
              : hasOpportunities
                ? "Refresh my next moves"
                : "Find my next moves"}
          </Button>
        </form>
      )}

      {operation?.status === "failed" && operation.failureCode && (
        <p className="text-amber text-sm">
          Vibe couldn&apos;t work out your next moves. {OPERATION_FAILURE_MESSAGES[operation.failureCode]}
        </p>
      )}

      {state && !state.ok && (
        <p className="text-amber text-sm">{OPERATION_FAILURE_MESSAGES[state.error]}</p>
      )}

      {state?.ok && state.kind === "reused" && (
        <p className="text-fg-muted text-sm">
          Nothing has changed since the last time, so your existing moves are shown.
        </p>
      )}
    </div>
  );
}
