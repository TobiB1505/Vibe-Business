import { beforeEach, describe, expect, it } from "vitest";
import { OPPORTUNITY_GENERATION_CONFIG } from "@/modules/ai/operations";
import {
  FakeProvider,
  fakeLiveSnapshot,
  fakeRepositorySnapshot,
} from "@/modules/business-audit/test-support";
import { OPPORTUNITY_PROMPT_VERSION } from "@/modules/opportunities/prompt";
import { OPPORTUNITY_RUBRIC_VERSION } from "@/modules/opportunities/rubric";
import { OPPORTUNITY_ENGINE_VERSION, OPPORTUNITY_SET_SCHEMA_VERSION } from "@/modules/opportunities/schema";
import { computeAuditInputHash } from "@/modules/business-audit/store";
import { computeOpportunityInputHash } from "@/modules/opportunities/store";
import { fakeAudit, fakeWireOpportunity } from "@/modules/opportunities/test-support";
import type { ExecutionDeps } from "../business-audit/execution";
import { FakeDatabase, fakeSupabase, seedProductUnderstanding } from "../test-support";
import {
  completeOpportunityOperationStep,
  countOpportunityTokensStep,
  failOpportunityOperationStep,
  prepareOpportunitiesStep,
  runPrioritizationStep,
} from "./execution";

/**
 * Durable opportunity generation (Sprint 8 §40, §41).
 *
 * The same cost-control properties the Business Audit's steps are held to, on
 * the second consumer of the foundation. `provider.requests` — the count of
 * billable calls — is the assertion that matters in almost every case.
 */

const USER = "user_1";
const PROJECT = "project_1";
const AUDIT = "audit_1";
const PROFILE = "profile_1";
const INTENT_HASH = "c".repeat(64);

/**
 * The audit's real identity, not a placeholder.
 *
 * `verifyPackProvenance` recomputes this digest from the row's versions and a
 * fresh load of its five sources, so a fixture with an invented `input_hash`
 * describes an audit that could not exist — and every test here would fail on
 * provenance rather than on what it means to assert.
 */
const AUDIT_VERSIONS = {
  schemaVersion: "business-readiness-audit.v1",
  auditVersion: "business-audit-v1",
  evidencePackVersion: "business-evidence.v3",
  promptVersion: "business-audit-prompt-v2",
  rubricVersion: "business-readiness-rubric-v1",
  profileSchemaVersion: "product-profile.v1",
  profileBuilderVersion: "profile-builder-v1",
  provider: "anthropic",
  model: "claude-sonnet-5",
} as const;

const AUDIT_HASH = computeAuditInputHash({
  repositorySnapshotId: "repo_snapshot_1",
  liveSnapshotId: "live_snapshot_1",
  productProfileId: PROFILE,
  founderIntentHash: INTENT_HASH,
  // This fixture seeds no Deep Scan, and null is what that means.
  authenticatedSnapshotId: null,
  ...AUDIT_VERSIONS,
});


function identity() {
  return computeOpportunityInputHash({
    auditId: AUDIT,
    auditInputHash: AUDIT_HASH,
    evidencePackVersion: "business-evidence.v2",
    engineVersion: OPPORTUNITY_ENGINE_VERSION,
    promptVersion: OPPORTUNITY_PROMPT_VERSION,
    rubricVersion: OPPORTUNITY_RUBRIC_VERSION,
    schemaVersion: OPPORTUNITY_SET_SCHEMA_VERSION,
    provider: "anthropic",
    model: OPPORTUNITY_GENERATION_CONFIG.model,
  });
}

let db: FakeDatabase;
let provider: FakeProvider;
let operationId: string;

function providerReturning(entries: unknown[]) {
  return new FakeProvider({
    result: {
      ok: true,
      data: { opportunities: entries },
      usage: { inputTokens: 9_000, outputTokens: 1_400, thinkingTokens: 800 },
      model: "claude-sonnet-5",
      latencyMs: 22_000,
    },
  });
}

function deps(): ExecutionDeps {
  return { supabase: fakeSupabase(db), provider };
}

