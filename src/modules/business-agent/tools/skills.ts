import { AGENT_SKILL_IDS, findSkill } from "../skills/registry";
import { strictObject, type AgentTool } from "./registry";

/**
 * `use_skill` — Vibe hands the model its own procedure.
 *
 * The one tool here that reads no customer row and touches no database. What
 * it returns is prose Vibe wrote, so it is **not** fenced as untrusted: a
 * fence says "this came from outside and is data", and putting Vibe's own
 * instructions behind one would teach the model to disregard them.
 *
 * The id is enum-constrained to the registry, so an id the registry does not
 * have is refused by argument validation before this function runs, and a
 * skill that was removed cannot be loaded by a model that remembers it.
 *
 * The ids are imported from the skill registry directly rather than through
 * the tool registry, and that is not tidiness. The tool registry imports this
 * file, so reaching back into it for the enum made a cycle: at module init the
 * re-export was still undefined, the enum was dropped from the schema, and
 * `validateArguments` accepted any string as a skill id. `registry.test.ts`
 * found it by asking for a skill that does not exist and being given one.
 */
export const useSkillTool: AgentTool = {
  name: "use_skill",
  description:
    "Load Vibe's own procedure for a kind of question, by id, and follow it. Call this first when a skill in the index fits what the founder asked. Free.",
  inputSchema: strictObject({
    skill_id: {
      type: "string",
      enum: AGENT_SKILL_IDS,
      description: "An id from the skill index in your instructions.",
    },
  }),
  classification: "read_only",
  progressLabel: "Understanding your question",
  async execute(_context, input) {
    const skill = findSkill(String(input.skill_id));
    if (!skill) {
      return {
        kind: "error",
        code: "not_found",
        message: "No skill with that id exists. Answer from the tools you have.",
      };
    }
    return { kind: "ok", content: skill.procedure, subjectIds: [], artifacts: [] };
  },
};
