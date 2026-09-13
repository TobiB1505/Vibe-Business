import type {
  AIProvider,
  AIToolCallingProvider,
  AssistantBlock,
  StructuredFailure,
  StructuredRequest,
  StructuredResult,
  TokenCountResult,
  ToolCallingRequest,
  ToolCallingResult,
} from "@/modules/ai/provider";

/**
 * Providers that replay a script, for the tests and for reproducing a
 * recorded trajectory without a key.
 *
 * Each answers requests in order and records what it was asked, so a test
 * can assert both halves of the contract: what the loop sent (one request
 * per model call, the transcript as it should be) and what the loop did
 * with the reply. A script that runs out throws — a loop that calls more
 * often than its script allows has a bug worth a stack trace, not a default.
 */

export class ScriptedToolCallingProvider implements AIToolCallingProvider {
  readonly name = "scripted";
  readonly requests: ToolCallingRequest[] = [];
  readonly countRequests: ToolCallingRequest[] = [];

  constructor(
    private readonly script: readonly ToolCallingResult[],
    private readonly count: TokenCountResult = { ok: true, inputTokens: 1_000 },
  ) {}

  async countToolCallingInputTokens(request: ToolCallingRequest): Promise<TokenCountResult> {
    this.countRequests.push(request);
    return this.count;
  }

  async generateWithTools(request: ToolCallingRequest): Promise<ToolCallingResult> {
    this.requests.push(request);
    const next = this.script[this.requests.length - 1];
    if (!next) throw new Error(`scripted provider: no response for call ${this.requests.length}`);
    return next;
  }
}

export class ScriptedStructuredProvider implements AIProvider {
  readonly name = "scripted";
  readonly requests: StructuredRequest[] = [];
  readonly countRequests: StructuredRequest[] = [];

  constructor(
    private readonly script: readonly StructuredResult[],
    private readonly count: TokenCountResult = { ok: true, inputTokens: 1_000 },
  ) {}

  async countInputTokens(request: StructuredRequest): Promise<TokenCountResult> {
    this.countRequests.push(request);
    return this.count;
  }

  async generateStructured(request: StructuredRequest): Promise<StructuredResult> {
    this.requests.push(request);
    const next = this.script[this.requests.length - 1];
    if (!next) throw new Error(`scripted provider: no response for call ${this.requests.length}`);
    return next;
  }
}

const USAGE = {
  inputTokens: 1_000,
  outputTokens: 80,
  thinkingTokens: 0,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
};

/** A Seam A turn that calls the given tools (in one message). */
export function toolUseTurn(
  calls: readonly { name: string; input: unknown }[],
  text = "",
  usage: Partial<typeof USAGE> = {},
): ToolCallingResult {
  const content: AssistantBlock[] = [];
  if (text) content.push({ type: "text", text });
  const toolCalls = calls.map((call, index) => ({
    id: `toolu_${index + 1}`,
    name: call.name,
    input: call.input,
  }));
  for (const call of toolCalls) content.push({ type: "tool_use", ...call });
  return {
    ok: true,
    stopReason: "tool_use",
    content,
    text,
    toolCalls,
    usage: { ...USAGE, ...usage },
    model: "claude-sonnet-5",
    latencyMs: 10,
  };
}

/** A Seam A turn that answers. */
export function endTurn(text: string, usage: Partial<typeof USAGE> = {}): ToolCallingResult {
  return {
    ok: true,
    stopReason: "end_turn",
    content: text ? [{ type: "text", text }] : [],
    text,
    toolCalls: [],
    usage: { ...USAGE, ...usage },
    model: "claude-sonnet-5",
    latencyMs: 10,
  };
}

export function truncatedTurn(): ToolCallingResult {
  return {
    ok: true,
    stopReason: "max_tokens",
    content: [{ type: "text", text: "partial" }],
    text: "partial",
    toolCalls: [],
    usage: { ...USAGE },
    model: "claude-sonnet-5",
    latencyMs: 10,
  };
}

export function providerFailure(error: StructuredFailure["error"]): StructuredFailure {
  return { ok: false, error, model: "claude-sonnet-5", latencyMs: 5 };
}

/** A Seam B structured reply carrying one action. */
export function actionTurn(
  action:
    | { action: "answer"; message: string }
    | {
        action: "call_tool";
        tool: string;
        arguments?: Partial<Record<"lens" | "opportunity_id" | "step_key" | "chain", unknown>>;
      },
  usage: Partial<{ inputTokens: number; outputTokens: number; thinkingTokens: number }> = {},
): StructuredResult {
  const data =
    action.action === "answer"
      ? {
          action: "answer",
          tool: "none",
          arguments: { lens: "", opportunity_id: "", step_key: "", chain: false },
          message: action.message,
        }
      : {
          action: "call_tool",
          tool: action.tool,
          arguments: {
            lens: "",
            opportunity_id: "",
            step_key: "",
            chain: false,
            ...action.arguments,
          },
          message: "",
        };
  return {
    ok: true,
    data,
    usage: { inputTokens: 1_000, outputTokens: 80, thinkingTokens: 0, ...usage },
    model: "claude-sonnet-5",
    latencyMs: 10,
  };
}

/** A Seam B reply whose JSON does not describe a legal action. */
export function malformedActionTurn(data: unknown): StructuredResult {
  return {
    ok: true,
    data,
    usage: { inputTokens: 1_000, outputTokens: 80, thinkingTokens: 0 },
    model: "claude-sonnet-5",
    latencyMs: 10,
  };
}
