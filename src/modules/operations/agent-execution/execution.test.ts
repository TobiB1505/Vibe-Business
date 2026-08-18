import { beforeEach, describe, expect, it } from "vitest";
import { fakeAgentSpec, fakeCodingAgentProvider } from "@/modules/coding-agent/test-support";
import { creditsToUnits } from "@/modules/credits/units";
import { agentSandboxNameFor } from "@/modules/coding-agent/identity";
import type { BaseContentPort } from "@/modules/coding-agent/candidate";
import type { ExecutionProbePort, GitWritePort } from "@/modules/execution/git-port";
import { fakeSandboxProvider } from "@/modules/validation/test-support";
import { FakeDatabase, fakeSupabase } from "../test-support";
import {
  cleanupAgentWorkspaceStep,
  extractAndVerifyStep,
  finishAgentExecutionStep,
  provisionAgentWorkspaceStep,
  runAgentStep,
  writeAgentBranchStep,
  type AgentExecutionDeps,
  type AgentRepositoryTarget,
} from "./execution";

/**
 * Durable agentic execution
 * (EXECUTION CORE-4 §8, §12, §27, §30, §35, §37, §54, §57).
 *
 * The assertion that matters in most cases is a count: how many sandboxes were
 * created, how many GitHub writes happened, how many provider runs occurred. A
 * safety property in this file is almost always "exactly zero of X" or "exactly
 * one of X, however many times the step is re-entered".
 */

const USER = "user_1";
const PROJECT = "project_1";
const BASE_SHA = "1f4b0c9d7a2e5f8b3c6d9e0a1b2c3d4e5f607182";
const MOVED_SHA = "9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a291807";

let db: FakeDatabase;
let git: { writes: number; refs: string[]; commits: string[]; port: GitWritePort };
let probeState: { head: { defaultBranch: string; commitSha: string }; writePermission: boolean };

/**
 * A GitHub write port that actually stores what it was given.
 *
 * `prepareChangeOnBranch` verifies its own write by reading every file back off
 * the new ref and comparing hashes — "success is not the API returned 201"
 * (Sprint 9 §25). A fake that acknowledged writes without storing them would
 * make that verification untestable, and every assertion here would be about a
 * stub rather than about the write path.
 */
