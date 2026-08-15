"use client";

import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { OPERATION_FAILURE_MESSAGES } from "@/modules/operations/messages";
import { OPERATION_STAGE_LABELS, type OperationView } from "@/modules/operations/view";
import {
  BLOCKED_ACTION_LABELS,
  BLOCKED_MESSAGES,
  CAPABILITY_LABELS,
  blockedAction,
  type OpportunityActionState,
} from "@/modules/execution/view";
import type { PreparedDiff } from "@/modules/execution/diff";
import { getOperationStatusAction } from "./run-audit-action";
import { ValidationPanel, type ValidationSummary } from "./validation-panel";
import {
  getPreparedDiffAction,
  prepareChangeAction,
  type PrepareChangeActionState,
} from "./prepare-change-action";

/**
 * The execution affordance on an opportunity card (Sprint 9C §2, §3, §11, §14).
 *
 * Three rules this component exists to keep:
 *
 *  - **No write without confirmation.** The first click opens a dialog that
 *    says exactly what will happen, including that the user's own CI may react
 *    to a new branch. Only the second click starts anything (§3).
 *  - **No promise of shipping.** A prepared change is prepared: not merged,
 *    not deployed, not run. The copy says so on the result itself (§11).
 *  - **Untrusted content is text.** The diff is a customer's repository
 *    rendered through React's escaping — never `dangerouslySetInnerHTML`,
 *    never markdown-with-HTML, never a highlighter that evaluates input (§13).
 */

const POLL_INTERVAL_MS = 3_000;

