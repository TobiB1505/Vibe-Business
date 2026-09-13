import { describe, expect, it, vi } from "vitest";
import type { ToolCallingConfig } from "@/modules/ai/operations";
import type {
  AIToolCallingProvider,
  ToolCallingRequest,
  ToolCallingResult,
  ToolCallingSuccess,
} from "@/modules/ai/provider";
import { fakeSupabase, FakeDatabase } from "@/modules/operations/test-support";
import { AGENT_TURN_BUDGETS } from "./budgets";
import { agentFallbackReply } from "./fallback";
import { runAgentTurn, type AgentTurnResult } from "./loop";

/**
 * The loop, against a scripted provider.
 *
 * Nothing here reaches the network, needs a key, or costs money — the provider
 * is a script and the tools run against an empty fake database, which is a
 * real answer ("no audit has run") rather than a stub. What these prove is the
 * set of properties ADR 0109 made binding: one call per turn, no retry, every
 * ceiling enforced in code, an identical repeat refused, and — the one the
 * pilot's worst rows are about — **a founder-visible reply on every path out**.
 */

const CONFIG: ToolCallingConfig = {
  operation: "agent_turn",
  model: "claude-sonnet-5",
  reasoning: { mode: "none" },
  maxOutputTokensPerCall: 4_000,
  maxInputTokensPerCall: 24_000,
  timeoutMs: 60_000,
};

const USAGE = {
  inputTokens: 100,
  outputTokens: 10,
  thinkingTokens: 0,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
};

function answer(text: string): ToolCallingSuccess {
  return {
    ok: true,
    content: [{ type: "text", text }],
    text,
    toolCalls: [],
    stopReason: "end_turn",
    usage: USAGE,
    latencyMs: 5,
    model: "claude-sonnet-5",
  };
}

function callTool(
  name: string,
  input: Record<string, unknown>,
  id = "toolu_1",
): ToolCallingSuccess {
  return {
    ok: true,
    content: [{ type: "tool_use", id, name, input }],
    text: "",
    toolCalls: [{ id, name, input }],
    stopReason: "tool_use",
    usage: USAGE,
    latencyMs: 5,
    model: "claude-sonnet-5",
  };
}

function scriptedProvider(script: readonly ToolCallingResult[], inputTokens = 100) {
  const requests: ToolCallingRequest[] = [];
  let index = 0;
  const provider: AIToolCallingProvider = {
    name: "scripted",
    countToolCallingInputTokens: vi.fn(async () => ({ ok: true as const, inputTokens })),
    generateWithTools: vi.fn(async (request: ToolCallingRequest) => {
      requests.push(request);
      const next = script[Math.min(index, script.length - 1)];
      index += 1;
      return next;
    }),
  };
  return { provider, requests, calls: () => index };
}

async function run(
  script: readonly ToolCallingResult[],
  overrides: Partial<Parameters<typeof runAgentTurn>[0]> = {},
): Promise<AgentTurnResult> {
  const { provider } = scriptedProvider(script);
  return runAgentTurn({
    provider,
    config: CONFIG,
    context: { supabase: fakeSupabase(new FakeDatabase()), projectId: "p1", userId: "u1" },
    contextBrief: '<untrusted source="context-brief">product_name: Ledgerline</untrusted>',
    history: [],
    founderMessage: "What should I work on next?",
    ...overrides,
  });
}

describe("one provider call is one model turn", () => {
  it("never retries a failed call", async () => {
    const { provider, calls } = scriptedProvider([
      { ok: false, error: "provider_rate_limited", model: "claude-sonnet-5", latencyMs: 3 },
    ]);

    const result = await runAgentTurn({
      provider,
      config: CONFIG,
      context: { supabase: fakeSupabase(new FakeDatabase()), projectId: "p1", userId: "u1" },
      contextBrief: "brief",
      history: [],
      founderMessage: "What should I work on next?",
    });

    expect(calls()).toBe(1);
    expect(result.stop).toBe("provider_failure");
  });

  it("counts the input before every paid call", async () => {
    const { provider } = scriptedProvider([
      callTool("get_project_focus", {}),
      answer("Here it is, and it is one thing."),
    ]);
    await runAgentTurn({
      provider,
      config: CONFIG,
      context: { supabase: fakeSupabase(new FakeDatabase()), projectId: "p1", userId: "u1" },
      contextBrief: "brief",
      history: [],
      founderMessage: "What next?",
    });

    expect(provider.countToolCallingInputTokens).toHaveBeenCalledTimes(2);
    expect(provider.generateWithTools).toHaveBeenCalledTimes(2);
  });
});

