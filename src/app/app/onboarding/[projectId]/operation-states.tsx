import type { ReactNode } from "react";
import { Notice } from "@/components/ui/states";
import { OPERATION_FAILURE_MESSAGES } from "@/modules/operations/messages";
import type { OperationView } from "@/modules/operations/view";

/**
 * What onboarding shows when a durable operation ends badly, or stops
 * plausibly running at all (UI-S1 §14, §15).
 *
 * ## The defect these replace
 *
 * A failed operation stops being an *active* operation the instant it fails,
 * and onboarding only ever asked for the active one. So a failure rendered as
 * the absence of a failure: the waiting screen vanished and the start button
 * came back, unchanged, as though nothing had been pressed. The founder was
 * left to infer from a reappearing button that something had gone wrong — which
 * is not a failure state, it is a failure to have one.
 *
 * ## The three questions a failure has to answer
 *
 * What happened, was anything changed, and what can I do now. All three are
 * answered here, in that order, and the third is never absent — the control
 * that would have been shown anyway is passed in as `action` and rendered
 * *inside* the failure rather than beside it, so a button can no longer appear
 * on its own.
 *
 * ## Why the copy is safe to make
 *
 * The two operations onboarding runs — understanding a product, auditing a
 * business — read evidence and write conclusions. Neither touches the
 * repository, so "your project is unchanged" is a property of what these
 * operations *are*, not a reassurance. What is deliberately not claimed is that
 * nothing was spent: `retryAllowed` is already false for a failure that may
 * have been billed, and offering a cheerful retry there is exactly how a
 * durable system quietly buys a second inference.
 */
export function OnboardingOperationFailure({
  /** What the founder was waiting for, in their words. */
  what,
  operation,
  action,
}: {
  what: string;
  operation: OperationView;
  action?: ReactNode;
}) {
  const detail = operation.failureCode
    ? OPERATION_FAILURE_MESSAGES[operation.failureCode]
    : null;

  return (
    <Notice tone="problem" label={`Vibe couldn't finish ${what}`} action={action}>
      <div className="flex flex-col gap-2">
        {detail && <p>{detail}</p>}
        <p>
          Your project and your connected repository are unchanged — this step only reads and
          concludes, it never writes to your code.
        </p>
        {!operation.retryAllowed && (
          <p className="text-fg-muted">
            Vibe will not start this again by itself. Start a fresh run below when you are ready.
          </p>
        )}
      </div>
    </Notice>
  );
}

/**
 * Running far longer than the work could plausibly take (§14).
 *
 * The previous copy said "This is taking longer than expected" directly above
 * "You can leave this page. Vibe will keep going" — a worry and a reassurance
 * contradicting each other, with nothing to do about either. What made it worse
 * is that the claim had by then stopped being true: the view marks a run
 * `stalled` precisely because a durable run *can* be lost, and it stops polling
 * at the same moment. So the screen promised continuation while the mechanism
 * had given up waiting for it.
 *
 * This says the one true thing — it may still finish, and it may not — and puts
 * a way to start again in front of the founder rather than leaving them to
 * refresh the tab and hope.
 */
export function OnboardingStalled({
  what,
  action,
}: {
  what: string;
  action?: ReactNode;
}) {
  return (
    <Notice tone="waiting" label="This is taking longer than usual" action={action}>
      <div className="flex flex-col gap-2">
        <p>
          Vibe has been {what} for much longer than this normally takes. It may still finish on its
          own — nothing has been lost either way, and your project is unchanged.
        </p>
        <p>You can leave this page and come back, or start it again now.</p>
      </div>
    </Notice>
  );
}
