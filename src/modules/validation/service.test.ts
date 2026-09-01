import { beforeEach, describe, expect, it } from "vitest";
import { FakeDatabase, FakeExecutor, fakeSupabase } from "@/modules/operations/test-support";
import { VALIDATION_DEPTH_POLICY_VERSION, type ValidationDepth } from "./depth";
import { computeValidationIdentity } from "./identity";
import { SANDBOX_POLICY_VERSION, validationProfileVersionFor } from "./schema";
import { startChangeValidation } from "./service";
import { FIXTURE_COMMIT_SHA, fakeValidatableSnapshot } from "./test-support";

/**
 * Starting a validation (Sprint 10A §34, §35).
 *
 * Two families of test, and they are the two ways this can go expensively
 * wrong: someone validating an artifact that is not theirs, and one click
 * buying two microVMs.
 */

const USER = "user_1";
const OTHER_USER = "user_2";
const PROJECT = "project_1";
const OTHER_PROJECT = "project_2";
const PREPARED = "prepared_1";

let db: FakeDatabase;
let executor: FakeExecutor;

function identityFor(
  overrides: {
    commitSha?: string;
    policyVersion?: string;
    profileVersion?: string;
    depth?: ValidationDepth;
  } = {},
) {
  return computeValidationIdentity({
    preparedChangeId: PREPARED,
    preparedCommitSha: overrides.commitSha ?? FIXTURE_COMMIT_SHA,
    validationProfile: "nextjs_node_v1",
    validationProfileVersion: overrides.profileVersion ?? validationProfileVersionFor("nextjs_node_v1"),
    sandboxPolicyVersion: overrides.policyVersion ?? SANDBOX_POLICY_VERSION,
    // The fixture prepared change has no agent run behind it, so every trusted
    // lookup returns nothing and the resolver lands on its safe default.
    validationDepth: overrides.depth ?? "standard",
    validationDepthPolicyVersion: VALIDATION_DEPTH_POLICY_VERSION,
  });
}

function seed(options: { preparedStatus?: string; commitSha?: string | null; packageManager?: string } = {}) {
  db.seed("projects", { id: PROJECT, user_id: USER });
  db.seed("projects", { id: OTHER_PROJECT, user_id: OTHER_USER });

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
    files: [{ path: "src/app/robots.ts", contentHash: "a".repeat(64), bytes: 408 }],
  });

  db.seed("repository_intelligence_snapshots", {
    id: "snapshot_1",
    project_id: PROJECT,
    status: "completed",
    result: fakeValidatableSnapshot({ packageManager: options.packageManager }),
    created_at: "2026-08-12T00:00:00.000Z",
  });
}

function start(params: { userId?: string; projectId?: string; preparedChangeId?: string } = {}) {
  return startChangeValidation(fakeSupabase(db), executor, {
    projectId: params.projectId ?? PROJECT,
    userId: params.userId ?? USER,
    preparedChangeId: params.preparedChangeId ?? PREPARED,
  });
}

beforeEach(() => {
  db = new FakeDatabase();
  executor = new FakeExecutor();
});

describe("the happy path", () => {
  it("starts one durable operation for a validatable prepared change", async () => {
    seed();

    const outcome = await start();

    expect(outcome.kind).toBe("started");
    expect(executor.starts).toHaveLength(1);
    expect(executor.starts[0].operationType).toBe("change_validation");
  });

  it("records the prepared change as the operation's subject", async () => {
    seed();
    await start();

    const operation = db.rows("operation_runs")[0];
    expect(operation.subject_id).toBe(PREPARED);
    expect(operation.input_identity).toBe(identityFor());
  });
});

