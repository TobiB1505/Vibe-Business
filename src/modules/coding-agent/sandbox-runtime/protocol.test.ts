import { describe, expect, it } from "vitest";
import {
  AGENT_RUNTIME_VERSION,
  parseAgentRuntimeResult,
  toAgentModelUsage,
} from "./protocol";

/**
 * What comes back out of the sandbox, treated as what it is: JSON produced
 * inside a VM that is running a customer's repository under a model that reads
 * it.
 *
 * Every field is re-derived rather than cast. The failure this guards against
 * is not a hostile payload so much as a plausible one — a number where a count
 * belongs, a version from a runtime that no longer exists — being carried into
 * a usage ledger and a customer's bill.
 */

function result(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    version: AGENT_RUNTIME_VERSION,
    subtype: "success",
    assistantMessages: 4,
    sdkLoopIterations: 9,
    sessionId: "session-1",
    permissionDenials: 1,
    modelUsage: {},
    error: null,
    ...overrides,
  });
}

describe("a well-formed result", () => {
  it("parses every field", () => {
    expect(parseAgentRuntimeResult(result())).toEqual({
      version: AGENT_RUNTIME_VERSION,
      subtype: "success",
      assistantMessages: 4,
      sdkLoopIterations: 9,
      sessionId: "session-1",
      verificationCommands: 0,
      verificationRefusals: 0,
      policyDecisions: 0,
      permissionDenials: 1,
      modelUsage: {},
      error: null,
    });
  });
});

describe("a result this runtime cannot vouch for", () => {
  it.each([
    ["no file at all", null],
    ["not JSON", "the agent finished"],
    ["JSON that is not an object", "[]"],
    ["an object with no version", JSON.stringify({ subtype: "success" })],
  ])("is refused: %s", (_why, payload) => {
    expect(parseAgentRuntimeResult(payload)).toBeNull();
  });

  /**
   * A stale program left behind in a reused sandbox would answer a request it
   * never understood, and the reply would look perfectly well-formed.
   */
  it("is refused when the runtime version does not match", () => {
    expect(parseAgentRuntimeResult(result({ version: "vibe-agent-runtime-v0" }))).toBeNull();
  });
});

describe("fields are coerced, never trusted", () => {
  it.each([
    ["a negative turn count", { assistantMessages: -5 }, 0],
    ["a fractional turn count", { assistantMessages: 3.7 }, 3],
    ["a turn count that is a string", { assistantMessages: "many" }, 0],
  ])("%s becomes a non-negative integer", (_why, overrides, expected) => {
    expect(parseAgentRuntimeResult(result(overrides))?.assistantMessages).toBe(expected);
  });

  /**
   * The two counters are separate on purpose, so the parser must not let one
   * fill in for the other. Null is the honest value for a run whose harness
   * never reported a loop count — the message count is not a substitute, and
   * treating it as one is what produced run b33635a1's "66 / 40".
   */
  it("reports an absent loop count as null, never as the message count", () => {
    expect(parseAgentRuntimeResult(result({ sdkLoopIterations: undefined }))?.sdkLoopIterations)
      .toBeNull();
    expect(parseAgentRuntimeResult(result({ sdkLoopIterations: "nine" }))?.sdkLoopIterations)
      .toBeNull();
    expect(parseAgentRuntimeResult(result({ sdkLoopIterations: 12 }))?.sdkLoopIterations).toBe(12);
  });

  it("drops a session id that is not a string", () => {
    expect(parseAgentRuntimeResult(result({ sessionId: { token: "x" } }))?.sessionId).toBeNull();
  });

  it("bounds an error string rather than storing whatever came back", () => {
    const parsed = parseAgentRuntimeResult(result({ error: "x".repeat(5_000) }));

    expect(parsed?.error?.length).toBe(400);
  });

  it("bounds a subtype, which is used to pick a domain outcome", () => {
    const parsed = parseAgentRuntimeResult(result({ subtype: "s".repeat(500) }));

    expect(parsed?.subtype.length).toBe(64);
  });
});

describe("usage crossing the boundary", () => {
  it("reads the counts the harness reported", () => {
    expect(
      toAgentModelUsage({
        "claude-sonnet-5": {
          inputTokens: 1_200,
          outputTokens: 340,
          cacheReadInputTokens: 90,
          cacheCreationInputTokens: 12,
          costUSD: 0.04,
        },
      }),
    ).toEqual([
      {
        model: "claude-sonnet-5",
        inputTokens: 1_200,
        outputTokens: 340,
        cacheReadInputTokens: 90,
        cacheCreationInputTokens: 12,
        reportedCostUsd: 0.04,
      },
    ]);
  });

  /**
   * A missing count becomes zero rather than `undefined` reaching arithmetic.
   * The alternative is a `NaN` in a pricing calculation, which is a number
   * nobody can bill and nobody notices until an invoice is wrong.
   */
  it("turns missing and nonsensical counts into zero", () => {
    expect(
      toAgentModelUsage({ "claude-sonnet-5": { inputTokens: "lots", outputTokens: -3 } }),
    ).toEqual([
      {
        model: "claude-sonnet-5",
        inputTokens: 0,
        outputTokens: 0,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        reportedCostUsd: null,
      },
    ]);
  });

  it("ignores entries that are not objects", () => {
    expect(toAgentModelUsage({ "claude-sonnet-5": "free", other: null })).toEqual([]);
  });
});
