"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/states";
import {
  confirmProductAndStartAuditAction,
  retryProductScanAction,
  type BeginUnderstandingState,
  type ConfirmAndAuditState,
} from "./actions";

export function RetryProductScan({ projectId }: { projectId: string }) {
  const router = useRouter();
  const retry = retryProductScanAction.bind(null, projectId);
  const [state, action, pending] = useActionState<BeginUnderstandingState, FormData>(retry, null);
  useEffect(() => {
    // Only a genuinely new run changes what the page should show. Refreshing
    // after "the same run is still going" would redraw the identical screen and
    // read as a button that did nothing (UI-S1 §14).
    if (state?.ok && !state.alreadyRunning) router.refresh();
  }, [router, state]);
  return (
    <div className="flex flex-col gap-3">
      <form action={action}>
        <Button type="submit" disabled={pending} busy={pending}>
          {pending ? "Vibe is reading your product…" : "Try again"}
        </Button>
      </form>
      {state?.ok && state.alreadyRunning && (
        <p className="text-fg-muted text-sm">
          The run already in progress is still going, so Vibe has not started a second one. Leave
          this page and come back — it will be here when it finishes.
        </p>
      )}
      {state && !state.ok && (
        <Notice tone="problem" label="Vibe couldn't start it again">
          Your project and your connected repository are unchanged. Check that Vibe still has
          access to the repository, then try once more.
        </Notice>
      )}
    </div>
  );
}

export function StartAudit({ projectId, profileId }: { projectId: string; profileId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<ConfirmAndAuditState>(null);
  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [router, state]);

  return (
    <div className="flex flex-col gap-3">
      <Button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setState(await confirmProductAndStartAuditAction(projectId, profileId));
          })
        }
      >
        {pending ? "Starting your Audit…" : "Continue your Business Audit"}
      </Button>
      {state && !state.ok && (
        <Notice tone="problem" label="The Audit could not start">
          Your Product Profile is confirmed and safe. Retry when you are ready.
        </Notice>
      )}
    </div>
  );
}