describe("authority (§34)", () => {
  it("refuses a project the caller does not own", async () => {
    seed();

    const outcome = await start({ userId: OTHER_USER });

    expect(outcome).toEqual({ kind: "failed", error: "project_not_found" });
    expect(executor.starts).toHaveLength(0);
  });

  it("refuses a prepared change belonging to another project", async () => {
    seed();
    db.seed("prepared_changes", {
      id: "prepared_other",
      project_id: OTHER_PROJECT,
      user_id: OTHER_USER,
      status: "prepared",
      commit_sha: "aaaaaaa",
      files: [],
    });

    // Scoped to the caller's project, so another tenant's artifact is
    // invisible rather than merely forbidden.
    const outcome = await start({ preparedChangeId: "prepared_other" });

    expect(outcome).toEqual({ kind: "failed", error: "prepared_change_not_ready" });
    expect(executor.starts).toHaveLength(0);
  });

  it.each([
    ["still preparing", { preparedStatus: "preparing" }],
    ["failed", { preparedStatus: "failed" }],
    ["prepared but with no commit", { commitSha: null }],
  ])("refuses a prepared change that is %s, without provisioning", async (_label, options) => {
    seed(options);

    const outcome = await start();

    expect(outcome).toEqual({ kind: "failed", error: "prepared_change_not_ready" });
    expect(executor.starts).toHaveLength(0);
  });

  it("refuses an unsupported project before spending anything", async () => {
    seed({ packageManager: "bun" });

    const outcome = await start();

    expect(outcome).toEqual({ kind: "failed", error: "validation_not_supported" });
    // The important half: no operation, so no workflow, so no sandbox.
    expect(executor.starts).toHaveLength(0);
    expect(db.rows("operation_runs")).toHaveLength(0);
  });

  it("takes only a project and a prepared change from the caller (§27)", async () => {
    // Everything else — repository, commit, provider, runtime, commands,
    // network policy, package manager, working directory — is re-derived from
    // server state inside the durable step. A parameter that does not exist
    // cannot be tampered with.
    seed();
    await start();

    const operation = db.rows("operation_runs")[0];
    const serialized = JSON.stringify(operation);

    expect(serialized).not.toContain("github.com");
    expect(serialized).not.toContain("pnpm");
    expect(serialized).not.toContain("deny_all");
    expect(serialized).not.toContain("vercel_sandbox");
  });
});

describe("artifact-centric eligibility (§28)", () => {
  it("validates a prepared change even when newer intelligence exists", async () => {
    seed();
    // A second, newer snapshot — the exact condition that blocks *preparation*.
    db.seed("repository_intelligence_snapshots", {
      id: "snapshot_2",
      project_id: PROJECT,
      status: "completed",
      result: fakeValidatableSnapshot(),
      created_at: "2026-08-13T00:00:00.000Z",
    });

    // Preparation asks "should this change exist?" — a question about now.
    // Validation asks "does this commit build?" — a question about an artifact,
    // and an artifact's build result does not expire.
    const outcome = await start();

    expect(outcome.kind).toBe("started");
  });
});

describe("idempotency (§21, §35)", () => {
  it("reuses a validation that already passed for this identity", async () => {
    seed();
    db.seed("validation_runs", {
      id: "validation_1",
      project_id: PROJECT,
      user_id: USER,
      prepared_change_id: PREPARED,
      operation_run_id: "operation_old",
      validation_identity: identityFor(),
      status: "passed",
      stage: "completed",
      steps: {},
      validation_profile: "nextjs_node_v1",
      validation_profile_version: validationProfileVersionFor("nextjs_node_v1"),
      sandbox_policy_version: SANDBOX_POLICY_VERSION,
      sandbox_provider: "vercel_sandbox",
      package_manager: "pnpm",
      prepared_commit_sha: FIXTURE_COMMIT_SHA,
      artifact_snapshot_id: "snap_validation_1",
      artifact_expires_at: "2099-01-01T00:00:00.000Z",
      artifact_deleted_at: null,
    });

    const outcome = await start();

    expect(outcome).toEqual({ kind: "reused", validationRunId: "validation_1", status: "passed" });
    expect(executor.starts).toHaveLength(0);
  });

  it("reuses a pass regardless of any artifact state", async () => {
    /*
     * The inverse of what these tests asserted before Sprint 0114, and worth
     * reading as such.
     *
     * Reuse used to require a *usable captured artifact*, because a preview
     * booted from one — so a pass whose capture failed, expired or was deleted
     * had to be re-runnable, or Preview's "Validate again" could never recover
     * it. The first real 10B dogfood hit exactly that: snapshot() threw, and
     * the next click was answered with "nothing was re-run".
     *
     * Nothing captures an artifact any more (ADR 0064). Keeping those
     * predicates would make all three false for every run, so every validation
     * would re-run a check it had already passed — the same defect pointing the
     * other way, and costing a sandbox every time.
     */
    seed();
    db.seed("validation_runs", {
      id: "validation_without_artifact",
      project_id: PROJECT,
      user_id: USER,
      prepared_change_id: PREPARED,
      operation_run_id: "operation_old",
      validation_identity: identityFor(),
      status: "passed",
      stage: "completed",
      steps: {},
      validation_profile: "nextjs_node_v1",
      validation_profile_version: validationProfileVersionFor("nextjs_node_v1"),
      sandbox_policy_version: SANDBOX_POLICY_VERSION,
      sandbox_provider: "vercel_sandbox",
      package_manager: "pnpm",
      prepared_commit_sha: FIXTURE_COMMIT_SHA,
      artifact_snapshot_id: null,
      artifact_expires_at: null,
      artifact_deleted_at: null,
      created_at: new Date().toISOString(),
    });

    const outcome = await start();

    expect(outcome).toMatchObject({ kind: "reused" });
    expect(executor.starts).toHaveLength(0);
  });


  it("does not reuse a previous failure", async () => {
    // A failed build is not a durable fact about the artifact — the registry
    // may have blipped. Refusing to re-run would strand the user.
    seed();
    db.seed("validation_runs", {
      id: "validation_failed",
      project_id: PROJECT,
      user_id: USER,
      prepared_change_id: PREPARED,
      operation_run_id: "operation_old",
      validation_identity: identityFor(),
      status: "failed",
      stage: "building",
      steps: {},
      validation_profile: "nextjs_node_v1",
      validation_profile_version: validationProfileVersionFor("nextjs_node_v1"),
      sandbox_policy_version: SANDBOX_POLICY_VERSION,
      sandbox_provider: "vercel_sandbox",
      package_manager: "pnpm",
      prepared_commit_sha: FIXTURE_COMMIT_SHA,
    });

    expect((await start()).kind).toBe("started");
  });

  it("returns the running operation instead of starting a second", async () => {
    seed();
    db.seed("operation_runs", {
      id: "operation_active",
      project_id: PROJECT,
      user_id: USER,
      operation_type: "change_validation",
      status: "running",
      stage: "installing",
      input_identity: identityFor(),
      subject_id: PREPARED,
    });

    const outcome = await start();

    expect(outcome.kind).toBe("running");
    expect(executor.starts).toHaveLength(0);
  });

  it("buys one sandbox for a double click", async () => {
    seed();

    const [first, second] = await Promise.all([start(), start()]);

    const kinds = [first.kind, second.kind].sort();
    expect(kinds).toEqual(["running", "started"]);
    expect(executor.starts).toHaveLength(1);
    expect(db.rows("operation_runs")).toHaveLength(1);
  });
});

