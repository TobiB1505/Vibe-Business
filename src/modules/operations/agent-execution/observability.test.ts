import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const alertOperator =
  vi.fn<(message: string, context?: Record<string, unknown>) => Promise<void>>();
vi.mock("@/lib/observability/alert", () => ({
  alertOperator: (message: string, context?: Record<string, unknown>) =>
    alertOperator(message, context),
}));
import { fakeAgentSpec, fakeDetachedAgentProvider } from "@/modules/coding-agent/test-support";
import type { BaseContentPort, BaseTreePort } from "@/modules/coding-agent/candidate";
import type { ObservedRuntimeEntry } from "@/modules/coding-agent/provider";
import type { ExecutionProbePort, GitWritePort } from "@/modules/execution/git-port";
import { fakeSandboxProvider } from "@/modules/validation/test-support";
import { buildAgentExecutionLiveModel } from "@/modules/coding-agent/observability/live-view";
import { MAX_EVENTS_PER_RUN } from "@/modules/coding-agent/observability/events";
import { listExecutionEvents } from "@/modules/coding-agent/observability/store";
import { AGENT_SDK_VERSION } from "@/modules/coding-agent/sandbox-runtime/protocol";
import { REDACTED } from "@/lib/security/credential-patterns";
import { FakeDatabase, fakeSupabase } from "../test-support";
import { buildOperationView } from "../view";
import {
  collectAgentStep,
  extractAndVerifyStep,
  finishAgentExecutionStep,
  pollAgentStep,
  provisionAgentWorkspaceStep,
  startAgentStep,
  type AgentExecutionDeps,
  type AgentRepositoryTarget,
} from "./execution";

/**
 * What run #3 will be able to show, tested before it costs anything.
 *
 * Runs #1 and #2 were reconstructed afterwards from four tables and a platform
 * log. The properties below are the ones that make that unnecessary: the feed
 * survives a lost poll, the ordering is the harness's own, the counts a person
 * reads are Vibe's observations rather than the agent's claims, and nothing a
 * repository controls can put a secret or an unbounded payload in the record.
 */

const USER = "user_1";
const PROJECT = "project_1";
const BASE_SHA = "1f4b0c9d7a2e5f8b3c6d9e0a1b2c3d4e5f607182";
const SANDBOX_HOME = "/vercel/sandbox";

let db: FakeDatabase;

const BASE_FILES: Record<string, string> = {
  "src/app/page.tsx": "export default function Page() { return null; }\n",
  ".gitignore": "*.tsbuildinfo\n",
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
    baseTree,
  };
}

const SANDBOX_RESULTS = { pwd: { exitCode: 0, output: `${SANDBOX_HOME}\n` } };
const SANDBOX_FILES = {
  "product/package.json": JSON.stringify({ scripts: { typecheck: "tsc" } }),
  // Deliberately different from the base commit's bytes: a file written back
  // identical is not a change, and this test needs one that is.
  "product/src/app/page.tsx": "export default function Page() { return <main />; }\n",
  "product/tsconfig.tsbuildinfo": '{"generated":true}',
};

function seed() {
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
    mode: "agentic",
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
    created_at: "2026-08-19T00:00:00.000Z",
  });

  const operation = db.seed("operation_runs", {
    project_id: PROJECT,
    user_id: USER,
    operation_type: "agent_execution",
    status: "queued",
    stage: "preparing",
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
    coding_agent_policy_version: "coding-agent-policy-v1",
    prompt_compiler_version: "agent-prompt-v1",
    budget_policy_version: "core4-dogfood-budget-v1",
    execution_policy_version: "execution-policy-v1",
    non_production_economics: true,
    base_sha: BASE_SHA,
    credit_reservation_id: null,
    status: "queued",
    assistant_messages: 0,
    sdk_loop_iterations: null,
    tool_calls_allowed: 0,
    tool_calls_denied: 0,
    files_read: 0,
    check_runs: 0,
    repair_attempts: 0,
    changed_file_count: 0,
    changed_bytes: 0,
    created_at: "2026-08-19T00:00:00.000Z",
  });

  // Ids as strings: `FakeDatabase.seed` returns `Record<string, unknown>`,
  // and every step below looks its subject up by id.
  return {
    operation: { id: String(operation.id) },
    run: { id: String(run.id) },
  };
}

