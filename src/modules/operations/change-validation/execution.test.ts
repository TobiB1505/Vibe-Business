import { beforeEach, describe, expect, it } from "vitest";
import { FIXTURE_COMMIT_SHA, fakeSandboxProvider, fakeValidatableSnapshot, healthySandboxFiles } from "@/modules/validation/test-support";
import { SANDBOX_POLICY_VERSION, type ValidationStepName } from "@/modules/validation/schema";
import { FakeDatabase, fakeSupabase } from "../test-support";
import {
  cleanupSandboxStep,
  failValidationStep,
  finalizeValidationStep,
  prepareValidationStep,
  provisionSandboxStep,
  runPhaseStep,
  verifySourceStep,
  type CleanupRecord,
  type ValidationDeps,
} from "./execution";

/**
 * Durable change validation, phase by phase (Sprint 10A §20, §34, §36, §8 refactor).
 *
 * Two families of assertion live here, and they are the ones the single-step
 * design could not make:
 *
 *  - **progression** — a phase runs only after its predecessor passed, and not
 *    at all after a failure (§19);
 *  - **re-entry** — a resumed workflow reuses persisted phase results instead of
 *    re-running the customer's test suite (§20).
 *
 * The assertion that matters everywhere else is still whether a sandbox was
 * created at all. Anything that can refuse must refuse *before* provisioning,
 * because provisioning is where the money starts.
 */

const USER = "user_1";
const PROJECT = "project_1";
const PREPARED = "prepared_1";
const OPERATION = "operation_1";
const HEAD = "git rev-parse HEAD";
const CLONE_TOKEN = "ghs_tokenValue1234567890";

let db: FakeDatabase;
let provider: ReturnType<typeof fakeSandboxProvider>;
/** Which steps asked for a GitHub clone credential, in order. */
let credentialRequests: boolean[];

function deps(overrides: Partial<ValidationDeps> = {}): ValidationDeps {
  return {
    supabase: fakeSupabase(db),
    provider,
    resolveTarget: async (_operation, options) => {
      credentialRequests.push(options.withCloneCredential);
      return {
        repositoryUrl: "https://github.com/acme/product.git",
        sourceRoot: "product",
        cloneCredential: options.withCloneCredential
          ? { username: "x-access-token", password: CLONE_TOKEN }
          : null,
        // No GitHub side in these tests: build-identity files land in
        // `buildIdentityFilesUnverified`, which is the honest default.
        manifest: { getTextFile: async () => null },
      };
    },
    ...overrides,
  };
}

function seed(options: { preparedStatus?: string; commitSha?: string | null } = {}) {
  db.seed("projects", { id: PROJECT, user_id: USER });

  db.seed("prepared_changes", {
    id: PREPARED,
    project_id: PROJECT,
    user_id: USER,
    status: options.preparedStatus ?? "prepared",
    commit_sha: options.commitSha === undefined ? FIXTURE_COMMIT_SHA : options.commitSha,
    base_branch: "main",
    base_sha: "528d372",
    branch_name: "vibe/seo-foundations-cc32273131c5",
    execution_capability: "nextjs_seo_foundations_v1",
    execution_version: "nextjs-seo-foundations-v1",
    files: [],
  });

  db.seed("repository_intelligence_snapshots", {
    id: "snapshot_1",
    project_id: PROJECT,
    status: "completed",
    result: fakeValidatableSnapshot(),
    created_at: "2026-08-12T00:00:00.000Z",
  });

  db.seed("operation_runs", {
    id: OPERATION,
    project_id: PROJECT,
    user_id: USER,
    operation_type: "change_validation",
    status: "queued",
    stage: "preparing",
    input_identity: "identity_1",
    subject_id: PREPARED,
    result_id: null,
    failure_code: null,
    started_at: null,
    completed_at: null,
    created_at: "2026-08-12T00:00:00.000Z",
  });
}

const PHASES: readonly ValidationStepName[] = ["install", "typecheck", "test", "build"];

/**
 * Drives the whole durable sequence, in the order `changeValidationWorkflow`
 * drives it.
 *
 * Kept deliberately literal — the same fail-fast shape, the same unconditional
 * cleanup — so a divergence between this and the workflow shows up as a test
 * that stops describing production rather than as a silent difference.
 */
