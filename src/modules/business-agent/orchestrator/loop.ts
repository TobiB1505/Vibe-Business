import "server-only";
import type { ToolCallingConfig } from "@/modules/ai/operations";
import type {
  AgentTurn,
  AIToolCallingProvider,
  AIUsage,
  ToolCallingRequest,
  ToolCallingUsage,
} from "@/modules/ai/provider";
import type { AgentArtifactRef, AgentToolContext } from "../tools/registry";
import { agentToolDescriptors } from "../tools/registry";
import { AGENT_TURN_BUDGETS, MAX_FOUNDER_MESSAGE_CHARS, type AgentTurnBudgets } from "./budgets";
import { dispatchAgentToolCall, normalizeArguments, type AgentToolCallRecord } from "./dispatch";
import { agentFallbackReply, type AgentFallbackReason } from "./fallback";
import { AGENT_PROMPT_VERSION, buildAgentSystemPrompt, renderFounderMessage } from "./prompt";
import { checkAgentReply, type AgentReplyFinding } from "./validate";

/**
 * The agent loop. It lives here, in the domain module, and never in the provider.
 *
 * ## One provider call is one model turn
 *
 * `generateWithTools` performs exactly one turn and returns. Which tool to run,
 * whether to run it at all, when to stop and what the founder finally reads are
 * all decisions this file makes — because they are product decisions, and a
 * provider that looped would be making them where no test of this product could
 * see them. It is also what makes usage exact: one call, one billed request,
 * one ledger row (rule 47).
 *
 * ## No retry, anywhere
 *
 * `maxRetries = 0` on the client and no retry here. A failed call is a failed
 * turn with a founder-visible sentence, never a second billed attempt at the
 * same question (rule 50).
 *
 * ## Every exit produces a reply
 *
 * There is no path out of `runAgentTurn` that returns an empty string. A
 * ceiling, a provider failure, a refused reply and a silent model each resolve
 * to a Vibe-authored sentence from `fallback.ts`. ADR 0109 measured the
 * alternative: two turns in thirty-six that ended at a ceiling having said
 * nothing at all, which is the worst outcome in the whole run.
 *
 * ## Ceilings are checked before the thing they bound
 *
 * The clock before each iteration, the model-call count before sampling, the
 * free token count before the paid call, the tool count before dispatch, the
 * output total after each call. A turn never discovers it has overspent.
 */

export type AgentTurnStop =
  | "answered"
  | "max_model_calls"
  | "max_tool_calls"
  | "max_total_output_tokens"
  | "max_wall_clock"
  | "input_budget_exceeded"
  | "output_truncated"
  | "provider_failure"
  | "empty_reply"
  | "validation_rejected";

export type AgentModelCallRecord = {
  index: number;
  estimatedInputTokens: number | null;
  usage: ToolCallingUsage | null;
  latencyMs: number;
  stopReason: string | null;
  failure: string | null;
  servedModel: string | null;
};

export type AgentTurnTotals = {
  modelCalls: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  durationMs: number;
};

export type AgentTurnResult = {
  /** Never empty. Either the model's validated reply or a Vibe-authored one. */
  reply: string;
  replySource: "model" | "template";
  fallbackReason: AgentFallbackReason | null;
  stop: AgentTurnStop;
  /** References to canonical rows the turn actually read. Never copies. */
  artifacts: readonly AgentArtifactRef[];
  modelCalls: readonly AgentModelCallRecord[];
  toolCalls: readonly AgentToolCallRecord[];
  totals: AgentTurnTotals;
  /** Why a model reply was refused, when one was. Persisted on the run, not shown. */
  validationFailures: readonly AgentReplyFinding[];
};

export type AgentTurnInput = {
  provider: AIToolCallingProvider;
  config: ToolCallingConfig;
  context: AgentToolContext;
  /** The fenced context brief. */
  contextBrief: string;
  /** Earlier messages of this conversation, oldest first, already bounded. */
  history: readonly { role: "founder" | "assistant"; text: string }[];
  founderMessage: string;
  budgets?: AgentTurnBudgets;
  now?: () => number;
};

