import type { ToolCallingConfig } from "@/modules/ai/operations";
import type { AIProvider, StructuredRequest } from "@/modules/ai/provider";
import { PILOT_BUDGETS } from "./budgets";
import { dispatchToolCall } from "./dispatch";
import {
  buildPilotSystemPrompt,
  PILOT_PROMPT_VERSION,
  renderContextBrief,
  renderFounderMessage,
} from "./prompt";
import { boundFounderMessage, type SeamRunInput } from "./seam-a";
import { isPilotToolName, PILOT_TOOL_NAMES, PILOT_TOOLS, type PilotToolName } from "./tools";
import {
  emptyTotals,
  type ModelCallRecord,
  type ToolCallRecord,
  type Trajectory,
  type TrajectoryStop,
} from "./trajectory";

/**
 * Seam B — a tool loop over the existing structured-output provider.
 *
 * The provider is unchanged: `generateStructured`, one user string, one JSON
 * Schema. The loop asks the model for an *action* each turn — call one tool,
 * or answer — dispatches the tool itself, and appends the result to the user
 * string for the next call. Nothing native is faked: there is no `tools`
 * parameter, no `tool_use` block, no parallel calls, and the whole transcript
 * is re-sent as one uncached user string on every iteration. That is the
 * honest cost of the seam, and it is what the pilot measures.
 *
 * ## The action schema is flat on purpose
 *
 * The structured-output subset forbids unions, so a per-tool argument shape
 * would have to be nine object variants under `anyOf` — which is exactly the
 * grammar-size problem `business-audit/wire-schema.ts` records paying for.
 * The arguments are therefore one bag of every field any tool takes, all
 * required, with the unused ones left empty. The loop picks out the fields
 * the chosen tool declares and validates them through the same
 * `validateArguments` Seam A uses — a wrong type is still a refusal, but the
 * schema itself cannot express "this tool takes these two fields".
 */

export const PILOT_ACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["action", "tool", "arguments", "message"],
  properties: {
    action: { type: "string", enum: ["call_tool", "answer"] },
    tool: { type: "string", enum: [...PILOT_TOOL_NAMES, "none"] },
    arguments: {
      type: "object",
      additionalProperties: false,
      required: ["lens", "opportunity_id", "step_key", "chain"],
      properties: {
        lens: { type: "string" },
        opportunity_id: { type: "string" },
        step_key: { type: "string" },
        chain: { type: "boolean" },
      },
    },
    message: { type: "string" },
  },
} as const;

export type PilotAction =
  | { action: "answer"; message: string }
  | { action: "call_tool"; tool: string; arguments: Record<string, unknown> };

/**
 * Structured output guarantees the shape; this re-checks it anyway, because
 * a shape the provider promised is still a claim the loop acts on.
 */
export function parsePilotAction(
  data: unknown,
): { ok: true; action: PilotAction } | { ok: false; reason: string } {
  if (typeof data !== "object" || data === null) return { ok: false, reason: "not an object" };
  const record = data as Record<string, unknown>;
  const action = record.action;
  const tool = record.tool;
  const args = record.arguments;
  const message = record.message;
  if (typeof message !== "string") return { ok: false, reason: "message must be a string" };
  if (typeof tool !== "string") return { ok: false, reason: "tool must be a string" };
  if (typeof args !== "object" || args === null)
    return { ok: false, reason: "arguments must be an object" };

  if (action === "answer") return { ok: true, action: { action: "answer", message } };
  if (action === "call_tool") {
    if (tool === "none") return { ok: false, reason: "call_tool names no tool" };
    return {
      ok: true,
      action: { action: "call_tool", tool, arguments: args as Record<string, unknown> },
    };
  }
  return { ok: false, reason: "action must be call_tool or answer" };
}

/** Picks the fields the chosen tool declares out of the flat bag. */
export function argumentsForTool(
  tool: PilotToolName,
  bag: Record<string, unknown>,
): Record<string, unknown> {
  const declared = Object.keys(
    (PILOT_TOOLS[tool].inputSchema.properties ?? {}) as Record<string, unknown>,
  );
  return Object.fromEntries(declared.map((key) => [key, bag[key]]));
}

function renderHistory(history: SeamRunInput["history"]): string {
  return history
    .map((turn) =>
      turn.role === "founder"
        ? renderFounderMessage(boundFounderMessage(turn.text))
        : `NOVA (earlier reply): ${turn.text}${
            turn.artifactRefs && turn.artifactRefs.length > 0
              ? `\n[artifacts: ${turn.artifactRefs.join(", ")}]`
              : ""
          }`,
    )
    .join("\n\n");
}

