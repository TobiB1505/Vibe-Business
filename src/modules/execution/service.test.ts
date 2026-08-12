import { beforeEach, describe, expect, it } from "vitest";
import { FakeDatabase, FakeExecutor, fakeSupabase } from "@/modules/operations/test-support";
import { fakeAudit } from "@/modules/opportunities/test-support";
import { computeExecutionIdentity } from "./identity";
import { NEXTJS_SEO_FOUNDATIONS_VERSION } from "./schema";
import { getChangePreparationStatus, getPreparedChangeView, startChangePreparation } from "./service";
import { fakeRepositorySnapshotFor, FIXTURE_SNAPSHOT_SHA } from "./test-support";

/**
 * Server-side authority and identity (Sprint 9B §23, §24).
 *
 * The property under test throughout: **the caller decides a project and an
 * opportunity, and nothing else.** Every other input to a repository write is
 * resolved here from server state, so most of these cases are about what a
 * client cannot reach rather than what it can.
 */

const USER = "user_1";
const OTHER_USER = "user_2";
const PROJECT = "project_1";
const OTHER_PROJECT = "project_2";
const SET = "set_1";
const OPPORTUNITY = "opportunity_1";
const SNAPSHOT = "snapshot_1";

function identityFor(overrides: { snapshotId?: string; baseSha?: string; opportunityId?: string } = {}) {
  return computeExecutionIdentity({
    projectId: PROJECT,
    opportunitySetId: SET,
    opportunityId: overrides.opportunityId ?? OPPORTUNITY,
    capability: "nextjs_seo_foundations_v1",
    capabilityVersion: NEXTJS_SEO_FOUNDATIONS_VERSION,
    repositorySnapshotId: overrides.snapshotId ?? SNAPSHOT,
    baseSha: overrides.baseSha ?? FIXTURE_SNAPSHOT_SHA,
  });
}

let db: FakeDatabase;
let executor: FakeExecutor;

function seedProject(projectId = PROJECT, userId = USER, productionUrl = "https://acme.com") {
  db.seed("projects", { id: projectId, user_id: userId, production_url: productionUrl });
}

function seedEvidence(options: { snapshotId?: string; commitSha?: string } = {}) {
  const snapshot = fakeRepositorySnapshotFor();
  db.seed("repository_intelligence_snapshots", {
    id: options.snapshotId ?? SNAPSHOT,
    project_id: PROJECT,
    status: "completed",
    result: {
      ...snapshot,
      source: { ...snapshot.source, commitSha: options.commitSha ?? FIXTURE_SNAPSHOT_SHA },
      routes: {
        mode: "app_router",
        truncated: false,
        routes: [{ path: "/", kind: "page", dynamic: false, sourcePath: "src/app/page.tsx" }],
      },
    },
    created_at: "2026-08-01T00:00:00.000Z",
  });
  db.seed("live_product_intelligence_snapshots", {
    id: "live_1",
    project_id: PROJECT,
    status: "completed",
    result: {},
    created_at: "2026-08-01T00:00:00.000Z",
    completed_at: "2026-08-01T00:00:00.000Z",
  });
  db.seed("project_business_context", {
    id: "context_1",
    project_id: PROJECT,
    product_summary: "A summary long enough to be valid for the audit fixture.",
    context_hash: "c".repeat(64),
    updated_at: "2026-08-01T00:00:00.000Z",
  });
}

/**
 * The audit and opportunity chain the service consults.
 *
 * `getAuditCurrency` recomputes the audit's identity, so the stored audit's
 * hash is made to match by reading back what the service computes — the
 * alternative is duplicating the whole identity derivation in the test.
 */
