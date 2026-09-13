import type { ToolCallingConfig } from "@/modules/ai/operations";
import type { AgentTurn, AIToolCallingProvider, ToolCallingRequest } from "@/modules/ai/provider";
import { MAX_FOUNDER_MESSAGE_CHARS, PILOT_BUDGETS, type PilotBudgets } from "./budgets";
import type { PilotHistoryTurn } from "./cases";
import { dispatchToolCall } from "./dispatch";
import type { PilotEnvironment } from "./fixtures";
import {
  buildPilotSystemPrompt,
  PILOT_PROMPT_VERSION,
  renderContextBrief,
  renderFounderMessage,
} from "./prompt";
import { pilotToolDescriptors } from "./tools";
import {
  emptyTotals,
  type ModelCallRecord,
  type ToolCallRecord,
  type Trajectory,
  type TrajectoryStop,
} from "./trajectory";

/**
 * Seam A — native tool calling.
 *
 * The provider performs one turn (`generateWithTools`); this loop owns
 * everything else: the transcript, the budgets, the dispatch, the stop. What
 * the provider returns is the neutral `AssistantBlock[]`, and what goes back
 * is a `tool_results` turn the adapter renders however its wire wants — no
 * SDK type reaches this file.
 *
 * Every ceiling is checked in code before the thing it bounds happens: the
 * free token count precedes every paid call, the tool ceiling is consulted
 * before a tool runs, the model-call ceiling before a call is made.
 */
export type SeamRunInput = {
  caseId: string;
  environment: PilotEnvironment;
  history: readonly PilotHistoryTurn[];
  founderMessage: string;
  budgets?: PilotBudgets;
  /**
   * Sees every rendered tool result as the model saw it. The trajectory
   * deliberately keeps none; the probe hands them to the judge and forgets.
   */
  observeToolResult?: (rendered: string) => void;
};

export function boundFounderMessage(text: string): string {
  const oneBlock = text.replace(/\s+/g, " ").trim();
  return oneBlock.length > MAX_FOUNDER_MESSAGE_CHARS
    ? oneBlock.slice(0, MAX_FOUNDER_MESSAGE_CHARS)
    : oneBlock;
}

function historyTurns(history: readonly PilotHistoryTurn[]): AgentTurn[] {
  return history.map(
    (turn): AgentTurn =>
      turn.role === "founder"
        ? { role: "user", content: renderFounderMessage(boundFounderMessage(turn.text)) }
        : {
            role: "assistant",
            content: [
              {
                type: "text",
                text:
                  turn.artifactRefs && turn.artifactRefs.length > 0
                    ? `${turn.text}\n[artifacts: ${turn.artifactRefs.join(", ")}]`
                    : turn.text,
              },
            ],
          },
  );
}