function fakeGit() {
  const refs = new Map<string, string>();
  const blobs = new Map<string, string>();
  const tree = new Map<string, string>();
  const commits: string[] = [];
  let writes = 0;

  const port: GitWritePort = {
    async getRefSha(ref) {
      return refs.get(ref.replace(/^heads\//, "")) ?? null;
    },
    async getFileContent(path) {
      return tree.get(path) ?? null;
    },
    async getCommitTreeSha() {
      return "basetree";
    },
    async createBlob(content) {
      writes += 1;
      const sha = `blob-${blobs.size}`;
      blobs.set(sha, content);
      return sha;
    },
    async createTree(input) {
      writes += 1;
      for (const file of input.files) {
        const content = blobs.get(file.blobSha);
        if (content !== undefined) tree.set(file.path, content);
      }
      return "newtree";
    },
    async createCommit(input) {
      writes += 1;
      commits.push(input.message);
      return "newcommit";
    },
    async createRef(input) {
      writes += 1;
      refs.set(input.ref.replace("refs/heads/", ""), "newcommit");
    },
  };

  return {
    port,
    commits,
    get writes() {
      return writes;
    },
    get refs() {
      return [...refs.keys()];
    },
  };
}

const probe: ExecutionProbePort = {
  async getHead() {
    return probeState.head;
  },
  async findExistingPaths() {
    return [];
  },
  async isServed() {
    return false;
  },
  async hasWritePermission() {
    return probeState.writePermission;
  },
};

const base: BaseContentPort = {
  async getTextFile(path: string) {
    // The base commit's bytes. `src/app/page.tsx` exists; anything else is new.
    return path === "src/app/page.tsx" ? "export default function Page() { return null; }\n" : null;
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
    git: git.port,
    probe,
    base,
  };
}

const SANDBOX_FILES = {
  "product/package.json": JSON.stringify({
    scripts: { typecheck: "tsc", test: "vitest", build: "next build" },
  }),
  "product/src/app/page.tsx": "export default function Page() { return null; }\n",
};

function seed(overrides: { runStatus?: string; specMode?: string } = {}) {
  db.seed("projects", { id: PROJECT, user_id: USER, production_url: "https://acme.com" });

  const spec = fakeAgentSpec();
  const specRow = db.seed("execution_specs", {
    project_id: PROJECT,
    action_plan_id: "plan-1",
    step_key: spec.stepKey,
    step_order: spec.stepOrder,
    business_audit_id: "audit-1",
    opportunity_id: "move-1",
    spec_identity: "identity-1",
    mode: overrides.specMode ?? "agentic",
    execution_class: "application_code_change",
    risk_class: "moderate",
    repository_connection_id: "conn-1",
    base_sha: BASE_SHA,
    repository_snapshot_id: spec.repository.repositorySnapshotId,
    capability: null,
    capability_version: null,
    spec: { ...spec, repository: { ...spec.repository, baseSha: BASE_SHA } },
    schema_version: spec.schemaVersion,
    resolver_version: spec.resolverVersion,
    policy_version: spec.policyVersion,
    risk_policy_version: spec.riskPolicyVersion,
    created_at: "2026-08-18T00:00:00.000Z",
  });

  const operation = db.seed("operation_runs", {
    project_id: PROJECT,
    user_id: USER,
    operation_type: "agent_execution",
    status: "queued",
    stage: "preparing",
    input_identity: "run-identity-1",
    subject_id: specRow.id,
    created_at: "2026-08-18T00:00:00.000Z",
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
    coding_agent_policy_version: "coding-agent-policy-v1",
    prompt_compiler_version: "agent-prompt-v1",
    budget_policy_version: "core4-dogfood-budget-v1",
    execution_policy_version: "execution-policy-v1",
    non_production_economics: true,
    base_sha: BASE_SHA,
    credit_reservation_id: null,
    status: overrides.runStatus ?? "queued",
    turns: 0,
    tool_calls_allowed: 0,
    tool_calls_denied: 0,
    files_read: 0,
    check_runs: 0,
    repair_attempts: 0,
    changed_file_count: 0,
    changed_bytes: 0,
    created_at: "2026-08-18T00:00:00.000Z",
  });

  // Ids as strings: `FakeDatabase.seed` returns `Record<string, unknown>`,
  // which is honest about a row read back from a database and unhelpful for the
  // one column every call site here needs.
  return {
    operation: { id: String(operation.id) },
    run: { id: String(run.id) },
    specRow: { id: String(specRow.id) },
  };
}

function deps(overrides: Partial<AgentExecutionDeps> = {}): AgentExecutionDeps {
  return {
    supabase: fakeSupabase(db),
    provider: fakeCodingAgentProvider(),
    sandboxProvider: fakeSandboxProvider({ files: SANDBOX_FILES }),
    resolveTarget: async () => target(),
    ...overrides,
  };
}

beforeEach(() => {
  db = new FakeDatabase();
  git = fakeGit();
  probeState = { head: { defaultBranch: "main", commitSha: BASE_SHA }, writePermission: true };
});

describe("§8, §12 — the workspace is pinned, scrubbed and closed before the agent exists", () => {
  it("creates one sandbox at the exact base SHA and shuts the network before install ends", async () => {
    const { operation } = seed();
    const sandbox = fakeSandboxProvider({ files: SANDBOX_FILES });

    const outcome = await provisionAgentWorkspaceStep(deps({ sandboxProvider: sandbox }), operation.id);

    expect(outcome.ok).toBe(true);
    expect(sandbox.createCount()).toBe(1);

    const created = sandbox.createdWith();
    expect(created?.source).toMatchObject({ kind: "git", revision: BASE_SHA });
    // Never a branch name. A spec pins a commit, and the workspace is that
    // commit or the run does not start.
    expect(created?.networkPolicy).toEqual({
      mode: "allow_domains",
      domains: ["github.com", "*.github.com", "codeload.github.com"],
    });

    // The environment carries nothing of value.
    expect(created?.env).toEqual({ CI: "1", NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1" });

    // The policy sequence: github → registry → nothing. The agent has not been
    // constructed yet when the last one is applied (§12).
    expect(sandbox.policies().map((policy) => policy.mode)).toEqual([
      "allow_domains",
      "allow_domains",
      "deny_all",
    ]);

    // The credential stops existing before anything repository-controlled runs.
    expect(sandbox.commands()).toContain("rm -rf .git");
    // Install runs with no lifecycle scripts, from the lockfile alone.
    expect(sandbox.commands()).toContain("pnpm install --frozen-lockfile --ignore-scripts");
  });

  /**
   * §54. The spec pinned SHA A; the default branch is now SHA B. The provider
   * materialized A, so the observation disagrees — and the honest answer is to
   * stop rather than to silently work against something else.
   */
  it("refuses when the checked-out commit is not the pinned one", async () => {
    const { operation } = seed();
    const sandbox = fakeSandboxProvider({
      files: SANDBOX_FILES,
      results: { "git rev-parse HEAD": { exitCode: 0, output: MOVED_SHA } },
    });

    const outcome = await provisionAgentWorkspaceStep(deps({ sandboxProvider: sandbox }), operation.id);

    expect(outcome).toEqual({ ok: false, failureCode: "repository_changed" });
    // Nothing repository-controlled ran.
    expect(sandbox.commands()).not.toContain("pnpm install --frozen-lockfile --ignore-scripts");
  });

  it("refuses when the credential store survives the scrub", async () => {
    const { operation } = seed();
    const sandbox = fakeSandboxProvider({
      files: { ...SANDBOX_FILES, "product/.git/config": "[remote]\n  url = https://x:token@github.com" },
      // `rm -f` reports success whether or not it removed anything, so the
      // scrub is verified rather than inferred. This is the case where it
      // survives.
      unremovablePaths: ["product/.git/config"],
    });

    const outcome = await provisionAgentWorkspaceStep(deps({ sandboxProvider: sandbox }), operation.id);

    expect(outcome).toEqual({ ok: false, failureCode: "credential_scrub_failed" });
  });

  it("adopts a sandbox a previous attempt left behind rather than buying a second", async () => {
    const { operation } = seed();
    const sandbox = fakeSandboxProvider({ files: SANDBOX_FILES });

    await provisionAgentWorkspaceStep(deps({ sandboxProvider: sandbox }), operation.id);
    await provisionAgentWorkspaceStep(deps({ sandboxProvider: sandbox }), operation.id);

    expect(sandbox.createCount()).toBe(1);
  });
});

describe("§37 — the paid loop runs at most once", () => {
  it("refuses to run a second agent after an ambiguous outcome", async () => {
    const { operation } = seed();
    const sandbox = fakeSandboxProvider({ files: SANDBOX_FILES });
    await provisionAgentWorkspaceStep(deps({ sandboxProvider: sandbox }), operation.id);

    const provider = fakeCodingAgentProvider({ calls: [] });
    const first = await runAgentStep(deps({ provider, sandboxProvider: sandbox }), operation.id, [
      "typecheck",
    ]);
    expect(first.ok).toBe(true);
    expect(provider.requests).toHaveLength(1);

    // A re-entry after the outcome was lost. The claim is scoped to `queued`,
    // so this reports false and the step refuses rather than buying a second
    // coding agent.
    const second = await runAgentStep(deps({ provider, sandboxProvider: sandbox }), operation.id, [
      "typecheck",
    ]);
    expect(second).toEqual({ ok: false, failureCode: "inference_interrupted" });
    expect(provider.requests).toHaveLength(1);
  });

  /**
   * §57. The provider failed. Whatever usage it reported before failing is
   * still recorded — Vibe paid for those tokens whether or not the run
   * delivered anything.
   */
  it("records observed usage when the provider fails", async () => {
    const { operation, run } = seed();
    const sandbox = fakeSandboxProvider({ files: SANDBOX_FILES });
    await provisionAgentWorkspaceStep(deps({ sandboxProvider: sandbox }), operation.id);

    const provider = fakeCodingAgentProvider({
      calls: [{ tool: "read_file", input: { path: "src/app/page.tsx" } }],
      outcome: "provider_error",
    });

    const outcome = await runAgentStep(deps({ provider, sandboxProvider: sandbox }), operation.id, [
      "typecheck",
    ]);

    expect(outcome).toEqual({ ok: false, failureCode: "provider_unavailable" });

    const usage = db.rows("ai_usage_events");
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({
      operation: "agentic_execution",
      status: "failed",
      job_id: run.id,
      // Cache accounting, which is most of an agent loop's input bill.
      cache_read_input_tokens: 4_000,
      cache_creation_input_tokens: 2_000,
    });
  });

  it("records the tool trail and the activity trail even on failure", async () => {
    const { operation } = seed();
    const sandbox = fakeSandboxProvider({ files: SANDBOX_FILES });
    await provisionAgentWorkspaceStep(deps({ sandboxProvider: sandbox }), operation.id);

    const provider = fakeCodingAgentProvider({
      calls: [
        { tool: "read_file", input: { path: "src/app/page.tsx" } },
        { tool: "read_file", input: { path: ".env" } },
      ],
      outcome: "provider_error",
    });

    await runAgentStep(deps({ provider, sandboxProvider: sandbox }), operation.id, ["typecheck"]);

    const events = db.rows("agent_tool_events");
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.decision)).toEqual(["allowed", "denied"]);
    expect(db.rows("agent_activity_events").length).toBeGreaterThan(0);
  });
});

describe("§25 — a question pauses the run", () => {
  it("persists the interrupt, pauses both records, and does not proceed", async () => {
    const { operation, run } = seed();
    const sandbox = fakeSandboxProvider({ files: SANDBOX_FILES });
    await provisionAgentWorkspaceStep(deps({ sandboxProvider: sandbox }), operation.id);

    const provider = fakeCodingAgentProvider({
      calls: [
        { tool: "request_decision", input: { situation: "business_decision_required" } },
        { tool: "write_file", input: { path: "src/app/page.tsx", content: "changed" } },
      ],
    });

    const outcome = await runAgentStep(deps({ provider, sandboxProvider: sandbox }), operation.id, [
      "typecheck",
    ]);

    expect(outcome).toEqual({ ok: true, paused: true, changedFileCount: 0 });

    const interrupts = db.rows("execution_interrupts");
    expect(interrupts).toHaveLength(1);
    expect(interrupts[0]).toMatchObject({
      status: "open",
      interrupt_type: "business_decision_required",
      agent_execution_run_id: run.id,
    });

    expect(db.rows("agent_execution_runs")[0].status).toBe("needs_user_input");
    expect(db.rows("operation_runs")[0].status).toBe("needs_user");

    // The write after the question was never attempted.
    expect(provider.attempted.map((entry) => entry.tool)).toEqual(["request_decision"]);
  });
});

describe("§27, §28 — Vibe computes and checks the change", () => {
  async function runToChange(calls: { tool: string; input: unknown }[]) {
    const { operation } = seed();
    const sandbox = fakeSandboxProvider({ files: SANDBOX_FILES });
    const shared = deps({ sandboxProvider: sandbox, provider: fakeCodingAgentProvider({ calls }) });

    await provisionAgentWorkspaceStep(shared, operation.id);
    await runAgentStep(shared, operation.id, ["typecheck", "test", "build"]);
    return { operation, shared, sandbox };
  }

  it("refuses a run that changed nothing", async () => {
    const { operation, shared } = await runToChange([
      { tool: "read_file", input: { path: "src/app/page.tsx" } },
    ]);

    const outcome = await extractAndVerifyStep(shared, operation.id);
    expect(outcome).toEqual({ ok: false, failureCode: "agent_produced_no_change" });
  });

  it("refuses a change whose bytes reproduce the base exactly", async () => {
    const { operation, shared } = await runToChange([
      {
        tool: "write_file",
        input: {
          path: "src/app/page.tsx",
          content: "export default function Page() { return null; }\n",
        },
      },
    ]);

    const outcome = await extractAndVerifyStep(shared, operation.id);
    // The write was brokered, the file is on disk, and it is identical to the
    // base — so there is no change, and no reviewable artifact is created.
    expect(outcome).toEqual({ ok: false, failureCode: "agent_produced_no_change" });
  });

  it("accepts a real change and hands back exactly what will be written", async () => {
    const { operation, shared } = await runToChange([
      { tool: "write_file", input: { path: "src/app/page.tsx", content: "export default () => <b/>;\n" } },
      { tool: "write_file", input: { path: "src/app/new.tsx", content: "export const x = 1;\n" } },
    ]);

    const outcome = await extractAndVerifyStep(shared, operation.id);

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.files.map((file) => file.path)).toEqual([
        "src/app/new.tsx",
        "src/app/page.tsx",
      ]);
      expect(outcome.candidateDigest).toHaveLength(64);
    }
  });
});

