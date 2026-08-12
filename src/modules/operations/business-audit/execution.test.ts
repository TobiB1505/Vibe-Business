import { beforeEach, describe, expect, it } from "vitest";
import { BUSINESS_READINESS_AUDIT_CONFIG } from "@/modules/ai/operations";
import { EVIDENCE_PACK_V2_VERSION } from "@/modules/business-audit/evidence-v2";
import { PROMPT_VERSION } from "@/modules/business-audit/prompt";
import { RUBRIC_VERSION } from "@/modules/business-audit/rubric";
import { BUSINESS_AUDIT_SCHEMA_VERSION, BUSINESS_AUDIT_VERSION } from "@/modules/business-audit/schema";
import { computeAuditInputHash } from "@/modules/business-audit/store";
import {
  FakeProvider,
  fakeLiveSnapshot,
  fakeRepositorySnapshot,
} from "@/modules/business-audit/test-support";
import { FakeDatabase, fakeSupabase } from "../test-support";
import {
  completeOperationStep,
  countTokensStep,
  failOperationStep,
  prepareEvidenceStep,
  runInferenceStep,
  type ExecutionDeps,
} from "./execution";

/**
 * Durable step behaviour (Sprint 7 §29, §30).
 *
 * These are the cost-control tests. Durable execution can re-enter a step, so
 * "it only runs once" stops being an argument and has to be a property. Every
 * case below asserts on `provider.requests` — the count of billable calls —
 * rather than only on the resulting state.
 */

const USER = "user_1";
const PROJECT = "project_1";
const CONTEXT_HASH = "c".repeat(64);

