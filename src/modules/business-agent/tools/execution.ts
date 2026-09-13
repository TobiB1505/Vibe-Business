import { stepResponsibility } from "@/modules/action-plans/view";
import { resolveAgentPlanRoutes } from "@/modules/coding-agent/website-preflight";
import { VIBE_EXECUTABLE_MODES } from "@/modules/execution-contract/schema";
import { boundToolResult, strictObject, type AgentTool } from "./registry";

/**
 * `resolve_execution` — whether Vibe can build one step, and why not.
 *
 * ## A forecast, never an admission
 *
 * `resolvePlanExecutionRoutes` reads stored state and nothing else: no live
 * HEAD, no crawl, no network. Its own docblock warns that `admission` here is
 * about stored state alone and must never be presented as permission, and rule
 * 55 says the same thing from the other side — stored evidence is a routing
 * signal, never authority. So this tool answers one question in one word, for
 * one sentence of a reply, and starting anything remains a control the founder
 * presses, which re-runs the real admission at that moment.
 *
 * ## Why it is classified `prepare` rather than `read_only`
 *
 * It reads. But what it produces is the input to an offer, and keeping the two
 * classes apart is what makes "the model called a prepare tool on a question
 * that only asked for advice" a countable event rather than an impression. The
 * seam pilot counted exactly that, and the arm that did it lost partly for it.
 *
 * ## The step key is a real key, resolved against this project's plan
 *
 * Not a sentinel, not an order number, not a title. If the key is not in the
 * current plan the answer is `not_found` naming the way back — the same answer
 * a key from another project's plan gets, and for the same reason.
 */
export const resolveExecutionTool: AgentTool = {
  name: "resolve_execution",
  description:
    "Whether Vibe can build one Action Plan step itself, and if not, why: the mode, the reason, the risk class and whose the step is. A forecast, never a promise — it starts nothing. Pass a step key from get_action_plan. Free.",
  inputSchema: strictObject({
    step_key: {
      type: "string",
      description: "A step key returned by get_action_plan.",
    },
  }),
  classification: "prepare",
  progressLabel: "Checking what Vibe can build",
  async execute(context, input) {
    const requested = String(input.step_key).trim();

    let routes;
    try {
      routes = await resolveAgentPlanRoutes(context.supabase, {
        projectId: context.projectId,
        userId: context.userId,
      });
    } catch {
      return {
        kind: "error",
        code: "read_failed",
        message: "What Vibe can build could not be worked out. Answer from what you have.",
      };
    }

    if (!routes.available) {
      return {
        kind: "ok",
        content:
          "state: no_plan\nThere is no Action Plan, so there is no step to resolve. Planning a Move is something the founder starts.",
        subjectIds: [],
        artifacts: [],
      };
    }

    const step = routes.plan.steps.find((candidate) => candidate.id === requested);
    const resolution = routes.resolutions.find((candidate) => candidate.stepKey === requested);
    if (!step || !resolution) {
      return {
        kind: "error",
        code: "not_found",
        message:
          "No step with that key exists in this project's Action Plan. Call get_action_plan for its step keys.",
      };
    }

    const vibeCanBuild = VIBE_EXECUTABLE_MODES.includes(resolution.mode);
    const responsibility = stepResponsibility(step, resolution);

    const lines = [
      `step_key: ${resolution.stepKey}`,
      `title: ${step.title}`,
      `vibe_can_build_this: ${vibeCanBuild ? "yes" : "no"}`,
      `mode: ${resolution.mode}`,
      `reason: ${resolution.reason}`,
      resolution.unmetRequirements.length > 0
        ? `also_unmet: ${resolution.unmetRequirements.join(", ")}`
        : null,
      `risk_class: ${resolution.riskClass}`,
      `whose_step_this_is: ${responsibility.headline}${responsibility.sublabel ? ` — ${responsibility.sublabel}` : ""}`,
      resolution.blockedBy.length > 0
        ? `waiting_on_steps: ${resolution.blockedBy.join(", ")}`
        : null,
      "note: this is a forecast from stored state. Nothing has started, and starting it is a control the founder presses.",
    ].filter((line): line is string => line !== null);

    return {
      kind: "ok",
      content: boundToolResult(lines.join("\n")),
      subjectIds: [resolution.stepKey],
      artifacts: [],
    };
  },
};