describe("§30 — trusted Vibe infrastructure writes the branch", () => {
  async function prepared() {
    const { operation } = seed();
    const sandbox = fakeSandboxProvider({ files: SANDBOX_FILES });
    const shared = deps({
      sandboxProvider: sandbox,
      provider: fakeCodingAgentProvider({
        calls: [
          {
            tool: "write_file",
            input: { path: "src/app/page.tsx", content: "export default () => <b/>;\n" },
          },
        ],
      }),
    });

    await provisionAgentWorkspaceStep(shared, operation.id);
    await runAgentStep(shared, operation.id, ["typecheck"]);
    const extracted = await extractAndVerifyStep(shared, operation.id);
    if (!extracted.ok) throw new Error("fixture did not produce a change");

    return { operation, shared, extracted };
  }

  it("derives the branch and commit message itself", async () => {
    const { operation, shared, extracted } = await prepared();

    const outcome = await writeAgentBranchStep(
      shared,
      operation.id,
      extracted.files,
      extracted.candidateDigest,
    );

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      // A hash of an identity Vibe computed — no step title, no model text.
      expect(outcome.branchName).toMatch(/^vibe\/agent-[0-9a-f]{12}$/);
    }

    // An integer Vibe assigned, never the Planner's prose (Rule 57).
    expect(git.commits).toEqual(["vibe: implement plan step 1"]);
    expect(git.refs).toHaveLength(1);
  });

  /**
   * §54, at the last possible moment. A durable operation can sit queued while
   * the repository moves, and a change written onto a moved base is a change
   * against a tree nobody reviewed.
   */
  it("refuses when the default branch moved before the write", async () => {
    const { operation, shared, extracted } = await prepared();
    probeState.head = { defaultBranch: "main", commitSha: MOVED_SHA };

    const outcome = await writeAgentBranchStep(
      shared,
      operation.id,
      extracted.files,
      extracted.candidateDigest,
    );

    expect(outcome).toEqual({ ok: false, failureCode: "repository_changed" });
    expect(git.writes).toBe(0);
  });

  it("refuses without write permission", async () => {
    const { operation, shared, extracted } = await prepared();
    probeState.writePermission = false;

    const outcome = await writeAgentBranchStep(
      shared,
      operation.id,
      extracted.files,
      extracted.candidateDigest,
    );

    expect(outcome).toEqual({ ok: false, failureCode: "github_write_permission_required" });
    expect(git.writes).toBe(0);
  });

  it("records the change under the agentic capability, with no opportunity set", async () => {
    const { operation, shared, extracted } = await prepared();

    await writeAgentBranchStep(shared, operation.id, extracted.files, extracted.candidateDigest);

    const change = db.rows("prepared_changes")[0];
    expect(change).toMatchObject({
      execution_capability: "agentic_execution_v1",
      execution_version: "agentic-execution-v1",
      opportunity_set_id: null,
      opportunity_id: null,
      status: "prepared",
      base_sha: BASE_SHA,
    });
  });
});

