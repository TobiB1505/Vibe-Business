import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { creditsToUnits } from "@/modules/credits/units";
import { GLOBALLY_FORBIDDEN_CAPABILITIES, isToolAllowed } from "./policy";
import { resolveStepExecution } from "./resolver";
import { admitExecutionSpec } from "./service";
import { buildExecutionSpec } from "./spec";
import { resolveExecutionValidation } from "./validation-requirements";
import {
  FIXTURE_OTHER_SHA,
  FIXTURE_PLAN,
  fakeBudgetPolicy,
  fakePlanContext,
  fakePlanStep,
  fakeRepositoryBinding,
  fakeRepositoryContext,
  fakeResolveInput,
  fakeSnapshot,
  fakeWriteScope,
} from "./test-support";
import { resolveExecutionBudget } from "./budget";

/**
 * The §54 security review, as executable assertions.
 *
 * Each `it` below is one line of that checklist. A prose checklist in a sprint
 * document is a claim about the code at the moment somebody read it; this is a
 * claim the suite re-checks on every commit.
 */

const MODULE_DIR = join(process.cwd(), "src/modules/execution-contract");

/**
 * Every production source file in this module.
 *
 * Tests and probes are excluded deliberately: this file itself contains the
 * very strings it asserts are absent, and scanning it would make the assertion
 * fail on its own text. Probes are dev-only and never bundled.
 */
function moduleSources(): string[] {
  return readdirSync(MODULE_DIR)
    .filter((name) => name.endsWith(".ts"))
    .filter((name) => !name.endsWith(".test.ts") && !name.endsWith(".probe.ts"))
    .map((name) => readFileSync(join(MODULE_DIR, name), "utf8"));
}

const MIGRATIONS_DIR = join(process.cwd(), "supabase/migrations");

function migration(suffix: string): string {
  const name = readdirSync(MIGRATIONS_DIR)
    .sort()
    .find((entry) => entry.endsWith(suffix));
  if (!name) throw new Error(`no migration ending in ${suffix}`);
  return readFileSync(join(MIGRATIONS_DIR, name), "utf8");
}

const MIGRATION = migration("_execution_specs.sql");

/**
 * The newest definition of the immutability guard.
 *
 * Read across the whole history rather than from one file, because a `create
 * or replace` in a later migration is the definition that is live — reading
 * only the original would assert against a function Postgres no longer has.
 */
function guardDefinition(): string {
  const definitions = readdirSync(MIGRATIONS_DIR)
    .sort()
    .map((name) => readFileSync(join(MIGRATIONS_DIR, name), "utf8"))
    // Comments stripped first, and that is not cosmetic: the follow-up
    // migration *explains* why `security definer` was wrong, so a naive scan
    // would find the phrase in the prose that removed it.
    .map((sql) => sql.replace(/--[^\n]*/g, ""))
    .filter((sql) => sql.includes("function public.reject_execution_spec_mutation()"));

  return definitions[definitions.length - 1];
}

describe("§54 — the Planner cannot grant execution authority", () => {
  it("resolves independently of the plan's own executionSupport and capability", () => {
    const claiming = fakePlanStep({
      executionSupport: "vibe_executes_now",
      capability: "nextjs_seo_foundations_v2",
    });
    const denying = fakePlanStep({ executionSupport: "not_yet_supported", capability: null });

    const a = resolveStepExecution(
      fakeResolveInput({ step: claiming, plan: fakePlanContext([claiming]) }),
    );
    const b = resolveStepExecution(
      fakeResolveInput({ step: denying, plan: fakePlanContext([denying]) }),
    );

    // Identical structured facts, opposite Planner claims, identical answer.
    expect(a.mode).toBe(b.mode);
    expect(a.capability).toBe(b.capability);
  });
});

