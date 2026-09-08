"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getLatestActionPlan } from "@/modules/action-plans/service";
import { requireSession } from "@/modules/auth/session";
import { resolvePlanExecutionRoutes } from "@/modules/coding-agent/website-preflight";
import { REFUSAL_SHAPES } from "@/modules/execution-contract/view";
import { HANDOFF_TOOLS, type HandoffPurpose, type HandoffTool } from "@/modules/handoff/schema";
import { recordActionPlanHandoff } from "@/modules/operations/handoff/server-writes";

export type HandoffActionState = { ok: true } | { ok: false; message: string } | null;

const ERROR_COPY = {
  project_not_found: "This project is no longer available.",
  step_not_handoffable: "This step is no longer the one waiting on you. Reload the plan.",
  not_refused: "Vibe can build this one itself now, so there is nothing to hand over.",
  not_measurable: "This step is not one you check yourself, so there is no prompt to give you.",
  unknown_tool: "Pick one of the listed tools.",
  handoff_failed: "That could not be saved. Please try again.",
} as const;

/**
 * Hand one step to the founder's own coding tool (ADR 0099).
 *
 * ## The check that makes the attestation gate mean anything
 *
 * A handoff is what lets a `vibe` + `product_change` step be closed by the
 * founder's word, and that exclusion exists so nobody can confirm away work the
 * agent would build. So the offer is only legitimate where Vibe genuinely
 * refuses — and that is re-derived here, from the live resolution, immediately
 * before the write. Rendering a button is never authority (rule 55); the button
 * may have been drawn against a repository state that has since changed.
 *
 * `policy` is the only admitted shape. A repairable refusal has a fix, a
 * sequencing one has an order, and handing either out would tell a founder to
 * go and build something Vibe was about to be able to do.
 *
 * ## The second purpose, checked differently
 *
 * A `verify` handoff has no execution resolution to consult, because there is
 * no execution: the step is `founder_action` + `measurement`, work that was
 * never Vibe's. So its admission is the step's own immutable shape, read from
 * the stored plan — not a live refusal, and not model prose.
 *
 * It also grants nothing. That step was already the founder's to close, so the
 * prompt adds help and no permission. The narrow check is written anyway,
 * because a purpose that admitted more than one shape would be one refactor
 * away from admitting the shape `build` exists to gate.
 */
export async function recordHandoffAction(
  projectId: string,
  actionPlanId: string,
  stepKey: string,
  /** Bound by the surface that rendered the control, never read from the form. */
  purpose: HandoffPurpose,
  _previous: HandoffActionState,
  formData: FormData,
): Promise<HandoffActionState> {
  void _previous;
  const submitted = formData.get("tool");
  if (typeof submitted !== "string" || !HANDOFF_TOOLS.includes(submitted as HandoffTool)) {
    return { ok: false, message: ERROR_COPY.unknown_tool };
  }
  const tool = submitted as HandoffTool;

  /*
   * Staleness is deliberately *not* a gate here (ADR 0099).
   *
   * `planStaleness` says the diagnosis behind the plan moved — a new product
   * profile, a newer audit. It does not say this step is wrong, and the plan
   * screen keeps showing a stale plan on purpose: "hiding a founder's plan
   * because the diagnosis moved would be worse than saying so". Refusing every
   * action on a plan the product still displays is the dead end that argument
   * exists to prevent, and it is what a founder actually hit.
   *
   * Nothing is loosened by removing it. `getLatestActionPlan` returns the
   * latest completed plan, so a replan already fails the identity check on the
   * line above, and the record binds to one immutable plan/step pair either
   * way. The one place staleness still gates is `founder-input-action`, and
   * that difference is the point: answering a planner's question writes a
   * durable business statement later plans read, so a question from a
   * superseded diagnosis may genuinely be the wrong question.
   */
  const session = await requireSession();
  const supabase = await createClient();
  const current = await getLatestActionPlan(supabase, projectId);

  if (
    !current ||
    current.plan.id !== actionPlanId ||
    current.firstActionableStep?.id !== stepKey
  ) {
    return { ok: false, message: ERROR_COPY.step_not_handoffable };
  }

  const step = current.firstActionableStep;

  if (purpose === "verify") {
    if (step.actor !== "founder_action" || step.changeKind !== "measurement") {
      return { ok: false, message: ERROR_COPY.not_measurable };
    }
  } else {
    const routes = await resolvePlanExecutionRoutes(supabase, {
      projectId,
      userId: session.userId,
      plan: current.plan,
    });
    const resolution = routes.resolutions.find((entry) => entry.stepKey === stepKey);
    if (!resolution || REFUSAL_SHAPES[resolution.reason] !== "policy") {
      return { ok: false, message: ERROR_COPY.not_refused };
    }
  }

  const result = await recordActionPlanHandoff({
    projectId,
    userId: session.userId,
    actionPlanId,
    stepKey,
    tool,
    purpose,
  });
  if (!result.ok) return { ok: false, message: ERROR_COPY[result.error] };

  revalidatePath(`/app/projects/${projectId}/plan`);
  return { ok: true };
}
