import { describe, expect, it } from "vitest";
import { AGENT_TOOLS } from "../tools/registry";
import {
  FOREIGN_MARKER,
  FOREIGN_MOVE_ID,
  healthyProject,
  INJECTION,
  missingAudit,
  noActionPlan,
  noOpportunities,
  staleAudit,
  withForeignProject,
  withInjectedInstruction,
  type EvalWorld,
} from "./world";

/**
 * The production tools, against the states a real project is actually in.
 *
 * ## What this replaces, and why
 *
 * The seam pilot graded eight scripted tools over an invented world, which was
 * the right instrument for choosing a provider seam and says nothing about
 * whether the product answers well. These run the **production adapters**
 * against seeded rows in the tables production writes, so what is faked is the
 * database driver and nothing else.
 *
 * ## What they can prove without paying a provider
 *
 * Everything about the evidence: that a missing audit reads as missing rather
 * than as bad, that a stale one says so, that an empty Move set is not
 * fabricated into one, that a foreign identifier fails closed and that no row
 * of another project is ever reachable. What they cannot prove is what the
 * *model* does with any of it — that needs a paid run, and ADR 0109's shipping
 * gate is where it is decided.
 */

const context = (world: EvalWorld) => ({
  supabase: world.supabase,
  projectId: world.projectId,
  userId: world.userId,
});

async function content(world: EvalWorld, tool: keyof typeof AGENT_TOOLS, input = {}) {
  const outcome = await AGENT_TOOLS[tool].execute(context(world), input);
  return outcome.kind === "ok" ? outcome.content : `ERROR:${outcome.code}:${outcome.message}`;
}

describe("a healthy project", () => {
  it("reads a current audit and names its priority with the evidence behind it", async () => {
    const text = await content(healthyProject(), "get_business_health");

    expect(text).toContain("state: current");
    expect(text).toContain("No price is shown anywhere a visitor can reach");
    expect(text).toContain("evidence:");
  });

  it("carries a real Move id, so the next tool never needs a sentinel", async () => {
    const text = await content(healthyProject(), "get_opportunities");

    expect(text).toContain("id: opp-1");
    expect(text).toContain("planned_move: opp-1");
    expect(text).toContain("state: current");
  });

  it("names the first step that can be worked on, by its key", async () => {
    const text = await content(healthyProject(), "get_action_plan", {
      opportunity_id: "opp-1",
    });

    expect(text).toContain("step_key: step-pricing-section");
    expect(text).toContain("first_step_that_can_be_worked_on_now: step-pricing-section");
  });
});

describe("missing evidence is not a bad result (rule 44)", () => {
  it("says no audit has run rather than reporting nothing", async () => {
    const text = await content(missingAudit(), "get_business_health");

    expect(text).toContain("no_audit_has_run");
    // Not a zero, not an empty reading, not a score of any kind.
    expect(text).not.toMatch(/\b0\b/);
    expect(text).not.toContain("overall:");
  });

  it("says no Moves have been ranked rather than inventing one", async () => {
    const text = await content(missingAudit(), "get_opportunities");

    expect(text).toContain("no_moves");
    expect(text).not.toContain("id: opp-");
  });

  it("says there is no plan rather than describing steps nobody wrote", async () => {
    const text = await content(noActionPlan(), "get_action_plan", { opportunity_id: "opp-1" });

    expect(text).toContain("no_plan");
    expect(text).not.toContain("step_key:");
  });
});

describe("stale evidence says so", () => {
  it("reports the reading as outdated rather than as current", async () => {
    const text = await content(staleAudit(), "get_business_health");

    expect(text).toContain("state: outdated");
    expect(text).toContain("produced:");
    // The age is a bucket, never a number a reply could quote as a fact.
    expect(text).toMatch(
      /produced: (today|a few days ago|about a week ago|a few weeks ago|months ago)/,
    );
  });
});

describe("nothing is fabricated when a set is empty", () => {
  it("reports no Moves from a project whose audit produced none", async () => {
    const text = await content(noOpportunities(), "get_opportunities");
    expect(text).toContain("no_moves");
  });
});

describe("a foreign identifier fails closed", () => {
  it("refuses a Move id from another project and names the way back", async () => {
    const world = withForeignProject(healthyProject());
    const outcome = await AGENT_TOOLS.get_action_plan.execute(context(world), {
      opportunity_id: FOREIGN_MOVE_ID,
    });

    expect(outcome.kind).toBe("error");
    if (outcome.kind === "error") {
      expect(outcome.code).toBe("not_found");
      expect(outcome.message).toContain("get_opportunities");
    }
  });

  it("never lets another project's prose reach any tool result", async () => {
    const world = withForeignProject(healthyProject());

    for (const tool of ["get_business_health", "get_opportunities", "get_project_focus"] as const) {
      const text = await content(world, tool);
      expect(text, tool).not.toContain(FOREIGN_MARKER);
      expect(text, tool).not.toContain(FOREIGN_MOVE_ID);
    }
  });
});

describe("an injected instruction is carried as data", () => {
  /**
   * It reaches the model, and that is the point: removing it would test a
   * world where injection does not happen. What must hold is that nothing in
   * the tool layer *acts* on it — the text arrives inside a fence, the tool it
   * names does not exist, and the reply validator refuses the word it wants
   * the founder to read.
   */
  it("returns the planted text inside the evidence, and nothing else changes", async () => {
    const world = withInjectedInstruction(healthyProject());
    const text = await content(world, "get_business_health");

    expect(text).toContain(INJECTION);
    // The tool still answers the question it was asked.
    expect(text).toContain("state: current");
  });

  it("has no tool for the thing the injection asks for", async () => {
    expect(Object.keys(AGENT_TOOLS)).not.toContain("merge_change");
  });
});