describe("§54 — a client cannot forge what a spec says", () => {
  it("gives execution_specs no insert, update or delete policy", () => {
    expect(MIGRATION).toContain('create policy "select own execution_specs"');
    expect(MIGRATION).not.toMatch(/create policy[^;]*for insert[^;]*execution_specs/i);
    expect(MIGRATION).not.toMatch(/create policy[^;]*for update[^;]*execution_specs/i);
    expect(MIGRATION).not.toMatch(/create policy[^;]*for delete[^;]*execution_specs/i);
  });

  it("scopes every read to the caller's own project", () => {
    expect(MIGRATION).toContain("p.user_id = auth.uid()");
  });

  it("rejects every mutation of a stored spec at the database level (§10, §47)", () => {
    expect(MIGRATION).toContain("before update or delete on public.execution_specs");
    expect(MIGRATION).toContain("execution_specs rows are immutable");
  });

  it("leaves the immutability guard unelevated and off the REST surface", () => {
    // Found by Supabase's security advisor immediately after the first deploy:
    // the guard shipped as `security definer`, which made it callable by `anon`
    // over `/rest/v1/rpc/`. It needs no privilege — it only raises — so the
    // elevation was removed rather than justified.
    //
    // Asserted against the *newest* definition, which is how a `create or
    // replace` in a later migration is read: the last one wins, exactly as it
    // does in Postgres.
    const definition = guardDefinition();
    expect(definition).toContain("security invoker");
    expect(definition).not.toContain("security definer");
    expect(definition).toContain("revoke execute on function");
  });

  it("constrains the mode column to executable modes only", () => {
    // A `blocked` or `needs_user_input` spec cannot exist as a row, so a
    // forged one cannot be inserted even by something holding service role.
    expect(MIGRATION).toContain("check (mode in ('deterministic', 'agentic'))");
  });

  it("pins a full-length commit SHA rather than accepting any string", () => {
    expect(MIGRATION).toContain("base_sha text not null check (char_length(base_sha) = 40)");
  });

  it("stores the server-only writer behind a server-only module", () => {
    const service = readFileSync(
      join(process.cwd(), "src/modules/execution-contract/service.ts"),
      "utf8",
    );
    const store = readFileSync(
      join(process.cwd(), "src/modules/execution-contract/store.ts"),
      "utf8",
    );

    expect(service.startsWith('import "server-only";')).toBe(true);
    expect(store.startsWith('import "server-only";')).toBe(true);
  });
});

describe("§54 — a client cannot expand a tool policy or raise its own budget", () => {
  it("compiles the policy from the resolved mode, never from a caller's request", () => {
    const step = fakePlanStep();
    const resolution = resolveStepExecution(
      fakeResolveInput({ step, plan: fakePlanContext([step]) }),
    );
    const budget = resolveExecutionBudget(new Date("2026-08-18T00:00:00.000Z"), [
      fakeBudgetPolicy(),
    ])!;

    const spec = buildExecutionSpec({
      resolution,
      step,
      plan: { ...FIXTURE_PLAN, assumptions: [...FIXTURE_PLAN.assumptions] },
      projectId: "project-1",
      repository: fakeRepositoryBinding(),
      approvedDecisions: [],
      validation: resolveExecutionValidation(fakeSnapshot()),
      budget,
      credit: { quoteId: null, maxAuthorizedCredits: budget.maxCredits },
      writeScope: fakeWriteScope(),
      createdAt: "2026-08-18T12:00:00.000Z",
    });

    for (const capability of GLOBALLY_FORBIDDEN_CAPABILITIES) {
      expect(isToolAllowed(spec.policy, capability)).toBe(false);
    }
  });

  it("refuses admission when the bound reservation is smaller than the ceiling", () => {
    const step = fakePlanStep();
    const resolution = resolveStepExecution(
      fakeResolveInput({ step, plan: fakePlanContext([step]) }),
    );
    const budget = resolveExecutionBudget(new Date("2026-08-18T00:00:00.000Z"), [
      fakeBudgetPolicy(),
    ])!;

    const spec = buildExecutionSpec({
      resolution,
      step,
      plan: { ...FIXTURE_PLAN, assumptions: [...FIXTURE_PLAN.assumptions] },
      projectId: "project-1",
      repository: fakeRepositoryBinding(),
      approvedDecisions: [],
      validation: resolveExecutionValidation(fakeSnapshot()),
      budget,
      credit: { quoteId: null, maxAuthorizedCredits: budget.maxCredits },
      writeScope: fakeWriteScope(),
      createdAt: "2026-08-18T12:00:00.000Z",
    });

    expect(
      admitExecutionSpec({
        spec,
        resolution,
        budget,
        reservation: { id: "res-1", status: "active", reservedCredits: creditsToUnits(1) },
      }),
    ).toEqual({ admissible: false, refusal: "credit_reservation_insufficient" });
  });
});

