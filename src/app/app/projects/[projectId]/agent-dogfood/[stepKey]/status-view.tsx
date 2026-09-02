"use client";

import Link from "next/link";
import { FounderInputCard } from "@/components/founder-input/founder-input-card";
import { Notice } from "@/components/ui/states";
import {
  REVIEW_CLASSIFICATION_LABELS,
  REVIEW_CLASSIFICATION_NOTES,
  REVIEW_DOWNGRADE_NOTE,
} from "@/modules/review/classification";
import { OPERATION_FAILURE_MESSAGES } from "@/modules/operations/messages";
import { useOperationPoll } from "@/lib/client/use-operation-poll";
import { operationPollPhase } from "@/modules/operations/view";
import { AgentExecutionLiveView } from "@/modules/coding-agent/ui/agent-execution-live-view";
// From `./poll`, not `./live-view`: this is a client component, and
// `live-view.ts` is server-only (Sprint 0053).
import { validationStillSettling } from "@/modules/coding-agent/observability/poll";
import {
  getAgentRunStatusAction,
  resolveAgentFounderInputAction,
  type AgentRunStatus,
} from "./actions";

/** Matches the existing Action Plan panel's own cadence (§16, §20). */
const POLL_INTERVAL_MS = 3_000;

/**
 * Whether this screen still has anything to wait for.
 *
 * Two things happen on this page in sequence, not one: the agent run, and then
 * the validation its success automatically enqueues a few seconds later. Asking
 * only about the agent stopped the poll in the gap between them, which is why a
 * six-minute validation used to render forever as "not started" (Sprint 0053).
 *
 * Both halves are pure functions kept out of this component, so the decision is
 * unit-tested rather than asserted by a screenshot.
 */
function stillWatching(status: AgentRunStatus): boolean {
  return (
    operationPollPhase(status.live.operation) === "working" ||
    validationStillSettling(status.live)
  );
}

/**
 * The dogfood surface's host for the reusable live execution view.
 *
 * Everything visual lives in `@/modules/coding-agent/ui` — this file owns the
 * route, the poll and the one thing that genuinely is dogfood-specific, which
 * is the interrupt form. That split is the point: moving this into the real
 * dashboard later is a new host and a data call, not a second implementation.
 *
 * Polling is the refresh mechanism, never the source of truth: the first render
 * comes from the server component that mounted this, a reload re-fetches
 * through the same server action, and losing the poll loses nothing. It stops
 * the moment the operation is terminal — `shouldPoll` is false for every
 * terminal status, so a finished run costs no further requests.
 */
export function StatusView({
  projectId,
  status: initial,
}: {
  projectId: string;
  status: AgentRunStatus;
}) {
  const { latest: polled } = useOperationPoll<AgentRunStatus>({
    key: initial.live.operation.operationId,
    enabled: stillWatching(initial),
    intervalMs: POLL_INTERVAL_MS,
    poll: async () => {
      const next = await getAgentRunStatusAction(projectId, initial.live.operation.operationId);
      return next ? { kind: "value", value: next } : { kind: "unavailable" };
    },
    // Stops on its own answer: the server render cannot know the run ended.
    continueAfter: stillWatching,
  });

  const status = polled ?? initial;
  const { live, openInterrupt, founderInputRequest } = status;
  const operation = live.operation;

  return (
    <div className="flex flex-col gap-6">
      <AgentExecutionLiveView model={live} />

      {operation.status === "failed" && operation.failureCode && (
        <Notice tone="problem" label="stopped">
          {OPERATION_FAILURE_MESSAGES[operation.failureCode]}
        </Notice>
      )}

      {operation.status === "completed" && operation.resultId && (
        <Notice
          tone="info"
          label="ready for review"
          action={
            <Link
              href={`/app/projects/${projectId}/agent`}
              className="text-mint text-sm font-semibold underline underline-offset-2"
            >
              Review change
            </Link>
          }
        >
          Vibe sent the change for validation. Nothing has been merged or deployed.
        </Notice>
      )}

      {operation.status === "completed" && status.recommendedReview && (
        <RecommendedReview classification={status.recommendedReview} />
      )}

      {founderInputRequest?.status === "open" && (
        <FounderInputCard
          projectId={projectId}
          request={founderInputRequest}
          context="runtime_execution"
          resolveAction={resolveAgentFounderInputAction}
        />
      )}

      {openInterrupt && !founderInputRequest && (
        <Notice tone="waiting" label="answer required">
          This older execution stopped for founder input, but it predates the current resolution
          contract. Start a fresh attempt instead of reusing its immutable execution context.
        </Notice>
      )}
    </div>
  );
}

/**
 * Which review this change deserves (Sprint 0048).
 *
 * A line in the existing panel, not a new surface. It recommends and nothing
 * else: no review is started here, and the visual-review domain's rule that
 * nothing is automatic is untouched — a browser session still costs money by
 * the second and still waits for a click.
 */
function RecommendedReview({
  classification,
}: {
  classification: NonNullable<AgentRunStatus["recommendedReview"]>;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-line-2 p-4">
      <p className="text-xs uppercase tracking-wide text-fg-muted">Recommended review</p>
      <p className="text-sm font-semibold text-fg-prose">
        {REVIEW_CLASSIFICATION_LABELS[classification.classification]}
      </p>
      <p className="text-xs text-fg-secondary">
        {REVIEW_CLASSIFICATION_NOTES[classification.classification]}
      </p>
      {classification.routes.length > 0 && (
        <p className="text-xs text-fg-muted">
          Pages affected: {classification.routes.join(", ")}
        </p>
      )}
      {/* Why a page file did not earn a screenshot. Without this the reader
          has to guess whether the classifier missed it. */}
      {classification.downgradedPaths.length > 0 && (
        <p className="text-xs text-fg-muted">{REVIEW_DOWNGRADE_NOTE}</p>
      )}
      <p className="text-xs text-fg-muted">
        {classification.visualPaths.length} rendered {fileWord(classification.visualPaths.length)},{" "}
        {classification.codePaths.length} other {fileWord(classification.codePaths.length)}.
      </p>
    </div>
  );
}

function fileWord(count: number): string {
  return count === 1 ? "file" : "files";
}
