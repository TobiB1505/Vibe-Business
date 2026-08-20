"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { CreditPrice } from "@/components/ui/credit-price";
import { OPERATION_FAILURE_MESSAGES } from "@/modules/operations/messages";
import { useOperationPoll } from "@/lib/client/use-operation-poll";
import {
  freshestOperation,
  operationPollPhase,
  OPERATION_STAGE_LABELS, type OperationView,
} from "@/modules/operations/view";
import {
  getOperationStatusAction,
  startAuditAction,
  type StartAuditActionState,
} from "./run-audit-action";

/** Conservative, and it stops (§20). */
const POLL_INTERVAL_MS = 3_000;

const initialState: StartAuditActionState = null;

export function RunAuditButton({
  projectId,
  hasAudit,
  disabled,
  billable = false,
  activeOperation,
}: {
  projectId: string;
  hasAudit: boolean;
  disabled: boolean;
  /**
   * Whether starting this run would actually spend Credits
   * (BILLING CORE-2 §55).
   *
   * Decided on the server from the entitlement, not inferred from `hasAudit`.
   * The two come apart in a case that matters: when Vibe owes a replacement
   * because its own audit contract moved, an audit exists *and* the re-run is
   * free — and showing "35 Credits" beside a free run would be a lie in the
   * direction that costs trust.
   */
  billable?: boolean;
  /**
   * Discovered on the server at page load. This is what makes a reload or a
   * return to the tab show "Analyzing…" instead of an inviting button, without
   * the client starting anything (§19).
   */
  activeOperation: OperationView | null;
}) {
  const router = useRouter();
  const action = startAuditAction.bind(null, projectId);
  const [state, formAction, pending] = useActionState(action, initialState);

  /*
   * Enter the lifecycle the moment a run is accepted (UI-S2 §22, §47).
   *
   * This button knew an audit had started; the page did not. So the control
   * said "Preparing evidence…" while the entire completed audit below it — the
   * verdict, the map, the priorities — stayed on screen, presented as current,
   * until something happened to re-render the route. A founder reading a
   * headline verdict has no reason to suspect it is about to be replaced.
   *
   * `router.refresh()` re-runs the server component, which discovers the active
   * operation it already knows how to find and swaps the stale result for the
   * preparing/analyzing state. Nothing new is started and nothing is spent —
   * the run is already enqueued by the time this fires.
   */
  const startedOperationId = state?.ok && state.kind === "running" ? state.operation.operationId : null;
  useEffect(() => {
    if (startedOperationId !== null) router.refresh();
  }, [router, startedOperationId]);

  /*
   * A reused audit changes nothing to look at, but the server has already
   * revalidated the path — so the route is refreshed for the same reason:
   * whatever is on screen may predate what the action just confirmed.
   */
  const reused = state?.ok && state.kind === "reused";
  useEffect(() => {
    if (reused) router.refresh();
  }, [router, reused]);

  // Two sources describe the same thing: what the server rendered or the
  // poller last saw, and what the start action just returned. Derive which is
  // newer rather than syncing them — a poll result for the started operation
  // supersedes it; anything else means the poller has not caught up yet.
  const startedOperation = state?.ok && state.kind === "running" ? state.operation : null;

  /*
   * What to watch, before the first reading lands: whichever of the server
   * render and the start action's answer is newer.
   */
  const watching = freshestOperation(activeOperation, startedOperation);

  const { latest: polled } = useOperationPoll<OperationView>({
    key: watching?.operationId ?? null,
    enabled: operationPollPhase(watching) === "working",
    intervalMs: POLL_INTERVAL_MS,
    poll: async () => {
      const operationId = watching?.operationId;
      if (!operationId) return { kind: "unavailable" };

      const result = await getOperationStatusAction(projectId, operationId);
      return result.ok ? { kind: "value", value: result.operation } : { kind: "unavailable" };
    },
    // Stops on its own answer: the server render cannot know the run ended.
    continueAfter: (next) => operationPollPhase(next) === "working",
  });

  const operation = freshestOperation(polled ?? activeOperation, startedOperation);

  const running = operation !== null && (operation.status === "queued" || operation.status === "running");
  const failed = operation?.status === "failed";

  if (running) {
    return (
      <div className="space-y-1">
        <p className="text-sm text-fg-prose">
          {operation.stalled ? "Still analyzing…" : `${OPERATION_STAGE_LABELS[operation.stage]}…`}
        </p>
        <p className="text-sm text-fg-muted">
          {operation.stalled
            ? "This is taking much longer than expected. You can start a new audit if it never finishes."
            : "You can leave this page. Vibe will continue the analysis."}
        </p>
        {operation.stalled && (
          <form action={formAction}>
            <input type="hidden" name="force" value="true" />
            <Button type="submit" disabled={pending || disabled}>
              Start a new audit
            </Button>
          </form>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <form action={formAction} className="flex items-center gap-3">
        <input type="hidden" name="force" value={hasAudit ? "true" : "false"} />
        <Button type="submit" disabled={pending || disabled} busy={pending}>
          {pending ? "Starting…" : hasAudit ? "Re-run business audit" : "Run business audit"}
        </Button>
        {/* The cost, before the click (§55) — and only when there is one. */}
        {billable && <CreditPrice operation="business_audit" />}
      </form>

      {failed && operation?.failureCode && (
        <div className="space-y-2">
          <p className="text-sm text-amber">
            Business audit couldn&apos;t complete. {OPERATION_FAILURE_MESSAGES[operation.failureCode]}
          </p>
          {/* Only offered where starting again is honest — never after an
              interrupted paid call, where we cannot say whether it was
              billed (§21). */}
          {operation.retryAllowed && (
            <form action={formAction}>
              <input type="hidden" name="force" value="true" />
              <Button type="submit" disabled={pending || disabled}>
                Try again
              </Button>
            </form>
          )}
        </div>
      )}

      {state && !state.ok && <p className="text-sm text-amber">{OPERATION_FAILURE_MESSAGES[state.error]}</p>}

      {state?.ok && state.kind === "reused" && (
        <p className="text-sm text-fg-muted">
          Nothing has changed since the last audit, so the existing result is shown.
        </p>
      )}
    </div>
  );
}
