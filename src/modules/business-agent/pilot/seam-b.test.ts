import { describe, expect, it } from "vitest";
import { AGENT_TURN_CONFIG } from "@/modules/ai/operations";
import { PILOT_BUDGETS } from "./budgets";
import { PILOT_CASES } from "./cases";
import { baseEnvironment } from "./fixtures";
import { argumentsForTool, parsePilotAction, PILOT_ACTION_SCHEMA, runSeamB } from "./seam-b";
import {
  actionTurn,
  malformedActionTurn,
  providerFailure,
  ScriptedStructuredProvider,
} from "./scripted";

/**
 * Seam B's loop against a scripted structured provider — the same contract
 * as `seam-a.test.ts`, on the other arm, plus the things only this seam has:
 * a flat argument bag, an action that can be malformed, and a transcript
 * that is re-sent in full.
 */

const P1 = PILOT_CASES.find((pilotCase) => pilotCase.id === "P1-next-move")!;

function run(
  provider: ScriptedStructuredProvider,
  overrides: Partial<Parameters<typeof runSeamB>[0]> = {},
) {
  return runSeamB({
    provider,
    config: AGENT_TURN_CONFIG,
    caseId: P1.id,
    environment: baseEnvironment(),
    history: P1.history,
    founderMessage: P1.founderMessage,
    ...overrides,
  });
}

describe("the action schema", () => {
  it("is in the structured-output subset and names every tool as an enum", () => {
    expect(PILOT_ACTION_SCHEMA.additionalProperties).toBe(false);
    expect(PILOT_ACTION_SCHEMA.properties.tool.enum).toContain("get_business_health");
    expect(PILOT_ACTION_SCHEMA.properties.tool.enum).toContain("none");
    expect(PILOT_ACTION_SCHEMA.properties.tool.enum).not.toContain("merge_change");
  });

  it("parses the two legal actions and refuses everything else", () => {
    expect(
      parsePilotAction({ action: "answer", tool: "none", arguments: {}, message: "hi" }),
    ).toEqual({
      ok: true,
      action: { action: "answer", message: "hi" },
    });
    expect(
      parsePilotAction({ action: "call_tool", tool: "none", arguments: {}, message: "" }).ok,
    ).toBe(false);
    expect(parsePilotAction({ action: "dance", tool: "none", arguments: {}, message: "" }).ok).toBe(
      false,
    );
    expect(parsePilotAction({ action: "answer", tool: "none", arguments: {}, message: 1 }).ok).toBe(
      false,
    );
    expect(parsePilotAction(null).ok).toBe(false);
  });

  it("picks only the declared fields out of the flat bag", () => {
    const bag = { lens: "conversion", opportunity_id: "opp-1", step_key: "s", chain: true };
    expect(argumentsForTool("get_business_health", bag)).toEqual({ lens: "conversion" });
    expect(argumentsForTool("get_project_focus", bag)).toEqual({});
    expect(argumentsForTool("estimate_execution_cost", bag)).toEqual({
      step_key: "s",
      chain: true,
    });
  });
});

describe("one provider call is one model turn", () => {
  it("counts before every paid call, one tool per call, and re-sends the transcript in full", async () => {
    const provider = new ScriptedStructuredProvider([
      actionTurn({ action: "call_tool", tool: "get_project_focus" }),
      actionTurn({ action: "call_tool", tool: "get_opportunities" }),
      actionTurn({ action: "answer", message: "Start with pricing." }),
    ]);
    const trajectory = await run(provider);

    expect(trajectory.stop).toBe("answered");
    expect(provider.requests).toHaveLength(3);
    expect(provider.countRequests).toHaveLength(3);
    expect(trajectory.toolCalls.map((call) => call.requested)).toEqual([
      "get_project_focus",
      "get_opportunities",
    ]);

    const [first, second, third] = provider.requests.map((request) => request.userContent);
    expect(second.startsWith(first)).toBe(true);
    expect(third.startsWith(first)).toBe(true);
    expect(third.length).toBeGreaterThan(second.length);
    expect(third).toContain("ACTION 2: call_tool get_opportunities");
    expect(third).toContain('<untrusted source="tool:get_project_focus">');
    // No tools parameter exists on this path at all.
    expect("tools" in provider.requests[0]).toBe(false);
    expect(trajectory.modelCalls.every((call) => call.cacheReadInputTokens === 0)).toBe(true);
  });

  it("never retries a failed call", async () => {
    const provider = new ScriptedStructuredProvider([providerFailure("provider_overloaded")]);
    const trajectory = await run(provider);
    expect(trajectory.stop).toBe("provider_failure");
    expect(provider.requests).toHaveLength(1);
  });

  it("refuses the paid call when the count exceeds the input ceiling", async () => {
    const provider = new ScriptedStructuredProvider(
      [actionTurn({ action: "answer", message: "never" })],
      {
        ok: true,
        inputTokens: 999_999,
      },
    );
    const trajectory = await run(provider);
    expect(trajectory.stop).toBe("input_budget_exceeded");
    expect(provider.requests).toHaveLength(0);
  });
});