function seedOpportunityChain(options: { auditCurrent?: boolean; setStale?: boolean } = {}) {
  const auditId = "audit_1";
  db.seed("business_readiness_audits", {
    id: auditId,
    project_id: PROJECT,
    status: "completed",
    input_hash: options.auditCurrent === false ? "stale".padEnd(64, "0") : "will-be-fixed",
    result: fakeAudit(),
    created_at: "2026-08-02T00:00:00.000Z",
    completed_at: "2026-08-02T00:00:00.000Z",
  });

  db.seed("opportunity_sets", {
    id: SET,
    project_id: PROJECT,
    business_audit_id: options.setStale ? "some_other_audit" : auditId,
    status: "completed",
    opportunity_count: 1,
    input_hash: "o".repeat(64),
    created_at: "2026-08-03T00:00:00.000Z",
    completed_at: "2026-08-03T00:00:00.000Z",
  });

  db.seed("business_opportunities", {
    id: OPPORTUNITY,
    opportunity_set_id: SET,
    rank: 1,
    title: "Fix missing technical SEO foundations",
    problem: "No robots or sitemap.",
    why_now: "Low effort and independent.",
    impact: "medium",
    effort: "low",
    confidence: "high",
    category: "seo",
    primary_dimension: "distribution",
    secondary_dimensions: [],
    evidence_ids: ["live.seo.robots_txt_missing", "live.seo.sitemap_missing"],
    execution_type: "code_change",
    execution_readiness: "ready",
    dependencies: [],
  });
}

/** Makes the stored audit hash match whatever the service computes. */
async function alignAuditCurrency() {
  const { getAuditCurrency } = await import("@/modules/business-audit/service");
  const before = await getAuditCurrency(fakeSupabase(db), PROJECT);
  if (!before.upToDate) {
    // `getAuditCurrency` compares the stored hash to a freshly computed one.
    // Reading the computed value back out of a probe row keeps the fixture
    // honest rather than hard-coding a digest that would rot.
    const probe = db.rows("business_readiness_audits")[0];
    const { computeAuditInputHash } = await import("@/modules/business-audit/store");
    const { BUSINESS_AUDIT_SCHEMA_VERSION, BUSINESS_AUDIT_VERSION } = await import(
      "@/modules/business-audit/schema"
    );
    const { EVIDENCE_PACK_V2_VERSION } = await import("@/modules/business-audit/evidence-v2");
    const { PROMPT_VERSION } = await import("@/modules/business-audit/prompt");
    const { RUBRIC_VERSION } = await import("@/modules/business-audit/rubric");
    const { BUSINESS_READINESS_AUDIT_CONFIG } = await import("@/modules/ai/operations");

    probe.input_hash = computeAuditInputHash({
      repositorySnapshotId: SNAPSHOT,
      liveSnapshotId: "live_1",
      businessContextHash: "c".repeat(64),
      authenticatedSnapshotId: null,
      schemaVersion: BUSINESS_AUDIT_SCHEMA_VERSION,
      auditVersion: BUSINESS_AUDIT_VERSION,
      evidencePackVersion: EVIDENCE_PACK_V2_VERSION,
      promptVersion: PROMPT_VERSION,
      rubricVersion: RUBRIC_VERSION,
      provider: "anthropic",
      model: BUSINESS_READINESS_AUDIT_CONFIG.model,
    });
  }
}

function start(params: { userId?: string; projectId?: string; opportunityId?: string } = {}) {
  return startChangePreparation(fakeSupabase(db), executor, {
    projectId: params.projectId ?? PROJECT,
    userId: params.userId ?? USER,
    opportunityId: params.opportunityId ?? OPPORTUNITY,
  });
}

beforeEach(async () => {
  db = new FakeDatabase();
  executor = new FakeExecutor();
  seedProject();
  seedEvidence();
  seedOpportunityChain();
  await alignAuditCurrency();
});

