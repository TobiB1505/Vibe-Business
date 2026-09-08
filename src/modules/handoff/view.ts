import { HANDOFF_TOOLS, type HandoffTool } from "./schema";

/**
 * What each tool is called, in the founder's language (mirrors §42's rule).
 *
 * A lookup rather than a formatted enum, for the same reason every other
 * founder-facing label in this codebase is one: `claude_code` is an internal
 * id and must never reach a screen.
 */
export const HANDOFF_TOOL_LABELS: Record<HandoffTool, string> = {
  claude_code: "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
  lovable: "Lovable",
  other: "Something else",
};

/** The tools in the order a picker should offer them. */
export const HANDOFF_TOOL_CHOICES: readonly { id: HandoffTool; label: string }[] =
  HANDOFF_TOOLS.map((id) => ({ id, label: HANDOFF_TOOL_LABELS[id] }));
