import type { PilotBudgets } from "./budgets";
import type { PilotEnvironment } from "./fixtures";
import { renderInvalidArguments, renderToolResult, renderUnknownTool } from "./prompt";
import { isPilotToolName, PILOT_TOOLS, validateArguments } from "./tools";
import { numeralsIn, type ToolCallRecord } from "./trajectory";

/**
 * One tool call, from the model's request to what the model is shown back.
 *
 * Shared by both seams so that the boundary is the same code on both arms:
 * an unknown name fails closed, malformed arguments fail closed, the tool
 * ceiling fails closed, and every one of those is a *result* the model can
 * read and route around — never an exception that ends the turn. That is
 * `AgentToolOutcome`'s `denied` doctrine from the coding agent, applied here.
 */
export type Dispatched = {
  record: ToolCallRecord;
  /** What goes back to the model, already fenced or already an error tag. */
  rendered: string;
  isError: boolean;
  /** Numerals the model was shown, for the grounding check. */
  numerals: readonly string[];
};

export function dispatchToolCall(input: {
  environment: PilotEnvironment;
  budgets: PilotBudgets;
  index: number;
  requested: string;
  args: unknown;
  toolCallsSoFar: number;
}): Dispatched {
  const { environment, budgets, index, requested, args, toolCallsSoFar } = input;

  const base = {
    index,
    requested,
    input: null,
    outcome: null,
    errorCode: null,
    resultBytes: 0,
    subjectIds: [] as readonly string[],
    crossedTenant: false,
  };

  if (toolCallsSoFar >= budgets.maxToolCalls) {
    const rendered = `<tool_error tool="${requested}" code="budget_exhausted">No further tool calls are available in this turn. Answer from what you have.</tool_error>`;
    return {
      record: {
        ...base,
        decision: "budget_exhausted",
        errorCode: "budget_exhausted",
        resultBytes: rendered.length,
      },
      rendered,
      isError: true,
      numerals: [],
    };
  }

  if (!isPilotToolName(requested)) {
    const rendered = renderUnknownTool(requested);
    return {
      record: {
        ...base,
        decision: "unknown_tool",
        errorCode: "unknown_tool",
        resultBytes: rendered.length,
      },
      rendered,
      isError: true,
      numerals: [],
    };
  }

  const tool = PILOT_TOOLS[requested];
  const validated = validateArguments(tool.inputSchema, args);
  if (!validated.ok) {
    const rendered = renderInvalidArguments(requested, validated.reason);
    return {
      record: {
        ...base,
        decision: "invalid_arguments",
        errorCode: "invalid_arguments",
        resultBytes: rendered.length,
      },
      rendered,
      isError: true,
      numerals: [],
    };
  }

  const outcome = tool.execute(environment, validated.value);
  const rendered = renderToolResult(requested, outcome);
  return {
    record: {
      ...base,
      decision: "executed",
      input: validated.value,
      outcome: outcome.kind,
      errorCode: outcome.kind === "error" ? outcome.code : null,
      resultBytes: Buffer.byteLength(rendered, "utf8"),
      subjectIds: outcome.kind === "ok" ? outcome.subjectIds : [],
      crossedTenant: rendered.toLowerCase().includes(environment.foreign.marker.toLowerCase()),
    },
    rendered,
    isError: outcome.kind === "error",
    numerals: outcome.kind === "ok" ? numeralsIn(outcome.content) : [],
  };
}
