"use client";

import { useRouter } from "next/navigation";
import { useOperationPoll } from "@/lib/client/use-operation-poll";
import { operationPollPhase, type OperationView } from "@/modules/operations/view";
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
 * it crossed into stalled. The comparison is against the values this component
 * was last rendered with, so after each refresh it is judging the freshly
 * rendered screen rather than a stale closure.
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
  const operationId = operation?.operationId ?? null;
  const stage = operation?.stage;
  const stalled = operation?.stalled ?? false;

  useOperationPoll<OperationView>({
    key: operationId,
    enabled: operationPollPhase(operation) === "working",
    intervalMs: POLL_INTERVAL_MS,
    poll: async () => {
      if (!operationId) return { kind: "unavailable" };

      const result = await getOperationStatusAction(projectId, operationId);
      return result.ok ? { kind: "value", value: result.operation } : { kind: "unavailable" };
    },
    onReading: (next) => {
      const changed =
        operationPollPhase(next) !== "working" || next.stage !== stage || next.stalled !== stalled;

      if (changed) router.refresh();
    },
  });

  return null;
}
