import { getLatestActionPlan } from "@/modules/action-plans/service";
import { getLatestOpportunities } from "@/modules/opportunities/service";
import { boundToolResult, strictObject, type AgentTool } from "./registry";

/**
 * `get_action_plan` — the plan Vibe holds, for a Move the model names.
 *
 * ## Why the Move id is required and never optional
 *
 * ADR 0109 measured what an optional identifier costs under native tool
 * calling: asked to pass an empty string for "the latest", the model emitted
 * `"\""\""`, a single space, and fragments of its own tool-call markup, then
 * repeated the identical malformed call until the turn's ceiling stopped it and
 * the founder got nothing. The remedy is a rule rather than a workaround: no
 * tool in this registry takes a sentinel. The Move id comes from
 * `get_opportunities` or `get_project_focus`, both of which carry ids for
 * exactly this reason.
 *
 * ## The typed clarification state
 *
 * A project has one current plan. If the Move the model asked about is a real
 * Move of this project but not the one the plan is for, that is not an error
 * and not an empty answer — it is a *clarification*: the tool says which Move
 * the plan is actually for, and the model can ask again with that id. §5 of the
 * slice brief asks for exactly this where ambiguity cannot be resolved
 * deterministically, and "guess which plan they meant" is the thing it forbids.
 *
 * ## Nothing here starts a refresh (rule 60)
 *
 * Staleness is reported. A stale plan stays visible, because it was true when
 * it was made and hiding a founder's plan to tidy a screen is worse than saying
 * so. Planning a Move costs Credits and is a control the founder presses.
 */
export const getActionPlanTool: AgentTool = {
  name: "get_action_plan",
  description:
    "The Action Plan for one Move: its goal, the ordered steps with who does each and its step key, which are already done, the first step that can be worked on now, and whether the plan is stale. Pass a Move id from get_opportunities or get_project_focus. Free.",
  inputSchema: strictObject({
    opportunity_id: {
      type: "string",
      description: "A Move id returned by get_opportunities or get_project_focus.",
    },
  }),
  classification: "read_only",
  async execute(context, input) {
    const requested = String(input.opportunity_id).trim();

    let opportunities;
    let plan;
    try {
      [opportunities, plan] = await Promise.all([
        getLatestOpportunities(context.supabase, context.projectId),
        getLatestActionPlan(context.supabase, context.projectId),
      ]);
    } catch {
      return {
        kind: "error",
        code: "read_failed",
        message: "The Action Plan could not be read. Answer from what you have.",
      };
    }

    const known = new Set((opportunities?.set.opportunities ?? []).map((move) => move.id));
    if (!known.has(requested)) {
      return {
        kind: "error",
        code: "not_found",
        message:
          "No Move with that id exists in this project. Call get_opportunities for this project's own Move ids.",
      };
    }

    if (!plan) {
      return {
        kind: "ok",
        content:
          "state: no_plan\nNo Action Plan has been made for this project yet. Planning a Move is something the founder starts.",
        subjectIds: [requested],
        artifacts: [],
      };
    }

    if (plan.plan.opportunityId !== requested) {
      const planned = plan.plan.opportunityId;
      return {
        kind: "ok",
        content: [
          "state: plan_is_for_another_move",
          `The current Action Plan is for Move ${planned ?? "(unknown)"}, not the one you asked about.`,
          planned ? `Ask again with ${planned} to read it.` : "",
          "The Move you asked about has no plan of its own; planning it is something the founder starts.",
        ]
          .filter((line) => line.length > 0)
          .join("\n"),
        subjectIds: [requested, ...(planned ? [planned] : [])],
        artifacts: [],
      };
    }

    const done = new Set(plan.completedStepOrders);
    const lines = [
      `state: ${plan.staleness.length > 0 ? `stale — ${plan.staleness.join(", ")}` : "current"}`,
      `for_move: ${requested}`,
      plan.plan.goal ? `goal: ${plan.plan.goal}` : null,
      plan.plan.whyNow ? `why_now: ${plan.plan.whyNow}` : null,
      "steps:",
    ].filter((line): line is string => line !== null);

    for (const step of plan.plan.steps) {
      const absorbed = plan.absorbedByStepOrder[step.order];
      const state = done.has(step.order)
        ? "done"
        : absorbed !== undefined
          ? `covered by step ${absorbed}`
          : "open";
      lines.push(`  step_key: ${step.id}`);
      lines.push(`  order: ${step.order}  state: ${state}  whose: ${step.actor}`);
      lines.push(`  title: ${step.title}`);
      lines.push(`  purpose: ${step.purpose}`);
      lines.push(`  done_when: ${step.completionCriteria}`);
      lines.push("");
    }

    lines.push(
      plan.firstActionableStep
        ? `first_step_that_can_be_worked_on_now: ${plan.firstActionableStep.id} — ${plan.firstActionableStep.title}`
        : "first_step_that_can_be_worked_on_now: (none — every remaining step is waiting on something)",
    );
    if (plan.openFounderInputCount > 0) {
      lines.push("note: this plan is waiting on an answer from the founder");
    }

    return {
      kind: "ok",
      content: boundToolResult(lines.join("\n")),
      subjectIds: [requested, ...plan.plan.steps.map((step) => step.id)],
      artifacts: [{ kind: "opportunity", subjectId: requested }],
    };
  },
};
