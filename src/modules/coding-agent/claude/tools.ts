import { z } from "zod";
import { AGENT_CHECK_NAMES, AGENT_DECISION_TOOL, type AgentToolRequestName } from "../schema";
import { EXECUTION_INTERRUPT_TYPES } from "@/modules/execution-contract/schema";

/**
 * Zod shapes for the Claude adapter's tools (EXECUTION CORE-4 §5, §10).
 *
 * ## Why the shapes are here rather than on the descriptors
 *
 * `AgentToolDescriptor` carries JSON Schema because it is provider-neutral —
 * a future adapter for a provider that speaks JSON Schema uses it directly. The
 * Claude Agent SDK's `tool()` helper wants a Zod raw shape, so the translation
 * lives on the Claude side of the boundary rather than pushing a Zod dependency
 * into the domain.
 *
 * ## These schemas are not the enforcement
 *
 * A schema constrains what the model is *asked* to produce. The gateway
 * re-validates every argument on receipt, because the model can send anything
 * and a provider's validation is a request rather than a fact (§11). If a shape
 * here and a check in `gateway.ts` ever disagree, the gateway wins by
 * construction: it runs second and it is the only thing holding a workspace.
 *
 * A tool whose name has no shape below is simply not offered — the safe
 * direction for a gap between the two lists is silence, not an unschema'd tool.
 */

export const AGENT_TOOL_SHAPES: Partial<Record<AgentToolRequestName, z.ZodRawShape>> = {
  list_files: {
    path: z.string().optional().describe("Directory to list. Omit for the repository root."),
  },
  search_repository: {
    query: z.string().describe("Literal text to find. Not a regular expression."),
    path: z.string().optional().describe("Subtree to search. Omit to search everything."),
  },
  read_file: {
    path: z.string().describe("Repository-relative path to read."),
  },
  write_file: {
    path: z.string().describe("Repository-relative path to create or replace."),
    content: z.string().describe("The file's complete new contents."),
  },
  delete_file: {
    path: z.string().describe("Repository-relative path to delete."),
  },
  run_check: {
    check: z.enum(AGENT_CHECK_NAMES).describe("Which of the repository's checks to run."),
  },
  [AGENT_DECISION_TOOL]: {
    situation: z
      .enum(EXECUTION_INTERRUPT_TYPES)
      .describe("Which kind of decision this is. Vibe writes the question itself."),
    options: z
      .array(z.string())
      .optional()
      .describe("Two to four short answer choices, when the situation has them."),
  },
};
