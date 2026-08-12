"use client";

import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { OperationFailureCode } from "@/modules/operations/failures";
import { OPERATION_STAGE_LABELS, type OperationView } from "@/modules/operations/view";
import {
  getOperationStatusAction,
  startAuditAction,
  type StartAuditActionState,
} from "./run-audit-action";

/**
 * User-facing copy for every typed failure (Sprint 4 §27, Sprint 7 §21).
 *
 * Raw provider errors, workflow internals and stack traces never reach the
 * browser. Each message says what happened and, where it is true, what the
 * user can do about it.
 */
const ERROR_MESSAGES: Record<OperationFailureCode, string> = {
  project_not_found: "This project could not be found.",
  operation_not_found: "That analysis could not be found.",
  repository_intelligence_missing: "Inspect the repository first — the audit needs that evidence.",
  live_product_intelligence_missing: "Inspect the live product first — the audit needs that evidence.",
  business_context_missing: "Complete your business context first.",
  already_running: "An audit is already running for this project. Give it a moment.",
  // The evidence moved under the operation's feet — a Deep Scan finished, or
  // the context was edited. Starting again picks up the new evidence.
  inputs_changed: "Your evidence changed while the audit was starting. Run it again to use the latest.",
  execution_start_failed: "The analysis could not be queued. Try again in a moment.",
  // Deliberately does not claim the call was free. We do not know.
  inference_interrupted:
    "The analysis was interrupted while the AI was running, so Vibe stopped rather than risk analyzing twice.",
  audit_input_budget_exceeded: "There is too much evidence to analyze in one audit. This is a bug — please report it.",
  token_count_failed: "The audit could not be prepared. Try again in a moment.",
  provider_rate_limited: "The AI provider is rate limiting requests. Try again in a few minutes.",
  provider_auth_error: "Vibe Business is not correctly configured to reach the AI provider.",
  provider_billing_error: "The AI provider account has no available usage credit or has a billing issue.",
  provider_timeout: "The audit took too long to complete. Try again.",
  provider_unavailable: "The AI provider could not be reached. Try again in a moment.",
  provider_overloaded: "The AI provider is overloaded right now. Try again in a few minutes.",
  provider_refusal: "The AI provider declined to analyze this input. Nothing was saved.",
  provider_request_rejected: "The AI provider rejected the audit request. The integration needs adjustment.",
  structured_output_empty: "The AI provider returned no usable audit output.",
  structured_output_json_invalid: "The AI provider returned an invalid audit format.",
  structured_output_schema_invalid: "The audit response did not pass Vibe's validation.",
  output_truncated: "The audit result was cut short. Nothing was saved.",
  audit_failed: "The business audit could not be completed.",
};

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
  const action = startAuditAction.bind(null, projectId);
  const [state, formAction, pending] = useActionState(action, initialState);
  const [polled, setPolled] = useState<OperationView | null>(activeOperation);

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
        <p className="text-sm text-zinc-300">
          {operation.stalled ? "Still analyzing…" : `${OPERATION_STAGE_LABELS[operation.stage]}…`}
        </p>
        <p className="text-sm text-zinc-500">
          {operation.stalled
            ? "This is taking much longer than expected. You can start a new audit if it never finishes."
            : "You can leave this page. Vibe will continue the analysis."}
        </p>
        {operation.stalled && (
          <form action={formAction}>
            <input type="hidden" name="force" value="true" />
            <Button type="submit" disabled={pending}>
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
          <p className="text-sm text-amber-400">
            Business audit couldn&apos;t complete. {ERROR_MESSAGES[operation.failureCode]}
          </p>
          {/* Only offered where starting again is honest — never after an
              interrupted paid call, where we cannot say whether it was
              billed (§21). */}
          {operation.retryAllowed && (
            <form action={formAction}>
              <input type="hidden" name="force" value="true" />
              <Button type="submit" disabled={pending}>
                Try again
              </Button>
            </form>
          )}
        </div>
      )}

      {state && !state.ok && <p className="text-sm text-amber-400">{ERROR_MESSAGES[state.error]}</p>}

      {state?.ok && state.kind === "reused" && (
        <p className="text-sm text-zinc-500">
          Nothing has changed since the last audit, so the existing result is shown.
        </p>
      )}
    </div>
  );
}