describe("§20, §35 — cleanup and settlement", () => {
  it("stops the sandbox and records its usage on every path", async () => {
    const { operation } = seed();
    const sandbox = fakeSandboxProvider({
      files: SANDBOX_FILES,
      usage: { activeCpuDurationMs: 42_000, networkEgressBytes: 1_024 },
    });
    const shared = deps({ sandboxProvider: sandbox });

    await provisionAgentWorkspaceStep(shared, operation.id);
    const cleanup = await cleanupAgentWorkspaceStep(shared, operation.id);

    expect(cleanup).toEqual({ cleanup: "stopped" });
    expect(sandbox.stopped()).toBe(true);

    const usage = db.rows("sandbox_usage_events")[0];
    expect(usage).toMatchObject({
      operation: "agent_execution",
      active_cpu_ms: 42_000,
      network_egress_bytes: 1_024,
      // Unknown is not zero: Vercel exposes no attributable per-sandbox cost.
      provider_cost_usd: null,
    });
  });

  it("names the sandbox after the attempt, not the identity", () => {
    // A stable identity would guarantee that a retry asks the provider for a
    // name that already exists — the exact failure that cost a validation
    // dogfood run.
    expect(agentSandboxNameFor("11111111-2222-3333-4444-555555555555")).toBe(
      "vibe-agent-11111111222233334444",
    );
    // Different attempts, different names — which is what lets a retry create a
    // sandbox at all.
    expect(agentSandboxNameFor("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")).not.toBe(
      agentSandboxNameFor("11111111-2222-3333-4444-555555555555"),
    );
  });

  it("releases the hold on failure and never charges for a run that delivered nothing", async () => {
    const { operation, run } = seed();

    // Taken through the real billing path, so the release is asserted against
    // a hold the ledger actually agrees exists.
    const { grantCreditLot } = await import("@/modules/credits/grants");
    await grantCreditLot(fakeSupabase(db), {
      userId: USER,
      sourceKind: "purchase",
      credits: creditsToUnits(500),
      reason: "internal dogfood funding",
      idempotencyKey: "fund-1",
    });

    const { authorizeOperationCredits } = await import("@/modules/credits/operation-billing");
    const authorized = await authorizeOperationCredits(fakeSupabase(db), {
      projectId: PROJECT,
      operation: "agent_execution_dogfood",
      idempotencyKey: operation.id,
      operationRunId: operation.id,
    });
    if (!authorized.ok || !authorized.billable) throw new Error("fixture did not reserve");

    db.rows("agent_execution_runs")[0].credit_reservation_id = authorized.reservationId;

    await finishAgentExecutionStep(deps(), operation.id, {
      kind: "failed",
      failureCode: "agent_change_rejected",
    });

    expect(db.rows("agent_execution_runs")[0]).toMatchObject({
      id: run.id,
      status: "failed",
      failure_code: "agent_change_rejected",
    });
    expect(db.rows("billing_credit_reservations")[0].status).toBe("released");
    expect(db.rows("operation_runs")[0].status).toBe("failed");
  });

  it("keeps the hold while a run is paused on a question", async () => {
    const { operation } = seed({ runStatus: "needs_user_input" });
    db.rows("agent_execution_runs")[0].credit_reservation_id = "reservation-1";
    db.seed("billing_credit_reservations", {
      id: "reservation-1",
      status: "active",
      operation_run_id: operation.id,
      reserved_credits: 100_000,
    });

    await finishAgentExecutionStep(deps(), operation.id, { kind: "paused" });

    // The work may still be completed once the customer answers, and releasing
    // now would leave the resumed run with no authorized budget.
    expect(db.rows("billing_credit_reservations")[0].status).toBe("active");
    expect(db.rows("agent_execution_runs")[0].status).toBe("needs_user_input");
  });
});