function seed(options: { inputIdentity?: string } = {}) {
  db.seed("projects", { id: PROJECT, user_id: USER });
  db.seed("repository_intelligence_snapshots", {
    id: "repo_snapshot_1",
    project_id: PROJECT,
    status: "completed",
    result: fakeRepositorySnapshot(),
    created_at: "2026-08-01T00:00:00.000Z",
  });
  db.seed("live_product_intelligence_snapshots", {
    id: "live_snapshot_1",
    project_id: PROJECT,
    status: "completed",
    result: fakeLiveSnapshot(),
    created_at: "2026-08-01T00:00:00.000Z",
    completed_at: "2026-08-01T00:00:00.000Z",
  });
  seedProductUnderstanding(db, { projectId: PROJECT, profileId: PROFILE, intentHash: INTENT_HASH });
  db.seed("business_readiness_audits", {
    id: AUDIT,
    project_id: PROJECT,
    status: "completed",
    input_hash: AUDIT_HASH,
    result: fakeAudit(),
    overall_score: 40,
    // The observations this audit reasoned from. `not null` on the real table,
    // and the fixture omitted them — which made every test here describe an
    // audit that could not exist, and left the rebuild-provenance check with
    // nothing to check.
    repository_snapshot_id: "repo_snapshot_1",
    live_snapshot_id: "live_snapshot_1",
    product_profile_id: PROFILE,
    founder_intent_hash: INTENT_HASH,
    // The reproducibility set. Without it `evidence_pack_version` is undefined
    // and the provenance check silently takes its pre-CORE-2 fallback — so the
    // path this fixture exists to exercise would never run.
    schema_version: "business-readiness-audit.v1",
    audit_version: "business-audit-v1",
    evidence_pack_version: "business-evidence.v3",
    prompt_version: "business-audit-prompt-v2",
    rubric_version: "business-readiness-rubric-v1",
    product_profile_schema_version: "product-profile.v1",
    product_profile_builder_version: "profile-builder-v1",
    provider: "anthropic",
    model: "claude-sonnet-5",
    created_at: "2026-08-02T00:00:00.000Z",
    completed_at: "2026-08-02T00:00:00.000Z",
  });

  const operation = db.seed("operation_runs", {
    id: "operation_1",
    project_id: PROJECT,
    user_id: USER,
    operation_type: "opportunity_generation",
    status: "queued",
    stage: "preparing",
    input_identity: options.inputIdentity ?? identity(),
    workflow_run_id: "run_1",
    execution_provider: "fake_executor",
    result_id: null,
    inference_started_at: null,
    failure_code: null,
    started_at: null,
    completed_at: null,
    created_at: "2026-08-03T00:00:00.000Z",
  });
  operationId = String(operation.id);
}

async function runPipeline() {
  const prepared = await prepareOpportunitiesStep(deps(), operationId);
  if (!prepared.ok) {
    await failOpportunityOperationStep(deps(), operationId, prepared.failureCode);
    return prepared;
  }

  const counted = await countOpportunityTokensStep(deps(), operationId);
  if (!counted.ok) {
    await failOpportunityOperationStep(deps(), operationId, counted.failureCode);
    return counted;
  }

  const prioritized = await runPrioritizationStep(deps(), operationId, counted.estimatedInputTokens);
  if (!prioritized.ok) {
    await failOpportunityOperationStep(deps(), operationId, prioritized.failureCode);
    return prioritized;
  }

  await completeOpportunityOperationStep(deps(), operationId, prioritized.setId);
  return prioritized;
}

const operationRow = () => db.rows("operation_runs")[0];
const setRows = () => db.rows("opportunity_sets");
const opportunityRows = () => db.rows("business_opportunities");

beforeEach(() => {
  db = new FakeDatabase();
  provider = providerReturning([
    fakeWireOpportunity({ rank: 1, category: "monetization", primaryDimension: "monetization" }),
    fakeWireOpportunity({ rank: 2, category: "positioning", primaryDimension: "product" }),
    fakeWireOpportunity({ rank: 3, category: "seo", primaryDimension: "distribution" }),
  ]);
  seed();
});

