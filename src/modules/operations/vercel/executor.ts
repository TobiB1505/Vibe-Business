import "server-only";

import { start } from "workflow/api";
import { businessAuditWorkflow } from "../business-audit/workflow";
import { opportunityGenerationWorkflow } from "../opportunities/workflow";
import { changeValidationWorkflow } from "../change-validation/workflow";
import { changePreviewWorkflow } from "../change-preview/workflow";
import { previewTeardownWorkflow } from "../change-preview/teardown-workflow";
import { changeReviewWorkflow } from "../change-review/workflow";
import { changePreparationWorkflow } from "../change-preparation/workflow";
import { changeMergeWorkflow } from "../change-merge/workflow";
import { changeOutcomeVerificationWorkflow } from "../change-outcome-verification/workflow";
import { businessMeasurementWorkflow } from "../business-measurement/workflow";
import { productUnderstandingWorkflow } from "../product-understanding/workflow";
import { actionPlanningWorkflow } from "../action-plans/workflow";
import type { OperationExecutor, StartOperationInput, StartOperationResult } from "../executor";
import type { OperationType } from "../schema";

/**
 * Vercel Workflows adapter (Sprint 7 §3, §4 — ADR 0013).
 *
 * The only file allowed to name the workflow platform. Everything above it
 * sees `OperationExecutor` and an operation id.
 *
 * `start()` enqueues and returns; it does not wait for the run. Awaiting the
 * run's `returnValue` here would recreate the exact problem this sprint
 * exists to remove — a browser request holding a ~50 second operation open —
 * so this adapter only ever reads `runId`.
 *
 * A failure to enqueue is reported as a typed code rather than thrown. The
 * caller has already created an operation row, and leaving it queued with no
 * durable run behind it would block the identity's unique index forever.
 */
/**
 * The one place an operation type is mapped to durable work.
 *
 * A `Record` over the closed type union rather than a switch: adding an
 * operation type without a workflow becomes a type error instead of a run that
 * is accepted and then never happens.
 */
const WORKFLOWS: Record<OperationType, (operationId: string) => Promise<void>> = {
  business_audit: businessAuditWorkflow,
  opportunity_generation: opportunityGenerationWorkflow,
  change_preparation: changePreparationWorkflow,
  change_validation: changeValidationWorkflow,
  change_preview: changePreviewWorkflow,
  preview_teardown: previewTeardownWorkflow,
  change_review: changeReviewWorkflow,
  change_merge: changeMergeWorkflow,
  change_outcome_verification: changeOutcomeVerificationWorkflow,
  business_measurement: businessMeasurementWorkflow,
  product_understanding: productUnderstandingWorkflow,
  action_planning: actionPlanningWorkflow,
};

export class VercelWorkflowExecutor implements OperationExecutor {
  readonly name = "vercel_workflow";

  async start(input: StartOperationInput): Promise<StartOperationResult> {
    try {
      // Only the id crosses the boundary. Everything the run needs is in the
      // database, which is what keeps evidence out of the durable log (§14).
      const run = await start(WORKFLOWS[input.operationType], [input.operationId]);
      return { ok: true, runId: run.runId };
    } catch (error) {
      // The provider's message is not shown to a user and not stored; it goes
      // to server logs alone, where an operator can act on it.
      console.error("[operations] failed to start durable run", {
        operationId: input.operationId,
        operationType: input.operationType,
        error: error instanceof Error ? error.message : "unknown",
      });
      return { ok: false, error: "execution_start_failed" };
    }
  }
}