describe("validation identity (§21, §22, §35)", () => {
  it("changes when the sandbox policy version changes", async () => {
    // The point of putting policy in the identity: a stored `passed` describes
    // commands that ran under specific rules. Tighten the rules and the old
    // result no longer describes what would happen now.
    // Deliberately a version that is neither the current one nor a past one, so
    // this test keeps testing the mechanism rather than a particular bump.
    expect(identityFor({ policyVersion: "sandbox-policy-vNext" })).not.toBe(identityFor());
  });

  it("changes when the validation profile version changes", () => {
    expect(identityFor({ profileVersion: "nextjs-node-v2" })).not.toBe(identityFor());
  });

  it("changes when the prepared commit changes", () => {
    expect(identityFor({ commitSha: "0".repeat(40) })).not.toBe(identityFor());
  });

  it("does not reuse a pass recorded under an older policy", async () => {
    seed();
    db.seed("validation_runs", {
      id: "validation_old_policy",
      project_id: PROJECT,
      user_id: USER,
      prepared_change_id: PREPARED,
      operation_run_id: "operation_old",
      validation_identity: identityFor({ policyVersion: "sandbox-policy-v0" }),
      status: "passed",
      stage: "completed",
      steps: {},
      validation_profile: "nextjs_node_v1",
      validation_profile_version: validationProfileVersionFor("nextjs_node_v1"),
      sandbox_policy_version: "sandbox-policy-v0",
      sandbox_provider: "vercel_sandbox",
      package_manager: "pnpm",
      prepared_commit_sha: FIXTURE_COMMIT_SHA,
      artifact_snapshot_id: "snap_old_policy",
      artifact_expires_at: "2099-01-01T00:00:00.000Z",
      artifact_deleted_at: null,
    });

    expect((await start()).kind).toBe("started");
  });
});