describe("the happy path", () => {
  it("produces one set from exactly one provider call", async () => {
    const outcome = await runPipeline();

    expect(outcome.ok).toBe(true);
    expect(provider.requests).toHaveLength(1);
    expect(setRows()).toHaveLength(1);
    expect(setRows()[0].status).toBe("completed");
    expect(setRows()[0].opportunity_count).toBe(3);
  });

  it("writes the opportunities with unique contiguous ranks", async () => {
    await runPipeline();

    const ranks = opportunityRows().map((row) => row.rank);
    expect(ranks).toEqual([1, 2, 3]);
    expect(new Set(ranks).size).toBe(3);
  });

  it("links the operation to the set it produced", async () => {
    await runPipeline();

    expect(operationRow().status).toBe("completed");
    expect(operationRow().result_id).toBe(setRows()[0].id);
  });

  it("ties the set to the audit it prioritized", async () => {
    await runPipeline();
    expect(setRows()[0].business_audit_id).toBe(AUDIT);
  });

  it("records exactly one usage event for the new operation", async () => {
    await runPipeline();

    const usage = db.rows("ai_usage_events");
    expect(usage).toHaveLength(1);
    expect(usage[0].operation).toBe("opportunity_generation");
    expect(usage[0].status).toBe("succeeded");
    expect(usage[0].job_id).toBe(setRows()[0].id);
  });

  it("passes through the prioritizing stage", async () => {
    await prepareOpportunitiesStep(deps(), operationId);
    const counted = await countOpportunityTokensStep(deps(), operationId);
    expect(operationRow().stage).toBe("counting_tokens");

    if (!counted.ok) throw new Error("expected a count");
    await runPrioritizationStep(deps(), operationId, counted.estimatedInputTokens);
    // Ends on persisting; prioritizing was passed through on the way.
    expect(operationRow().stage).toBe("persisting");
  });
});

describe("re-entry and idempotency (§40)", () => {
  it("does not claim a second set when prepare runs twice", async () => {
    const first = await prepareOpportunitiesStep(deps(), operationId);
    const second = await prepareOpportunitiesStep(deps(), operationId);

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.setId).toBe(first.setId);
    expect(setRows()).toHaveLength(1);
  });

  it("returns the same set without a second provider call when prioritization re-runs", async () => {
    await runPipeline();

    const replay = await runPrioritizationStep(deps(), operationId, 9_000);

    expect(replay.ok).toBe(true);
    expect(provider.requests).toHaveLength(1);
    expect(setRows()).toHaveLength(1);
    expect(opportunityRows()).toHaveLength(3);
  });

  it("does not duplicate the usage event on a replayed persistence", async () => {
    await runPipeline();
    await runPrioritizationStep(deps(), operationId, 9_000);

    expect(db.rows("ai_usage_events")).toHaveLength(1);
  });

  it("does not emit a second completion when the finish step replays", async () => {
    const outcome = await runPipeline();
    if (!outcome.ok) throw new Error("expected success");

    await completeOpportunityOperationStep(deps(), operationId, outcome.setId);

    expect(db.rows("audit_events").filter((row) => row.event_type === "operation.completed")).toHaveLength(1);
  });
});

describe("paid-call ambiguity (§26)", () => {
  it("refuses to prioritize again after an interrupted call", async () => {
    await prepareOpportunitiesStep(deps(), operationId);
    operationRow().inference_started_at = "2026-08-03T00:00:10.000Z";

    const outcome = await runPrioritizationStep(deps(), operationId, 9_000);

    expect(outcome).toEqual({ ok: false, failureCode: "inference_interrupted" });
    expect(provider.requests).toHaveLength(0);
  });

  it("surfaces a refusal as terminal, with the set marked failed", async () => {
    const refusing = new FakeProvider({
      result: { ok: false, error: "provider_refusal", model: "claude-sonnet-5", latencyMs: 10 },
    });

    await prepareOpportunitiesStep(deps(), operationId);
    const outcome = await runPrioritizationStep(
      { supabase: fakeSupabase(db), provider: refusing },
      operationId,
      9_000,
    );

    expect(outcome).toEqual({ ok: false, failureCode: "provider_refusal" });
    expect(refusing.requests).toHaveLength(1);
    expect(setRows()[0].status).toBe("failed");
    expect(opportunityRows()).toHaveLength(0);
  });

  it("does not re-infer after unusable output", async () => {
    const invalid = new FakeProvider({
      result: {
        ok: true,
        data: { opportunities: "not an array" },
        usage: { inputTokens: 900, outputTokens: 100, thinkingTokens: 0 },
        model: "claude-sonnet-5",
        latencyMs: 10,
      },
    });

    await prepareOpportunitiesStep(deps(), operationId);
    const first = await runPrioritizationStep({ supabase: fakeSupabase(db), provider: invalid }, operationId, 9_000);
    expect(first.ok).toBe(false);

    const second = await runPrioritizationStep({ supabase: fakeSupabase(db), provider: invalid }, operationId, 9_000);
    expect(second.ok).toBe(false);
    expect(invalid.requests).toHaveLength(1);
  });

  it("records billed usage even when the response was unusable", async () => {
    const invalid = new FakeProvider({
      result: {
        ok: true,
        data: { opportunities: [] },
        usage: { inputTokens: 900, outputTokens: 100, thinkingTokens: 0 },
        model: "claude-sonnet-5",
        latencyMs: 10,
      },
    });

    await prepareOpportunitiesStep(deps(), operationId);
    await runPrioritizationStep({ supabase: fakeSupabase(db), provider: invalid }, operationId, 9_000);

    const usage = db.rows("ai_usage_events");
    expect(usage).toHaveLength(1);
    expect(usage[0].status).toBe("failed");
    expect(usage[0].input_tokens).toBe(900);
  });
});