function ConfirmDialog({
  capabilityLabel,
  pending,
  onCancel,
  formAction,
}: {
  capabilityLabel: string;
  pending: boolean;
  onCancel: () => void;
  formAction: (formData: FormData) => void;
}) {
  return (
    <div className="space-y-3 rounded-md border border-line-4 bg-surface-2 p-4">
      <h4 className="text-sm font-medium text-fg">Prepare {capabilityLabel}?</h4>
      <div className="space-y-2 text-sm text-fg-secondary">
        <p>Vibe will create an isolated GitHub branch and commit the proposed change.</p>
        <p>Your default branch and production site will not be changed.</p>
        {/* Deliberately not "nothing external can happen": creating a branch
            can trigger the user's own automation, and Vibe does not control
            that (§3, §36). */}
        <p>
          Your repository&apos;s existing CI, preview deployment or other GitHub automation may react
          to the new branch.
        </p>
      </div>
      <div className="flex items-center gap-3">
        <form action={formAction}>
          <input type="hidden" name="confirmed" value="true" />
          <Button type="submit" disabled={pending}>
            {pending ? "Starting…" : "Prepare change"}
          </Button>
        </form>
        <button
          type="button"
          onClick={onCancel}
          className="text-sm text-fg-secondary underline underline-offset-2 hover:text-fg-body"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function DiffView({ diff }: { diff: PreparedDiff }) {
  return (
    <div className="space-y-3">
      <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-fg-muted">
        <div className="flex gap-2">
          <dt>Base</dt>
          <dd className="text-fg-prose">{diff.baseSha.slice(0, 7)}</dd>
        </div>
        <div className="flex gap-2">
          <dt>Prepared</dt>
          <dd className="text-fg-prose">{diff.commitSha.slice(0, 7)}</dd>
        </div>
      </dl>

      {diff.files.map((file) => (
        <div key={file.path} className="space-y-1">
          <p className="text-xs text-fg-secondary">{file.path}</p>
          {/* Plain text in a <pre>. React escapes every line; nothing here
              parses, highlights or evaluates repository content. */}
          <pre className="overflow-x-auto rounded-md border border-line-2 bg-app p-3 text-xs leading-relaxed text-fg-prose">
            {file.lines.map((line, index) => (
              <span key={index} className="block">
                <span className="text-mint">+ </span>
                {line}
              </span>
            ))}
          </pre>
          {file.truncated && (
            <p className="text-xs text-fg-muted">This file was truncated for review.</p>
          )}
        </div>
      ))}

      {diff.truncated && <p className="text-xs text-fg-muted">Some files were omitted for review.</p>}
    </div>
  );
}

const initialState: PrepareChangeActionState = null;

export function PrepareChangePanel({
  projectId,
  opportunityId,
  actionState,
  branchUrl,
  validationSummary,
}: {
  projectId: string;
  opportunityId: string;
  /** Derived server-side from capability, operation and prepared-change state. */
  actionState: OpportunityActionState;
  /** Built from stored linkage, never client-supplied (§15). */
  branchUrl: string | null;
  /** The latest isolated validation for this artifact (Sprint 10A §44). */
  validationSummary: ValidationSummary | null;
}) {
  const action = prepareChangeAction.bind(null, projectId, opportunityId);
  const [state, formAction, pending] = useActionState(action, initialState);
  const [confirming, setConfirming] = useState(false);
  const [polled, setPolled] = useState<OperationView | null>(
    actionState.kind === "preparing" ? actionState.operation : null,
  );
  const [diff, setDiff] = useState<PreparedDiff | null>(null);
  const [diffError, setDiffError] = useState<string | null>(null);

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

  const preparedChangeId =
    actionState.kind === "already_prepared"
      ? actionState.preparedChangeId
      : state?.ok && state.kind === "reused"
        ? state.preparedChangeId
        : operation?.status === "completed"
          ? operation.resultId
          : null;

  async function loadDiff(id: string) {
    setDiffError(null);
    const result = await getPreparedDiffAction(projectId, id);
    if (result.ok) setDiff(result.diff);
    else setDiffError("The prepared change could not be loaded for review.");
  }

  if (running && operation) {
    return (
      <div className="space-y-1 border-t border-line-2 pt-3">
        <p className="text-sm text-fg-prose">{OPERATION_STAGE_LABELS[operation.stage]}…</p>
        <p className="text-sm text-fg-muted">
          You can leave this page. Vibe will continue preparing the change.
        </p>
      </div>
    );
  }

  if (preparedChangeId !== null) {
    return (
      <div className="space-y-3 border-t border-line-2 pt-3">
        <p className="text-sm text-fg-prose">Change prepared</p>
        {/* Stated plainly, because Vibe has not executed the customer's code
            and must not imply otherwise (§11, §27). */}
        <p className="text-sm text-fg-muted">Not merged · Not deployed · Not runtime-tested</p>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={() => loadDiff(preparedChangeId)}>
            Review change
          </Button>
          {branchUrl && (
            <a
              href={branchUrl}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-fg-prose underline underline-offset-2 hover:text-fg"
            >
              Open branch on GitHub
            </a>
          )}
        </div>

        {diffError && <p className="text-sm text-amber">{diffError}</p>}
        {diff && <DiffView diff={diff} />}

        {/* Isolated validation of this exact commit (Sprint 10A §44). Offered
            only once a change exists — there is nothing to validate before. */}
        <ValidationPanel
          projectId={projectId}
          preparedChangeId={preparedChangeId}
          summary={validationSummary}
          runningOperation={null}
        />
      </div>
    );
  }

  if (actionState.kind === "failed") {
    return (
      <div className="space-y-2 border-t border-line-2 pt-3">
        <p className="text-sm text-amber">
          Vibe couldn&apos;t prepare this change.{" "}
          {actionState.operation.failureCode
            ? OPERATION_FAILURE_MESSAGES[actionState.operation.failureCode]
            : ""}
        </p>
        {actionState.retryAllowed && (
          <form action={formAction}>
            <input type="hidden" name="confirmed" value="true" />
            <Button type="submit" disabled={pending}>
              Try again
            </Button>
          </form>
        )}
      </div>
    );
  }

  if (actionState.kind === "blocked") {
    const action = blockedAction(actionState.reason);
    return (
      <div className="space-y-2 border-t border-line-2 pt-3">
        <p className="text-sm text-fg-secondary">{BLOCKED_MESSAGES[actionState.reason]}</p>
        {action.kind !== "none" && (
          <a
            href={action.kind === "enable_github_write" ? "#github-access" : "#business-audit"}
            className="inline-block text-sm text-fg-prose underline underline-offset-2 hover:text-fg"
          >
            {BLOCKED_ACTION_LABELS[action.kind]}
          </a>
        )}
      </div>
    );
  }

  if (actionState.kind === "preparable") {
    return (
      <div className="space-y-2 border-t border-line-2 pt-3">
        {confirming ? (
          <ConfirmDialog
            capabilityLabel={CAPABILITY_LABELS[actionState.capability]}
            pending={pending}
            onCancel={() => setConfirming(false)}
            formAction={formAction}
          />
        ) : (
          <Button type="button" onClick={() => setConfirming(true)}>
            Let Vibe prepare this
          </Button>
        )}

        {state && !state.ok && (
          <p className="text-sm text-amber">{OPERATION_FAILURE_MESSAGES[state.error]}</p>
        )}
      </div>
    );
  }

  // `needs_user_input` and `not_automated` render nothing extra: the card
  // already carries the readiness badge, and a disabled button would only
  // suggest a capability that does not exist (§2).
  return null;
}
