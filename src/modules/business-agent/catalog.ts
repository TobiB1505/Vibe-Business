/**
 * The tool names and the words a founder reads while one runs.
 *
 * ## Why this is a file of its own
 *
 * `tools/registry.ts` carries `server-only` because its adapters read Supabase,
 * and the thread has to render a turn's steps in the browser. The names and
 * their founder-facing labels are the part both sides need, so they live here
 * with no import that could drag a database read into a client bundle — the
 * same split `artifacts.ts` exists for.
 *
 * ## The label is the whole point
 *
 * A founder never reads `get_business_health`, and never reads
 * `{"opportunity_id":"opp-1"}`. Vibe's own vocabulary for its machinery is
 * banned from anything generated (`BANNED_MODULE_NAMES`), and a hand-written
 * screen is held to the same line. What they read is a sentence Vibe wrote
 * about what was being done — "Reading your Business Health" — which is both
 * truthful and the only version that means anything to them.
 *
 * This is also why the catalogue components that render a tool call as its raw
 * name with a JSON payload beneath it were rejected rather than ported: they
 * are built for an engineer watching an agent, and this surface is a founder
 * watching their own business.
 */

export const AGENT_TOOL_NAMES = [
  "use_skill",
  "get_project_focus",
  "get_business_health",
  "get_opportunities",
  "get_action_plan",
  "resolve_execution",
] as const;

export type AgentToolName = (typeof AGENT_TOOL_NAMES)[number];

export function isAgentToolName(name: string): name is AgentToolName {
  return (AGENT_TOOL_NAMES as readonly string[]).includes(name);
}

/**
 * `read_only` reads rows. `prepare` builds a forecast or an offer and still
 * changes nothing. There is no third class, because a class that acted would
 * need a tool that acts, and this slice writes none.
 */
export type AgentToolClassification = "read_only" | "prepare";

export const AGENT_TOOL_CLASSIFICATION: Record<AgentToolName, AgentToolClassification> = {
  use_skill: "read_only",
  get_project_focus: "read_only",
  get_business_health: "read_only",
  get_opportunities: "read_only",
  get_action_plan: "read_only",
  resolve_execution: "prepare",
};

/** What the thread shows while this runs. Vibe-authored, never model text. */
export const AGENT_TOOL_PROGRESS_LABELS: Record<AgentToolName, string> = {
  use_skill: "Working out how to answer this",
  get_project_focus: "Checking what needs attention",
  get_business_health: "Reading your Business Health",
  get_opportunities: "Reading your Moves",
  get_action_plan: "Looking at your Action Plan",
  resolve_execution: "Checking what Vibe can build",
};

/**
 * What a founder is told about a step whose name Vibe does not recognise.
 *
 * Reached when a turn recorded a tool that has since left the registry — an old
 * conversation read under new code. The alternative is rendering the stored
 * string, which is the one thing this file exists to prevent.
 */
export const UNKNOWN_STEP_LABEL = "Checking something";

export function agentStepLabel(tool: string): string {
  return isAgentToolName(tool) ? AGENT_TOOL_PROGRESS_LABELS[tool] : UNKNOWN_STEP_LABEL;
}
