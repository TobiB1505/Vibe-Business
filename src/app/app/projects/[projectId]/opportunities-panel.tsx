"use client";

import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { describeEvidenceId } from "@/modules/business-audit/evidence-labels";
import { DIMENSION_LABELS } from "@/modules/business-audit/schema";
import { OPERATION_FAILURE_MESSAGES } from "@/modules/operations/messages";
import { OPERATION_STAGE_LABELS, type OperationView } from "@/modules/operations/view";
import { buildOpportunityBlockNotice } from "@/modules/opportunities/view";
import type { OpportunityActionState } from "@/modules/execution/view";
import { PrepareChangePanel } from "./prepare-change-panel";
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

const READINESS_TONE: Record<ExecutionReadiness, string> = {
  ready: "border-emerald-800 text-emerald-400",
  needs_user_input: "border-amber-800 text-amber-400",
  not_supported_yet: "border-zinc-700 text-zinc-500",
};

function Badge({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`rounded-full border border-zinc-700 px-2 py-0.5 text-xs text-zinc-400 ${className}`}>
      {children}
    </span>
  );
}

function OpportunityCard({
  projectId,
  opportunity,
  execution,
  branchUrl,
}: {
  projectId: string;
  opportunity: BusinessOpportunity;
  /** Derived server-side. Null when this project has no execution state yet. */
  execution: OpportunityActionState | null;
  branchUrl: string | null;
}) {
  return (
    <li className="space-y-3 rounded-md border border-zinc-800 p-4">
      <div className="flex items-baseline gap-3">
        <span className="text-sm text-zinc-500">#{opportunity.rank}</span>
        <h3 className="text-sm font-medium text-zinc-100">{opportunity.title}</h3>
      </div>

      <div className="flex flex-wrap gap-2">
        <Badge>{IMPACT_LABELS[opportunity.impact]}</Badge>
        <Badge>{EFFORT_LABELS[opportunity.effort]}</Badge>
        <Badge>{CONFIDENCE_LABELS[opportunity.confidence]}</Badge>
        <Badge>{DIMENSION_LABELS[opportunity.primaryDimension]}</Badge>
        <Badge className={READINESS_TONE[opportunity.executionReadiness]}>
          {EXECUTION_READINESS_LABELS[opportunity.executionReadiness]}
        </Badge>
      </div>

      <p className="text-sm text-zinc-400">{opportunity.problem}</p>

      <details>
        <summary className="cursor-pointer text-xs text-zinc-500 hover:text-zinc-400">Why now?</summary>
        <div className="mt-2 space-y-3">
          <p className="text-sm text-zinc-400">{opportunity.whyNow}</p>

          {opportunity.dependencies.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs text-zinc-500">First</p>
              <ul className="space-y-0.5 pl-3">
                {opportunity.dependencies.map((dependency) => (
                  <li key={dependency} className="text-xs text-zinc-400">
                    {dependency}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {opportunity.evidenceIds.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs text-zinc-500">Why Vibe thinks this</p>
              <ul className="space-y-0.5 pl-3">
                {opportunity.evidenceIds.map((id) => {
                  const { source, detail } = describeEvidenceId(id);
                  return (
                    <li key={id} className="text-xs text-zinc-500" title={id}>
                      <span className="text-zinc-400">{source}:</span> {detail}
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
        />
      )}
    </li>
  );
}

const initialState: StartOpportunitiesActionState = null;

export function OpportunitiesPanel({
  projectId,
  opportunities,
  executionStates,
  branchUrls,
  stale,
  activeOperation,
  blockedReason,
}: {
  projectId: string;
  opportunities: BusinessOpportunity[];
  /** Per-opportunity execution state, resolved on the server (§2). */
  executionStates: Record<string, OpportunityActionState>;
  branchUrls: Record<string, string>;
  /** A newer audit exists than the one these were prioritized from (§35). */
  stale: boolean;
  activeOperation: OperationView | null;
  /** Why generation cannot be offered, when it cannot (§34). */
  blockedReason: "audit_missing" | "audit_stale" | null;
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
    <section className="space-y-3">
      <h2 className="text-sm font-medium text-zinc-200">
        {hasOpportunities ? "Your next moves" : "Opportunities"}
      </h2>

      {hasOpportunities && (
        <ol className="space-y-3">
          {opportunities.map((opportunity) => (
            <OpportunityCard
              key={opportunity.id}
              projectId={projectId}
              opportunity={opportunity}
              execution={executionStates[opportunity.id] ?? null}
              branchUrl={branchUrls[opportunity.id] ?? null}
            />
          ))}
        </ol>
      )}

      {stale && hasOpportunities && (
        <div className="space-y-2 rounded-md border border-zinc-800 px-3 py-2">
          <p className="text-sm text-zinc-300">New business evidence is available</p>
          <p className="text-sm text-zinc-500">
            These were prioritized from an earlier audit. Refreshing spends another AI call and may
            change the order.
          </p>
        </div>
      )}

      {running && operation && (
        <div className="space-y-1">
          <p className="text-sm text-zinc-300">
            {operation.stalled ? "Still working…" : `${OPERATION_STAGE_LABELS[operation.stage]}…`}
          </p>
          <p className="text-sm text-zinc-500">
            {operation.stalled
              ? "This is taking much longer than expected. You can start again if it never finishes."
              : "You can leave this page. Vibe will continue."}
          </p>
        </div>
      )}

      {!running && blockNotice !== null && (
        <div className="space-y-2">
          <p className="text-sm text-zinc-500">{OPERATION_FAILURE_MESSAGES[blockNotice.reason]}</p>
          {/* Never a heading with a disabled button and no way forward — that
              dead end was reported as a broken feature twice in Deep Scan. */}
          <a
            href={blockNotice.anchor}
            className="inline-block text-sm text-zinc-300 underline underline-offset-2 hover:text-zinc-50"
          >
            {blockNotice.actionLabel}
          </a>
        </div>
      )}

      {!running && !hasOpportunities && blockedReason === null && (
        <p className="text-sm text-zinc-500">
          Vibe can work out the highest-impact things to do next from your business audit.
        </p>
      )}

      {!running && blockNotice === null && (
        <form action={formAction} className="flex items-center gap-3">
          <input type="hidden" name="force" value={hasOpportunities ? "true" : "false"} />
          <Button type="submit" disabled={pending}>
            {pending ? "Starting…" : hasOpportunities ? "Refresh opportunities" : "Find opportunities"}
          </Button>
        </form>
      )}

      {operation?.status === "failed" && operation.failureCode && (
        <p className="text-sm text-amber-400">
          Vibe couldn&apos;t work out your opportunities. {OPERATION_FAILURE_MESSAGES[operation.failureCode]}
        </p>
      )}

      {state && !state.ok && (
        <p className="text-sm text-amber-400">{OPERATION_FAILURE_MESSAGES[state.error]}</p>
      )}

      {state?.ok && state.kind === "reused" && (
        <p className="text-sm text-zinc-500">
          Nothing has changed since the last time, so the existing opportunities are shown.
        </p>
      )}
    </section>
  );
}