/** One block, bounded at the door so nothing unbounded reaches a token count. */
export function boundFounderMessage(text: string): string {
  const oneBlock = text.replace(/\s+/g, " ").trim();
  return oneBlock.length > MAX_FOUNDER_MESSAGE_CHARS
    ? oneBlock.slice(0, MAX_FOUNDER_MESSAGE_CHARS)
    : oneBlock;
}

function historyTurns(history: AgentTurnInput["history"]): AgentTurn[] {
  return history.map(
    (turn): AgentTurn =>
      turn.role === "founder"
        ? { role: "user", content: renderFounderMessage(boundFounderMessage(turn.text)) }
        : { role: "assistant", content: [{ type: "text", text: turn.text }] },
  );
}

export const AGENT_POLICY_VERSION = "agent-policy-v1";

export async function runAgentTurn(input: AgentTurnInput): Promise<AgentTurnResult> {
  const budgets = input.budgets ?? AGENT_TURN_BUDGETS;
  const now = input.now ?? (() => Date.now());
  const startedAt = now();
  const system = buildAgentSystemPrompt();
  const tools = agentToolDescriptors();
  const founderMessage = boundFounderMessage(input.founderMessage);

  const messages: AgentTurn[] = [
    ...historyTurns(input.history),
    { role: "user", content: `${input.contextBrief}\n\n${renderFounderMessage(founderMessage)}` },
  ];

  const modelCalls: AgentModelCallRecord[] = [];
  const toolCalls: AgentToolCallRecord[] = [];
  const artifacts: AgentArtifactRef[] = [];
  const subjectIds = new Set<string>();
  const numerals = new Set<string>(founderMessage.match(/\d+(?:[.,]\d+)*/g) ?? []);
  const attempted = new Set<string>();
  const totals = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };

  const settle = (
    stop: AgentTurnStop,
    reply: string,
    replySource: "model" | "template",
    fallbackReason: AgentFallbackReason | null,
    validationFailures: readonly AgentReplyFinding[] = [],
  ): AgentTurnResult => ({
    reply,
    replySource,
    fallbackReason,
    stop,
    // Only artifacts the reply is entitled to: a turn that fell back names none.
    artifacts: replySource === "model" ? artifacts : [],
    modelCalls,
    toolCalls,
    totals: {
      ...totals,
      modelCalls: modelCalls.length,
      toolCalls: toolCalls.length,
      durationMs: now() - startedAt,
    },
    validationFailures,
  });

  const giveUp = (stop: AgentTurnStop, reason: AgentFallbackReason) =>
    settle(stop, agentFallbackReply(reason), "template", reason);

  for (;;) {
    if (now() - startedAt >= budgets.maxWallClockMs) {
      return giveUp("max_wall_clock", "budget_exhausted");
    }
    if (modelCalls.length >= budgets.maxModelCalls) {
      return giveUp("max_model_calls", "budget_exhausted");
    }

    const request: ToolCallingRequest = {
      operation: "agent_turn",
      model: input.config.model,
      system,
      // A snapshot: a request is a value, and the transcript keeps growing.
      messages: [...messages],
      tools,
      maxOutputTokens: input.config.maxOutputTokensPerCall,
      reasoning: input.config.reasoning,
      timeoutMs: input.config.timeoutMs,
    };

    // Free, and before every paid call (rule 47).
    const counted = await input.provider.countToolCallingInputTokens(request);
    if (!counted.ok) {
      modelCalls.push(blank(modelCalls.length, null, counted.error));
      return giveUp("provider_failure", "provider_failed");
    }
    const inputCeiling = Math.min(
      budgets.maxInputTokensPerCall,
      input.config.maxInputTokensPerCall,
    );
    if (counted.inputTokens > inputCeiling) {
      modelCalls.push(blank(modelCalls.length, counted.inputTokens, "input_budget_exceeded"));
      return giveUp("input_budget_exceeded", "budget_exhausted");
    }

    const result = await input.provider.generateWithTools(request);
    if (!result.ok) {
      modelCalls.push({
        index: modelCalls.length,
        estimatedInputTokens: counted.inputTokens,
        usage: result.usage ? toUsage(result.usage) : null,
        latencyMs: result.latencyMs,
        stopReason: null,
        failure: result.error,
        servedModel: null,
      });
      if (result.usage) accumulate(totals, toUsage(result.usage));
      return giveUp(
        result.error === "output_truncated" ? "output_truncated" : "provider_failure",
        "provider_failed",
      );
    }

    modelCalls.push({
      index: modelCalls.length,
      estimatedInputTokens: counted.inputTokens,
      usage: result.usage,
      latencyMs: result.latencyMs,
      stopReason: result.stopReason,
      failure: null,
      servedModel: result.model,
    });
    accumulate(totals, result.usage);

    if (totals.outputTokens > budgets.maxTotalOutputTokens) {
      return giveUp("max_total_output_tokens", "budget_exhausted");
    }
    if (result.stopReason === "max_tokens") {
      return giveUp("output_truncated", "provider_failed");
    }

    messages.push({ role: "assistant", content: result.content });

    if (result.stopReason === "end_turn") {
      const text = result.text.trim();
      if (text === "") return giveUp("empty_reply", "no_reply");

      const check = checkAgentReply({
        reply: text,
        allowedNumericFacts: [...numerals],
        referencedSubjectIds: [...subjectIds],
        claimedSubjectIds: artifacts.map((artifact) => artifact.subjectId),
      });
      if (!check.ok) {
        return settle(
          "validation_rejected",
          agentFallbackReply("validation_rejected"),
          "template",
          "validation_rejected",
          check.failures,
        );
      }
      return settle("answered", text, "model", null);
    }

    // `tool_use` with no tool_use block is a malformed turn: nothing to answer,
    // and an empty results turn would be a malformed request.
    if (result.toolCalls.length === 0) return giveUp("empty_reply", "no_reply");

    const results: { toolCallId: string; content: string; isError: boolean }[] = [];
    let ranSomething = false;
    for (const call of result.toolCalls) {
      const dispatched = await dispatchAgentToolCall({
        context: input.context,
        sequence: toolCalls.length,
        requested: call.name,
        args: call.input,
        budgetExhausted: toolCalls.length >= budgets.maxToolCalls,
        attempted,
      });
      toolCalls.push(dispatched.record);
      if (dispatched.record.decision === "allowed") {
        attempted.add(`${call.name}:${normalizeArguments(dispatched.record.input)}`);
        ranSomething = true;
      }
      for (const id of dispatched.record.subjectIds) subjectIds.add(id);
      for (const numeral of dispatched.numerals) numerals.add(numeral);
      for (const artifact of dispatched.artifacts) {
        if (!artifacts.some((held) => held.subjectId === artifact.subjectId)) {
          artifacts.push(artifact);
        }
      }
      results.push({
        toolCallId: call.id,
        content: dispatched.rendered,
        isError: dispatched.isError,
      });
    }

    // A turn in which the ceiling refused every request is the model asking for
    // tools it has already been told it has no more of. It does not get another
    // call to ask again.
    if (
      !ranSomething &&
      toolCalls
        .slice(-result.toolCalls.length)
        .every((record) => record.decision === "tool_budget_exhausted")
    ) {
      return giveUp("max_tool_calls", "budget_exhausted");
    }

    messages.push({ role: "tool_results", results });
  }
}

function blank(index: number, estimated: number | null, failure: string): AgentModelCallRecord {
  return {
    index,
    estimatedInputTokens: estimated,
    usage: null,
    latencyMs: 0,
    stopReason: null,
    failure,
    servedModel: null,
  };
}

/**
 * The usage a *failed* call reports, widened to the tool-calling shape.
 *
 * A failure carries no cache counts, so they are zero rather than guessed —
 * and zero is the right answer here, not a stand-in for unknown: a request the
 * provider rejected read nothing back from a cache and wrote nothing to one.
 */
function toUsage(usage: AIUsage): ToolCallingUsage {
  return { ...usage, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 };
}

function accumulate(
  totals: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
  },
  usage: ToolCallingUsage,
): void {
  totals.inputTokens += usage.inputTokens;
  totals.outputTokens += usage.outputTokens;
  totals.cacheReadTokens += usage.cacheReadInputTokens;
  totals.cacheWriteTokens += usage.cacheCreationInputTokens;
}

export { AGENT_PROMPT_VERSION };