export async function runSeamA(
  input: SeamRunInput & { provider: AIToolCallingProvider; config: ToolCallingConfig },
): Promise<Trajectory> {
  const budgets = input.budgets ?? PILOT_BUDGETS;
  const system = buildPilotSystemPrompt("A");
  const tools = pilotToolDescriptors();

  const messages: AgentTurn[] = [
    ...historyTurns(input.history),
    {
      role: "user",
      content: `${renderContextBrief(input.environment)}\n\n${renderFounderMessage(boundFounderMessage(input.founderMessage))}`,
    },
  ];

  const modelCalls: ModelCallRecord[] = [];
  const toolCalls: ToolCallRecord[] = [];
  const numerals: string[] = [];
  const totals = emptyTotals();
  const startedAt = Date.now();

  const finish = (stop: TrajectoryStop, finalMessage: string | null): Trajectory => ({
    seam: "A",
    caseId: input.caseId,
    promptVersion: PILOT_PROMPT_VERSION,
    model: input.config.model,
    modelCalls,
    toolCalls,
    finalMessage,
    stop,
    totals: {
      ...totals,
      modelCalls: modelCalls.length,
      toolCalls: toolCalls.length,
      latencyMs: Date.now() - startedAt,
    },
    toolResultNumerals: numerals,
  });

  for (;;) {
    if (modelCalls.length >= budgets.maxModelCalls) return finish("max_model_calls", null);

    const request: ToolCallingRequest = {
      operation: "agent_turn",
      model: input.config.model,
      system,
      // A snapshot: a request is a value, and the transcript keeps growing
      // after this one is sent.
      messages: [...messages],
      tools,
      maxOutputTokens: input.config.maxOutputTokensPerCall,
      reasoning: input.config.reasoning,
      timeoutMs: input.config.timeoutMs,
    };

    const counted = await input.provider.countToolCallingInputTokens(request);
    if (!counted.ok) {
      modelCalls.push(record(modelCalls.length, null, null, counted.error));
      return finish("provider_failure", null);
    }
    if (
      counted.inputTokens >
      Math.min(budgets.maxInputTokensPerCall, input.config.maxInputTokensPerCall)
    ) {
      modelCalls.push(
        record(modelCalls.length, counted.inputTokens, null, "input_budget_exceeded"),
      );
      return finish("input_budget_exceeded", null);
    }

    const result = await input.provider.generateWithTools(request);
    if (!result.ok) {
      modelCalls.push(
        record(
          modelCalls.length,
          counted.inputTokens,
          result.usage ?? null,
          result.error,
          result.latencyMs,
        ),
      );
      if (result.usage) addUsage(totals, result.usage, 0, 0);
      return finish(
        result.error === "output_truncated" ? "output_truncated" : "provider_failure",
        null,
      );
    }

    modelCalls.push({
      index: modelCalls.length,
      estimatedInputTokens: counted.inputTokens,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      thinkingTokens: result.usage.thinkingTokens,
      cacheReadInputTokens: result.usage.cacheReadInputTokens,
      cacheCreationInputTokens: result.usage.cacheCreationInputTokens,
      latencyMs: result.latencyMs,
      stopReason: result.stopReason,
      failure: null,
      servedModel: result.model,
    });
    addUsage(
      totals,
      result.usage,
      result.usage.cacheReadInputTokens,
      result.usage.cacheCreationInputTokens,
    );

    if (totals.outputTokens > budgets.maxTotalOutputTokens)
      return finish("max_total_output_tokens", null);
    if (result.stopReason === "max_tokens") return finish("output_truncated", null);

    messages.push({ role: "assistant", content: result.content });

    if (result.stopReason === "end_turn") {
      const text = result.text.trim();
      return text === "" ? finish("empty_reply", null) : finish("answered", text);
    }
    // `tool_use` with no tool_use block is a malformed turn; there is nothing
    // to answer, and an empty results turn would be a malformed request.
    if (result.toolCalls.length === 0) return finish("empty_reply", null);

    // tool_use: answer every call in one tool_results turn, in order. A call
    // past the ceiling is answered with `budget_exhausted` rather than run.
    const results: { toolCallId: string; content: string; isError: boolean }[] = [];
    const decisions: string[] = [];
    for (const call of result.toolCalls) {
      const dispatched = dispatchToolCall({
        environment: input.environment,
        budgets,
        index: toolCalls.length,
        requested: call.name,
        args: call.input,
        toolCallsSoFar: toolCalls.length,
      });
      toolCalls.push(dispatched.record);
      numerals.push(...dispatched.numerals);
      input.observeToolResult?.(dispatched.rendered);
      results.push({
        toolCallId: call.id,
        content: dispatched.rendered,
        isError: dispatched.isError,
      });
      decisions.push(dispatched.record.decision);
    }

    // A message in which *nothing* could run — every request landed past the
    // ceiling — is the model asking for tools it was already told it has no
    // more of. The turn ends there; it does not get another call to ask again.
    if (decisions.length > 0 && decisions.every((decision) => decision === "budget_exhausted")) {
      return finish("max_tool_calls", null);
    }

    messages.push({ role: "tool_results", results });
  }
}

function record(
  index: number,
  estimated: number | null,
  usage: { inputTokens: number; outputTokens: number; thinkingTokens: number } | null,
  failure: string,
  latencyMs = 0,
): ModelCallRecord {
  return {
    index,
    estimatedInputTokens: estimated,
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    thinkingTokens: usage?.thinkingTokens ?? 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    latencyMs,
    stopReason: "failed",
    failure,
    servedModel: null,
  };
}

function addUsage(
  totals: Trajectory["totals"],
  usage: { inputTokens: number; outputTokens: number; thinkingTokens: number },
  cacheRead: number,
  cacheWrite: number,
): void {
  totals.inputTokens += usage.inputTokens;
  totals.outputTokens += usage.outputTokens;
  totals.thinkingTokens += usage.thinkingTokens;
  totals.cacheReadInputTokens += cacheRead;
  totals.cacheCreationInputTokens += cacheWrite;
}
