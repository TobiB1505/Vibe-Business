import { describe, expect, it } from "vitest";
import { measureSchema } from "@/modules/ai/probe/schema-metrics";
import { baseEnvironment, withToolFailure } from "./fixtures";
import {
  boundToolResult,
  isPilotToolName,
  PILOT_TOOL_NAMES,
  PILOT_TOOLS,
  pilotToolDescriptors,
  PROHIBITED_CAPABILITIES,
  validateArguments,
} from "./tools";

/**
 * The tool boundary, offline. Every property the seams rely on is a
 * property of this file, so it is proved here once rather than once per seam.
 */

describe("the registry is closed", () => {
  it("resolves exactly the declared names and nothing else", () => {
    for (const name of PILOT_TOOL_NAMES) expect(isPilotToolName(name)).toBe(true);
    for (const name of PROHIBITED_CAPABILITIES) expect(isPilotToolName(name)).toBe(false);
    expect(isPilotToolName("get_business_health ")).toBe(false);
    expect(isPilotToolName("GET_BUSINESS_HEALTH")).toBe(false);
  });

  it("offers only read-only and prepare tools, never a write", () => {
    for (const name of PILOT_TOOL_NAMES) {
      expect(["read_only", "prepare"]).toContain(PILOT_TOOLS[name].classification);
    }
  });

  it("names no prohibited capability in any descriptor", () => {
    const descriptors = pilotToolDescriptors();
    expect(descriptors.map((tool) => tool.name)).toEqual([...PILOT_TOOL_NAMES]);
    for (const prohibited of PROHIBITED_CAPABILITIES) {
      expect(descriptors.some((tool) => tool.name === prohibited)).toBe(false);
    }
  });

  it("declares every input schema in the strict subset", () => {
    for (const tool of pilotToolDescriptors()) {
      const metrics = measureSchema(tool.inputSchema);
      expect(metrics.objectsMissingAdditionalPropertiesFalse, tool.name).toBe(0);
      expect(metrics.optionalPropertyCount, tool.name).toBe(0);
      expect(metrics.unionCount, tool.name).toBe(0);
    }
  });
});

describe("arguments are validated on receipt", () => {
  const health = PILOT_TOOLS.get_business_health.inputSchema;

  it("accepts a well-formed call", () => {
    expect(validateArguments(health, { lens: "conversion" })).toEqual({
      ok: true,
      value: { lens: "conversion" },
    });
  });

  it("refuses a missing, extra, mistyped or out-of-enum argument", () => {
    expect(validateArguments(health, {}).ok).toBe(false);
    expect(validateArguments(health, { lens: "conversion", extra: 1 }).ok).toBe(false);
    expect(validateArguments(health, { lens: 3 }).ok).toBe(false);
    expect(validateArguments(health, { lens: "vibes" }).ok).toBe(false);
    expect(validateArguments(health, "conversion").ok).toBe(false);
    expect(validateArguments(health, null).ok).toBe(false);
  });

  it("refuses a boolean given as a string", () => {
    const schema = PILOT_TOOLS.estimate_execution_cost.inputSchema;
    expect(validateArguments(schema, { step_key: "s", chain: "true" }).ok).toBe(false);
    expect(validateArguments(schema, { step_key: "s", chain: true }).ok).toBe(true);
  });
});

describe("identifiers carry no authority", () => {
  it("answers not_found for a Move that is not this project's, and never reads the foreign rows", () => {
    const env = baseEnvironment();
    const outcome = PILOT_TOOLS.get_action_plan.execute(env, {
      opportunity_id: env.foreign.moveId,
    });
    expect(outcome).toEqual({ kind: "error", code: "not_found", message: expect.any(String) });
    expect(JSON.stringify(outcome)).not.toContain(env.foreign.marker);
  });

  it("answers not_found for a malformed id the same way", () => {
    const env = baseEnvironment();
    const outcome = PILOT_TOOLS.resolve_execution.execute(env, {
      step_key: "../step-pricing-section",
    });
    expect(outcome.kind).toBe("error");
    if (outcome.kind === "error") expect(outcome.code).toBe("not_found");
  });

  it("never lets an offer start anything, and refuses to offer a step Vibe cannot build", () => {
    const env = baseEnvironment();
    const offered = PILOT_TOOLS.offer_execution.execute(env, {
      step_key: "step-pricing-section",
      chain: false,
    });
    expect(offered.kind).toBe("ok");
    if (offered.kind === "ok") {
      expect(offered.content).toContain("Nothing has started");
      expect(offered.subjectIds).toEqual(["execution_offer:step-pricing-section"]);
    }
    const refused = PILOT_TOOLS.offer_execution.execute(env, {
      step_key: "step-confirm-price",
      chain: false,
    });
    expect(refused.kind).toBe("ok");
    if (refused.kind === "ok") expect(refused.content).toContain('"offered": false');
  });
});

describe("failures are results", () => {
  it("returns a typed error rather than throwing when a tool is down", () => {
    const env = withToolFailure(baseEnvironment(), "get_business_health", "tool_unavailable");
    expect(PILOT_TOOLS.get_business_health.execute(env, { lens: "all" })).toEqual({
      kind: "error",
      code: "tool_unavailable",
      message: expect.any(String),
    });
    // Other tools are unaffected.
    expect(PILOT_TOOLS.get_project_focus.execute(env, {}).kind).toBe("ok");
  });

  it("bounds a result at the byte budget and says so", () => {
    const long = "x".repeat(10_000);
    const bounded = boundToolResult(long, 100);
    expect(Buffer.byteLength(bounded, "utf8")).toBeLessThan(200);
    expect(bounded).toContain("[truncated at 100 bytes]");
    expect(boundToolResult("short", 100)).toBe("short");
  });
});