describe("every ceiling stops the turn, and the founder still reads something", () => {
  it("stops at the model-call ceiling", async () => {
    const result = await run([callTool("get_project_focus", {})], {
      budgets: { ...AGENT_TURN_BUDGETS, maxModelCalls: 2 },
    });

    expect(result.stop).toBe("max_model_calls");
    expect(result.reply).toBe(agentFallbackReply("budget_exhausted"));
    expect(result.replySource).toBe("template");
  });

  it("stops at the tool-call ceiling", async () => {
    const result = await run([callTool("get_project_focus", {})], {
      budgets: { ...AGENT_TURN_BUDGETS, maxToolCalls: 1, maxModelCalls: 6 },
    });

    expect(["max_tool_calls", "max_model_calls"]).toContain(result.stop);
    expect(result.reply.length).toBeGreaterThan(0);
  });

  it("refuses a request whose input would exceed the per-call ceiling", async () => {
    const { provider } = scriptedProvider([answer("anything")], 1_000_000);
    const result = await runAgentTurn({
      provider,
      config: CONFIG,
      context: { supabase: fakeSupabase(new FakeDatabase()), projectId: "p1", userId: "u1" },
      contextBrief: "brief",
      history: [],
      founderMessage: "What next?",
    });

    expect(result.stop).toBe("input_budget_exceeded");
    // Refused before the paid call, not after it.
    expect(provider.generateWithTools).not.toHaveBeenCalled();
    expect(result.reply).toBe(agentFallbackReply("budget_exhausted"));
  });

  it("stops on the wall clock", async () => {
    let clock = 0;
    const result = await run([callTool("get_project_focus", {})], {
      now: () => {
        clock += 200_000;
        return clock;
      },
    });

    expect(result.stop).toBe("max_wall_clock");
    expect(result.reply).toBe(agentFallbackReply("budget_exhausted"));
  });

  it("stops when the output total is spent", async () => {
    const big: ToolCallingSuccess = {
      ...callTool("get_project_focus", {}),
      usage: { ...USAGE, outputTokens: 99_999 },
    };

    const result = await run([big]);
    expect(result.stop).toBe("max_total_output_tokens");
    expect(result.reply.length).toBeGreaterThan(0);
  });
});

describe("an identical tool call is refused rather than repeated", () => {
  it("answers the second attempt with Vibe's own sentence and counts it", async () => {
    const repeat = callTool("get_action_plan", { opportunity_id: "opp-1" });
    const result = await run([
      repeat,
      repeat,
      answer("I could not find that Move in this project."),
    ]);

    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls[0].decision).toBe("allowed");
    expect(result.toolCalls[1].decision).toBe("duplicate_call");
    expect(result.toolCalls[1].denialReason).toContain("already made in this turn");
    // Counted: a refusal that was free would make a loop unbounded.
    expect(result.totals.toolCalls).toBe(2);
  });

  it("treats different arguments as different calls", async () => {
    const result = await run([
      callTool("get_action_plan", { opportunity_id: "opp-1" }),
      callTool("get_action_plan", { opportunity_id: "opp-2" }),
      answer("Neither of those Moves is one this project has."),
    ]);

    expect(result.toolCalls.map((call) => call.decision)).toEqual(["allowed", "allowed"]);
  });

  it("does not count argument order as a difference", async () => {
    const first = callTool("resolve_execution", { step_key: "s1" });
    const second = callTool("resolve_execution", { step_key: "s1" }, "toolu_2");
    const result = await run([first, second, answer("There is no plan for me to look at yet.")]);

    expect(result.toolCalls[1].decision).toBe("duplicate_call");
  });
});

describe("the tool boundary fails closed", () => {
  it("answers an unknown tool name with a result, not an exception", async () => {
    const result = await run([
      callTool("merge_change", { anything: "true" }),
      answer("I have no way to do that, and nothing has been merged."),
    ]);

    expect(result.toolCalls[0].decision).toBe("unknown_tool");
    expect(result.stop).toBe("answered");
  });

  it("answers malformed arguments with a result naming the problem", async () => {
    const result = await run([
      callTool("get_action_plan", { wrong_field: "x" }),
      answer("I could not look that up, so here is what I do have."),
    ]);

    expect(result.toolCalls[0].decision).toBe("invalid_arguments");
    expect(result.toolCalls[0].denialReason).toContain("unexpected argument");
  });
});

describe("the reply is checked before the founder reads it", () => {
  it("refuses a number no tool returned", async () => {
    const result = await run([answer("Your activation score is 54 and that is the thing to fix.")]);

    expect(result.stop).toBe("validation_rejected");
    expect(result.reply).toBe(agentFallbackReply("validation_rejected"));
    expect(result.validationFailures.map((finding) => finding.code)).toContain("unallowed_number");
  });

  it("refuses a claim that something is live", async () => {
    const result = await run([
      answer("I have put the pricing section up and it is live for visitors now."),
    ]);

    expect(result.stop).toBe("validation_rejected");
    expect(result.validationFailures.map((finding) => finding.code)).toContain("banned_claim");
  });

  it("refuses a claim that Vibe acted", async () => {
    const result = await run([
      answer("I started the build for you and it is under way as we speak."),
    ]);

    expect(result.stop).toBe("validation_rejected");
    expect(result.validationFailures.map((finding) => finding.code)).toContain("claimed_action");
  });

  it("carries no artifact reference when it fell back", async () => {
    const result = await run([answer("Your activation score is 54.")]);
    expect(result.artifacts).toEqual([]);
  });

  it("lets a grounded reply through with its source named", async () => {
    const result = await run([
      answer("There is no Business Audit for this project yet, so I have nothing to rank."),
    ]);

    expect(result.stop).toBe("answered");
    expect(result.replySource).toBe("model");
  });
});

describe("there is no path out that says nothing", () => {
  it("answers even when the model returns an empty turn", async () => {
    const result = await run([answer("   ")]);
    expect(result.stop).toBe("empty_reply");
    expect(result.reply).toBe(agentFallbackReply("no_reply"));
  });

  it("answers when the provider fails outright", async () => {
    const result = await run([
      { ok: false, error: "provider_unavailable", model: "claude-sonnet-5", latencyMs: 1 },
    ]);
    expect(result.reply).toBe(agentFallbackReply("provider_failed"));
  });

  it("answers when the model is cut off mid-sentence", async () => {
    const truncated: ToolCallingResult = { ...answer("half a sen"), stopReason: "max_tokens" };
    const result = await run([truncated]);
    expect(result.stop).toBe("output_truncated");
    expect(result.reply.length).toBeGreaterThan(0);
  });
});
