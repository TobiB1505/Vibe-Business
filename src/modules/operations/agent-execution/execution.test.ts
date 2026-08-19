import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeAgentSpec, fakeDetachedAgentProvider } from "@/modules/coding-agent/test-support";
import { creditsToUnits } from "@/modules/credits/units";
import { agentSandboxNameFor } from "@/modules/coding-agent/identity";
import type { BaseContentPort, BaseTreePort } from "@/modules/coding-agent/candidate";
import type { DetachedCodingAgentProvider } from "@/modules/coding-agent/provider";
import type { ExecutionProbePort, GitWritePort } from "@/modules/execution/git-port";
import {
  DEPENDENCY_HOSTS,
  SOURCE_HOSTS,
} from "@/modules/validation/sandbox-port";
import { fakeSandboxProvider } from "@/modules/validation/test-support";
import { FakeDatabase, fakeSupabase } from "../test-support";
import {
  cleanupAgentWorkspaceStep,
  extractAndVerifyStep,
  finishAgentExecutionStep,
  provisionAgentWorkspaceStep,
  collectAgentStep,
  pollAgentStep,
  startAgentStep,
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

/**
 * The repository as it stood at the pinned base commit.
 *
 * A real tree and a real `.gitignore`, not a stub: the suppression rule that
 * matters — "a tracked file is never withheld" — is only testable if there is
 * something tracked to withhold.
 */
const BASE_FILES: Record<string, string> = {
  "src/app/page.tsx": "export default function Page() { return null; }\n",
  "src/app/layout.tsx": "export default function Layout() { return null; }\n",
  "src/app/app/layout.tsx": "export default function AppLayout() { return null; }\n",
  "src/app/login/page.tsx": "export default function Login() { return null; }\n",
  "src/app/signup/page.tsx": "export default function Signup() { return null; }\n",
  "src/app/forgot-password/page.tsx": "export default function Forgot() { return null; }\n",
  "src/app/reset-password/page.tsx": "export default function Reset() { return null; }\n",
  // Verbatim from this repository's own `.gitignore` at the commit run
  // `b33635a1` was pinned to.
  ".gitignore": [
    "/node_modules",
    "/coverage",
    "/.next/",
    "/out/",
    "/build",
    ".DS_Store",
    "*.tsbuildinfo",
    "next-env.d.ts",
    "/.swc",
    "src/app/.well-known/workflow/",
  ].join("\n"),
};

const base: BaseContentPort = {
  async getTextFile(path: string) {
    return BASE_FILES[path] ?? null;
  },
};

const baseTree: BaseTreePort = {
  async getTree() {
    return {
      entries: Object.keys(BASE_FILES).map((path) => ({ path, type: "blob" as const })),
      truncated: false,
    };
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
    baseTree,
  };
}

const SANDBOX_HOME = "/vercel/sandbox";

/**
 * Commands every agent step depends on the sandbox answering.
 *
 * `pwd` is how the runtime learns where it is — asked rather than assumed, so
 * a provider that moved its workspace would surface as a failure to start
 * rather than as a model that could not find any files.
 */
const SANDBOX_RESULTS = {
  pwd: { exitCode: 0, output: `${SANDBOX_HOME}\n` },
};

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

/**
 * `provider` is still the override these tests write, because what they
 * exercise is the step graph rather than where the harness happens to run.
 * It is wrapped into the `gateway_tools` runtime here — the topology whose
 * every effect goes through `ExecutionToolGateway`, which is what most of the
 * assertions below are about.
 */
/**
 * `provider` is still the override these tests write, wrapped into the one
 * runtime shape production uses.
 *
 * There is no second shape any more. The harness runs detached in the
 * execution's own sandbox, and a fake offering one awaited `run()` would let
 * this whole file test a step graph no deployment executes — the failure rule
 * 69 keeps warning about, and the one that let a 300-second ceiling reach a
 * customer.
 */
function deps(
  overrides: Partial<AgentExecutionDeps> & { provider?: DetachedCodingAgentProvider } = {},
): AgentExecutionDeps {
  const { provider, ...rest } = overrides;
  const harness = provider ?? fakeDetachedAgentProvider();

  return {
    supabase: fakeSupabase(db),
    runtime: { build: () => harness },
    sandboxProvider: fakeSandboxProvider({ files: SANDBOX_FILES, results: SANDBOX_RESULTS }),
    resolveTarget: async () => target(),
    ...rest,
  };
}

/**
 * Start, watch and collect — the three steps that replaced one `runAgentStep`.
 *
 * Kept as one helper so the tests below still read as "run the agent", while
 * actually exercising the boundaries a real deployment crosses between them.
 */
async function runAgent(
  agentDeps: AgentExecutionDeps,
  operationId: string,
  availableChecks: Parameters<typeof startAgentStep>[2],
) {
  const started = await startAgentStep(agentDeps, operationId, availableChecks);
  if (!started.ok) return started;
  // A question raised before the first turn holds the run where it is; there is
  // nothing to watch and nothing to collect.
  if (started.paused) return { ok: true as const, paused: true, observedPathCount: 0, changedPaths: null };

  for (let poll = 0; poll < 5; poll += 1) {
    const observed = await pollAgentStep(agentDeps, operationId);
    if (!observed.ok) return observed;
    if (observed.finished || observed.expired) break;
  }

  return collectAgentStep(agentDeps, operationId);
}

beforeEach(() => {
  db = new FakeDatabase();
  git = fakeGit();
  probeState = { head: { defaultBranch: "main", commitSha: BASE_SHA }, writePermission: true };

  /*
   * The gateway is not optional any more.
   *
   * Provisioning resolves it before it installs anything, because a run that
   * discovers at turn one that it has nowhere to sample has already bought a
   * VM. Stubbed for every test here rather than a few, so the suite runs the
   * configuration a deployment actually has.
   */
  vi.stubEnv("VIBE_AGENT_GATEWAY_ORIGIN", "https://app.vibe.test");
  vi.stubEnv("VIBE_AGENT_GATEWAY_SECRET", "test-gateway-secret-not-a-real-one");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("§8, §12 — the workspace is pinned, scrubbed and closed before the agent exists", () => {
  it("creates one sandbox at the exact base SHA and shuts the network before install ends", async () => {
    const { operation } = seed();
    const sandbox = fakeSandboxProvider({ files: SANDBOX_FILES, results: SANDBOX_RESULTS });

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

    // The policy sequence: github → registry → the gateway alone. The agent has not been
    // constructed yet when the last one is applied (§12).
    expect(sandbox.policies().map((policy) => policy.mode)).toEqual([
      "allow_domains",
      "allow_domains",
      "allow_domains",
    ]);
    // …and the last one is exactly one host: the Agent Gateway. Egress is not
    // "closed" any more, it is narrowed to the single destination the harness
    // needs, because the harness now lives inside this VM (ADR 0029 §3).
    expect(sandbox.policies().at(-1)).toEqual({
      mode: "allow_domains",
      domains: ["app.vibe.test"],
    });

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
    const sandbox = fakeSandboxProvider({ files: SANDBOX_FILES, results: SANDBOX_RESULTS });

    await provisionAgentWorkspaceStep(deps({ sandboxProvider: sandbox }), operation.id);
    await provisionAgentWorkspaceStep(deps({ sandboxProvider: sandbox }), operation.id);

    expect(sandbox.createCount()).toBe(1);
  });
});

describe("§37 — the paid loop runs at most once", () => {
  it("refuses to run a second agent after an ambiguous outcome", async () => {
    const { operation } = seed();
    const sandbox = fakeSandboxProvider({ files: SANDBOX_FILES, results: SANDBOX_RESULTS });
    await provisionAgentWorkspaceStep(deps({ sandboxProvider: sandbox }), operation.id);

    const provider = fakeDetachedAgentProvider({ calls: [] });
    const first = await runAgent(deps({ provider, sandboxProvider: sandbox }), operation.id, [
      "typecheck",
    ]);
    expect(first.ok).toBe(true);
    expect(provider.requests).toHaveLength(1);

    // A re-entry after the outcome was lost. The claim is scoped to `queued`,
    // so this reports false and the step refuses rather than buying a second
    // coding agent.
    const second = await runAgent(deps({ provider, sandboxProvider: sandbox }), operation.id, [
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
  /**
   * Provider usage is no longer written here, and that is the fix rather than a
   * regression.
   *
   * Every sampling call writes its own row from the Agent Gateway as it
   * happens — the only place that sees what a streamed response actually cost.
   * A summary row written at the end would double-count a run whose per-call
   * rows are the ones the ceilings are measured against.
   */
  it("leaves provider usage to the gateway that observed each call", async () => {
    const { operation } = seed();
    const sandbox = fakeSandboxProvider({ files: SANDBOX_FILES, results: SANDBOX_RESULTS });
    const shared = deps({
      sandboxProvider: sandbox,
      provider: fakeDetachedAgentProvider({ outcome: "provider_error" }),
    });

    await provisionAgentWorkspaceStep(shared, operation.id);
    await runAgent(shared, operation.id, ["typecheck"]);

    expect(db.rows("ai_usage_events")).toHaveLength(0);

    // What this step does still record is what only it can observe.
    expect(db.rows("agent_execution_runs")[0]).toMatchObject({ duration_ms: 1_234 });
  });

  it("records the tool trail and the activity trail even on failure", async () => {
    const { operation } = seed();
    const sandbox = fakeSandboxProvider({ files: SANDBOX_FILES, results: SANDBOX_RESULTS });
    await provisionAgentWorkspaceStep(deps({ sandboxProvider: sandbox }), operation.id);

    const provider = fakeDetachedAgentProvider({
      calls: [
        { tool: "read_file", input: { path: "src/app/page.tsx" } },
        { tool: "read_file", input: { path: ".env" } },
      ],
      outcome: "provider_error",
    });

    await runAgent(deps({ provider, sandboxProvider: sandbox }), operation.id, ["typecheck"]);

    const events = db.rows("agent_tool_events");
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.decision)).toEqual(["allowed", "denied"]);
    expect(db.rows("agent_activity_events").length).toBeGreaterThan(0);
  });
});

describe("§25 — a question pauses the run", () => {
  it("persists the interrupt, pauses both records, and does not proceed", async () => {
    const { operation, run } = seed();
    const sandbox = fakeSandboxProvider({ files: SANDBOX_FILES, results: SANDBOX_RESULTS });
    await provisionAgentWorkspaceStep(deps({ sandboxProvider: sandbox }), operation.id);

    const provider = fakeDetachedAgentProvider({
      calls: [
        { tool: "request_decision", input: { situation: "business_decision_required" } },
        { tool: "write_file", input: { path: "src/app/page.tsx", content: "changed" } },
      ],
    });

    const outcome = await runAgent(deps({ provider, sandboxProvider: sandbox }), operation.id, [
      "typecheck",
    ]);

    // The pause happens at start, before there is anything to watch or collect.
    expect(outcome).toEqual({ ok: true, paused: true, changedPaths: null, observedPathCount: 0 });

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
    const sandbox = fakeSandboxProvider({ files: SANDBOX_FILES, results: SANDBOX_RESULTS });
    const shared = deps({ sandboxProvider: sandbox, provider: fakeDetachedAgentProvider({ calls }) });

    await provisionAgentWorkspaceStep(shared, operation.id);
    await runAgent(shared, operation.id, ["typecheck", "test", "build"]);
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

  /**
   * Why a refusal happened, and not only that it did.
   *
   * The first complete agent run was refused for `too_many_files` and
   * `diff_too_large`, and the audit row said exactly that and nothing else — so
   * "the budget is too small for this step" and "the observation swept up build
   * output" were indistinguishable weeks later. The paths are what tells them
   * apart, and they belong in the record the refusal writes.
   */
  it("records the paths and the measured limits behind a refusal", async () => {
    const { operation } = seed();

    // Sixteen source files plus build output the walk's prune list does not
    // cover, which is the shape the real run is suspected of having had.
    const source = Array.from({ length: 16 }, (_, index) => `src/app/p${index}/page.tsx`);
    const generated = ["tsconfig.tsbuildinfo", "debug.log"];
    const observed = [...source, ...generated];

    const sandbox = fakeSandboxProvider({
      files: {
        ...SANDBOX_FILES,
        ...Object.fromEntries(observed.map((path) => [`product/${path}`, `content of ${path}\n`])),
      },
      results: SANDBOX_RESULTS,
    });
    const shared = deps({ sandboxProvider: sandbox, provider: fakeDetachedAgentProvider() });

    await provisionAgentWorkspaceStep(shared, operation.id);
    await runAgent(shared, operation.id, ["typecheck"]);

    const outcome = await extractAndVerifyStep(shared, operation.id, observed);
    expect(outcome).toEqual({ ok: false, failureCode: "agent_change_rejected" });

    const rejected = db
      .rows("audit_events")
      .find((row) => row.event_type === "agent_execution.change_rejected");
    expect(rejected).toBeDefined();

    const metadata = rejected!.metadata as Record<string, unknown>;
    expect(metadata.rejections).toEqual(["too_many_files"]);
    expect(metadata.changedPathCount).toBe(18);
    // `tsconfig.tsbuildinfo` is withheld by the base `.gitignore`; `debug.log`
    // is not ignored by this repository and stays a change. Seventeen files
    // still overruns the fifteen the fixture scope allows.
    expect(metadata.changedFileCount).toBe(17);
    expect(metadata.ignoredPathCount).toBe(1);
    expect(metadata.changedPathsTruncated).toBe(false);
    expect(metadata.classCounts).toEqual({ source: 16, generated: 1, runtime: 1, unknown: 0 });

    // The actual list, so the next question can be answered by reading.
    const paths = (metadata.changedPaths as { path: string }[]).map((entry) => entry.path);
    expect(paths.sort()).toEqual([...observed].sort());

    // The limit the change was measured against, which the previous row dropped.
    expect(metadata.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "too_many_files", changed: 17, limit: 15 }),
      ]),
    );

    // Rule 26: measurements about files, never any of their bytes.
    expect(JSON.stringify(metadata)).not.toContain("content of");
  });
});

describe("§30 — trusted Vibe infrastructure writes the branch", () => {
  async function prepared() {
    const { operation } = seed();
    const sandbox = fakeSandboxProvider({ files: SANDBOX_FILES, results: SANDBOX_RESULTS });
    const shared = deps({
      sandboxProvider: sandbox,
      provider: fakeDetachedAgentProvider({
        calls: [
          {
            tool: "write_file",
            input: { path: "src/app/page.tsx", content: "export default () => <b/>;\n" },
          },
        ],
      }),
    });

    await provisionAgentWorkspaceStep(shared, operation.id);
    await runAgent(shared, operation.id, ["typecheck"]);
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

/* ---------------------------------------------------------------------------
 * The runtime-placement correction: the harness inside the sandbox
 * ------------------------------------------------------------------------ */

/**
 * The SDK spawns a native binary of 307–325 MB and a Vercel function's whole
 * deployment budget is 250 MB, so the harness runs in the execution's own
 * microVM. These assert the two things that changes: what the sandbox may
 * reach, and where the change set comes from once no tool gateway brokers it.
 */
describe("the sandbox-hosted harness", () => {
  const HOME = "/vercel/sandbox";
  const LIST =
    "find . ( -name node_modules -o -name .git -o -name .next -o -name dist -o -name build -o -name .turbo -o -name .vercel -o -name coverage ) -prune -o -type f -printf %P\n";
  const TOUCHED = `find . ( -name node_modules -o -name .git -o -name .next -o -name dist -o -name build -o -name .turbo -o -name .vercel -o -name coverage ) -prune -o -type f -newer ${HOME}/.vibe-agent/marker -printf %P\n`;

  /** The workspace as the fake sandbox reports it, before and after the run. */
  function walk(options: { before: string[]; after: string[]; touched: string[] }) {
    let listings = 0;
    return {
      [LIST]: {
        exitCode: 0,
        get output() {
          listings += 1;
          return `${(listings === 1 ? options.before : options.after).join("\n")}\n`;
        },
      },
      [TOUCHED]: { exitCode: 0, output: `${options.touched.join("\n")}\n` },
      "pwd": { exitCode: 0, output: `${HOME}\n` },
    };
  }

  function sandboxRuntimeDeps(
    provider: DetachedCodingAgentProvider,
    sandboxProvider: ReturnType<typeof fakeSandboxProvider>,
  ): AgentExecutionDeps {
    return {
      supabase: fakeSupabase(db),
      runtime: { build: () => provider },
      sandboxProvider,
      resolveTarget: async () => target(),
    };
  }

  it("installs the harness while the registry is open, then narrows to the gateway alone", async () => {
    const { operation } = seed();
    const sandbox = fakeSandboxProvider({ files: SANDBOX_FILES, results: SANDBOX_RESULTS });

    const outcome = await provisionAgentWorkspaceStep(
      sandboxRuntimeDeps(fakeDetachedAgentProvider(), sandbox),
      operation.id,
    );

    expect(outcome.ok).toBe(true);

    const commands = sandbox.commands();
    const install = commands.findIndex((command) => command.startsWith("npm install"));
    expect(install).toBeGreaterThan(-1);

    // Bootstrap egress and execution egress, in that order and never overlapping.
    expect(sandbox.policies()).toEqual([
      { mode: "allow_domains", domains: SOURCE_HOSTS },
      { mode: "allow_domains", domains: DEPENDENCY_HOSTS },
      { mode: "allow_domains", domains: ["app.vibe.test"] },
    ]);
  });

  /**
   * The whole point of separating the two windows. A registry still reachable
   * during the run is a package publish away from being an exfiltration
   * channel, and the agent is the party that would use it.
   */
  it("leaves no registry host reachable once the agent can run", async () => {
    const { operation } = seed();
    const sandbox = fakeSandboxProvider({ files: SANDBOX_FILES, results: SANDBOX_RESULTS });

    await provisionAgentWorkspaceStep(
      sandboxRuntimeDeps(fakeDetachedAgentProvider(), sandbox),
      operation.id,
    );

    const final = sandbox.policies().at(-1);
    expect(final).toEqual({ mode: "allow_domains", domains: ["app.vibe.test"] });
  });

  /**
   * A run that cannot reach a gateway has nowhere to sample, and discovering
   * that at turn one means a VM has already been bought.
   */
  it("refuses to provision when no gateway is configured", async () => {
    vi.stubEnv("VIBE_AGENT_GATEWAY_ORIGIN", "");
    const { operation } = seed();
    const sandbox = fakeSandboxProvider({ files: SANDBOX_FILES, results: SANDBOX_RESULTS });

    expect(
      await provisionAgentWorkspaceStep(
        sandboxRuntimeDeps(fakeDetachedAgentProvider(), sandbox),
        operation.id,
      ),
    ).toEqual({ ok: false, failureCode: "missing_required_context" });
  });

  it("takes the change set off the filesystem rather than from a tool trail", async () => {
    const { operation } = seed();
    const sandbox = fakeSandboxProvider({ files: SANDBOX_FILES, results: SANDBOX_RESULTS });
    const shared = deps({
      sandboxProvider: sandbox,
      // The write lands in the fake's own filesystem, and the marker plus
      // `find -newer` is what finds it again. Nothing consults the tool trail.
      provider: fakeDetachedAgentProvider({
        calls: [
          { tool: "write_file", input: { path: "src/app/robots.ts", content: "export const x = 1;\n" } },
        ],
      }),
    });

    await provisionAgentWorkspaceStep(shared, operation.id);
    const outcome = await runAgent(shared, operation.id, ["typecheck"]);

    expect(outcome).toMatchObject({
      ok: true,
      paused: false,
      changedPaths: ["src/app/robots.ts"],
      observedPathCount: 1,
    });
  });

  /** A file the agent only read is not a change, whatever it says it did. */
  it("reports nothing for a run that only read", async () => {
    const { operation } = seed();
    const sandbox = fakeSandboxProvider({ files: SANDBOX_FILES, results: SANDBOX_RESULTS });
    const shared = deps({
      sandboxProvider: sandbox,
      provider: fakeDetachedAgentProvider({
        calls: [{ tool: "read_file", input: { path: "src/app/page.tsx" } }],
      }),
    });

    await provisionAgentWorkspaceStep(shared, operation.id);
    const outcome = await runAgent(shared, operation.id, ["typecheck"]);

    expect(outcome).toMatchObject({ ok: true, changedPaths: [], observedPathCount: 0 });
  });

  /**
   * "We found these files" and "these are the files" are different claims, and
   * only the second may become a diff a person is asked to approve (Rule 27).
   */
  it("refuses when the workspace observation was incomplete", async () => {
    const { operation } = seed();
    // The *post-run* listing fails. The baseline is taken first and must
    // succeed, or the run stops before the agent — a different failure, covered
    // by the test below.
    let listings = 0;
    const sandbox = fakeSandboxProvider({
      files: SANDBOX_FILES,
      results: {
        ...walk({ before: [], after: [], touched: [] }),
        [LIST]: {
          get exitCode() {
            listings += 1;
            return listings === 1 ? 0 : 1;
          },
          output: "",
        },
      },
    });
    const deps = sandboxRuntimeDeps(fakeDetachedAgentProvider(), sandbox);

    await provisionAgentWorkspaceStep(deps, operation.id);

    expect(await runAgent(deps, operation.id, ["typecheck"])).toEqual({
      ok: false,
      failureCode: "change_preparation_failed",
    });
  });

  /**
   * The defect that killed the first real run, at the level it mattered.
   *
   * The baseline listing was built by joining `find`'s prune tokens — written
   * for an argument array — into a `sh -c` line, so the shell choked on `(` and
   * the run reported `agent_workspace_unavailable` six seconds in. What the
   * step must do when it genuinely cannot list the workspace is stop *before*
   * the harness starts: an agent launched against a workspace Vibe never
   * observed produces a diff with no baseline to compare it to.
   */
  it("stops before the agent when the baseline could not be taken", async () => {
    const { operation } = seed();
    const sandbox = fakeSandboxProvider({
      files: SANDBOX_FILES,
      results: { ...walk({ before: [], after: [], touched: [] }), [LIST]: { exitCode: 1, output: "" } },
    });
    const provider = fakeDetachedAgentProvider();
    const deps = sandboxRuntimeDeps(provider, sandbox);

    await provisionAgentWorkspaceStep(deps, operation.id);

    expect(await runAgent(deps, operation.id, ["typecheck"])).toEqual({
      ok: false,
      failureCode: "sandbox_lost",
    });
    expect(provider.starts()).toBe(0);
  });

  /** The marker lives outside the repository, so it is never itself a change. */
  it("plants its baseline marker outside the workspace", async () => {
    const { operation } = seed();
    const sandbox = fakeSandboxProvider({
      files: SANDBOX_FILES,
      results: walk({ before: [], after: [], touched: [] }),
    });
    const deps = sandboxRuntimeDeps(fakeDetachedAgentProvider(), sandbox);

    await provisionAgentWorkspaceStep(deps, operation.id);
    await runAgent(deps, operation.id, ["typecheck"]);

    expect(sandbox.commands()).toContain(`touch -- ${HOME}/.vibe-agent/marker`);
  });
});