describe("guards", () => {
  it("refuses when the audit changed under the operation", async () => {
    db = new FakeDatabase();
    provider = providerReturning([fakeWireOpportunity()]);
    seed({ inputIdentity: "f".repeat(64) });

    const outcome = await prepareOpportunitiesStep(deps(), operationId);

    expect(outcome).toEqual({ ok: false, failureCode: "inputs_changed" });
    expect(setRows()).toHaveLength(0);
    expect(provider.requests).toHaveLength(0);
  });

  /*
   * The race the identity hash cannot see.
   *
   * `computeOpportunityInputHash` contains the audit's id, the audit's own
   * stored `input_hash`, and version constants — no snapshot id. The audit row
   * is not rewritten when a scan finishes, so a scan completing between the
   * click and this step leaves every field of that hash identical while moving
   * what `getLatestSuccessfulSnapshot` returns.
   *
   * The pack rebuilt here would then be built from the new scan while the
   * audit's conclusions, which the model is asked to prioritize, were written
   * from the old one. Nothing crashes: the citations are ids a builder still
   * mints, so they still render — pointing at a different observation than the
   * sentence above them. It is a paid call producing advice about a state that
   * no longer exists, and it is invisible from the outside.
   */
  it("refuses when a repository scan finished between the click and the step", async () => {
    db.seed("repository_intelligence_snapshots", {
      id: "repo_snapshot_2",
      project_id: PROJECT,
      status: "completed",
      result: fakeRepositorySnapshot(),
      created_at: "2026-08-04T00:00:00.000Z",
    });

    // The identity the operation was created for is untouched by that scan —
    // which is the whole point. Asserted, so this test cannot pass for the
    // trivial reason that the older guard caught it.
    expect(operationRow().input_identity).toBe(identity());

    const outcome = await runPipeline();

    expect(outcome).toEqual({ ok: false, failureCode: "inputs_changed" });
    expect(provider.requests).toHaveLength(0);
    expect(setRows()).toHaveLength(0);
  });

  it("refuses when a live scan finished between the click and the step", async () => {
    db.seed("live_product_intelligence_snapshots", {
      id: "live_snapshot_2",
      project_id: PROJECT,
      status: "completed",
      result: fakeLiveSnapshot(),
      created_at: "2026-08-04T00:00:00.000Z",
      completed_at: "2026-08-04T00:00:00.000Z",
    });

    expect(operationRow().input_identity).toBe(identity());

    const outcome = await runPipeline();

    expect(outcome).toEqual({ ok: false, failureCode: "inputs_changed" });
    expect(provider.requests).toHaveLength(0);
  });

  it("refuses when there is no audit to prioritize from", async () => {
    db.rows("business_readiness_audits")[0].status = "failed";

    const outcome = await prepareOpportunitiesStep(deps(), operationId);

    expect(outcome).toEqual({ ok: false, failureCode: "audit_missing" });
    expect(provider.requests).toHaveLength(0);
  });

  it("refuses when the operation's owner no longer owns the project", async () => {
    db.rows("projects")[0].user_id = "someone_else";

    const outcome = await prepareOpportunitiesStep(deps(), operationId);

    expect(outcome).toEqual({ ok: false, failureCode: "project_not_found" });
    expect(provider.requests).toHaveLength(0);
  });
});
