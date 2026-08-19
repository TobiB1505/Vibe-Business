import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AGENT_SANDBOX_LIFETIME_MS } from "@/modules/coding-agent/budget";
import { fakeAgentSpec, fakeDetachedAgentProvider } from "@/modules/coding-agent/test-support";
import { creditsToUnits } from "@/modules/credits/units";
import type { BaseContentPort } from "@/modules/coding-agent/candidate";
import type { ExecutionProbePort, GitWritePort } from "@/modules/execution/git-port";
import { fakeSandboxProvider } from "@/modules/validation/test-support";
import { FakeDatabase, fakeSupabase } from "../test-support";
import {
  pollAgentStep,
  provisionAgentWorkspaceStep,
  startAgentStep,
  type AgentExecutionDeps,
  type AgentRepositoryTarget,
} from "./execution";

/**
 * The three defects the first real acceptance run exposed, each reproduced.
 *
 * Every one of them was invisible to a green suite and obvious the moment a
 * customer's repository was involved:
 *
 * ```
 * 1. the agent step was killed at 300 s with the harness still working
 * 2. one execution could persist exactly one ai_usage_events row
 * 3. a streamed response produced null tokens
 * ```
 *
 * Two and three are covered where they live (`usage-cardinality.test.ts`,
 * `gateway-usage.test.ts`). This file covers the first, and the lifecycle hole
 * it left behind: a run that stayed `running` with Credits held because nothing
 * was carrying it any more.
 */

const USER = "user_1";
const PROJECT = "project_1";
const BASE_SHA = "1f4b0c9d7a2e5f8b3c6d9e0a1b2c3d4e5f607182";
const SANDBOX_HOME = "/vercel/sandbox";
const SANDBOX_RESULTS = { pwd: { exitCode: 0, output: `${SANDBOX_HOME}\n` } };
const SANDBOX_FILES = {
  "product/package.json": JSON.stringify({ scripts: { typecheck: "tsc" } }),
  "product/src/app/page.tsx": "export default function Page() { return null; }\n",
};

let db: FakeDatabase;

const noopGit: GitWritePort = {
  async getRefSha() {
    return null;
  },
  async getFileContent() {
    return null;
  },
  async getCommitTreeSha() {
    return "tree";
  },
  async createBlob() {
    return "blob";
  },
  async createTree() {
    return "tree";
  },
  async createCommit() {
    return "commit";
  },
  async createRef() {},
};

const probe: ExecutionProbePort = {
  async getHead() {
    return { defaultBranch: "main", commitSha: BASE_SHA };
  },
  async findExistingPaths() {
    return [];
  },
  async isServed() {
    return false;
  },
  async hasWritePermission() {
    return true;
  },
};

const base: BaseContentPort = {
  async getTextFile() {
    return null;
  },
};

function target(): AgentRepositoryTarget {
  return {
    owner: "acme",
    repo: "product",
    repositoryUrl: "https://github.com/acme/product.git",
    sourceRoot: "product",
    workspaceRoot: "",
    cloneCredential: { username: "x-access-token", password: "ghs_fake" },
    git: noopGit,
    probe,
    base,
    // No tracked-path answer, so nothing is ever withheld. These tests are
    // about lifecycle, and the safe default is the one they should exercise.
    baseTree: null,
  };
}

