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
    if (state?.ok) router.refresh();
  }, [router, state]);
  return (
    <div className="flex flex-col gap-3">
      <form action={action}>
        <Button type="submit" disabled={pending}>
          {pending ? "Vibe is reading your product…" : "Try Product Understanding again"}
        </Button>
      </form>
      {state && !state.ok && (
        <Notice tone="problem" label="Vibe couldn't finish">
          Your source connection and project are safe. Check access, then retry.
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
