import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fakeSupabase, FakeDatabase } from "@/modules/operations/test-support";
import { BANNED_MODULE_NAMES } from "@/modules/nova/voice/checks";
import {
  AGENT_TOOL_PROGRESS_LABELS,
  UNKNOWN_STEP_LABEL,
  agentStepLabel,
} from "../catalog";
import { AGENT_SKILLS, AGENT_SKILL_IDS, SKILL_REGISTRY_VERSION } from "../skills/registry";
import {
  AGENT_TOOLS,
  AGENT_TOOL_NAMES,
  agentToolDescriptors,
  boundToolResult,
  isAgentToolName,
  validateArguments,
} from "./registry";

/**
 * The tool boundary, asserted as structure rather than as behaviour.
 *
 * These are the claims rule 41's second exception rests on, and none of them
 * can be checked by watching a turn go well: a closed set, no argument that
 * carries authority, no sentinel, every adapter project-scoped, every skill
 * naming only tools that exist.
 */

const DIR = join(process.cwd(), "src/modules/business-agent/tools");
const source = (file: string) => readFileSync(join(DIR, file), "utf8");
const ADAPTERS = readdirSync(DIR).filter(
  (file) => file.endsWith(".ts") && !file.endsWith(".test.ts") && file !== "registry.ts",
);

const context = () => ({
  supabase: fakeSupabase(new FakeDatabase()),
  projectId: "p1",
  userId: "u1",
});

