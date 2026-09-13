import { execSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AGENT_TURN_BUDGETS } from "./orchestrator/budgets";

/**
 * The claims ADR 0109 rests on, read as structure.
 *
 * A turn that behaves well proves nothing about any of these: they are about
 * what the code *cannot* do, and the only way to check that is to read it.
 */

const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

/**
 * Every production file of a module, by name and body.
 *
 * Two exclusions, both deliberate, and the test below holds them to being the
 * only ones. `pilot/` is the seam experiment ADR 0109 was decided on and its
 * job is to call the provider and replay scripted answers, so it holds the
 * adapter import and the model names these sweeps exist to keep out of
 * production; its own boundary is asserted by `ai/provider-contract.test.ts`.
 * A `.probe.ts` is a paid measurement — it reaches the provider accessor on
 * purpose, and `vitest.config` cannot reach it at all.
 */
function filesUnder(dir: string): { name: string; body: string }[] {
  const full = join(ROOT, dir);
  return readdirSync(full, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .filter((entry) => !entry.name.endsWith(".test.ts"))
    .filter((entry) => !entry.name.endsWith(".probe.ts"))
    .filter((entry) => !(entry.parentPath ?? full).includes("/pilot"))
    .map((entry) => ({
      name: entry.name,
      body: readFileSync(join(entry.parentPath ?? full, entry.name), "utf8"),
    }));
}

describe("the shipped structured operations stay tool-free", () => {
  it("keeps AIProvider to its two methods", () => {
    const provider = read("src/modules/ai/provider.ts");
    const iface = provider.slice(
      provider.indexOf("export interface AIProvider "),
      provider.indexOf("\n}", provider.indexOf("export interface AIProvider ")),
    );
    expect(iface).toContain("countInputTokens(");
    expect(iface).toContain("generateStructured(");
    expect(iface).not.toContain("generateWithTools");
  });

  it("names the tool-calling contract only where a caller had to ask for it", () => {
    const callers = execSync(
      `grep -rl "getAIToolCallingProvider\\|AIToolCallingProvider" src --include=*.ts --include=*.tsx || true`,
      { encoding: "utf8" },
    )
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .filter((path) => !path.endsWith(".test.ts"));

    // The provider, its adapter, its accessor, the agent module, the pilot, and
    // the one operation family that runs a turn. Nothing else in the product
    // can reach a model that holds a tool.
    for (const path of callers) {
      expect(
        path.startsWith("src/modules/ai/") ||
          path.startsWith("src/modules/business-agent/") ||
          path.startsWith("src/modules/operations/business-agent/"),
        path,
      ).toBe(true);
    }
  });
});

describe("the provider SDK stays behind its adapter", () => {
  it("is imported only under src/modules/ai/anthropic/", () => {
    const offenders = execSync(
      `grep -rlE 'from "@anthropic-ai/sdk"' src --include=*.ts --include=*.tsx || true`,
      { encoding: "utf8" },
    )
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .filter((path) => !path.startsWith("src/modules/ai/anthropic/"))
      .filter((path) => !path.endsWith(".test.ts"));
    expect(offenders).toEqual([]);
  });

  it("keeps the agent module free of the SDK and of the adapter", () => {
    for (const { name, body } of filesUnder("src/modules/business-agent")) {
      expect(body, name).not.toContain("@anthropic-ai/sdk");
      expect(body, name).not.toContain("@/modules/ai/anthropic");
    }
  });

  /**
   * The exclusions above are exclusions, not holes.
   *
   * Every file that reaches the provider accessor from this module is either
   * inside the pilot or is a probe, and a probe is unreachable from
   * `pnpm test` by configuration rather than by convention — which is what
   * makes it safe for one to hold a paid call.
   */
  it("lets only probes and the pilot reach the provider accessor", () => {
    const reaching = execSync(
      `grep -rl "@/modules/ai/anthropic" src/modules/business-agent || true`,
      { encoding: "utf8" },
    )
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      // This file names the accessor's import path in order to forbid it.
      .filter((path) => !path.endsWith(".test.ts"));

    for (const path of reaching) {
      expect(path.endsWith(".probe.ts") || path.includes("/pilot/"), path).toBe(true);
    }
    // And the sweep is not vacuous: the probes it permits do exist.
    expect(reaching.some((path) => path.endsWith(".probe.ts"))).toBe(true);

    /*
     * Unreachable by configuration: the suite matches `*.test.{ts,tsx}` and
     * nothing else, so a `.probe.ts` cannot be collected by `pnpm test` no
     * matter where it sits or what it imports.
     */
    const config = read("vitest.config.mts");
    expect(config).toContain('include: ["src/**/*.test.{ts,tsx}"]');
  });
});

describe("the agent module holds no capability it must not have", () => {
  it("starts no operation, moves no money, and reaches no URL", () => {
    for (const { name, body } of filesUnder("src/modules/business-agent")) {
      for (const forbidden of [
        "startBusinessAuditOperation",
        "startOpportunityOperation",
        "startActionPlanOperation",
        "startAgentRun",
        "mergeChange",
        "reserveCredits",
        "createServiceClient",
        "fetch(",
        "execSync",
        "child_process",
      ]) {
        expect(body, `${name} must not reach ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("names no model anywhere outside ai/operations.ts (rule 46)", () => {
    for (const { name, body } of filesUnder("src/modules/business-agent")) {
      expect(body, name).not.toMatch(/claude-sonnet|claude-opus|claude-haiku/);
    }
  });
});

describe("the ceilings are numbers in a file, not sentences in a prompt", () => {
  it("puts every budget in budgets.ts", () => {
    for (const key of Object.keys(AGENT_TURN_BUDGETS)) {
      expect(typeof AGENT_TURN_BUDGETS[key as keyof typeof AGENT_TURN_BUDGETS]).toBe("number");
    }
  });

  it("writes no ceiling into the system prompt", () => {
    const prompt = read("src/modules/business-agent/orchestrator/prompt.ts");
    // A number in a prompt is a request. The loop's numbers are facts.
    const inPromptText = prompt
      .split("\n")
      .filter((line) => line.trim().startsWith("-") || line.includes("`;"))
      .join("\n");
    expect(inPromptText).not.toMatch(/\b\d{2,}\b/);
  });
});

describe("the conversation is not canonical business state", () => {
  it("stores references to rows, and no copy of one", () => {
    const migration = read("supabase/migrations/20260913120000_agent_conversations.sql");
    const artifacts = migration.slice(
      migration.indexOf("create table public.agent_message_artifacts"),
      migration.indexOf("comment on table public.agent_message_artifacts"),
    );
    expect(artifacts).toContain("subject_id");
    for (const copied of ["title", "problem", "headline", "score", "body", "jsonb"]) {
      expect(artifacts, copied).not.toContain(copied);
    }
  });

  it("gives no table a column model reasoning could occupy", () => {
    const migration = read("supabase/migrations/20260913120000_agent_conversations.sql");
    /*
     * Column definitions only. The prose above them says the word "reasoning"
     * on purpose — it is the comment arguing that no such column exists — so
     * the sweep reads the declarations rather than the file, which is where a
     * column would actually appear.
     */
    const declarations = migration
      .split("\n")
      .filter((line) =>
        /^\s{2}\w+\s+(uuid|text|integer|smallint|jsonb|timestamptz|boolean)/.test(line),
      )
      .join("\n");
    expect(declarations.length).toBeGreaterThan(200);
    for (const forbidden of [
      "reasoning",
      "thinking",
      "chain_of_thought",
      "prompt_text",
      "rationale",
    ]) {
      expect(declarations, forbidden).not.toContain(forbidden);
    }
  });

  it("gives the founder no write policy on any of the five", () => {
    const migration = read("supabase/migrations/20260913120000_agent_conversations.sql");
    for (const table of [
      "agent_conversations",
      "agent_messages",
      "agent_message_artifacts",
      "agent_turn_runs",
      "agent_turn_tool_calls",
    ]) {
      expect(migration, table).toContain(`grant select on table public.${table} to authenticated;`);
      expect(migration, table).not.toMatch(
        new RegExp(`grant [^;]*insert[^;]*on table public\\.${table} to authenticated`),
      );
    }
  });
});

describe("the turn writes one ledger row per model call (rule 47)", () => {
  it("records usage for failures as well as successes", () => {
    const execution = read("src/modules/operations/business-agent/execution.ts");
    expect(execution).toContain("for (const call of result.modelCalls)");
    expect(execution).toContain('status: call.failure === null ? "succeeded" : "failed"');
  });

  it("exempts agent_turn from the one-row-per-job index, by name", () => {
    const migration = read("supabase/migrations/20260913120000_agent_conversations.sql");
    expect(migration).toContain("operation <> 'agent_turn'");
    // Lifted for that one value, never weakened globally.
    expect(migration).toContain("operation <> 'agentic_execution'");
  });
});