function deps(
  overrides: {
    entries?: readonly ObservedRuntimeEntry[];
    results?: Record<string, { exitCode?: number; output?: string }>;
  } = {},
): AgentExecutionDeps {
  const provider = fakeDetachedAgentProvider({ entries: overrides.entries });
  const sandbox = fakeSandboxProvider({
    files: SANDBOX_FILES,
    results: { ...SANDBOX_RESULTS, ...overrides.results },
  });

  return {
    supabase: fakeSupabase(db),
    runtime: { build: () => provider },
    sandboxProvider: sandbox,
    resolveTarget: async () => target(),
    now: () => Date.parse("2026-08-19T10:00:00.000Z"),
  };
}

const FEED: ObservedRuntimeEntry[] = [
  { sequence: 1, kind: "started" },
  { sequence: 2, kind: "turn", assistantMessages: 1 },
  { sequence: 3, kind: "tool", tool: "Read", path: "src/app/page.tsx" },
  { sequence: 4, kind: "tool", tool: "Edit", path: "src/app/page.tsx" },
  { sequence: 5, kind: "tool", tool: "Bash", command: "pnpm run typecheck" },
];

beforeEach(() => {
  db = new FakeDatabase();
  alertOperator.mockClear();

  // Provisioning resolves the gateway before it installs anything, so a run
  // with no configured origin never reaches the harness at all.
  vi.stubEnv("VIBE_AGENT_GATEWAY_ORIGIN", "https://app.vibe.test");
  vi.stubEnv("VIBE_AGENT_GATEWAY_SECRET", "test-gateway-secret-not-a-real-one");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function toRunningAgent(shared: AgentExecutionDeps, operationId: string) {
  const provisioned = await provisionAgentWorkspaceStep(shared, operationId);
  if (!provisioned.ok) throw new Error(`provision: ${provisioned.failureCode}`);
  const started = await startAgentStep(shared, operationId, ["typecheck"]);
  if (!started.ok) throw new Error(`start: ${started.failureCode}`);
}

describe("the execution event log", () => {
  it("records the harness's feed in the harness's own order", async () => {
    const { operation, run } = seed();
    const shared = deps({ entries: FEED });

    await toRunningAgent(shared, operation.id);
    await pollAgentStep(shared, operation.id);

    const events = await listExecutionEvents(fakeSupabase(db), {
      runId: run.id,
      projectId: PROJECT,
    });

    const fromFeed = events.filter((event) => event.sequence < 90_000);
    expect(fromFeed.map((event) => event.sequence)).toEqual([2, 3, 4, 5]);
    expect(fromFeed.map((event) => event.type)).toEqual([
      "turn_completed",
      "file_read",
      "file_edited",
      "command_started",
    ]);
  });

  /**
   * The property that makes a lost poll cost nothing. Every poll re-offers the
   * whole file, so re-entry must rewrite rather than duplicate.
   */
  it("is idempotent across repeated polls", async () => {
    const { operation, run } = seed();
    const shared = deps({ entries: FEED });

    await toRunningAgent(shared, operation.id);
    await pollAgentStep(shared, operation.id);
    await pollAgentStep(shared, operation.id);
    await pollAgentStep(shared, operation.id);

    const events = await listExecutionEvents(fakeSupabase(db), {
      runId: run.id,
      projectId: PROJECT,
    });

    const sequences = events.map((event) => event.sequence);
    expect(new Set(sequences).size).toBe(sequences.length);
  });

  /**
   * A repository can induce an agent to touch files in a loop. The cap is what
   * stops one execution from becoming an unbounded table.
   */
  it("refuses a feed line beyond the per-run cap", async () => {
    const { operation, run } = seed();
    const shared = deps({
      entries: [
        { sequence: 2, kind: "tool", tool: "Read", path: "kept.ts" },
        { sequence: MAX_EVENTS_PER_RUN + 5, kind: "tool", tool: "Read", path: "dropped.ts" },
      ],
    });

    await toRunningAgent(shared, operation.id);
    await pollAgentStep(shared, operation.id);

    const events = await listExecutionEvents(fakeSupabase(db), {
      runId: run.id,
      projectId: PROJECT,
    });

    expect(events.some((event) => event.metadata.path === "kept.ts")).toBe(true);
    expect(events.some((event) => event.metadata.path === "dropped.ts")).toBe(false);
  });

  /**
   * The agent holds a gateway bearer token on its environment, so a command it
   * composes really can carry one into this table.
   */
  it("cannot carry a secret out of a command the agent ran", async () => {
    const { operation, run } = seed();
    const shared = deps({
      entries: [
        {
          sequence: 2,
          kind: "tool",
          tool: "Bash",
          command: "curl -H 'Authorization: Bearer vibe_agt_supersecretvalue' https://x",
        },
      ],
    });

    await toRunningAgent(shared, operation.id);
    await pollAgentStep(shared, operation.id);

    const events = await listExecutionEvents(fakeSupabase(db), {
      runId: run.id,
      projectId: PROJECT,
    });

    expect(JSON.stringify(events)).not.toContain("vibe_agt_supersecretvalue");
  });

  it("records Vibe's own milestones alongside the feed", async () => {
    const { operation, run } = seed();
    const shared = deps({ entries: FEED });

    await toRunningAgent(shared, operation.id);
    await pollAgentStep(shared, operation.id);
    await collectAgentStep(shared, operation.id);

    const events = await listExecutionEvents(fakeSupabase(db), {
      runId: run.id,
      projectId: PROJECT,
    });

    const types = events.map((event) => event.type);
    expect(types).toContain("workspace_ready");
    expect(types).toContain("agent_started");
    expect(types).toContain("agent_finished");
    expect(types).toContain("change_discovered");
  });

  /** A founder sees milestones; the per-file detail is the inspector's. */
  it("separates the customer projection from the technical record", async () => {
    const { operation, run } = seed();
    const shared = deps({ entries: FEED });

    await toRunningAgent(shared, operation.id);
    await pollAgentStep(shared, operation.id);

    const customer = await listExecutionEvents(fakeSupabase(db), {
      runId: run.id,
      projectId: PROJECT,
      audience: "customer",
    });

    expect(customer.every((event) => event.audience === "customer")).toBe(true);
    expect(customer.some((event) => event.type === "file_read")).toBe(false);
  });
});

describe("the live view model", () => {
  async function model(entries: readonly ObservedRuntimeEntry[], status: "running" | "failed") {
    const { operation, run } = seed();
    const shared = deps({ entries });

    await toRunningAgent(shared, operation.id);
    await pollAgentStep(shared, operation.id);

    if (status === "failed") {
      await finishAgentExecutionStep(shared, operation.id, {
        kind: "failed",
        failureCode: "agent_change_rejected",
      });
    }

    const row = db.rows("operation_runs")[0] as Record<string, unknown>;

    return buildAgentExecutionLiveModel(fakeSupabase(db), {
      operation: {
        ...buildOperationView(
          {
            operationId: operation.id,
            status: row.status as never,
            stage: row.stage as never,
            failureCode: (row.failure_code as string | null) ?? null,
            resultId: null,
            startedAt: "2026-08-19T09:50:00.000Z",
            completedAt: null,
            createdAt: "2026-08-19T09:50:00.000Z",
          },
          new Date("2026-08-19T10:00:00.000Z"),
        ),
        agentExecutionRunId: run.id,
      },
      projectId: PROJECT,
      run: {
        id: run.id,
        status: row.status as string,
        assistantMessages: 1,
        sdkLoopIterations: null,
        startedAt: "2026-08-19T09:50:00.000Z",
        completedAt: null,
        durationMs: null,
        observedPathCount: 0,
        changedFileCount: 0,
        context: null,
        verification: null,
        completion: null,
      },
      limits: { maxWallClockMs: 1_200_000, maxTurns: 40, maxProviderSpendUsd: 3 },
      now: () => Date.parse("2026-08-19T10:00:00.000Z"),
    });
  }

  it("counts what the harness did, from events rather than from claims", async () => {
    const live = await model(FEED, "running");

    expect(live.metrics.filesRead).toBe(1);
    expect(live.metrics.filesEdited).toBe(1);
    expect(live.metrics.commands).toBe(1);
  });

  /**
   * The two turn numbers are never divided by one another. Run `b33635a1`
   * recorded 66 assistant messages against a 40-iteration ceiling and overran
   * nothing; "66 / 40" would have reported a breach that did not happen.
   */
  it("keeps assistant messages and SDK iterations as separate named metrics", async () => {
    const live = await model(FEED, "running");

    expect(live.metrics.maxSdkIterations).toBe(40);
    // Unknown until the harness reports its own count, and null says so.
    expect(live.metrics.sdkLoopIterations).toBeNull();
  });

  /**
   * The specific substitution that produced the misleading display: the
   * inspector read the message count out of the `agent_finished` event and
   * labelled it SDK loop iterations. It now reads the run row's own column.
   */
  it("reads the loop count from its own column, never from the message count", async () => {
    const { operation, run } = seed();
    const shared = deps({ entries: FEED });

    await toRunningAgent(shared, operation.id);
    await pollAgentStep(shared, operation.id);
    await collectAgentStep(shared, operation.id);

    const events = await listExecutionEvents(fakeSupabase(db), {
      runId: run.id,
      projectId: PROJECT,
    });
    const finished = events.find((event) => event.type === "agent_finished");

    // Both are recorded, under their own names, and neither is derived from
    // the other — the event carries them as two separate fields.
    expect(finished?.metadata).toHaveProperty("assistantMessages");
    expect(finished?.metadata).toHaveProperty("sdkLoopIterations");

    const row = db.rows("agent_execution_runs")[0] as Record<string, unknown>;
    expect(row).toHaveProperty("sdk_loop_iterations");
    expect(row.sdk_loop_iterations).toBe(finished?.metadata.sdkLoopIterations);
  });

  /**
   * Mid-run progress writes the message count and nothing else. The harness
   * reports its loop count once, in its terminal message, so filling the column
   * before then could only mean putting the message count there.
   */
  it("writes no loop count before the harness has reported one", async () => {
    const { operation } = seed();
    const shared = deps({ entries: FEED });

    await toRunningAgent(shared, operation.id);
    await pollAgentStep(shared, operation.id);

    const row = db.rows("agent_execution_runs")[0] as Record<string, unknown>;
    expect(row.sdk_loop_iterations ?? null).toBeNull();
  });
});

describe("observed and changed are two columns, not one", () => {
  /**
   * Run #3 stored `changed_file_count: 14` for a change of two files. Both
   * numbers were real; the column held the wrong one, under a name that
   * promised the other. This is that split, end to end.
   */
  it("records the observation on collect and the candidate on extract", async () => {
    const { operation } = seed();
    const shared = deps();

    await toRunningAgent(shared, operation.id);
    await pollAgentStep(shared, operation.id);
    await collectAgentStep(shared, operation.id);

    // Collect has looked at the filesystem and nothing else, so it writes the
    // observation and leaves the candidate count alone.
    const afterCollect = db.rows("agent_execution_runs")[0] as Record<string, unknown>;
    const observed = afterCollect.observed_path_count as number;
    expect(afterCollect.changed_file_count).toBe(0);

    await extractAndVerifyStep(shared, operation.id, ["src/app/page.tsx", "tsconfig.tsbuildinfo"]);

    // Extract knows which of them survived comparison with the pinned base —
    // and does not touch the observation collect recorded.
    const afterExtract = db.rows("agent_execution_runs")[0] as Record<string, unknown>;
    expect(afterExtract.observed_path_count).toBe(observed);
    expect(afterExtract.changed_file_count).toBe(1);
    expect(afterExtract.changed_bytes).toBeGreaterThan(0);
  });

  /** A run that never verified anything keeps 0, not the observation. */
  it("leaves the candidate count at zero for a run that never got that far", async () => {
    const { operation } = seed();
    const shared = deps();

    await toRunningAgent(shared, operation.id);
    await pollAgentStep(shared, operation.id);
    await collectAgentStep(shared, operation.id);

    expect((db.rows("agent_execution_runs")[0] as Record<string, unknown>).changed_file_count).toBe(
      0,
    );
  });
});

describe("the evidence for an accepted change", () => {
  /**
   * Previously only a refusal wrote an audit event, which had it backwards: an
   * accepted change is the one a human approves and the one that may reach a
   * branch. Run #3 withheld twelve of fourteen paths and the only record of
   * which twelve was a platform log.
   */
  it("is durable, and names every path it withheld", async () => {
    const { operation, run } = seed();
    const shared = deps();

    await toRunningAgent(shared, operation.id);
    await pollAgentStep(shared, operation.id);
    await collectAgentStep(shared, operation.id);

    const outcome = await extractAndVerifyStep(shared, operation.id, [
      "src/app/page.tsx",
      "tsconfig.tsbuildinfo",
    ]);
    expect(outcome.ok).toBe(true);

    const verified = db
      .rows("audit_events")
      .find((row) => row.event_type === "agent_execution.change_verified");
    expect(verified).toBeDefined();

    const metadata = verified!.metadata as Record<string, unknown>;
    expect(metadata.agentExecutionRunId).toBe(run.id);
    expect(metadata.changedPathCount).toBe(2);
    expect(metadata.changedFileCount).toBe(1);
    expect(metadata.ignoredPathCount).toBe(1);

    const withheld = (
      metadata.changedPaths as { path: string; status: string; ignoredBy?: unknown }[]
    ).filter((entry) => entry.status === "observed_ignored");
    expect(withheld.map((entry) => entry.path)).toEqual(["tsconfig.tsbuildinfo"]);
    expect(withheld[0].ignoredBy).toMatchObject({ reason: "base_gitignore" });

    // Rule 26: measurements about files, never any of their bytes.
    expect(JSON.stringify(metadata)).not.toContain("export default");
  });
});

describe("candidate metrics are never inflated by generated output", () => {
  /**
   * The whole of Part A, seen through the observability layer: a run that also
   * wrote a tsbuildinfo reports six-of-eighteen honestly rather than eighteen.
   */
  it("counts only the verified candidate in the change_verified event", async () => {
    const { operation, run } = seed();
    const shared = deps();

    await toRunningAgent(shared, operation.id);
    await pollAgentStep(shared, operation.id);
    await collectAgentStep(shared, operation.id);
    await extractAndVerifyStep(shared, operation.id, ["src/app/page.tsx", "tsconfig.tsbuildinfo"]);

    const events = await listExecutionEvents(fakeSupabase(db), {
      runId: run.id,
      projectId: PROJECT,
    });

    const verified = events.find((event) => event.type === "change_verified");
    expect(verified?.metadata.observedPaths).toBe(2);
    expect(verified?.metadata.candidateFiles).toBe(1);
    expect(verified?.metadata.observedIgnored).toBe(1);
  });
});

/**
 * A harness that will not install (PERF-022).
 *
 * Two things were wrong with how that was reported. It went out as a bare
 * `console.error`, which on Vercel is a line in a stream nobody watches — the
 * exact failure `alert.ts` was written to end, and a sandbox that cannot be
 * prepared is squarely one of its cases. And the detail it carried is the tail
 * of a command run inside the customer's own tree, so it is untrusted
 * repository output that can print whatever their install printed.
 *
 * Sentry would have scrubbed it on the way out; the local log line is the one
 * `beforeSend` never sees, which is why the redaction happens before the value
 * is handed over rather than after.
 */
describe("a harness that could not be installed", () => {
  const INSTALL = [
    "npm install --no-save --no-audit --no-fund --ignore-scripts",
    `@anthropic-ai/claude-agent-sdk@${AGENT_SDK_VERSION}`,
  ].join(" ");

  const FAILING = {
    [INSTALL]: {
      exitCode: 1,
      output: "npm error 403 Forbidden\nnpm error using token sk-ant-api03-NOTAREALKEY123456\n",
    },
  };

  it("reaches the operator instead of a log stream", async () => {
    const { operation } = seed();

    const provisioned = await provisionAgentWorkspaceStep(deps({ results: FAILING }), operation.id);

    expect(provisioned).toMatchObject({ ok: false, failureCode: "sandbox_unavailable" });
    expect(alertOperator).toHaveBeenCalledTimes(1);
  });

  it("redacts the customer's output before it is reported anywhere", async () => {
    const { operation, run } = seed();

    await provisionAgentWorkspaceStep(deps({ results: FAILING }), operation.id);

    const [message, context = {}] = alertOperator.mock.calls[0];

    expect(message).toContain("harness");
    expect(context).toMatchObject({ operationId: operation.id, agentExecutionRunId: run.id });

    const detail = String(context.detail);
    // The sentence survives — it is the whole reason the detail is worth
    // carrying — and only the credential inside it is gone.
    expect(detail).toContain("403 Forbidden");
    expect(detail).toContain(REDACTED);
    expect(detail).not.toContain("sk-ant-api03-NOTAREALKEY123456");
  });

  it("bounds what one failure can report", async () => {
    const { operation } = seed();
    const flood = "x".repeat(50_000);

    await provisionAgentWorkspaceStep(
      deps({ results: { [INSTALL]: { exitCode: 1, output: flood } } }),
      operation.id,
    );

    const [, context = {}] = alertOperator.mock.calls[0];
    expect(String(context.detail).length).toBeLessThanOrEqual(2_000);
  });
});