describe("the registry is closed", () => {
  it("is total over its own names, and holds exactly six tools", () => {
    expect(Object.keys(AGENT_TOOLS).sort()).toEqual([...AGENT_TOOL_NAMES].sort());
    expect(AGENT_TOOL_NAMES).toHaveLength(6);
  });

  it("resolves a name outside it to nothing at all", () => {
    for (const absent of ["merge_change", "start_execution", "approve_change", "deploy"]) {
      expect(isAgentToolName(absent)).toBe(false);
      expect(Object.hasOwn(AGENT_TOOLS, absent)).toBe(false);
    }
  });

  it("holds no tool that writes, spends, merges, deploys or reaches a URL", () => {
    for (const file of ADAPTERS) {
      const body = source(file);
      for (const forbidden of [".insert(", ".update(", ".delete(", ".upsert(", "fetch("]) {
        expect(body, `${file} must not ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("classifies every tool as a read or a preparation, and nothing else", () => {
    for (const name of AGENT_TOOL_NAMES) {
      expect(["read_only", "prepare"]).toContain(AGENT_TOOLS[name].classification);
    }
  });

  it("gives every tool a Vibe-authored progress label a founder can read", () => {
    for (const name of AGENT_TOOL_NAMES) {
      const label = AGENT_TOOL_PROGRESS_LABELS[name];
      expect(label.length, name).toBeGreaterThan(3);
      /*
       * The label is what the thread shows while a step runs, so it is held to
       * the same line generated prose is: none of Vibe's own words for its
       * machinery, and never the tool's own name. A founder watching their
       * business read `get_business_health` would be reading the codebase.
       */
      const normalized = label.toLowerCase();
      for (const forbidden of [...BANNED_MODULE_NAMES, ...AGENT_TOOL_NAMES, "tool", "_"]) {
        expect(normalized, `${name}: "${label}"`).not.toContain(forbidden);
      }
    }
  });

  it("labels every recorded step, including one whose tool has since gone", () => {
    for (const name of AGENT_TOOL_NAMES) {
      expect(agentStepLabel(name)).toBe(AGENT_TOOL_PROGRESS_LABELS[name]);
    }
    // An old conversation read under new code renders Vibe's words, never the
    // stored string.
    expect(agentStepLabel("get_something_retired")).toBe(UNKNOWN_STEP_LABEL);
  });
});

describe("no tool takes a sentinel argument", () => {
  /**
   * The rule ADR 0109 made binding after the seam pilot measured what a
   * sentinel costs: asked to pass `""` for "the latest", the model emitted its
   * own tool-call markup instead and repeated the malformed call until the
   * turn's ceiling stopped it with nothing said to the founder.
   */
  it("declares no argument whose documentation offers an empty string", () => {
    for (const name of AGENT_TOOL_NAMES) {
      const schema = JSON.stringify(AGENT_TOOLS[name].inputSchema);
      expect(schema, name).not.toMatch(/empty string/i);
      expect(AGENT_TOOLS[name].description, name).not.toMatch(/empty string/i);
    }
  });

  it("requires every argument it declares, so absence is never a value", () => {
    for (const name of AGENT_TOOL_NAMES) {
      const schema = AGENT_TOOLS[name].inputSchema as {
        properties: Record<string, unknown>;
        required: string[];
        additionalProperties: boolean;
      };
      expect(schema.required.sort(), name).toEqual(Object.keys(schema.properties).sort());
      expect(schema.additionalProperties, name).toBe(false);
    }
  });
});

describe("arguments carry no authority", () => {
  it("takes the project from the context and never from an argument", () => {
    for (const name of AGENT_TOOL_NAMES) {
      const schema = AGENT_TOOLS[name].inputSchema as { properties: Record<string, unknown> };
      // The property *names*, not the prose: a description may name a tool
      // called `get_project_focus` without the tool taking a project.
      for (const key of Object.keys(schema.properties)) {
        expect(key, `${name}.${key}`).not.toMatch(/project|user|tenant|account|owner/i);
      }
    }
  });

  it("passes the context's project id into every read it makes", () => {
    for (const file of ADAPTERS) {
      const body = source(file);
      if (!body.includes("context.supabase")) continue;
      expect(body, file).toContain("context.projectId");
    }
  });

  it("never reaches a store function that has no project predicate", () => {
    // Both of these read a row by id alone; a model-supplied id would reach
    // another project's row through either.
    for (const file of ADAPTERS) {
      expect(source(file), file).not.toContain("getActionPlanById");
      expect(source(file), file).not.toContain("getProfileById");
    }
  });

  it("refuses a Move id this project does not have", async () => {
    const outcome = await AGENT_TOOLS.get_action_plan.execute(context(), {
      opportunity_id: "opp-from-another-project",
    });

    expect(outcome.kind).toBe("error");
    if (outcome.kind === "error") {
      expect(outcome.code).toBe("not_found");
      // Names the way back rather than leaving the model to guess again.
      expect(outcome.message).toContain("get_opportunities");
    }
  });

  it("refuses a step key this project's plan does not have", async () => {
    const outcome = await AGENT_TOOLS.resolve_execution.execute(context(), {
      step_key: "step-from-somewhere-else",
    });

    // No plan at all in an empty world, which is a state and not an error.
    expect(outcome.kind).toBe("ok");
    if (outcome.kind === "ok") expect(outcome.content).toContain("no_plan");
  });
});

describe("validation happens on receipt", () => {
  it("refuses an argument the schema does not declare", () => {
    const result = validateArguments(AGENT_TOOLS.get_action_plan.inputSchema, { nope: "x" });
    expect(result.ok).toBe(false);
  });

  it("refuses a missing argument", () => {
    const result = validateArguments(AGENT_TOOLS.resolve_execution.inputSchema, {});
    expect(result.ok).toBe(false);
  });

  it("refuses a skill id outside the registry", () => {
    const result = validateArguments(AGENT_TOOLS.use_skill.inputSchema, {
      skill_id: "make-me-a-sandwich",
    });
    expect(result.ok).toBe(false);
  });
});

describe("results are bounded and announced", () => {
  it("says so when it cuts a result", () => {
    const bounded = boundToolResult("x".repeat(10_000), 200);
    expect(Buffer.byteLength(bounded, "utf8")).toBeLessThanOrEqual(200);
    expect(bounded).toContain("this result is incomplete");
  });

  it("leaves a result that fits exactly as it is", () => {
    expect(boundToolResult("short", 200)).toBe("short");
  });

  it("bounds what every adapter returns", () => {
    for (const file of ADAPTERS) {
      const body = source(file);
      if (!body.includes('kind: "ok"')) continue;
      if (file === "skills.ts") continue; // Vibe's own procedure, authored and fixed.
      expect(body, file).toContain("boundToolResult(");
    }
  });
});

describe("the descriptors are what the provider is told", () => {
  it("names every tool once, with a description and a schema", () => {
    const descriptors = agentToolDescriptors();
    expect(descriptors.map((tool) => tool.name)).toEqual([...AGENT_TOOL_NAMES]);
    for (const descriptor of descriptors) {
      expect(descriptor.description.length).toBeGreaterThan(40);
      expect(descriptor.inputSchema).toBeTruthy();
    }
  });
});

describe("the skill registry", () => {
  it("ships one skill, and it is the one this slice exists to prove", () => {
    expect(AGENT_SKILL_IDS).toEqual(["next-move"]);
    expect(SKILL_REGISTRY_VERSION.length).toBeGreaterThan(0);
  });

  it("names only tools the registry actually has", () => {
    for (const skill of AGENT_SKILLS) {
      for (const tool of skill.recommendedTools) {
        expect(isAgentToolName(tool), `${skill.id} names ${tool}`).toBe(true);
      }
    }
  });

  it("keeps the procedure byte-identical to the SKILL.md beside it", () => {
    for (const skill of AGENT_SKILLS) {
      const onDisk = readFileSync(
        join(process.cwd(), `src/modules/business-agent/skills/${skill.id}/SKILL.md`),
        "utf8",
      );
      expect(skill.procedure, skill.id).toBe(onDisk);
    }
  });

  it("cites no file path and no model in any procedure", () => {
    for (const skill of AGENT_SKILLS) {
      expect(skill.procedure, skill.id).not.toMatch(/src\//);
      expect(skill.procedure, skill.id).not.toMatch(/claude-|gpt-|sonnet|opus/i);
    }
  });
});