export async function runSeamB(
  input: SeamRunInput & { provider: AIProvider; config: ToolCallingConfig },
): Promise<Trajectory> {
  const budgets = input.budgets ?? PILOT_BUDGETS;
  const system = buildPilotSystemPrompt("B");

  const head = [
    renderContextBrief(input.environment),
    renderHistory(input.history),
    renderFounderMessage(boundFounderMessage(input.founderMessage)),
  ]
    .filter((part) => part.length > 0)
    .join("\n\n");

  /** Every action so far and what it produced, re-sent in full each call. */
  const transcript: string[] = [];

  const modelCalls: ModelCallRecord[] = [];
  const toolCalls: ToolCallRecord[] = [];
  const numerals: string[] = [];
  const totals = emptyTotals();
  const startedAt = Date.now();

  const finish = (stop: TrajectoryStop, finalMessage: string | null): Trajectory => ({
    seam: "B",
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

  const failed = (
    index: number,
    estimated: number | null,
    failure: string,
    latencyMs = 0,
  ): ModelCallRecord => ({
    index,
    estimatedInputTokens: estimated,
    inputTokens: 0,
    outputTokens: 0,
    thinkingTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    latencyMs,
    stopReason: "failed",
    failure,
    servedModel: null,
  });

  for (;;) {
    if (modelCalls.length >= budgets.maxModelCalls) return finish("max_model_calls", null);

    const userContent =
      transcript.length === 0
        ? head
        : `${head}\n\nTRANSCRIPT OF THIS TURN SO FAR:\n${transcript.join("\n\n")}`;

    const request: StructuredRequest = {
      operation: "agent_turn",
      model: input.config.model,
      system,
      userContent,
      outputSchema: PILOT_ACTION_SCHEMA as unknown as Record<string, unknown>,
      maxOutputTokens: input.config.maxOutputTokensPerCall,
      reasoning: input.config.reasoning,
      timeoutMs: input.config.timeoutMs,
    };

    const counted = await input.provider.countInputTokens(request);
    if (!counted.ok) {
      modelCalls.push(failed(modelCalls.length, null, counted.error));
      return finish("provider_failure", null);
    }
    if (
      counted.inputTokens >
      Math.min(budgets.maxInputTokensPerCall, input.config.maxInputTokensPerCall)
    ) {
      modelCalls.push(failed(modelCalls.length, counted.inputTokens, "input_budget_exceeded"));
      return finish("input_budget_exceeded", null);
    }

    const result = await input.provider.generateStructured(request);
    if (!result.ok) {
      modelCalls.push(
        failed(modelCalls.length, counted.inputTokens, result.error, result.latencyMs),
      );
      if (result.usage) {
        totals.inputTokens += result.usage.inputTokens;
        totals.outputTokens += result.usage.outputTokens;
        totals.thinkingTokens += result.usage.thinkingTokens;
      }
      return finish(
        result.error === "output_truncated" ? "output_truncated" : "provider_failure",
        null,
      );
    }

    const parsed = parsePilotAction(result.data);
    modelCalls.push({
      index: modelCalls.length,
      estimatedInputTokens: counted.inputTokens,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      thinkingTokens: result.usage.thinkingTokens,
      // Structured generation reports no cache figures; a one-string user
      // turn that changes every call has nothing to cache.
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      latencyMs: result.latencyMs,
      stopReason: parsed.ok ? parsed.action.action : "invalid_action",
      failure: parsed.ok ? null : `invalid_action:${parsed.reason}`,
      servedModel: result.model,
    });
    totals.inputTokens += result.usage.inputTokens;
    totals.outputTokens += result.usage.outputTokens;
    totals.thinkingTokens += result.usage.thinkingTokens;

    if (totals.outputTokens > budgets.maxTotalOutputTokens)
      return finish("max_total_output_tokens", null);
    if (!parsed.ok) return finish("invalid_action", null);

    if (parsed.action.action === "answer") {
      const text = parsed.action.message.trim();
      return text === "" ? finish("empty_reply", null) : finish("answered", text);
    }

    const requested = parsed.action.tool;
    const args = isPilotToolName(requested)
      ? argumentsForTool(requested, parsed.action.arguments)
      : parsed.action.arguments;
    const dispatched = dispatchToolCall({
      environment: input.environment,
      budgets,
      index: toolCalls.length,
      requested,
      args,
      toolCallsSoFar: toolCalls.length,
    });
    toolCalls.push(dispatched.record);
    numerals.push(...dispatched.numerals);
    input.observeToolResult?.(dispatched.rendered);

    if (dispatched.record.decision === "budget_exhausted") return finish("max_tool_calls", null);

    transcript.push(
      `ACTION ${toolCalls.length}: call_tool ${requested} ${JSON.stringify(args)}\nRESULT:\n${dispatched.rendered}`,
    );
  }
}
