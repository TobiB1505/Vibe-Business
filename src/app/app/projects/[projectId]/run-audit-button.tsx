"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { OPERATION_FAILURE_MESSAGES } from "@/modules/operations/messages";
import { OPERATION_STAGE_LABELS, type OperationView } from "@/modules/operations/view";
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
  activeOperation,
}: {
  projectId: string;
  hasAudit: boolean;
  disabled: boolean;
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
  const [polled, setPolled] = useState<OperationView | null>(activeOperation);

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
  const operation =
    startedOperation && polled?.operationId !== startedOperation.operationId ? startedOperation : polled;

  const operationId = operation?.operationId ?? null;
  const shouldPoll = operation?.shouldPoll ?? false;

  useEffect(() => {
    if (!operationId || !shouldPoll) return;

    let cancelled = false;

    const timer = setInterval(async () => {
      const result = await getOperationStatusAction(projectId, operationId);
      // The component may have unmounted mid-request; a setState then is both
      // useless and noisy.
      if (cancelled) return;
      if (result.ok) setPolled(result.operation);
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [projectId, operationId, shouldPoll]);

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
        <Button type="submit" disabled={pending || disabled}>
          {pending ? "Starting…" : hasAudit ? "Re-run business audit" : "Run business audit"}
        </Button>
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