describe("integrity policy versioning (post-dogfood v1 → v2)", () => {
  /**
   * The first passing run recorded `pnpm-lock.yaml` as unverified, because a
   * 256 KB per-file budget silently excluded a ~310 KB lockfile — the one
   * build-identity file that decides which code gets installed. "Validated"
   * under v1 therefore meant something materially weaker than it looked.
   *
   * The budget and the truncation semantics both changed, so the claim changed,
   * so the version changed. These tests exist to stop that being reversible by
   * accident.
   */
  it("carries a policy version distinct from the one the first dogfood ran under", () => {
    expect(SANDBOX_POLICY_VERSION).not.toBe("sandbox-policy-v1");
  });

  it("leaves the command profile untouched", () => {
    // Integrity rules changed; which commands run did not. Bumping the profile
    // too would invalidate reuse for a reason that did not occur.
    expect(validationProfileVersionFor("nextjs_node_v1")).toBe("nextjs-node-v1");
  });

  it("produces a different validation identity for the same artifact", () => {
    const underV1 = computeValidationIdentity({
      preparedChangeId: PREPARED,
      preparedCommitSha: FIXTURE_COMMIT_SHA,
      validationProfile: "nextjs_node_v1",
      validationProfileVersion: validationProfileVersionFor("nextjs_node_v1"),
      sandboxPolicyVersion: "sandbox-policy-v1",
      validationDepth: "standard",
      validationDepthPolicyVersion: VALIDATION_DEPTH_POLICY_VERSION,
    });

    expect(identityFor()).not.toBe(underV1);
  });

  it("does not reuse the first dogfood's pass under the new policy", async () => {
    // The exact scenario: run 61b8c9f1 passed under v1 with an unverified
    // lockfile. Reusing it now would report a v1 result as though it had been
    // checked under v2's stronger rules.
    seed();
    db.seed("validation_runs", {
      id: "validation_v1_pass",
      project_id: PROJECT,
      user_id: USER,
      prepared_change_id: PREPARED,
      operation_run_id: "operation_old",
      validation_identity: computeValidationIdentity({
        preparedChangeId: PREPARED,
        preparedCommitSha: FIXTURE_COMMIT_SHA,
        validationProfile: "nextjs_node_v1",
        validationProfileVersion: validationProfileVersionFor("nextjs_node_v1"),
        sandboxPolicyVersion: "sandbox-policy-v1",
        validationDepth: "standard",
        validationDepthPolicyVersion: VALIDATION_DEPTH_POLICY_VERSION,
      }),
      status: "passed",
      stage: "completed",
      steps: {},
      validation_profile: "nextjs_node_v1",
      validation_profile_version: validationProfileVersionFor("nextjs_node_v1"),
      sandbox_policy_version: "sandbox-policy-v1",
      sandbox_provider: "vercel_sandbox",
      package_manager: "pnpm",
      prepared_commit_sha: FIXTURE_COMMIT_SHA,
    });

    const outcome = await start();

    expect(outcome.kind).toBe("started");
  });

  it("leaves the historical v1 row exactly as it was", async () => {
    seed();
    db.seed("validation_runs", {
      id: "validation_v1_pass",
      project_id: PROJECT,
      user_id: USER,
      prepared_change_id: PREPARED,
      operation_run_id: "operation_old",
      validation_identity: "v1identity".padEnd(64, "0"),
      status: "passed",
      stage: "completed",
      steps: {},
      validation_profile: "nextjs_node_v1",
      validation_profile_version: validationProfileVersionFor("nextjs_node_v1"),
      sandbox_policy_version: "sandbox-policy-v1",
      sandbox_provider: "vercel_sandbox",
      package_manager: "pnpm",
      prepared_commit_sha: FIXTURE_COMMIT_SHA,
    });

    await start();

    // History is not rewritten. The old row still says what it meant when it
    // was written, which is the whole reason the version is stored per run.
    const historical = db.rows("validation_runs").find((row) => row.id === "validation_v1_pass");
    expect(historical?.sandbox_policy_version).toBe("sandbox-policy-v1");
    expect(historical?.status).toBe("passed");
  });

  it("still reuses a pass recorded under the current policy", async () => {
    // The bump must not break reuse generally — only across the change.
    seed();
    db.seed("validation_runs", {
      id: "validation_v2_pass",
      project_id: PROJECT,
      user_id: USER,
      prepared_change_id: PREPARED,
      operation_run_id: "operation_old",
      validation_identity: identityFor(),
      status: "passed",
      stage: "completed",
      steps: {},
      validation_profile: "nextjs_node_v1",
      validation_profile_version: validationProfileVersionFor("nextjs_node_v1"),
      sandbox_policy_version: SANDBOX_POLICY_VERSION,
      sandbox_provider: "vercel_sandbox",
      package_manager: "pnpm",
      prepared_commit_sha: FIXTURE_COMMIT_SHA,
      artifact_snapshot_id: "snap_validation_v2",
      artifact_expires_at: "2099-01-01T00:00:00.000Z",
      artifact_deleted_at: null,
    });

    expect(await start()).toEqual({
      kind: "reused",
      validationRunId: "validation_v2_pass",
      status: "passed",
    });
  });
});