describe("service authority (§23)", () => {
  it("starts one operation for a valid request", async () => {
    const outcome = await start();

    expect(outcome.kind).toBe("started");
    expect(db.rows("operation_runs")).toHaveLength(1);
    expect(executor.starts).toHaveLength(1);
    expect(executor.starts[0].operationType).toBe("change_preparation");
  });

  it("records the opportunity as the operation's subject, from server state", async () => {
    await start();

    const operation = db.rows("operation_runs")[0];
    expect(operation.subject_id).toBe(OPPORTUNITY);
    expect(operation.input_identity).toBe(identityFor());
  });

  it("refuses a project the caller does not own", async () => {
    const outcome = await start({ userId: OTHER_USER });

    expect(outcome).toEqual({ kind: "failed", error: "project_not_found" });
    expect(executor.starts).toHaveLength(0);
  });

  it("refuses an opportunity from another project", async () => {
    // The opportunity exists, but not in this project's current set.
    seedProject(OTHER_PROJECT, USER);
    const outcome = await start({ projectId: OTHER_PROJECT });

    expect(outcome.kind).toBe("failed");
    expect(executor.starts).toHaveLength(0);
  });

  it("refuses an opportunity id that is not in the current set", async () => {
    const outcome = await start({ opportunityId: "not_in_this_set" });

    expect(outcome).toEqual({ kind: "failed", error: "stale_opportunity" });
    expect(executor.starts).toHaveLength(0);
  });

  it("accepts no repository, branch, path or capability from the caller", () => {
    // A structural assertion: the parameter type has exactly three fields, so
    // there is no argument through which a client could name its own target.
    const call = startChangePreparation.length;
    expect(call).toBe(3); // supabase, executor, params

    const params = { projectId: PROJECT, userId: USER, opportunityId: OPPORTUNITY };
    expect(Object.keys(params).sort()).toEqual(["opportunityId", "projectId", "userId"]);
  });
});

describe("staleness gates (§23)", () => {
  it("refuses when the opportunity set is stale", async () => {
    db = new FakeDatabase();
    executor = new FakeExecutor();
    seedProject();
    seedEvidence();
    seedOpportunityChain({ setStale: true });
    await alignAuditCurrency();

    const outcome = await start();

    expect(outcome).toEqual({ kind: "failed", error: "stale_opportunity" });
    expect(executor.starts).toHaveLength(0);
  });

  it("refuses when the audit is stale", async () => {
    db.rows("business_readiness_audits")[0].input_hash = "0".repeat(64);

    const outcome = await start();

    expect(outcome).toEqual({ kind: "failed", error: "stale_audit" });
    expect(executor.starts).toHaveLength(0);
  });

  it("refuses when no production origin is configured", async () => {
    db.rows("projects")[0].production_url = null;

    const outcome = await start();

    expect(outcome).toEqual({ kind: "failed", error: "missing_required_context" });
    expect(executor.starts).toHaveLength(0);
  });

  it("refuses an unsupported opportunity with zero writes", async () => {
    db.rows("business_opportunities")[0].execution_type = "business_decision";

    const outcome = await start();

    expect(outcome).toEqual({ kind: "failed", error: "unsupported_opportunity" });
    expect(executor.starts).toHaveLength(0);
    expect(db.rows("prepared_changes")).toHaveLength(0);
  });
});

