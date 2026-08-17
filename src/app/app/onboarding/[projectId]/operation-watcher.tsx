"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import type { OperationView } from "@/modules/operations/view";
import { getOperationStatusAction } from "../../projects/[projectId]/run-audit-action";

const POLL_INTERVAL_MS = 2_500;

/**
 * Keeps the onboarding screen level with the operation behind it (UI-S1 §13).
 *
 * ## What was wrong
 *
 * It refreshed only when the operation stopped being pollable. Everything in
 * between — reading your code, looking at your public product, putting it
 * together — was polled, observed, and thrown away, because the only thing the
 * result was compared against was "is it finished yet". So the server-rendered
 * stage line was whatever it had been at first paint, and a founder watched
 * "Reading what you built" for the entire ninety seconds while the server knew
 * perfectly well that it had moved on twice.
 *
 * ## What it does now
 *
 * Refreshes on any change worth showing: the stage moved, the run stopped, or
 * it crossed into stalled. `stage` and `stalled` are in the dependency list, so
 * after each refresh the effect re-arms against the freshly rendered values
 * rather than comparing against a stale closure.
 *
 * The stage copy itself stays on the server. This component decides *when* the
 * screen is out of date, never what it should say — which keeps one vocabulary
 * for operation stages rather than a second one that drifts.
 */
export function OperationWatcher({
  projectId,
  operation,
}: {
  projectId: string;
  operation: OperationView | null;
}) {
  const router = useRouter();
  const operationId = operation?.operationId;
  const shouldPoll = operation?.shouldPoll ?? false;
  const stage = operation?.stage;
  const stalled = operation?.stalled ?? false;

  useEffect(() => {
    if (!operationId || !shouldPoll) return;
    let cancelled = false;

    const timer = window.setInterval(async () => {
      const result = await getOperationStatusAction(projectId, operationId);
      if (cancelled || !result.ok) return;

      const next = result.operation;
      const changed =
        !next.shouldPoll || next.stage !== stage || next.stalled !== stalled;
      if (changed) router.refresh();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [operationId, projectId, router, shouldPoll, stage, stalled]);

  return null;
}
