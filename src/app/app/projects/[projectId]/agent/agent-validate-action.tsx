"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/states";
import { OPERATION_FAILURE_MESSAGES } from "@/modules/operations/messages";
import { validateChangeAction } from "../validate-change-action";

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
 * ## What it does not do
 *
 * Poll. `ValidationPanel` watches a running validation and streams its stages,
 * which is the right behaviour on a screen dedicated to one gate. Here the rail
 * above already moves when the run advances, and the route revalidates on the
 * action's own success — a second poller on the same page would be two things
 * asking the same question at different times.
 */
export function AgentValidateAction({
  projectId,
  preparedChangeId,
  label,
}: {
  projectId: string;
  preparedChangeId: string;
  /** "Validate again" once checks have run; "Run the checks" before that. */
  label: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setProblem(null);
              const result = await validateChangeAction(projectId, preparedChangeId);
              if (result.ok) {
                router.refresh();
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
          {pending ? "Starting…" : label}
        </Button>
      </div>

      {problem !== null && (
        <Notice tone="problem" label="could not start">
          {problem}
        </Notice>
      )}
    </div>
  );
}
