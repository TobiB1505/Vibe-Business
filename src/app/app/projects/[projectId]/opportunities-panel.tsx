"use client";

import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { CategoryChip, StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { Surface } from "@/components/ui/surface";
import { MonoLabel } from "@/components/ui/typography";
import { Notice } from "@/components/ui/states";
import { describeEvidenceId } from "@/modules/business-audit/evidence-labels";
import { DIMENSION_LABELS } from "@/modules/business-audit/schema";
import { OPERATION_FAILURE_MESSAGES } from "@/modules/operations/messages";
import { OPERATION_STAGE_LABELS, type OperationView } from "@/modules/operations/view";
import { buildOpportunityBlockNotice } from "@/modules/opportunities/view";
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
 * The Opportunities section (Sprint 8 §30, §31).
 *
 * Functional, not a redesign. Three things it must not do:
 *
 *  - **Promise execution.** Nothing here executes anything, and there is no
 *    "Let Vibe do it" button, because Vibe cannot do it yet. The readiness
 *    badge is a statement about a future capability, not an affordance.
 *  - **Show internals.** Evidence ids are resolved into the product's own
 *    language; a founder reads "Public product: Pricing not detected", never
 *    `live.surface.pricing`.
 *  - **Imply certainty.** Impact, effort and confidence are shown as the
 *    coarse labels they are. No percentages, no time estimates.
 *
 * Every string rendered here originates from an AI response about untrusted
 * customer content. React escapes it; nothing is rendered as markup.
 */

const POLL_INTERVAL_MS = 3_000;

/**
 * Readiness is a statement about a future capability, not an affordance — so
 * `ready` is deliberately NOT mint. Mint is Vibe's primary action, and a badge
 * that borrows it reads as a button that can be pressed. The tones say what the
 * state is; whether anything can be done about it is decided by whether
 * `PrepareChangePanel` renders at all.
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
}: {
  projectId: string;
  opportunity: BusinessOpportunity;
  /** Derived server-side. Null when this project has no execution state yet. */
  execution: OpportunityActionState | null;
  branchUrl: string | null;
  validationSummary: ValidationSummary | null;
}) {
  return (
    <Surface as="li" level="panel" padding="lg" className="flex flex-col gap-4">
      <div className="flex items-baseline gap-3">
        {/* The engine's own ordering. Shown, never recomputed on the client. */}
        <span className="text-fg-meta font-mono text-sm">#{opportunity.rank}</span>
        <h3 className="text-fg text-base font-semibold tracking-[-0.01em]">{opportunity.title}</h3>
      </div>

      <div className="flex flex-wrap gap-2">
        <CategoryChip>{IMPACT_LABELS[opportunity.impact]}</CategoryChip>
        <CategoryChip>{EFFORT_LABELS[opportunity.effort]}</CategoryChip>
        <CategoryChip>{CONFIDENCE_LABELS[opportunity.confidence]}</CategoryChip>
        <CategoryChip>{DIMENSION_LABELS[opportunity.primaryDimension]}</CategoryChip>
        <StatusPill tone={READINESS_TONE[opportunity.executionReadiness]}>
          {EXECUTION_READINESS_LABELS[opportunity.executionReadiness]}
        </StatusPill>
      </div>

      <p className="text-fg-prose text-sm leading-relaxed">{opportunity.problem}</p>

      <details className="group">
        <summary className="text-fg-muted hover:text-fg-body cursor-pointer rounded-sm text-xs transition-colors">
          Why now?
        </summary>
        <div className="mt-3 flex flex-col gap-4">
          <p className="text-fg-prose text-sm leading-relaxed">{opportunity.whyNow}</p>

          {opportunity.dependencies.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <MonoLabel className="tracking-[0.14em]">First</MonoLabel>
              <ul className="flex flex-col gap-1">
                {opportunity.dependencies.map((dependency) => (
                  <li key={dependency} className="text-fg-secondary text-xs leading-relaxed">
                    {dependency}
                  </li>
                ))}
              </ul>
            </div>
          )}

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
          executor. A "ready" badge alone never produces a button (§2). */}
      {execution && (
        <PrepareChangePanel
          projectId={projectId}
          opportunityId={opportunity.id}
          actionState={execution}
          branchUrl={branchUrl}
          validationSummary={validationSummary}
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
  /**
   * Where the block notice's action points. The domain still decides *that*
   * there is a way out and what it is called (`buildOpportunityBlockNotice`);
   * which URL the audit view lives at is a routing fact, so the route supplies
   * it. The domain's anchor is appended, so it still resolves on arrival.
   */
  auditHref: string;
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

  return (
    // The heading now belongs to the workspace section that wraps this panel
    // (UI-1), so it is not repeated here. Everything below — the action, the
    // polling, the block notice — is unchanged.
    <div className="flex flex-col gap-4">
      {hasOpportunities && (
        <ol className="flex flex-col gap-4">
          {opportunities.map((opportunity) => (
            <OpportunityCard
              key={opportunity.id}
              projectId={projectId}
              opportunity={opportunity}
              execution={executionStates[opportunity.id] ?? null}
              branchUrl={branchUrls[opportunity.id] ?? null}
              validationSummary={validationSummaries[opportunity.id] ?? null}
            />
          ))}
        </ol>
      )}

      {stale && hasOpportunities && (
        <Notice tone="waiting" label="New business evidence is available">
          These were prioritized from an earlier audit. Refreshing spends another AI call and may
          change the order.
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
        // Never a heading with a disabled button and no way forward — that
        // dead end was reported as a broken feature twice in Deep Scan.
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
            {pending ? "Starting…" : hasOpportunities ? "Refresh opportunities" : "Find opportunities"}
          </Button>
        </form>
      )}

      {operation?.status === "failed" && operation.failureCode && (
        <p className="text-amber text-sm">
          Vibe couldn&apos;t work out your opportunities. {OPERATION_FAILURE_MESSAGES[operation.failureCode]}
        </p>
      )}

      {state && !state.ok && (
        <p className="text-amber text-sm">{OPERATION_FAILURE_MESSAGES[state.error]}</p>
      )}

      {state?.ok && state.kind === "reused" && (
        <p className="text-fg-muted text-sm">
          Nothing has changed since the last time, so the existing opportunities are shown.
        </p>
      )}
    </div>
  );
}