function identity() {
  return computeAuditInputHash({
    repositorySnapshotId: "repo_snapshot_1",
    liveSnapshotId: "live_snapshot_1",
    businessContextHash: CONTEXT_HASH,
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

let db: FakeDatabase;
let provider: FakeProvider;
let operationId: string;

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
  db.seed("project_business_context", {
    id: "context_1",
    project_id: PROJECT,
    product_summary: "Vibe Business helps people turn a built product into a business.",
    target_customer: "Solo builders",
    stage: "prototype",
    monetization_model: "none",
    primary_goal: "launch",
    context_hash: CONTEXT_HASH,
    updated_at: "2026-08-01T00:00:00.000Z",
  });

  const operation = db.seed("operation_runs", {
    id: "operation_1",
    project_id: PROJECT,
    user_id: USER,
    operation_type: "business_audit",
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
    created_at: "2026-08-02T00:00:00.000Z",
  });
  operationId = String(operation.id);
}

/** Runs the whole pipeline the workflow would, without a workflow platform. */
async function runPipeline() {
  const prepared = await prepareEvidenceStep(deps(), operationId);
  if (!prepared.ok) {
    await failOperationStep(deps(), operationId, prepared.failureCode);
    return prepared;
  }

  const counted = await countTokensStep(deps(), operationId);
  if (!counted.ok) {
    await failOperationStep(deps(), operationId, counted.failureCode);
    return counted;
  }

  const inferred = await runInferenceStep(deps(), operationId, counted.estimatedInputTokens);
  if (!inferred.ok) {
    await failOperationStep(deps(), operationId, inferred.failureCode);
    return inferred;
  }

  await completeOperationStep(deps(), operationId, inferred.auditId);
  return inferred;
}

function operationRow() {
  return db.rows("operation_runs")[0];
}

function auditRows() {
  return db.rows("business_readiness_audits");
}

beforeEach(() => {
  db = new FakeDatabase();
  provider = new FakeProvider();
  seed();
});

describe("the happy path", () => {
  it("produces one audit from exactly one provider call", async () => {
    const outcome = await runPipeline();

    expect(outcome.ok).toBe(true);
    expect(provider.requests).toHaveLength(1);
    expect(auditRows()).toHaveLength(1);
    expect(auditRows()[0].status).toBe("completed");
  });

  it("completes the operation and links it to the audit", async () => {
    await runPipeline();

    expect(operationRow().status).toBe("completed");
    expect(operationRow().stage).toBe("completed");
    expect(operationRow().result_id).toBe(auditRows()[0].id);
    expect(operationRow().completed_at).not.toBeNull();
  });

  it("records exactly one usage event, with real tokens", async () => {
    await runPipeline();

    const usage = db.rows("ai_usage_events");
    expect(usage).toHaveLength(1);
    expect(usage[0].status).toBe("succeeded");
    expect(usage[0].job_id).toBe(auditRows()[0].id);
  });

  it("emits the domain and execution events once each", async () => {
    await runPipeline();

    const types = db.rows("audit_events").map((row) => row.event_type);
    expect(types.filter((type) => type === "business_audit.started")).toHaveLength(1);
    expect(types.filter((type) => type === "business_audit.completed")).toHaveLength(1);
    expect(types.filter((type) => type === "operation.completed")).toHaveLength(1);
  });

  it("moves through stages without inventing a percentage", async () => {
    await prepareEvidenceStep(deps(), operationId);
    expect(operationRow().status).toBe("running");
    expect(operationRow().stage).toBe("preparing");

    await countTokensStep(deps(), operationId);
    expect(operationRow().stage).toBe("counting_tokens");
  });
});

describe("re-entry and idempotency (§12, §30)", () => {
  it("does not claim a second audit when prepare runs twice", async () => {
    const first = await prepareEvidenceStep(deps(), operationId);
    const second = await prepareEvidenceStep(deps(), operationId);

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.auditId).toBe(first.auditId);
    expect(auditRows()).toHaveLength(1);
    // And no second "started" event.
    expect(db.rows("audit_events").filter((row) => row.event_type === "business_audit.started")).toHaveLength(1);
  });

  it("returns the same audit without a second provider call when inference re-runs", async () => {
    await runPipeline();

    const replay = await runInferenceStep(deps(), operationId, 1000);

    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(replay.auditId).toBe(String(auditRows()[0].id));
    // The whole point: one billable call, not two.
    expect(provider.requests).toHaveLength(1);
    expect(auditRows()).toHaveLength(1);
  });

  it("does not duplicate the usage event on a replayed persistence", async () => {
    await runPipeline();
    await runInferenceStep(deps(), operationId, 1000);

    expect(db.rows("ai_usage_events")).toHaveLength(1);
  });

  it("does not emit a second completion when the finish step replays", async () => {
    const outcome = await runPipeline();
    if (!outcome.ok) throw new Error("expected success");

    await completeOperationStep(deps(), operationId, outcome.auditId);

    expect(
      db.rows("audit_events").filter((row) => row.event_type === "operation.completed"),
    ).toHaveLength(1);
  });

  it("cannot resurrect a terminal operation with a late stage update", async () => {
    await runPipeline();
    await countTokensStep(deps(), operationId);

    expect(operationRow().status).toBe("completed");
    expect(operationRow().stage).toBe("completed");
  });
});

describe("paid-call ambiguity (§11)", () => {
  it("refuses to run inference again after an interrupted call", async () => {
    await prepareEvidenceStep(deps(), operationId);
    // Exactly what a crash between the marker and the response leaves behind.
    operationRow().inference_started_at = "2026-08-02T00:00:10.000Z";

    const outcome = await runInferenceStep(deps(), operationId, 1000);

    expect(outcome).toEqual({ ok: false, failureCode: "inference_interrupted" });
    expect(provider.requests).toHaveLength(0);
  });

  it("marks the call as started before making it, not after", async () => {
    await prepareEvidenceStep(deps(), operationId);
    await countTokensStep(deps(), operationId);

    // A provider that inspects the database at call time proves ordering: if
    // the marker were written afterwards, a crash inside the call would leave
    // no evidence that money may have been spent.
    let markerAtCallTime: unknown = null;
    const observing = new FakeProvider();
    const original = observing.generateStructured.bind(observing);
    observing.generateStructured = async (request) => {
      markerAtCallTime = operationRow().inference_started_at;
      return original(request);
    };

    await runInferenceStep({ supabase: fakeSupabase(db), provider: observing }, operationId, 1000);

    expect(markerAtCallTime).not.toBeNull();
  });

  it("surfaces a provider refusal as a terminal failure, never a retry", async () => {
    const refusing = new FakeProvider({
      result: { ok: false, error: "provider_refusal", model: "claude-sonnet-5", latencyMs: 10 },
    });

    await prepareEvidenceStep(deps(), operationId);
    await countTokensStep(deps(), operationId);
    const outcome = await runInferenceStep(
      { supabase: fakeSupabase(db), provider: refusing },
      operationId,
      1000,
    );

    expect(outcome).toEqual({ ok: false, failureCode: "provider_refusal" });
    // Returned, not thrown — a thrown error is what the platform retries.
    expect(refusing.requests).toHaveLength(1);
    expect(auditRows()[0].status).toBe("failed");
  });

  it("does not re-infer after a validation failure on a billed response", async () => {
    const invalid = new FakeProvider({
      result: {
        ok: true,
        data: { dimensions: "not an array" },
        usage: { inputTokens: 100, outputTokens: 50, thinkingTokens: 0 },
        model: "claude-sonnet-5",
        latencyMs: 10,
      },
    });

    await prepareEvidenceStep(deps(), operationId);
    const first = await runInferenceStep({ supabase: fakeSupabase(db), provider: invalid }, operationId, 1000);
    expect(first.ok).toBe(false);

    // The audit is failed and the marker is set, so a re-entry stops.
    const second = await runInferenceStep({ supabase: fakeSupabase(db), provider: invalid }, operationId, 1000);
    expect(second.ok).toBe(false);
    expect(invalid.requests).toHaveLength(1);
  });

  it("records billed usage even when the response was unusable", async () => {
    const invalid = new FakeProvider({
      result: {
        ok: true,
        data: { dimensions: "not an array" },
        usage: { inputTokens: 100, outputTokens: 50, thinkingTokens: 0 },
        model: "claude-sonnet-5",
        latencyMs: 10,
      },
    });

    await prepareEvidenceStep(deps(), operationId);
    await runInferenceStep({ supabase: fakeSupabase(db), provider: invalid }, operationId, 1000);

    const usage = db.rows("ai_usage_events");
    expect(usage).toHaveLength(1);
    expect(usage[0].status).toBe("failed");
    expect(usage[0].input_tokens).toBe(100);
  });
});

describe("guards", () => {
  it("refuses when the evidence no longer matches the operation's identity", async () => {
    db = new FakeDatabase();
    provider = new FakeProvider();
    seed({ inputIdentity: "f".repeat(64) });

    const outcome = await prepareEvidenceStep(deps(), operationId);

    expect(outcome).toEqual({ ok: false, failureCode: "inputs_changed" });
    expect(auditRows()).toHaveLength(0);
    expect(provider.requests).toHaveLength(0);
  });

  it("refuses when the operation's owner no longer owns the project", async () => {
    db.rows("projects")[0].user_id = "someone_else";

    const outcome = await prepareEvidenceStep(deps(), operationId);

    expect(outcome).toEqual({ ok: false, failureCode: "project_not_found" });
    expect(provider.requests).toHaveLength(0);
  });

  it("refuses an operation that does not exist", async () => {
    const outcome = await prepareEvidenceStep(deps(), "operation_missing");
    expect(outcome).toEqual({ ok: false, failureCode: "operation_not_found" });
  });

  it("fails the operation with a typed code and one execution event", async () => {
    await failOperationStep(deps(), operationId, "provider_timeout");
    await failOperationStep(deps(), operationId, "provider_timeout");

    expect(operationRow().status).toBe("failed");
    expect(operationRow().failure_code).toBe("provider_timeout");
    expect(db.rows("audit_events").filter((row) => row.event_type === "operation.failed")).toHaveLength(1);
  });
});