describe("§54 — a client cannot disable validation or unblock a blocked step", () => {
  it("keeps the validation requirement derived from the repository", () => {
    const requirement = resolveExecutionValidation(
      fakeSnapshot({ frameworks: [{ id: "rails", name: "Rails" }] }),
    );
    expect(requirement.supported).toBe(false);
  });

  it("never yields an executable mode for a step with an unfinished prerequisite", () => {
    const first = fakePlanStep({ id: "1-a", order: 1 });
    const second = fakePlanStep({ id: "2-b", order: 2, dependsOn: [1] });

    const resolution = resolveStepExecution(
      fakeResolveInput({ step: second, plan: fakePlanContext([first, second]) }),
    );

    expect(["deterministic", "agentic"]).not.toContain(resolution.mode);
  });
});

describe("§54 — the default branch stays outside every execution", () => {
  it("keeps default-branch writes, force push and merge globally forbidden", () => {
    expect(GLOBALLY_FORBIDDEN_CAPABILITIES).toContain("git_write_default_branch");
    expect(GLOBALLY_FORBIDDEN_CAPABILITIES).toContain("git_force_push");
    expect(GLOBALLY_FORBIDDEN_CAPABILITIES).toContain("git_merge");
  });

  it("leaves the existing merge path untouched", () => {
    // Safe merge is reached only from a human approval bound to an exact
    // commit. Nothing in this module imports it, and this asserts that rather
    // than trusting a reviewer to notice.
    for (const source of moduleSources()) {
      expect(source).not.toContain("@/modules/merge");
    }
  });
});

describe("§54 — no secret values persist in a spec", () => {
  it("stores a secret policy of `unavailable` and nothing resembling a value", () => {
    const step = fakePlanStep();
    const resolution = resolveStepExecution(
      fakeResolveInput({ step, plan: fakePlanContext([step]) }),
    );

    const spec = buildExecutionSpec({
      resolution,
      step,
      plan: { ...FIXTURE_PLAN, assumptions: [...FIXTURE_PLAN.assumptions] },
      projectId: "project-1",
      repository: fakeRepositoryBinding({ baseSha: FIXTURE_OTHER_SHA }),
      approvedDecisions: [],
      validation: resolveExecutionValidation(fakeSnapshot()),
      budget: null,
      credit: { quoteId: null, maxAuthorizedCredits: null },
      writeScope: fakeWriteScope(),
      createdAt: "2026-08-18T12:00:00.000Z",
    });

    const serialized = JSON.stringify(spec);
    expect(serialized).toContain('"secrets":{"mode":"unavailable"}');
    expect(serialized).not.toMatch(/sk-ant-|sk_live_|ghp_|BEGIN [A-Z ]*PRIVATE KEY/);
  });
});

describe("§54 — a client cannot select another user's project", () => {
  it("resolves nothing about ownership itself, and reads are RLS-scoped", () => {
    // The resolver is a pure function over data a caller already had to be
    // allowed to read. Ownership is enforced by the select policy above and by
    // the service resolving it from the persisted project row (Rule 53).
    expect(MIGRATION).toContain("alter table public.execution_specs enable row level security");
  });

  it("refuses admission against a repository the plan did not reason from", () => {
    const resolution = resolveStepExecution(
      fakeResolveInput({
        repository: fakeRepositoryContext({
          liveHead: { defaultBranch: "main", commitSha: FIXTURE_OTHER_SHA },
        }),
      }),
    );

    expect(resolution.admission.admissible).toBe(false);
  });
});

describe("§3 — no coding agent is introduced", () => {
  it("adds no agent SDK dependency", () => {
    const manifest = JSON.parse(
      readFileSync(join(process.cwd(), "package.json"), "utf8"),
    ) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };

    const all = { ...manifest.dependencies, ...manifest.devDependencies };
    for (const forbidden of [
      "@anthropic-ai/claude-agent-sdk",
      "@anthropic-ai/claude-code",
      "@openai/codex",
      "openai",
      "langchain",
    ]) {
      expect(all).not.toHaveProperty(forbidden);
    }
  });

  it("makes no AI call from this module", () => {
    for (const source of moduleSources()) {
      expect(source).not.toContain("@/modules/ai/anthropic");
      expect(source).not.toContain("getAIProvider");
    }
  });
});