function seed() {
  db.seed("projects", { id: PROJECT, user_id: USER });

  const spec = fakeAgentSpec();
  const specRow = db.seed("execution_specs", {
    project_id: PROJECT,
    spec_identity: "identity-1",
    mode: "agentic",
    base_sha: BASE_SHA,
    spec: { ...spec, repository: { ...spec.repository, baseSha: BASE_SHA } },
    created_at: "2026-08-19T00:00:00.000Z",
  });

  const operation = db.seed("operation_runs", {
    project_id: PROJECT,
    user_id: USER,
    operation_type: "agent_execution",
    status: "running",
    stage: "running_agent",
    input_identity: "run-identity-1",
    subject_id: specRow.id,
    created_at: "2026-08-19T00:00:00.000Z",
  });

  const run = db.seed("agent_execution_runs", {
    project_id: PROJECT,
    user_id: USER,
    operation_run_id: operation.id,
    execution_spec_id: specRow.id,
    run_identity: "run-identity-1",
    provider: "fake_provider",
    harness: "fake_harness",
    model: "claude-sonnet-5",
    base_sha: BASE_SHA,
    credit_reservation_id: null,
    status: "queued",
    turns: 0,
    tool_calls_allowed: 0,
    tool_calls_denied: 0,
    files_read: 0,
    check_runs: 0,
    repair_attempts: 0,
    changed_file_count: 0,
    changed_bytes: 0,
    created_at: "2026-08-19T00:00:00.000Z",
  });

  return { operation: { id: String(operation.id) }, run: { id: String(run.id) } };
}

function deps(overrides: Partial<AgentExecutionDeps> = {}): AgentExecutionDeps {
  return {
    supabase: fakeSupabase(db),
    runtime: { build: () => fakeDetachedAgentProvider() },
    sandboxProvider: fakeSandboxProvider({ files: SANDBOX_FILES, results: SANDBOX_RESULTS }),
    resolveTarget: async () => target(),
    ...overrides,
  };
}