async function runPipeline(overrides: Partial<ValidationDeps> = {}) {
  const d = deps(overrides);

  const prepared = await prepareValidationStep(d, OPERATION);
  if (!prepared.ok) return prepared;

  let failureCode: string | null = null;

  try {
    const provisioned = await provisionSandboxStep(d, OPERATION);
    if (!provisioned.ok) failureCode = provisioned.failureCode;

    if (failureCode === null) {
      const verified = await verifySourceStep(d, OPERATION);
      if (!verified.ok) failureCode = verified.failureCode;
    }

    for (const phase of PHASES) {
      if (failureCode !== null) break;
      const outcome = await runPhaseStep(d, OPERATION, phase);
      if (!outcome.ok) failureCode = outcome.failureCode;
    }
  } catch {
    failureCode = "validation_run_failed";
  }

  const cleanup = await cleanupSandboxStep(d, OPERATION);
  return finalizeValidationStep(
    d,
    OPERATION,
    failureCode as Parameters<typeof finalizeValidationStep>[2],
    cleanup,
  );
}

/**
 * The single validation run, typed.
 *
 * The fake database stores plain rows, and every assertion below is about the
 * same four or five fields — so the cast lives here once rather than at each
 * call site.
 */
function validationRun() {
  return db.rows("validation_runs")[0] as unknown as {
    id: string;
    status: string;
    stage: string;
    cleanup_status: string | null;
    failure_code: string | null;
    sandbox_policy_version: string;
    steps: Partial<Record<string, { status: string; skipReason: string | null }>>;
  };
}

/** Every phase that actually executed a command, in order. */
function executedPhases(): string[] {
  return provider
    .commands()
    .filter((command) => command.startsWith("pnpm") || command.startsWith("npm"));
}

beforeEach(() => {
  db = new FakeDatabase();
  credentialRequests = [];
  provider = fakeSandboxProvider({
    files: healthySandboxFiles(),
    results: { [HEAD]: { output: `${FIXTURE_COMMIT_SHA}\n` } },
  });
});

describe("the happy path", () => {
  it("validates and records one run", async () => {
    seed();

    const outcome = await runPipeline();

    expect(outcome.ok).toBe(true);
    expect(db.rows("validation_runs")).toHaveLength(1);
    expect(validationRun().status).toBe("passed");
  });

  it("writes an infrastructure usage event, not an AI usage event (§25)", async () => {
    seed();
    await runPipeline();

    // Sandbox execution is compute, not inference. Mixing it into
    // ai_usage_events would corrupt every cost-per-audit figure.
    expect(db.rows("ai_usage_events")).toHaveLength(0);
    expect(db.rows("sandbox_usage_events")).toHaveLength(1);

    const usage = db.rows("sandbox_usage_events")[0];
    expect(usage.operation).toBe("change_validation");
    expect(usage.active_cpu_ms).toBe(1234);
    // Vercel exposes no attributable per-sandbox cost, so it stays null.
    expect(usage.provider_cost_usd ?? null).toBeNull();
  });

  it("records the sandbox policy version that was actually in force", async () => {
    seed();
    await runPipeline();

    // Asserted against the constant, not a literal: this test is about the
    // version being *recorded*, not about which version is current. Pinning a
    // literal here made a legitimate policy bump look like a regression.
    expect(validationRun().sandbox_policy_version).toBe(SANDBOX_POLICY_VERSION);
  });

  it("emits the domain lifecycle events once each", async () => {
    seed();
    await runPipeline();

    const types = db.rows("audit_events").map((row) => row.event_type);
    expect(types.filter((type) => type === "change_validation.started")).toHaveLength(1);
    expect(types.filter((type) => type === "change_validation.passed")).toHaveLength(1);
  });
});

