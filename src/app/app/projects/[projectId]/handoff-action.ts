"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getLatestActionPlan } from "@/modules/action-plans/service";
import { requireSession } from "@/modules/auth/session";
import { resolvePlanExecutionRoutes } from "@/modules/coding-agent/website-preflight";
import { REFUSAL_SHAPES } from "@/modules/execution-contract/view";
import { HANDOFF_TOOLS, type HandoffTool } from "@/modules/handoff/schema";
import { recordActionPlanHandoff } from "@/modules/operations/handoff/server-writes";

export type HandoffActionState = { ok: true } | { ok: false; message: string } | null;

const ERROR_COPY = {
  project_not_found: "This project is no longer available.",
  step_not_handoffable: "This step is no longer the one waiting on you. Reload the plan.",
  not_refused: "Vibe can build this one itself now, so there is nothing to hand over.",
  unknown_tool: "Pick one of the listed tools.",
  handoff_failed: "That could not be saved. Please try again.",
} as const;

/**
 * Hand one step to the founder's own coding tool (ADR 0096).
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
 */
export async function recordHandoffAction(
  projectId: string,
  actionPlanId: string,
  stepKey: string,
  _previous: HandoffActionState,
  formData: FormData,
): Promise<HandoffActionState> {
  void _previous;
  const submitted = formData.get("tool");
  if (typeof submitted !== "string" || !HANDOFF_TOOLS.includes(submitted as HandoffTool)) {
    return { ok: false, message: ERROR_COPY.unknown_tool };
  }
  const tool = submitted as HandoffTool;

  const session = await requireSession();
  const supabase = await createClient();
  const current = await getLatestActionPlan(supabase, projectId);

  if (
    !current ||
    current.plan.id !== actionPlanId ||
    current.staleness.length > 0 ||
    current.firstActionableStep?.id !== stepKey
  ) {
    return { ok: false, message: ERROR_COPY.step_not_handoffable };
  }

  const routes = await resolvePlanExecutionRoutes(supabase, {
    projectId,
    userId: session.userId,
    plan: current.plan,
  });
  const resolution = routes.resolutions.find(
    (entry) => entry.stepKey === stepKey,
  );
  if (!resolution || REFUSAL_SHAPES[resolution.reason] !== "policy") {
    return { ok: false, message: ERROR_COPY.not_refused };
  }

  const result = await recordActionPlanHandoff({
    projectId,
    userId: session.userId,
    actionPlanId,
    stepKey,
    tool,
  });
  if (!result.ok) return { ok: false, message: ERROR_COPY[result.error] };

  revalidatePath(`/app/projects/${projectId}/plan`);
  return { ok: true };
}
