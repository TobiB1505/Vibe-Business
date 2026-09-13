import { describe, expect, it } from "vitest";
import { PILOT_CASES, PILOT_CRITICAL_CASE_IDS } from "./cases";
import { isPilotToolName, PILOT_TOOLS, validateArguments } from "./tools";

/**
 * Structural tests over the case set — free, and part of `pnpm test`.
 *
 * As for Nova's cases: these do not grade the model. They catch the eval
 * defects that make a paid run meaningless — a case that cannot be passed,
 * a duplicate id, a required tool that does not exist, a category that
 * quietly emptied out.
 */

describe("the case set as a whole", () => {
  it("has ten cases with unique ids", () => {
    expect(PILOT_CASES).toHaveLength(10);
    expect(new Set(PILOT_CASES.map((pilotCase) => pilotCase.id)).size).toBe(10);
  });

  it("covers the brief's categories", () => {
    const categories = new Set(PILOT_CASES.map((pilotCase) => pilotCase.tags[0]));
    expect([...categories].sort()).toEqual([
      "execution",
      "injection",
      "ordinary",
      "resilience",
      "security",
      "stopping",
      "uncertainty",
    ]);
  });

  it("says what regression each case exists to catch", () => {
    for (const pilotCase of PILOT_CASES)
      expect(pilotCase.why.length, pilotCase.id).toBeGreaterThan(60);
  });

  it("names critical cases that exist", () => {
    const ids = new Set(PILOT_CASES.map((pilotCase) => pilotCase.id));
    for (const id of PILOT_CRITICAL_CASE_IDS) expect(ids.has(id), id).toBe(true);
  });
});

describe("every expectation is satisfiable", () => {
  it("requires and forbids only tools that exist, and never both for one tool", () => {
    for (const pilotCase of PILOT_CASES) {
      const { requiredTools, optionalTools, forbiddenTools } = pilotCase.expectation;
      for (const tool of [...requiredTools, ...optionalTools, ...forbiddenTools]) {
        expect(isPilotToolName(tool), `${pilotCase.id}: ${tool}`).toBe(true);
      }
      for (const tool of requiredTools) {
        expect(
          forbiddenTools,
          `${pilotCase.id}: ${tool} both required and forbidden`,
        ).not.toContain(tool);
      }
    }
  });

  it("leaves room for every required tool inside the case's own tool ceiling", () => {
    for (const pilotCase of PILOT_CASES) {
      expect(pilotCase.expectation.requiredTools.length, pilotCase.id).toBeLessThanOrEqual(
        pilotCase.expectation.maxToolCalls,
      );
    }
  });

  it("orders only tools the case requires or allows", () => {
    for (const pilotCase of PILOT_CASES) {
      const allowed = new Set([
        ...pilotCase.expectation.requiredTools,
        ...pilotCase.expectation.optionalTools,
      ]);
      for (const [before, after] of pilotCase.expectation.orderedPairs) {
        expect(
          allowed.has(before) && allowed.has(after),
          `${pilotCase.id}: ${before} → ${after}`,
        ).toBe(true);
      }
    }
  });

  it("builds a fresh environment each time, so cases cannot leak into each other", () => {
    for (const pilotCase of PILOT_CASES) {
      const first = pilotCase.environment();
      const second = pilotCase.environment();
      expect(first).not.toBe(second);
      expect(first).toEqual(second);
    }
  });

  it("gives every required tool a fixture it can answer from with valid arguments", () => {
    for (const pilotCase of PILOT_CASES) {
      const env = pilotCase.environment();
      for (const tool of pilotCase.expectation.requiredTools) {
        const schema = PILOT_TOOLS[tool].inputSchema;
        const args: Record<string, unknown> = {};
        for (const key of Object.keys((schema.properties ?? {}) as Record<string, unknown>)) {
          args[key] = key === "chain" ? false : key === "lens" ? "all" : "";
        }
        expect(validateArguments(schema, args).ok, `${pilotCase.id}: ${tool}`).toBe(true);
        // A required tool may legitimately answer with an error (P8); it must not throw.
        expect(
          () => PILOT_TOOLS[tool].execute(env, args),
          `${pilotCase.id}: ${tool}`,
        ).not.toThrow();
      }
    }
  });

  it("plants the injection where a tool result will carry it, on the injection case only", () => {
    for (const pilotCase of PILOT_CASES) {
      const env = pilotCase.environment();
      const health = PILOT_TOOLS.get_business_health.execute(env, { lens: "all" });
      const carried =
        health.kind === "ok" &&
        pilotCase.injection !== null &&
        health.content.includes(pilotCase.injection);
      expect(carried, pilotCase.id).toBe(pilotCase.injection !== null);
    }
  });
});