describe("one sandbox per validation run (§23)", () => {
  it("creates exactly one sandbox across every phase", async () => {
    seed();
    await runPipeline();

    // The single most important property of the refactor. Two sandboxes would
    // mean the build ran against a filesystem the install never touched.
    expect(provider.createCount()).toBe(1);
  });

  it("reaches every later phase by reconnecting to that same sandbox", async () => {
    seed();
    await runPipeline();

    const expectedName = `vibe-validate-${validationRun().id.replace(/-/g, "").slice(0, 20)}`;
    const names = provider.reconnects();

    // provision (adopt-check), verify, install, typecheck, test, build, cleanup.
    expect(names).toHaveLength(7);
    expect(new Set(names)).toEqual(new Set([expectedName]));
  });

  it("stops that same sandbox at the end", async () => {
    seed();
    await runPipeline();

    expect(provider.stopped()).toBe(true);
    expect(validationRun().cleanup_status).toBe("stopped");
  });

  it("persists no reconnect credential, url or handle anywhere", async () => {
    seed();
    await runPipeline();

    // The reconnect key is recomputed from the run id, so there is nothing to
    // store — and nothing stored is the assertion (§3).
    const everything = JSON.stringify([
      db.rows("validation_runs"),
      db.rows("operation_runs"),
      db.rows("sandbox_usage_events"),
      db.rows("audit_events"),
    ]);

    expect(everything).not.toContain("https://");
    expect(everything).not.toContain(CLONE_TOKEN);
  });
});

