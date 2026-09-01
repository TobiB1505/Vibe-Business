"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Button, TextAction, buttonClasses} from "@/components/ui/button";
import { preparedChangeHref } from "@/components/layout/project-shell";
import { OPERATION_FAILURE_MESSAGES } from "@/modules/operations/messages";
import { useOperationPoll } from "@/lib/client/use-operation-poll";
import {
  freshestOperation,
  OPERATION_STAGE_LABELS,
  operationPollPhase,
  type OperationView,
} from "@/modules/operations/view";
import {
  BLOCKED_ACTION_LABELS,
  BLOCKED_MESSAGES,
  CAPABILITY_LABELS,
  blockedAction,
  blockedActionHref,
  type BlockedActionDestinations,
  type OpportunityActionState,
} from "@/modules/execution/view";
import { DiffView } from "@/components/change/diff-view";
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
          <Button type="submit" disabled={pending} busy={pending}>
            {pending ? "Starting…" : "Prepare change"}
          </Button>
        </form>
        <TextAction type="button" onClick={onCancel} className="text-sm">
          Cancel
        </TextAction>
      </div>
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
  preparedHref,
  blockedDestinations,
}: {
  projectId: string;
  opportunityId: string;
  /** Derived server-side from capability, operation and prepared-change state. */
  actionState: OpportunityActionState;
  /** Built from stored linkage, never client-supplied (§15). */
  branchUrl: string | null;
  /** The latest isolated validation for this artifact (Sprint 10A §44). */
  validationSummary: ValidationSummary | null;
  /** Where the prepared change lives, so preparing leads somewhere (UI-S2 §26). */
  preparedHref: string;
  /**
   * Where each blocked state sends someone. Supplied by the route, because the
   * workspace's segments are a UI fact and neither this panel nor the domain
   * should hard-code them — which is how the previous two hard-coded fragments
   * came to point at nothing.
   */
  blockedDestinations: BlockedActionDestinations;
}) {
  const action = prepareChangeAction.bind(null, projectId, opportunityId);
  const [state, formAction, pending] = useActionState(action, initialState);
  const [confirming, setConfirming] = useState(false);
  const [diff, setDiff] = useState<PreparedDiff | null>(null);
  const [diffError, setDiffError] = useState<string | null>(null);

  const serverOperation = actionState.kind === "preparing" ? actionState.operation : null;
  const startedOperation = state?.ok && state.kind === "running" ? state.operation : null;

  /*
   * What to watch, before the first reading lands: whichever of the server
   * render and the start action's answer is newer.
   */
  const watching = freshestOperation(serverOperation, startedOperation);

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

  const operation = freshestOperation(polled ?? serverOperation, startedOperation);

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

  /*
   * A run nobody is coming back to (UI-4 §5).
   *
   * The panel used to render "…preparing the change" for as long as the row
   * said `running`, which for a lost durable run is forever: the promise that
   * Vibe will continue is exactly the thing that has stopped being true. It
   * says so instead, and offers the same start control as before — the
   * operation is not resumable, so starting again is the honest option.
   */
  if (operationPollPhase(operation) === "stalled") {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-fg-prose">This is taking much longer than expected.</p>
        <p className="text-sm text-fg-muted">
          Vibe has not written anything to your repository. You can start again.
        </p>
        <form action={formAction}>
          <Button type="submit" variant="secondary" size="sm" disabled={pending} busy={pending}>
            {pending ? "Starting…" : "Try again"}
          </Button>
        </form>
      </div>
    );
  }

  if (running && operation) {
    return (
      <div className="flex flex-col gap-1">
        <p className="text-sm text-fg-prose">{OPERATION_STAGE_LABELS[operation.stage]}…</p>
        <p className="text-sm text-fg-muted">
          You can leave this page. Vibe will continue preparing the change.
        </p>
      </div>
    );
  }

  if (preparedChangeId !== null) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-fg-prose">Change prepared</p>
        {/* Stated plainly, because Vibe has not executed the customer's code
            and must not imply otherwise (§11, §27). */}
        <p className="text-sm text-fg-muted">Not merged · Not deployed · Not runtime-tested</p>

        {/*
          Where preparing leads (UI-S2 §26, §27).

          The id is the one this exact preparation resolved — from the action's
          own result, the stored prepared change for this opportunity, or the
          completed operation's `resultId`. Never "the newest change", which
          would hand a founder somebody else's work the moment two preparations
          finish close together (§46).
        */}
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href={preparedChangeHref(preparedHref, preparedChangeId)}
            className={buttonClasses()}
            data-testid="review-prepared-change"
          >
            Review prepared change
          </Link>
          <TextAction type="button" onClick={() => loadDiff(preparedChangeId)} className="text-sm">
            Preview the diff here
          </TextAction>
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
          /*
           * A change that was prepared moments ago. Neither is possible yet,
           * and stating them is the honest reading rather than a default.
           */
          approved={false}
          merged={false}
        />
      </div>
    );
  }

  if (actionState.kind === "failed") {
    return (
      <div className="flex flex-col gap-2">
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
    const blockedHref = blockedActionHref(action, blockedDestinations);
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm text-fg-secondary">{BLOCKED_MESSAGES[actionState.reason]}</p>
        {/*
          A route, resolved by the domain from the destinations this route
          supplied. It used to be one of two bare fragments — `#github-access`,
          which names no element anywhere in the app, and `#business-audit`,
          which names a section on a different route — so the only way out of a
          blocked state has scrolled nowhere since the workspace was split.
        */}
        {action.kind !== "none" && blockedHref && (
          <Link
            href={blockedHref}
            className="inline-block text-sm text-fg-prose underline underline-offset-2 hover:text-fg"
          >
            {BLOCKED_ACTION_LABELS[action.kind]}
          </Link>
        )}
      </div>
    );
  }

  if (actionState.kind === "preparable") {
    return (
      <div className="flex flex-col gap-2">
        {confirming ? (
          <ConfirmDialog
            capabilityLabel={CAPABILITY_LABELS[actionState.capability]}
            pending={pending}
            onCancel={() => setConfirming(false)}
            formAction={formAction}
          />
        ) : (
          <Button type="button" onClick={() => setConfirming(true)}>
            Start with Vibe
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
