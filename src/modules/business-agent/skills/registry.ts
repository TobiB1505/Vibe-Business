import type { AgentToolName } from "../tools/registry";
import { NEXT_MOVE_SKILL } from "./next-move/skill";

/**
 * The skill registry: Vibe-authored procedures the model loads by name.
 *
 * ## A skill is not a mode
 *
 * Nothing routes on a skill. There is no keyword table, no classifier and no
 * DSL — the model reads an index of one-line intents in the system prompt and
 * asks for a procedure with `use_skill` when one fits. Selection is the model's;
 * the procedure is Vibe's. That division is what keeps a skill from becoming a
 * second place where product behaviour is decided by prose nobody versioned.
 *
 * ## Why only one skill ships here
 *
 * Rule 15. The audit's catalogue names fifteen, and fourteen of them have no
 * caller, no tools built for them and no evaluation. `next-move` is the skill
 * the first vertical slice exists to prove, so it is the skill that exists.
 *
 * ## What the registry guarantees
 *
 * A skill may only name tools the tool registry has — `registry.test.ts` checks
 * every `recommendedTools` entry against `AGENT_TOOL_NAMES`, so a skill cannot
 * quietly instruct the model toward a capability that is absent. The version
 * below is stored on every turn run, so a reply can always be read against the
 * procedure that produced it.
 */

export const SKILL_REGISTRY_VERSION = "agent-skills-v1";

export type AgentSkill = {
  id: string;
  /** The one line the system prompt carries. The model selects from these. */
  whenToUse: string;
  /** Tools this procedure expects to use. Advisory to the model, checked by the registry. */
  recommendedTools: readonly AgentToolName[];
  /** The authored procedure, returned verbatim by `use_skill`. */
  procedure: string;
};

export const AGENT_SKILLS: readonly AgentSkill[] = [NEXT_MOVE_SKILL];

export const AGENT_SKILL_IDS = AGENT_SKILLS.map((skill) => skill.id);

export function findSkill(id: string): AgentSkill | null {
  return AGENT_SKILLS.find((skill) => skill.id === id) ?? null;
}

/**
 * The index the system prompt carries — ids and intents, never procedures.
 *
 * Fifteen procedures in a system prompt would be most of the prompt and nearly
 * all of it unread. One line each is what the model needs to choose; the body
 * arrives only when it does.
 */
export function renderSkillIndex(): string {
  return AGENT_SKILLS.map((skill) => `- ${skill.id}: ${skill.whenToUse}`).join("\n");
}