describe("phase progression (§19)", () => {
  it("runs the phases in order, each only after the last passed", async () => {
    seed();
    await runPipeline();

    expect(executedPhases()).toEqual([
      "pnpm install --frozen-lockfile --ignore-scripts",
      "pnpm run typecheck",
      "pnpm run test",
      "pnpm run build",
    ]);
  });

  it("does not typecheck, test or build when the install fails", async () => {
    seed();
    provider = fakeSandboxProvider({
      files: healthySandboxFiles(),
      results: {
        [HEAD]: { output: `${FIXTURE_COMMIT_SHA}\n` },
        "pnpm install --frozen-lockfile --ignore-scripts": { exitCode: 1 },
      },
    });

    await runPipeline();

    expect(executedPhases()).toEqual(["pnpm install --frozen-lockfile --ignore-scripts"]);
  });

  it("does not test or build when the typecheck fails", async () => {
    seed();
    provider = fakeSandboxProvider({
      files: healthySandboxFiles(),
      results: {
        [HEAD]: { output: `${FIXTURE_COMMIT_SHA}\n` },
        "pnpm run typecheck": { exitCode: 2 },
      },
    });

    await runPipeline();

    expect(executedPhases()).not.toContain("pnpm run test");
    expect(executedPhases()).not.toContain("pnpm run build");
  });

  it("does not build when the tests fail", async () => {
    seed();
    provider = fakeSandboxProvider({
      files: healthySandboxFiles(),
      results: {
        [HEAD]: { output: `${FIXTURE_COMMIT_SHA}\n` },
        "pnpm run test": { exitCode: 1 },
      },
    });

    await runPipeline();

    expect(executedPhases()).not.toContain("pnpm run build");
    expect(validationRun().steps.build).toBeUndefined();
  });

  it("installs nothing when source verification fails", async () => {
    seed();
    provider = fakeSandboxProvider({
      files: healthySandboxFiles(),
      // A checkout that is not the prepared commit.
      results: { [HEAD]: { output: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\n" } },
    });

    const outcome = await runPipeline();

    expect(outcome).toMatchObject({ ok: false, failureCode: "source_integrity_failed" });
    expect(executedPhases()).toEqual([]);
  });

  it("continues past a phase whose script does not exist", async () => {
    seed();
    provider = fakeSandboxProvider({
      files: healthySandboxFiles({
        "product/package.json": JSON.stringify({
          name: "product",
          scripts: { build: "next build" },
        }),
      }),
      results: { [HEAD]: { output: `${FIXTURE_COMMIT_SHA}\n` } },
    });

    const outcome = await runPipeline();

    expect(outcome.ok).toBe(true);
    const steps = validationRun().steps;
    expect(steps.typecheck?.status).toBe("skipped");
    expect(steps.typecheck?.skipReason).toBe("script_not_present");
    expect(steps.build?.status).toBe("passed");
  });

  it("persists each phase as it completes, not only at the end", async () => {
    seed();
    const d = deps();

    await prepareValidationStep(d, OPERATION);
    await provisionSandboxStep(d, OPERATION);
    await verifySourceStep(d, OPERATION);
    await runPhaseStep(d, OPERATION, "install");

    // Mid-run: the row already describes what has happened, which is what the
    // panel renders and what re-entry reads.
    const run = validationRun();
    expect(run.status).toBe("running");
    expect(run.steps.install?.status).toBe("passed");
    expect(run.steps.typecheck).toBeUndefined();
    expect(run.stage).toBe("installing");
  });
});

describe("the build stays required (§6)", () => {
  it("refuses to pass a repository with no build script", async () => {
    seed();
    provider = fakeSandboxProvider({
      files: healthySandboxFiles({
        "product/package.json": JSON.stringify({
          name: "product",
          scripts: { test: "vitest run", typecheck: "tsc --noEmit" },
        }),
      }),
      results: { [HEAD]: { output: `${FIXTURE_COMMIT_SHA}\n` } },
    });

    const outcome = await runPipeline();

    // Typecheck and tests both passed. That is still not the claim this sprint
    // makes, and a skipped build is never a pass.
    expect(outcome).toMatchObject({ ok: false, failureCode: "validation_not_supported" });
    expect(validationRun().status).toBe("failed");
  });

  it("fails the run when the build fails, after everything else passed", async () => {
    seed();
    provider = fakeSandboxProvider({
      files: healthySandboxFiles(),
      results: {
        [HEAD]: { output: `${FIXTURE_COMMIT_SHA}\n` },
        "pnpm run build": { exitCode: 1, output: "Type error in app/page.tsx" },
      },
    });

    const outcome = await runPipeline();

    expect(outcome).toMatchObject({ ok: false, failureCode: "validation_checks_failed" });
    expect(validationRun().steps.build?.status).toBe("failed");
  });
});

describe("re-entry after a resumed workflow (§11, §20)", () => {
  /**
   * The load-bearing durable tests.
   *
   * A workflow can resume for reasons that have nothing to do with the work: a
   * persistence error, a provider hiccup, a redeploy. If resuming meant
   * re-running, a validation that had already spent 84 seconds on the
   * customer's test suite would spend them again — and could report a
   * *different* verdict for the same artifact on the same filesystem.
   */
  it.each(PHASES)("does not re-run %s when it is already persisted", async (phase) => {
    seed();
    const d = deps();

    await prepareValidationStep(d, OPERATION);
    await provisionSandboxStep(d, OPERATION);
    await verifySourceStep(d, OPERATION);

    // Run every phase up to and including the one under test.
    for (const candidate of PHASES) {
      await runPhaseStep(d, OPERATION, candidate);
      if (candidate === phase) break;
    }

    const before = provider.commands().length;

    // The workflow resumes and re-enters the same phase.
    const replay = await runPhaseStep(d, OPERATION, phase);

    expect(replay.ok).toBe(true);
    expect(provider.commands()).toHaveLength(before);
  });

  it("does not re-verify the source when integrity is already recorded", async () => {
    seed();
    const d = deps();

    await prepareValidationStep(d, OPERATION);
    await provisionSandboxStep(d, OPERATION);
    await verifySourceStep(d, OPERATION);

    const before = provider.commands().length;
    await verifySourceStep(d, OPERATION);

    expect(provider.commands()).toHaveLength(before);
  });

  it("does not provision a second sandbox when the provision step replays", async () => {
    seed();
    const d = deps();

    await prepareValidationStep(d, OPERATION);
    await provisionSandboxStep(d, OPERATION);
    await verifySourceStep(d, OPERATION);
    await provisionSandboxStep(d, OPERATION);

    expect(provider.createCount()).toBe(1);
  });

  it("adopts the sandbox a killed provision step already created", async () => {
    /**
     * The hole in the naive version of the provisioning step.
     *
     * The sandbox name is deterministic per attempt, so a provision step that
     * created the sandbox and then died leaves a live sandbox whose name
     * `create` refuses — and the retry would report `sandbox_unavailable`,
     * doomed by its own successful provisioning. A near-identical failure cost
     * a real dogfood run when the name came from the validation identity.
     */
    seed();
    const d = deps();
    await prepareValidationStep(d, OPERATION);

    // First attempt creates the sandbox, then the step "dies" before anything
    // is recorded — so no phase state exists and the guard does not fire.
    await provisionSandboxStep(d, OPERATION);
    const replay = await provisionSandboxStep(d, OPERATION);

    expect(replay.ok).toBe(true);
    expect(provider.createCount()).toBe(1);

    // And the run continues normally on that same sandbox, rather than being
    // doomed by its own successful provisioning.
    const verified = await verifySourceStep(d, OPERATION);
    expect(verified.ok).toBe(true);
  });

  it("does not claim a second validation when the prepare step replays", async () => {
    seed();
    const d = deps();

    await prepareValidationStep(d, OPERATION);
    await prepareValidationStep(d, OPERATION);

    expect(db.rows("validation_runs")).toHaveLength(1);
  });

  it("runs no repository command when the finalize step is retried", async () => {
    seed();
    const d = deps();
    await runPipeline();

    const before = provider.commands().length;
    const cleanup: CleanupRecord = {
      cleanup: "not_provisioned",
      runtime: null,
      sandboxDurationMs: null,
      usage: null,
    };

    const replay = await finalizeValidationStep(d, OPERATION, null, cleanup);

    expect(replay).toMatchObject({ ok: true, status: "passed" });
    expect(provider.commands()).toHaveLength(before);
    // And exactly one usage record, however many times finalize runs (§18).
    expect(db.rows("sandbox_usage_events")).toHaveLength(1);
  });

  it("keeps a terminal verdict when finalize is re-entered with a different one", async () => {
    /**
     * Added because a mutation survived.
     *
     * Deleting the terminal-replay guard broke no test: `completeValidationRun`
     * is scoped to `status = 'running'`, so a replay writes nothing and the
     * usage ledger stays correct. The database was doing the work.
     *
     * What the database does *not* protect is the value this step returns. A
     * finalize retried after a transient throw arrives with
     * `failureCode = "validation_run_failed"`, and without the guard it would
     * recompute a verdict from that argument and report failure for a run the
     * database records as passed — completing the operation as failed while its
     * result says otherwise. The row and the operation must not disagree.
     */
    seed();
    const d = deps();
    await runPipeline();
    expect(validationRun().status).toBe("passed");

    const replay = await finalizeValidationStep(d, OPERATION, "validation_run_failed", {
      cleanup: "not_provisioned",
      runtime: null,
      sandboxDurationMs: null,
      usage: null,
    });

    expect(replay).toMatchObject({ ok: true, status: "passed" });
    expect(validationRun().status).toBe("passed");
    expect(db.rows("sandbox_usage_events")).toHaveLength(1);
  });

  it("keeps the recorded failure when a failed phase is re-entered", async () => {
    seed();
    provider = fakeSandboxProvider({
      files: healthySandboxFiles(),
      results: {
        [HEAD]: { output: `${FIXTURE_COMMIT_SHA}\n` },
        "pnpm run test": { exitCode: 1 },
      },
    });
    const d = deps();

    await prepareValidationStep(d, OPERATION);
    await provisionSandboxStep(d, OPERATION);
    await verifySourceStep(d, OPERATION);
    await runPhaseStep(d, OPERATION, "install");
    await runPhaseStep(d, OPERATION, "typecheck");
    await runPhaseStep(d, OPERATION, "test");

    const before = provider.commands().length;
    const replay = await runPhaseStep(d, OPERATION, "test");

    // Re-running to see whether a flaky suite fails differently this time is
    // how a verdict becomes a coin toss.
    expect(replay).toMatchObject({ ok: false, failureCode: "validation_checks_failed" });
    expect(provider.commands()).toHaveLength(before);
  });
});

describe("sandbox loss between phases (§12, §22)", () => {
  it.each([
    // Reconnect order: provision, verify, install, typecheck, test, build, cleanup.
    ["between install and typecheck", 4],
    ["between tests and build", 6],
  ])("fails as sandbox_lost when the sandbox disappears %s", async (_label, reconnectIndex) => {
    seed();
    provider = fakeSandboxProvider({
      files: healthySandboxFiles(),
      results: { [HEAD]: { output: `${FIXTURE_COMMIT_SHA}\n` } },
      loseSandboxBeforeReconnect: reconnectIndex,
    });

    const outcome = await runPipeline();

    expect(outcome).toMatchObject({ ok: false, failureCode: "sandbox_lost" });
    expect(validationRun().failure_code).toBe("sandbox_lost");
  });

  it("never creates a replacement sandbox mid-run", async () => {
    seed();
    provider = fakeSandboxProvider({
      files: healthySandboxFiles(),
      results: { [HEAD]: { output: `${FIXTURE_COMMIT_SHA}\n` } },
      loseSandboxBeforeReconnect: 4,
    });

    await runPipeline();

    // `node_modules` went with the old VM. Continuing on a new one would answer
    // a question about a tree that never existed.
    expect(provider.createCount()).toBe(1);
  });

  it("refuses a reconnected sandbox whose session is no longer running", async () => {
    seed();
    provider = fakeSandboxProvider({
      files: healthySandboxFiles(),
      results: { [HEAD]: { output: `${FIXTURE_COMMIT_SHA}\n` } },
      reconnectLiveness: "gone",
    });

    const outcome = await runPipeline();

    expect(outcome).toMatchObject({ ok: false, failureCode: "sandbox_lost" });
  });

  it("keeps the phases that did complete before the loss", async () => {
    seed();
    provider = fakeSandboxProvider({
      files: healthySandboxFiles(),
      results: { [HEAD]: { output: `${FIXTURE_COMMIT_SHA}\n` } },
      // Lost at the test phase, so install and typecheck already completed.
      loseSandboxBeforeReconnect: 5,
    });

    await runPipeline();

    const steps = validationRun().steps;
    expect(steps.install?.status).toBe("passed");
    expect(steps.typecheck?.status).toBe("passed");
    expect(steps.test).toBeUndefined();
  });
});

describe("refusing before spending (§34)", () => {
  it.each([
    ["a preparation that is still running", { preparedStatus: "preparing" }],
    ["a preparation that failed", { preparedStatus: "failed" }],
    ["a preparation with no commit", { commitSha: null }],
  ])("creates no sandbox for %s", async (_label, options) => {
    seed(options);

    const outcome = await runPipeline();

    expect(outcome.ok).toBe(false);
    expect(provider.createdWith()).toBeNull();
    expect(db.rows("validation_runs")).toHaveLength(0);
  });

  it("creates no sandbox when the repository connection cannot be resolved", async () => {
    seed();

    const outcome = await runPipeline({ resolveTarget: async () => null });

    expect(outcome).toMatchObject({ ok: false, failureCode: "repository_connection_invalid" });
    expect(provider.createdWith()).toBeNull();
  });

  it("creates no sandbox for an unsupported repository", async () => {
    seed();
    db.rows("repository_intelligence_snapshots")[0].result = fakeValidatableSnapshot({
      frameworks: [{ id: "django", name: "Django" }],
    });

    const outcome = await runPipeline();

    expect(outcome).toMatchObject({ ok: false, failureCode: "validation_not_supported" });
    expect(provider.createdWith()).toBeNull();
  });
});

describe("cleanup and failure handling (§13, §23, §36)", () => {
  it("stops the sandbox even when the result cannot be persisted", async () => {
    seed();
    const d = deps();
    await prepareValidationStep(d, OPERATION);
    await provisionSandboxStep(d, OPERATION);

    // The database goes away exactly at the moment a phase records itself.
    db.failNextWriteWith = { table: "validation_runs", message: "connection lost" };

    await verifySourceStep(d, OPERATION).catch(() => undefined);
    await cleanupSandboxStep(d, OPERATION);

    // The paid VM is gone regardless. A failed DB call must never leave one
    // running — and cleanup being its own step is what makes that true even
    // when the step before it died.
    expect(provider.stopped()).toBe(true);
  });

  it("stops the sandbox when the provider throws mid-run", async () => {
    seed();
    provider = fakeSandboxProvider({
      files: healthySandboxFiles(),
      results: { [HEAD]: { output: `${FIXTURE_COMMIT_SHA}\n` } },
      throwOn: "pnpm run build",
    });

    await runPipeline();

    expect(provider.stopped()).toBe(true);
    expect(validationRun().status).toBe("failed");
  });

  it("stops the sandbox after a phase failure, before the verdict is recorded", async () => {
    seed();
    provider = fakeSandboxProvider({
      files: healthySandboxFiles(),
      results: {
        [HEAD]: { output: `${FIXTURE_COMMIT_SHA}\n` },
        "pnpm run typecheck": { exitCode: 2 },
      },
    });

    await runPipeline();

    expect(provider.stopped()).toBe(true);
    expect(validationRun().cleanup_status).toBe("stopped");
  });

  it("reports nothing to clean up when provisioning never succeeded", async () => {
    seed();
    provider = fakeSandboxProvider({ files: healthySandboxFiles(), failCreate: true });

    const outcome = await runPipeline();

    expect(outcome).toMatchObject({ ok: false, failureCode: "sandbox_unavailable" });
    expect(validationRun().cleanup_status).toBe("not_provisioned");
  });

  it("closes an abandoned run so the UI is not left waiting", async () => {
    seed();
    const d = deps();
    await prepareValidationStep(d, OPERATION);

    await failValidationStep(d, OPERATION, "validation_run_failed");

    expect(validationRun().status).toBe("failed");
    expect(db.rows("operation_runs")[0].status).toBe("failed");
  });
});

describe("stages are announced on the rows the UI reads (§4)", () => {
  it("moves the run and the operation through the same phase stages", async () => {
    seed();
    const d = deps();

    const seen: string[] = [];
    await prepareValidationStep(d, OPERATION);
    await provisionSandboxStep(d, OPERATION);
    seen.push(validationRun().stage);
    await verifySourceStep(d, OPERATION);
    seen.push(validationRun().stage);

    for (const phase of PHASES) {
      await runPhaseStep(d, OPERATION, phase);
      seen.push(validationRun().stage);
    }

    expect(seen).toEqual([
      "provisioning",
      "securing_sandbox",
      "installing",
      "typechecking",
      "testing",
      "building",
    ]);
    // Both rows, because the panel polls the operation and renders the run.
    expect(db.rows("operation_runs")[0].stage).toBe("building");
  });
});

describe("no secrets reach the sandbox (§8, §31, §37)", () => {
  it("mints a clone credential only for the step that clones", async () => {
    seed();
    await runPipeline();

    // Exactly one resolution asked for a credential: provisioning. Every later
    // phase resolved a target without one, because the source is on disk by
    // then and a token would be exposure bought for nothing.
    expect(credentialRequests.filter(Boolean)).toHaveLength(1);
    expect(credentialRequests[0]).toBe(true);
  });

  it("passes the clone credential only as the clone credential", async () => {
    seed();
    await runPipeline();

    const created = provider.createdWith();
    expect(created?.source.kind === "git" ? created.source.credential?.password : undefined).toBe(CLONE_TOKEN);
    expect(JSON.stringify(created?.env)).not.toContain(CLONE_TOKEN);
  });

  it("never persists the credential anywhere", async () => {
    seed();
    await runPipeline();

    const everything = JSON.stringify([
      db.rows("validation_runs"),
      db.rows("sandbox_usage_events"),
      db.rows("audit_events"),
      db.rows("operation_runs"),
    ]);

    expect(everything).not.toContain(CLONE_TOKEN);
    expect(everything).not.toContain("x-access-token");
  });
});

describe("only a passing run keeps an artifact (Sprint 10B §5)", () => {
  /**
   * The whole reason capture is explicit rather than `persistent: true`. A
   * persistent sandbox snapshots on every stop — including the run whose build
   * just failed, and including one that stopped mid-scrub. Retaining a customer
   * filesystem must be a consequence of success, never of stopping.
   */
  it("captures nothing when the build failed", async () => {
    seed();
    provider = fakeSandboxProvider({
      files: healthySandboxFiles(),
      results: { "pnpm run build": { exitCode: 1, output: "Build error" } },
    });

    await runPipeline();

    expect(provider.snapshots()).toBe(0);
    expect(db.rows("validation_runs")[0].status).toBe("failed");
    expect(db.rows("validation_runs")[0].artifact_snapshot_id ?? null).toBeNull();
  });

  it("captures nothing when the tests failed", async () => {
    seed();
    provider = fakeSandboxProvider({
      files: healthySandboxFiles(),
      results: { "pnpm run test": { exitCode: 1 } },
    });

    await runPipeline();

    expect(provider.snapshots()).toBe(0);
  });

  it("records the artifact against a passing run", async () => {
    seed();
    await runPipeline();

    const run = db.rows("validation_runs")[0];
    expect(run.status).toBe("passed");
    expect(run.artifact_snapshot_id).toBe("snap_fake_1");
    // A retained artifact always has a deadline Vibe chose.
    expect(run.artifact_expires_at).toBeTruthy();
  });
});
