"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/states";
import { OPERATION_FAILURE_MESSAGES } from "@/modules/operations/messages";
import { operationPollPhase, type OperationView } from "@/modules/operations/view";
import { useOperationPoll } from "@/lib/client/use-operation-poll";
import {
  getValidationProgressAction,
  rerunChangeValidationAction,
  validateChangeAction,
} from "../validate-change-action";

const POLL_INTERVAL_MS = 2_500;

/**
 * Run the checks again, from the stage that shows them (UI-19).
 *
 * ## Why the control moved here
 *
 * The validation stage used to render its check rows and then mount the old
 * `ValidationPanel` underneath, which said the same thing again and carried the
 * only button. A founder saw their checks twice and had to scroll past the new
 * card to act on it. The new card owns the action now; the panel is not mounted
 * for this stage at all.
 *
 * A retry opts out of pass reuse: "Validate again" means a new isolated
 * observation. The poll below follows that durable operation and refreshes the
 * server-owned result only when it settles.
 */
export function AgentValidateAction({
  projectId,
  preparedChangeId,
  label,
  rerun,
}: {
  projectId: string;
  preparedChangeId: string;
  /** "Validate again" once checks have run; "Run the checks" before that. */
  label: string;
  /** Whether this click must produce a fresh validation observation. */
  rerun: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);
  const [started, setStarted] = useState<OperationView | null>(null);

  const { latest } = useOperationPoll<OperationView>({
    key: started?.operationId ?? null,
    enabled: operationPollPhase(started) === "working",
    intervalMs: POLL_INTERVAL_MS,
    poll: async () => {
      const operationId = started?.operationId;
      if (!operationId) return { kind: "unavailable" };

      const result = await getValidationProgressAction(
        projectId,
        preparedChangeId,
        operationId,
      );
      return result.ok
        ? { kind: "value", value: result.operation }
        : { kind: "unavailable" };
    },
    continueAfter: (next) => operationPollPhase(next) === "working",
    onReading: (next) => {
      if (operationPollPhase(next) !== "working") router.refresh();
    },
  });

  const operation = latest ?? started;
  const running = pending || operationPollPhase(operation) === "working";

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Button
          type="button"
          variant="accent"
          size="md"
          disabled={running}
          busy={running}
          className="min-w-[11.5rem]"
          onClick={() =>
            startTransition(async () => {
              setProblem(null);
              const result = await (rerun
                ? rerunChangeValidationAction(projectId, preparedChangeId)
                : validateChangeAction(projectId, preparedChangeId));
              if (result.ok) {
                if (result.kind === "running") {
                  setStarted(result.operation);
                } else {
                  router.refresh();
                }
                return;
              }
              /*
               * The same table the old panel read from, so one failure code
               * does not acquire two different sentences depending on which
               * screen a founder happened to be looking at.
               */
              setProblem(
                OPERATION_FAILURE_MESSAGES[
                  result.error as keyof typeof OPERATION_FAILURE_MESSAGES
                ] ?? "Vibe could not start the checks.",
              );
            })
          }
        >
          {!running && (
            <svg
              viewBox="0 0 24 24"
              width="17"
              height="17"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M20 11a8 8 0 1 1-2.35-5.65" />
              <path d="M20 4v7h-7" />
            </svg>
          )}
          {pending ? "Starting…" : running ? "Checks running…" : label}
        </Button>
      </div>

      {running && (
        <p role="status" className="text-fg-muted text-xs">
          Vibe is validating this exact change in an isolated environment. You can leave this page.
        </p>
      )}

      {problem !== null && (
        <Notice tone="problem" label="could not start">
          {problem}
        </Notice>
      )}
    </div>
  );
}