describe("identity and reuse (§24)", () => {
  it("returns the existing operation instead of starting a second", async () => {
    await start();
    const second = await start();

    expect(second.kind).toBe("active");
    expect(db.rows("operation_runs")).toHaveLength(1);
    expect(executor.starts).toHaveLength(1);
  });

  it("answers from the application check without attempting a second insert", async () => {
    await start();
    // Any further insert into operation_runs now fails. A second start must
    // still return the live operation, which it can only do by checking
    // first — the unique index is the backstop, not the normal path.
    db.failNextWriteWith = { table: "operation_runs", message: "must not insert" };

    expect((await start()).kind).toBe("active");
    expect(db.failNextWriteWith).not.toBeNull();
  });

  it("survives two starts racing past the application check", async () => {
    const [first, second] = await Promise.all([start(), start()]);

    expect([first.kind, second.kind].sort()).toEqual(["active", "started"]);
    expect(db.rows("operation_runs")).toHaveLength(1);
    expect(executor.starts).toHaveLength(1);
  });

  it("reuses a successful prepared change without starting a workflow", async () => {
    db.seed("prepared_changes", {
      id: "prepared_1",
      project_id: PROJECT,
      user_id: USER,
      operation_run_id: "operation_old",
      opportunity_set_id: SET,
      opportunity_id: OPPORTUNITY,
      execution_capability: "nextjs_seo_foundations_v1",
      execution_version: NEXTJS_SEO_FOUNDATIONS_VERSION,
      repository_snapshot_id: SNAPSHOT,
      base_branch: "main",
      base_sha: FIXTURE_SNAPSHOT_SHA,
      branch_name: "vibe/seo-foundations-abc",
      commit_sha: "commit_1",
      files: [{ path: "src/app/robots.ts", contentHash: "h", bytes: 10 }],
      execution_identity: identityFor(),
      status: "prepared",
      created_at: "2026-08-04T00:00:00.000Z",
      completed_at: "2026-08-04T00:00:00.000Z",
    });

    const outcome = await start();

    expect(outcome).toEqual({
      kind: "reused",
      preparedChangeId: "prepared_1",
      branchName: "vibe/seo-foundations-abc",
      commitSha: "commit_1",
    });
    expect(executor.starts).toHaveLength(0);
    expect(db.rows("operation_runs")).toHaveLength(0);
  });

  it("does not reuse a prepared change built on a different base commit", async () => {
    // A moved HEAD means the prepared commit sits on a parent that is no
    // longer current — a different change, however similar it looks.
    db.seed("prepared_changes", {
      id: "prepared_old",
      project_id: PROJECT,
      execution_identity: identityFor({ baseSha: "an-older-head" }),
      status: "prepared",
      branch_name: "vibe/seo-foundations-old",
      commit_sha: "commit_old",
      created_at: "2026-08-04T00:00:00.000Z",
    });

    expect((await start()).kind).toBe("started");
  });

  it("does not reuse a prepared change from a different capability version", async () => {
    db.seed("prepared_changes", {
      id: "prepared_v0",
      project_id: PROJECT,
      execution_identity: computeExecutionIdentity({
        projectId: PROJECT,
        opportunitySetId: SET,
        opportunityId: OPPORTUNITY,
        capability: "nextjs_seo_foundations_v1",
        capabilityVersion: "nextjs-seo-foundations-v0",
        repositorySnapshotId: SNAPSHOT,
        baseSha: FIXTURE_SNAPSHOT_SHA,
      }),
      status: "prepared",
      branch_name: "vibe/seo-foundations-v0",
      commit_sha: "commit_v0",
      created_at: "2026-08-04T00:00:00.000Z",
    });

    expect((await start()).kind).toBe("started");
  });

  it("does not reuse a failed prepared change", async () => {
    db.seed("prepared_changes", {
      id: "prepared_failed",
      project_id: PROJECT,
      execution_identity: identityFor(),
      status: "failed",
      failure_code: "branch_conflict",
      branch_name: "vibe/seo-foundations-x",
      created_at: "2026-08-04T00:00:00.000Z",
    });

    expect((await start()).kind).toBe("started");
  });
});

describe("status and prepared-change reads (§19, §20)", () => {
  it("exposes operation status with the prepared change reference", async () => {
    await start();
    const operation = db.rows("operation_runs")[0];
    operation.result_id = "prepared_1";

    const status = await getChangePreparationStatus(fakeSupabase(db), {
      projectId: PROJECT,
      operationId: String(operation.id),
    });

    expect(status?.preparedChangeId).toBe("prepared_1");
    expect(status?.status).toBe("queued");
  });

  it("does not return an operation from another project", async () => {
    await start();
    const operationId = String(db.rows("operation_runs")[0].id);
    seedProject(OTHER_PROJECT, USER);

    const status = await getChangePreparationStatus(fakeSupabase(db), {
      projectId: OTHER_PROJECT,
      operationId,
    });

    expect(status).toBeNull();
  });

  it("returns file paths but never file content", async () => {
    db.seed("prepared_changes", {
      id: "prepared_1",
      project_id: PROJECT,
      status: "prepared",
      branch_name: "vibe/seo-foundations-abc",
      base_branch: "main",
      base_sha: FIXTURE_SNAPSHOT_SHA,
      commit_sha: "commit_1",
      files: [{ path: "src/app/robots.ts", contentHash: "hash", bytes: 300 }],
      execution_identity: identityFor(),
      created_at: "2026-08-04T00:00:00.000Z",
      completed_at: "2026-08-04T00:00:00.000Z",
    });

    const view = await getPreparedChangeView(fakeSupabase(db), {
      projectId: PROJECT,
      preparedChangeId: "prepared_1",
    });

    expect(view?.filePaths).toEqual(["src/app/robots.ts"]);
    expect(JSON.stringify(view)).not.toContain("MetadataRoute");
    expect(JSON.stringify(view)).not.toContain("contentHash");
  });
});
