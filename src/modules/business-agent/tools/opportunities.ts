import { getLatestActionPlan } from "@/modules/action-plans/service";
import { getLatestOpportunities } from "@/modules/opportunities/service";
import { MOVE_BAND_LABELS, moveBand } from "@/modules/opportunities/view";
import { boundToolResult, strictObject, type AgentTool } from "./registry";

/**
 * `get_opportunities` — the ranked Moves, as the product ranked them.
 *
 * ## Why the plan's Move is named here
 *
 * Because the alternative was a sentinel. `get_action_plan` takes a Move id and
 * nothing else — no "" meaning "the current one" — so the model has to know
 * which Move the plan is for before it can ask about it, and the honest place
 * to say that is beside the Moves. Naming it here is what lets the next tool's
 * argument be a real identifier the model read, which is the whole remedy ADR
 * 0109 records for Seam A's one measured defect.
 *
 * ## Staleness is observed, never inferred
 *
 * `OpportunitySetView.stale` is true when a newer audit exists than the one
 * this set was ranked against. It is an id comparison, not a clock, and it is
 * reported as it is: nothing is hidden, deleted or silently refreshed, because
 * a set that disappeared would be a founder's ranked work vanishing to make a
 * screen tidy.
 */
export const getOpportunitiesTool: AgentTool = {
  name: "get_opportunities",
  description:
    "The ranked Moves from the latest Opportunity run — each with its id, the problem it addresses, why now, impact, effort and how confident Vibe is that the problem exists — plus which Move already has an Action Plan, and whether the ranking is stale against a newer audit. Free.",
  inputSchema: strictObject({}),
  classification: "read_only",
  async execute(context) {
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
        message: "The Moves could not be read. Answer from what you have.",
      };
    }

    if (!opportunities || opportunities.set.opportunities.length === 0) {
      return {
        kind: "ok",
        content:
          "state: no_moves\nNo Moves have been ranked for this project yet, so there is no ranking to read.",
        subjectIds: [],
        artifacts: [],
      };
    }

    const plannedMoveId = plan?.plan.opportunityId ?? null;
    const moves = opportunities.set.opportunities.slice().sort((a, b) => a.rank - b.rank);

    const lines = [
      `state: ${opportunities.stale ? "stale — a newer Business Audit exists than the one these were ranked against" : "current"}`,
      `planned_move: ${plannedMoveId ?? "(no Move has an Action Plan yet)"}`,
      "moves:",
    ];

    for (const move of moves) {
      lines.push(`  id: ${move.id}`);
      lines.push(`  band: ${MOVE_BAND_LABELS[moveBand(move.rank)]}`);
      lines.push(`  title: ${move.title}`);
      lines.push(`  problem: ${move.problem}`);
      lines.push(`  why_now: ${move.whyNow}`);
      lines.push(
        `  impact: ${move.impact}  effort: ${move.effort}  confidence_the_problem_exists: ${move.confidence}`,
      );
      lines.push(`  has_plan: ${move.id === plannedMoveId ? "yes" : "no"}`);
      lines.push("");
    }

    return {
      kind: "ok",
      content: boundToolResult(lines.join("\n")),
      subjectIds: moves.map((move) => move.id),
      artifacts: moves.map((move) => ({ kind: "opportunity", subjectId: move.id }) as const),
    };
  },
};