describe("bad actions fail closed", () => {
  it("ends the turn on an action that does not parse, rather than guessing", async () => {
    const provider = new ScriptedStructuredProvider([
      malformedActionTurn({ action: "call_tool", tool: 7 }),
    ]);
    const trajectory = await run(provider);
    expect(trajectory.stop).toBe("invalid_action");
    expect(trajectory.toolCalls).toHaveLength(0);
  });

  it("answers an unknown tool name with unknown_tool even though the schema should prevent it", async () => {
    const provider = new ScriptedStructuredProvider([
      actionTurn({ action: "call_tool", tool: "merge_change" }),
      actionTurn({ action: "answer", message: "I cannot merge." }),
    ]);
    const trajectory = await run(provider);
    expect(trajectory.toolCalls[0]).toMatchObject({
      requested: "merge_change",
      decision: "unknown_tool",
    });
    expect(provider.requests[1].userContent).toContain('code="unknown_tool"');
  });

  it("answers mistyped arguments with invalid_arguments", async () => {
    const provider = new ScriptedStructuredProvider([
      actionTurn({
        action: "call_tool",
        tool: "get_business_health",
        arguments: { lens: "vibes" },
      }),
      actionTurn({ action: "answer", message: "ok" }),
    ]);
    const trajectory = await run(provider);
    expect(trajectory.toolCalls[0].decision).toBe("invalid_arguments");
  });
});

describe("ceilings are enforced in code", () => {
  it("stops at the model-call ceiling", async () => {
    const script = Array.from({ length: PILOT_BUDGETS.maxModelCalls + 2 }, () =>
      actionTurn({ action: "call_tool", tool: "get_project_focus" }),
    );
    const trajectory = await run(new ScriptedStructuredProvider(script), {
      budgets: { ...PILOT_BUDGETS, maxToolCalls: 100 },
    });
    expect(trajectory.stop).toBe("max_model_calls");
    expect(trajectory.modelCalls).toHaveLength(PILOT_BUDGETS.maxModelCalls);
  });

  it("stops at the tool-call ceiling", async () => {
    const budgets = { ...PILOT_BUDGETS, maxToolCalls: 2, maxModelCalls: 10 };
    const script = Array.from({ length: 5 }, () =>
      actionTurn({ action: "call_tool", tool: "get_project_focus" }),
    );
    const trajectory = await run(new ScriptedStructuredProvider(script), { budgets });
    expect(trajectory.toolCalls.map((call) => call.decision)).toEqual([
      "executed",
      "executed",
      "budget_exhausted",
    ]);
    expect(trajectory.stop).toBe("max_tool_calls");
  });
});

describe("the same script gives the same trajectory", () => {
  it("is reproducible", async () => {
    const script = () =>
      new ScriptedStructuredProvider([
        actionTurn({ action: "call_tool", tool: "get_project_focus" }),
        actionTurn({
          action: "call_tool",
          tool: "get_business_health",
          arguments: { lens: "all" },
        }),
        actionTurn({ action: "answer", message: "Start with pricing." }),
      ]);
    const first = await run(script());
    const second = await run(script());
    const stable = (trajectory: typeof first) => ({
      ...trajectory,
      totals: { ...trajectory.totals, latencyMs: 0 },
    });
    expect(stable(first)).toEqual(stable(second));
  });
});