beforeEach(() => {
  db = new FakeDatabase();
  vi.stubEnv("VIBE_AGENT_GATEWAY_ORIGIN", "https://app.vibe.test");
  vi.stubEnv("VIBE_AGENT_GATEWAY_SECRET", "test-gateway-secret-not-a-real-one");
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/* ---------------------------------------------------------------------------
 * Defect 1 — the agent outlives any one workflow step
 * ------------------------------------------------------------------------ */

describe("an agent that runs longer than a Vercel step may live", () => {
  /**
   * The reproduction. The real run worked for five minutes and was killed at
   * `Task timed out after 300 seconds`; the budget authorizes twenty.
   *
   * What makes that impossible now is that no single step waits for the
   * harness: starting it returns immediately, and the watching is done by short
   * polls the workflow suspends between.
   */
  it("starts without waiting for the harness to finish", async () => {
    const { operation } = seed();
    const harness = fakeDetachedAgentProvider();
    // Never finishes, however many times it is polled.
    harness.finishAfterPolls(Number.MAX_SAFE_INTEGER);
    const shared = deps({ runtime: { build: () => harness } });

    await provisionAgentWorkspaceStep(shared, operation.id);
    const started = await startAgentStep(shared, operation.id, ["typecheck"]);

    expect(started.ok).toBe(true);
    expect(harness.starts()).toBe(1);

    // Twenty minutes of polling: every one of these is its own short step, and
    // not one of them is the call that waits for the agent.
    for (let poll = 0; poll < 60; poll += 1) {
      const observed = await pollAgentStep(shared, operation.id);
      expect(observed.ok).toBe(true);
      if (observed.ok) expect(observed.finished).toBe(false);
    }

    // And still exactly one harness. Sixty polls bought no second agent.
    expect(harness.starts()).toBe(1);
  });

  /**
   * Turns must survive the outer workflow failing. This is the exact number the
   * first real run lost: 27 Anthropic calls, and a run row that read zero.
   */
  it("persists turns as they happen, not only when the run ends", async () => {
    const { operation, run } = seed();
    const harness = fakeDetachedAgentProvider({
      calls: [
        { tool: "read_file", input: { path: "src/app/page.tsx" } },
        { tool: "read_file", input: { path: "src/app/page.tsx" } },
      ],
    });
    harness.finishAfterPolls(Number.MAX_SAFE_INTEGER);
    const shared = deps({ runtime: { build: () => harness } });

    await provisionAgentWorkspaceStep(shared, operation.id);
    await startAgentStep(shared, operation.id, ["typecheck"]);
    await pollAgentStep(shared, operation.id);

    // No collect step has run, and none ever will in this test. The turns are
    // already durable.
    const stored = db.rows("agent_execution_runs").find((row) => row.id === run.id);
    expect(stored?.turns).toBe(2);
  });

  /** Monotonic: a poll racing a stale read must not walk the count backwards. */
  it("never lowers a turn count it already recorded", async () => {
    const { operation, run } = seed();
    const harness = fakeDetachedAgentProvider({
      calls: [{ tool: "read_file", input: { path: "src/app/page.tsx" } }],
    });
    harness.finishAfterPolls(Number.MAX_SAFE_INTEGER);
    const shared = deps({ runtime: { build: () => harness } });

    await provisionAgentWorkspaceStep(shared, operation.id);
    await startAgentStep(shared, operation.id, ["typecheck"]);
    await pollAgentStep(shared, operation.id);

    db.rows("agent_execution_runs").find((row) => row.id === run.id)!.turns = 9;
    await pollAgentStep(shared, operation.id);

    expect(db.rows("agent_execution_runs").find((row) => row.id === run.id)?.turns).toBe(9);
  });

  /**
   * A retry of the start step must never buy a second agent. The claim is
   * scoped to `queued`, so the second entrant is refused before it can launch.
   */
  it("refuses a second start for the same run", async () => {
    const { operation } = seed();
    const harness = fakeDetachedAgentProvider();
    const shared = deps({ runtime: { build: () => harness } });

    await provisionAgentWorkspaceStep(shared, operation.id);
    const first = await startAgentStep(shared, operation.id, ["typecheck"]);
    const second = await startAgentStep(shared, operation.id, ["typecheck"]);

    expect(first.ok).toBe(true);
    expect(second).toEqual({ ok: false, failureCode: "inference_interrupted" });
    expect(harness.starts()).toBe(1);
  });

  /** A run past its wall clock is reported as expired so the loop can stop it. */
  it("reports a run that outlived its wall clock", async () => {
    const { operation, run } = seed();
    const harness = fakeDetachedAgentProvider();
    harness.finishAfterPolls(Number.MAX_SAFE_INTEGER);

    const shared = deps({ runtime: { build: () => harness } });
    await provisionAgentWorkspaceStep(shared, operation.id);
    await startAgentStep(shared, operation.id, ["typecheck"]);

    const startedAt = Date.parse(
      String(db.rows("agent_execution_runs").find((row) => row.id === run.id)?.started_at),
    );

    const inTime = await pollAgentStep({ ...shared, now: () => startedAt + 60_000 }, operation.id);
    expect(inTime.ok && inTime.expired).toBe(false);

    const tooLate = await pollAgentStep(
      { ...shared, now: () => startedAt + 21 * 60_000 },
      operation.id,
    );
    expect(tooLate.ok && tooLate.expired).toBe(true);
  });

  /**
   * The bound the whole refactor rests on: a run's sandbox must outlive the
   * wall clock its budget sells, or the VM dies with the harness still working.
   */
  it("gives the sandbox a lifetime longer than the agent's own ceiling", async () => {
    const { operation } = seed();
    const sandbox = fakeSandboxProvider({ files: SANDBOX_FILES, results: SANDBOX_RESULTS });

    await provisionAgentWorkspaceStep(deps({ sandboxProvider: sandbox }), operation.id);

    const created = sandbox.createdWith();
    expect(created?.timeoutMs).toBe(AGENT_SANDBOX_LIFETIME_MS);
    // The dogfood budget authorizes 20 minutes of agent wall clock.
    expect(AGENT_SANDBOX_LIFETIME_MS).toBeGreaterThan(20 * 60_000);
  });
});

/* ---------------------------------------------------------------------------
 * The lifecycle hole the killed step left behind
 * ------------------------------------------------------------------------ */

describe("a run nothing is carrying any more", () => {
  async function stale(startedMinutesAgo: number) {
    const { operation, run } = seed();
    const startedAt = new Date(Date.now() - startedMinutesAgo * 60_000).toISOString();

    /*
     * The wallet as well as the hold.
     *
     * Releasing decrements the account's materialized `reserved_credits`, so a
     * reservation seeded without its account would exercise a release that
     * cannot complete — and the property under test is precisely that the
     * Credits come back.
     */
    db.seed("billing_credit_accounts", {
      id: "account-1",
      user_id: USER,
      status: "active",
      posted_credits: creditsToUnits(1_000),
      reserved_credits: creditsToUnits(100),
    });

    db.seed("billing_credit_reservations", {
      id: "reservation-1",
      credit_account_id: "account-1",
      project_id: PROJECT,
      user_id: USER,
      operation_run_id: operation.id,
      status: "active",
      reserved_credits: creditsToUnits(100),
      created_at: startedAt,
    });

    const row = db.rows("agent_execution_runs").find((entry) => entry.id === run.id)!;
    row.status = "running";
    row.started_at = startedAt;
    row.credit_reservation_id = "reservation-1";

    return { operation, run };
  }

  /**
   * The exact state the first real run was left in: `running`, hours old, with
   * 100 Credits reserved and no workflow anywhere near it.
   *
   * A durable execution that can hold a customer's Credits forever is not one,
   * so there has to be an answer that does not depend on the workflow being
   * alive to give it.
   */
  it("is failed and its Credits released once it is past every bound", async () => {
    vi.resetModules();
    const { operation, run } = await stale(60);

    vi.doMock("@/lib/supabase/service", () => ({ createServiceClient: () => fakeSupabase(db) }));
    const { expireStaleAgentExecution } = await import("./server-writes");

    expect(await expireStaleAgentExecution({ operationRunId: operation.id })).toEqual({
      expired: true,
    });

    expect(db.rows("agent_execution_runs").find((row) => row.id === run.id)?.status).toBe("failed");
    expect(db.rows("operation_runs")[0]).toMatchObject({
      status: "failed",
      failure_code: "agent_wall_clock_exceeded",
    });
    expect(db.rows("billing_credit_reservations")[0].status).toBe("released");
  });

  /** A run that is merely slow must not be killed. Being wrong here is expensive. */
  it("leaves a run that is still inside its bounds alone", async () => {
    vi.resetModules();
    const { operation, run } = await stale(5);

    vi.doMock("@/lib/supabase/service", () => ({ createServiceClient: () => fakeSupabase(db) }));
    const { expireStaleAgentExecution } = await import("./server-writes");

    expect(await expireStaleAgentExecution({ operationRunId: operation.id })).toEqual({
      expired: false,
    });

    expect(db.rows("agent_execution_runs").find((row) => row.id === run.id)?.status).toBe("running");
    expect(db.rows("billing_credit_reservations")[0].status).toBe("active");
  });

  /** Idempotent: a status page polling every three seconds repairs it once. */
  it("repairs once however many times it is asked", async () => {
    vi.resetModules();
    const { operation } = await stale(60);

    vi.doMock("@/lib/supabase/service", () => ({ createServiceClient: () => fakeSupabase(db) }));
    const { expireStaleAgentExecution } = await import("./server-writes");

    await expireStaleAgentExecution({ operationRunId: operation.id });
    const second = await expireStaleAgentExecution({ operationRunId: operation.id });

    expect(second).toEqual({ expired: false });
    // The hold came back exactly once: released, and the wallet's materialized
    // reservation decremented a single time.
    expect(db.rows("billing_credit_reservations")[0].status).toBe("released");
    expect(db.rows("billing_credit_accounts")[0].reserved_credits).toBe(0);
  });

  /** A queued run has taken no provider call and may simply not have started. */
  it("never expires a run that has not started", async () => {
    vi.resetModules();
    const { operation, run } = seed();
    db.rows("agent_execution_runs").find((row) => row.id === run.id)!.status = "queued";

    vi.doMock("@/lib/supabase/service", () => ({ createServiceClient: () => fakeSupabase(db) }));
    const { expireStaleAgentExecution } = await import("./server-writes");

    expect(await expireStaleAgentExecution({ operationRunId: operation.id })).toEqual({
      expired: false,
    });
  });
});
