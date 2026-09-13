import "server-only";
import {
  AGENT_TOOLS,
  boundToolResult,
  isAgentToolName,
  validateArguments,
  type AgentArtifactRef,
  type AgentToolClassification,
  type AgentToolContext,
} from "../tools/registry";
import { untrusted, renderToolErrorBlock } from "./prompt";

/**
 * One tool call: what the model asked for, what Vibe decided, what it saw.
 *
 * ## Four ways to be refused, all of them results
 *
 * An unknown name, malformed arguments, a repeat of a call already made this
 * turn, and a call past the tool ceiling. None of them throws and none of them
 * ends the turn: each comes back as a `<tool_error>` block the model reads and
 * can route around, because a model that is told *why* it was refused can
 * answer from what it has, and a model that gets an exception cannot.
 *
 * ## The duplicate guard, and what it is for
 *
 * ADR 0109 measured a turn in which the model called one tool five times with
 * the same malformed argument, burned its entire budget, and said nothing to
 * the founder. Identical `(tool, normalized arguments)` is therefore refused on
 * the second attempt with a Vibe-authored sentence naming what to do instead,
 * and the refusal **counts against the tool budget** — a guard that made
 * repeats free would turn a loop into an unbounded one.
 *
 * Normalization is key-sorted JSON, so argument order cannot smuggle a repeat
 * past it, and it is exact: two genuinely different arguments are two calls.
 *
 * ## Vibe renders the result, and fences it
 *
 * A tool's answer is derived from the founder's own product, so it arrives
 * inside an `<untrusted>` fence naming the tool that produced it (rule 42). The
 * one exception is `use_skill`, whose content is prose Vibe wrote — fencing
 * Vibe's own instructions would teach the model to disregard them.
 */

export type AgentToolDecision =
  | "allowed"
  | "unknown_tool"
  | "invalid_arguments"
  | "duplicate_call"
  | "tool_budget_exhausted";

export type AgentToolCallRecord = {
  sequence: number;
  tool: string;
  classification: AgentToolClassification | null;
  decision: AgentToolDecision;
  denialReason: string | null;
  /** The arguments as given, for the trace. Never a file body, never prose. */
  input: Record<string, unknown>;
  resultKind: "ok" | "error" | "empty";
  resultBytes: number;
  subjectIds: readonly string[];
  durationMs: number;
};

export type DispatchedToolCall = {
  record: AgentToolCallRecord;
  /** Exactly what the model is shown. */
  rendered: string;
  isError: boolean;
  artifacts: readonly AgentArtifactRef[];
  numerals: readonly string[];
};

/** Key-sorted JSON, so argument order cannot disguise a repeat. */
export function normalizeArguments(input: unknown): string {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return JSON.stringify(input ?? null);
  }
  const entries = Object.entries(input as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return JSON.stringify(Object.fromEntries(entries));
}

/** Every maximal run of digits, so the validator knows what the model may write. */
function numeralsIn(text: string): string[] {
  return text.match(/\d+(?:[.,]\d+)*/g) ?? [];
}

const DUPLICATE_MESSAGE =
  "This exact request was already made in this turn and its result is above. Use that result, choose a different tool, or answer the founder.";

export async function dispatchAgentToolCall(params: {
  context: AgentToolContext;
  sequence: number;
  requested: string;
  args: unknown;
  /** True when the tool ceiling is already spent. */
  budgetExhausted: boolean;
  /** Normalized `(tool, arguments)` pairs already attempted this turn. */
  attempted: ReadonlySet<string>;
}): Promise<DispatchedToolCall> {
  const startedAt = Date.now();
  const args =
    typeof params.args === "object" && params.args !== null && !Array.isArray(params.args)
      ? (params.args as Record<string, unknown>)
      : {};

  const refuse = (
    decision: Exclude<AgentToolDecision, "allowed">,
    code: string,
    message: string,
    classification: AgentToolClassification | null = null,
  ): DispatchedToolCall => {
    const rendered = renderToolErrorBlock(params.requested, code, message);
    return {
      record: {
        sequence: params.sequence,
        tool: params.requested,
        classification,
        decision,
        denialReason: message,
        input: args,
        resultKind: "error",
        resultBytes: Buffer.byteLength(rendered, "utf8"),
        subjectIds: [],
        durationMs: Date.now() - startedAt,
      },
      rendered,
      isError: true,
      artifacts: [],
      numerals: [],
    };
  };

  if (params.budgetExhausted) {
    return refuse(
      "tool_budget_exhausted",
      "budget_exhausted",
      "No more tool calls are available in this turn. Answer the founder from what you already have.",
    );
  }

  if (!isAgentToolName(params.requested)) {
    return refuse("unknown_tool", "unknown_tool", "No such tool exists.");
  }

  const tool = AGENT_TOOLS[params.requested];
  const validated = validateArguments(tool.inputSchema, args);
  if (!validated.ok) {
    return refuse("invalid_arguments", "invalid_arguments", validated.reason, tool.classification);
  }

  const fingerprint = `${params.requested}:${normalizeArguments(validated.value)}`;
  if (params.attempted.has(fingerprint)) {
    return refuse("duplicate_call", "duplicate_call", DUPLICATE_MESSAGE, tool.classification);
  }

  let outcome;
  try {
    outcome = await tool.execute(params.context, validated.value);
  } catch {
    // A tool that throws is a bug in Vibe, not a finding about the product.
    // The model is told the read failed and answers from what it has; the turn
    // survives, which is the whole reason a tool result is data and not an
    // exception.
    outcome = {
      kind: "error" as const,
      code: "read_failed" as const,
      message: "That could not be read. Answer from what you have.",
    };
  }

  if (outcome.kind === "error") {
    const rendered = renderToolErrorBlock(params.requested, outcome.code, outcome.message);
    return {
      record: {
        sequence: params.sequence,
        tool: params.requested,
        classification: tool.classification,
        decision: "allowed",
        denialReason: null,
        input: validated.value,
        resultKind: "error",
        resultBytes: Buffer.byteLength(rendered, "utf8"),
        subjectIds: [],
        durationMs: Date.now() - startedAt,
      },
      rendered,
      isError: true,
      artifacts: [],
      numerals: [],
    };
  }

  const bounded = boundToolResult(outcome.content);
  // Vibe's own procedure is not third-party content and is not fenced as if it
  // were; everything derived from the founder's product is.
  const rendered =
    params.requested === "use_skill" ? bounded : untrusted(`tool:${params.requested}`, bounded);

  return {
    record: {
      sequence: params.sequence,
      tool: params.requested,
      classification: tool.classification,
      decision: "allowed",
      denialReason: null,
      input: validated.value,
      resultKind: bounded.trim().length === 0 ? "empty" : "ok",
      resultBytes: Buffer.byteLength(rendered, "utf8"),
      subjectIds: outcome.subjectIds,
      durationMs: Date.now() - startedAt,
    },
    rendered,
    isError: false,
    artifacts: outcome.artifacts,
    numerals: numeralsIn(bounded),
  };
}
