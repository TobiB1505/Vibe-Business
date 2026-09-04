import { ANALYZER_VERSION as REPOSITORY_ANALYZER_VERSION } from "@/modules/repository-intelligence/schema";
import { LIVE_PRODUCT_ANALYZER_VERSION } from "@/modules/live-product-intelligence/schema";
import { beforeEach, describe, expect, it } from "vitest";
import { BUSINESS_READINESS_AUDIT_CONFIG } from "@/modules/ai/operations";
import { EVIDENCE_PACK_V3_VERSION } from "@/modules/business-audit/evidence-v3";
import { PROMPT_VERSION } from "@/modules/business-audit/prompt";
import { RUBRIC_VERSION } from "@/modules/business-audit/rubric";
import {
  BUSINESS_AUDIT_SCHEMA_VERSION,
  BUSINESS_AUDIT_VERSION,
  MIN_SUPPORTED_AUDIT_CONTRACT_VERSION,
} from "@/modules/business-audit/schema";
import { computeAuditInputHash } from "@/modules/business-audit/store";
import { creditsToUnits } from "@/modules/credits/units";
import {
  FakeProvider,
  fakeLiveSnapshot,
  fakeRepositorySnapshot,
} from "@/modules/business-audit/test-support";
import { FakeDatabase, fakeSupabase, seedProductUnderstanding } from "../test-support";
import {
  checkFounderQuestionStep,
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
    productProfileId: "profile_1",
    founderIntentHash: CONTEXT_HASH,
    profileSchemaVersion: "product-profile.v1",
    profileBuilderVersion: "product-understanding-v1",
    authenticatedSnapshotId: null,
    schemaVersion: BUSINESS_AUDIT_SCHEMA_VERSION,
    auditVersion: BUSINESS_AUDIT_VERSION,
    evidencePackVersion: EVIDENCE_PACK_V3_VERSION,
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
    analyzer_version: REPOSITORY_ANALYZER_VERSION,
    id: "repo_snapshot_1",
    project_id: PROJECT,
    status: "completed",
    result: fakeRepositorySnapshot(),
    created_at: "2026-08-01T00:00:00.000Z",
  });
  db.seed("live_product_intelligence_snapshots", {
    analyzer_version: LIVE_PRODUCT_ANALYZER_VERSION,
    id: "live_snapshot_1",
    project_id: PROJECT,
    status: "completed",
    result: fakeLiveSnapshot(),
    created_at: "2026-08-01T00:00:00.000Z",
    completed_at: "2026-08-01T00:00:00.000Z",
  });
  seedProductUnderstanding(db, { projectId: PROJECT, intentHash: CONTEXT_HASH });

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
    // `operation_runs.pause_cycle smallint not null default 0` (ADR 0042
    // §P2) — the fake's `db.seed` does not apply column defaults, unlike a
    // real INSERT, so it is stated here explicitly.
    pause_cycle: 0,
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
    expect(
      db.rows("audit_events").filter((row) => row.event_type === "business_audit.started"),
    ).toHaveLength(1);
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
    // A non-object body fails v8 normalization — the simplest response that
    // is billed by the provider yet unusable by the contract.
    const invalid = new FakeProvider({
      result: {
        ok: true,
        data: "not an object",
        usage: { inputTokens: 100, outputTokens: 50, thinkingTokens: 0 },
        model: "claude-sonnet-5",
        latencyMs: 10,
      },
    });

    await prepareEvidenceStep(deps(), operationId);
    const first = await runInferenceStep(
      { supabase: fakeSupabase(db), provider: invalid },
      operationId,
      1000,
    );
    expect(first.ok).toBe(false);

    // The audit is failed and the marker is set, so a re-entry stops.
    const second = await runInferenceStep(
      { supabase: fakeSupabase(db), provider: invalid },
      operationId,
      1000,
    );
    expect(second.ok).toBe(false);
    expect(invalid.requests).toHaveLength(1);
  });

  it("records billed usage even when the response was unusable", async () => {
    const invalid = new FakeProvider({
      result: {
        ok: true,
        data: "not an object",
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

/**
 * The paid re-run, one step in (BILLING CORE-2 §39).
 *
 * The start path has routed `credits_required` into a reservation since Core-2,
 * and this step then re-asked the entitlement and refused — so a customer could
 * have 35 Credits held for work the very next step declined to do. Nothing in
 * the start path could see it, because the failure happened after the start
 * path returned `started`.
 *
 * What decides here is the **hold**, read live from the billing tables rather
 * than carried across the step boundary. So both directions matter: a held
 * operation runs and is recorded as Credit-funded, and an unheld one is still
 * refused.
 */
describe("a Credit-funded re-run", () => {
  /** Spends the included audit, durably — the grant survives a reconnect. */
  function consumeIncludedEntitlement() {
    db.seed("repository_connections", {
      id: "conn_1",
      project_id: PROJECT,
      github_repository_id: 12345,
    });
    db.seed("free_audit_grants", { id: "grant_1", user_id: USER, github_repository_id: 12345 });
  }

  /** Takes a real hold through the real billing path, not a hand-written row. */
  async function holdCredits() {
    const { grantCreditLot } = await import("@/modules/credits/grants");
    const { holdOperationCredits } = await import("../billing");
    await grantCreditLot(fakeSupabase(db), {
      userId: USER,
      sourceKind: "purchase",
      credits: creditsToUnits(100),
      reason: "test funding",
      idempotencyKey: "test-fund:execution",
    });
    const held = await holdOperationCredits(fakeSupabase(db), {
      projectId: PROJECT,
      operationRunId: operationId,
      operation: "business_audit",
    });
    expect(held.ok).toBe(true);
  }

  it("runs, and records the audit as Credit-funded rather than included", async () => {
    consumeIncludedEntitlement();
    await holdCredits();

    const outcome = await prepareEvidenceStep(deps(), operationId);

    expect(outcome.ok).toBe(true);
    expect(auditRows()).toHaveLength(1);
    expect(auditRows()[0].access_mode).toBe("credits");
  });

  it("writes no free-audit grant when it completes", async () => {
    consumeIncludedEntitlement();
    await holdCredits();

    await runPipeline();

    // One grant: the pre-existing one. A paid audit neither spends the included
    // entitlement again nor restores it.
    expect(db.rows("free_audit_grants")).toHaveLength(1);
  });

  it("still refuses when the entitlement is spent and nothing is held", async () => {
    consumeIncludedEntitlement();

    const outcome = await prepareEvidenceStep(deps(), operationId);

    expect(outcome).toEqual({ ok: false, failureCode: "credits_required" });
    expect(auditRows()).toHaveLength(0);
    expect(provider.requests).toHaveLength(0);
  });

  /**
   * A released hold funded nothing. Reading "a reservation exists" rather than
   * "a reservation is active" would let a refunded operation run for free.
   */
  it("refuses when the hold has already been released", async () => {
    consumeIncludedEntitlement();
    await holdCredits();

    const { releaseOperationBilling } = await import("../billing");
    await releaseOperationBilling(fakeSupabase(db), { operationRunId: operationId });

    const outcome = await prepareEvidenceStep(deps(), operationId);

    expect(outcome).toEqual({ ok: false, failureCode: "credits_required" });
    expect(provider.requests).toHaveLength(0);
  });
});

/**
 * ADR 0042 §P2 — a paused, credits-funded audit does not hold Credits while it
 * waits, and does not spend without a valid hold when it resumes.
 *
 * `seed()`'s fixture (via `seedProductUnderstanding`) already carries a
 * complete founder intent and a confident profile, so there is nothing left
 * to ask about by default — confirmed directly before writing this, not
 * assumed. `askFounderQuestion()` below reproduces the one recipe
 * `needs-user.test.ts` uses for a *confident* intent that still stops the
 * audit: an unconfirmed, AI-inferred audience the profile never asked the
 * founder to confirm, with a previous completed audit whose `audience` lens
 * assessed it as materially urgent ("now") — matching identity, so
 * `lensesReflectCurrentFacts` is true and the lens is not discarded.
 */
describe("pause and resume (ADR 0042 §P2)", () => {
  /** Makes `checkFounderQuestionStep` genuinely stop for the `first_customer` question. */
  function askFounderQuestion() {
    const profile = db.rows("product_profiles").find((row) => row.id === "profile_1")!;
    profile.result = {
      ...(profile.result as Record<string, unknown>),
      audience: {
        ...(profile.result as { audience: Record<string, unknown> }).audience,
        primaryAudience: {
          value: "Software founders and builders",
          confidence: "unclear",
          sources: ["ai_inferred"],
          evidence: [],
        },
      },
    };

    db.seed("business_readiness_audits", {
      id: "previous_audit",
      project_id: PROJECT,
      status: "completed",
      access_mode: "included_first_audit",
      input_hash: "previous-hash",
      overall_score: 50,
      assessed_dimensions: 5,
      total_dimensions: 5,
      failure_code: null,
      asked_intents: [],
      product_profile_id: "profile_1",
      founder_intent_hash: CONTEXT_HASH,
      result: {
        // Matches the current contract exactly, so entitlement decides
        // `credits_required` from the exhausted grant below rather than
        // `system_contract_refresh` from a stale one — the two are easy to
        // conflate, and this fixture wants the former specifically.
        contractVersion: MIN_SUPPORTED_AUDIT_CONTRACT_VERSION,
        synthesis: {
          lenses: [
            {
              lens: "audience",
              health: "weak",
              materiality: "now",
              summary: "Internal reasoning for audience.",
              evidenceIds: [],
              missingContext: ["Who the first paying customer actually is"],
            },
          ],
        },
      },
      created_at: "2026-08-01T12:00:00.000Z",
      completed_at: "2026-08-01T12:00:00.000Z",
    });
  }

  /** Spends the included audit, durably, so the run is Credit-funded. */
  function consumeIncludedEntitlement() {
    db.seed("repository_connections", {
      id: "conn_1",
      project_id: PROJECT,
      github_repository_id: 12345,
    });
    db.seed("free_audit_grants", { id: "grant_1", user_id: USER, github_repository_id: 12345 });
  }

  /** Takes a real hold through the real billing path, not a hand-written row. */
  async function holdCredits() {
    const { grantCreditLot } = await import("@/modules/credits/grants");
    const { holdOperationCredits } = await import("../billing");
    await grantCreditLot(fakeSupabase(db), {
      userId: USER,
      sourceKind: "purchase",
      credits: creditsToUnits(100),
      reason: "test funding",
      idempotencyKey: "test-fund:pause",
    });
    const held = await holdOperationCredits(fakeSupabase(db), {
      projectId: PROJECT,
      operationRunId: operationId,
      operation: "business_audit",
    });
    expect(held.ok).toBe(true);
  }

  function reservations() {
    return db
      .rows("billing_credit_reservations")
      .filter((row) => row.operation_run_id === operationId)
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  }

  /** Answers the question and resumes, exactly as `resumeAnsweredAuditOperation` does. */
  async function resume() {
    const { requeueAnsweredOperation } = await import("../store");
    const { requeued } = await requeueAnsweredOperation(fakeSupabase(db), operationId);
    expect(requeued).toBe(true);
  }

  it("releases the hold when the founder question pauses the operation", async () => {
    consumeIncludedEntitlement();
    await holdCredits();
    askFounderQuestion();
    await prepareEvidenceStep(deps(), operationId);

    const paused = await checkFounderQuestionStep(deps(), operationId);

    expect(paused).toMatchObject({ ok: true, paused: true });
    expect(operationRow().status).toBe("needs_user");
    expect(operationRow().pause_cycle).toBe(1);
    expect(reservations()).toHaveLength(1);
    expect(reservations()[0]).toMatchObject({
      status: "released",
      release_reason: "cancelled_before_usage",
    });
  });

  it("does not pause a second time for the same question once it is asked", async () => {
    consumeIncludedEntitlement();
    await holdCredits();
    askFounderQuestion();
    await prepareEvidenceStep(deps(), operationId);
    await checkFounderQuestionStep(deps(), operationId);
    await resume();

    const second = await checkFounderQuestionStep(deps(), operationId);

    expect(second).toMatchObject({ ok: true, paused: false });
  });

  it("re-acquires a fresh active hold on resume, before spending", async () => {
    consumeIncludedEntitlement();
    await holdCredits();
    askFounderQuestion();
    await prepareEvidenceStep(deps(), operationId);
    await checkFounderQuestionStep(deps(), operationId);
    await resume();
    await checkFounderQuestionStep(deps(), operationId);
    expect(reservations()).toHaveLength(1);

    const outcome = await runInferenceStep(deps(), operationId, 100);

    expect(outcome.ok).toBe(true);
    expect(reservations()).toHaveLength(2);
    expect(reservations()[0].status).toBe("released");
    expect(reservations()[1].status).toBe("active");
    expect(reservations()[0].idempotency_key).not.toBe(reservations()[1].idempotency_key);
    expect(reservations()[1].idempotency_key).toBe(`operation:${operationId}:resume:1`);
  });

  it("finishes the audit against the re-acquired hold, settling it on completion", async () => {
    consumeIncludedEntitlement();
    await holdCredits();
    askFounderQuestion();
    await prepareEvidenceStep(deps(), operationId);
    await checkFounderQuestionStep(deps(), operationId);
    await resume();
    await checkFounderQuestionStep(deps(), operationId);

    const counted = await countTokensStep(deps(), operationId);
    expect(counted.ok).toBe(true);
    if (!counted.ok) return;
    const inferred = await runInferenceStep(deps(), operationId, counted.estimatedInputTokens);
    expect(inferred.ok).toBe(true);
    if (!inferred.ok) return;
    await completeOperationStep(deps(), operationId, inferred.auditId);

    expect(reservations()).toHaveLength(2);
    expect(reservations()[0].status).toBe("released");
    expect(reservations()[1].status).toBe("settled");
    expect(auditRows()[0].status).toBe("completed");
  });

  it("does not take a second reservation when the resume step is retried for the same cycle", async () => {
    consumeIncludedEntitlement();
    await holdCredits();
    askFounderQuestion();
    await prepareEvidenceStep(deps(), operationId);
    await checkFounderQuestionStep(deps(), operationId);
    await resume();
    await checkFounderQuestionStep(deps(), operationId);

    const first = await runInferenceStep(deps(), operationId, 100);
    expect(first.ok).toBe(true);

    // A retry of this exact step for the same pause cycle — the durable
    // workflow re-entering after a crash between the re-acquire and the paid
    // call. `inferenceStartedAt` is now set, so this itself refuses before
    // spending again, but the reservation count is the property under test:
    // the idempotency key must not have taken a second hold on the way here.
    expect(reservations()).toHaveLength(2);
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
    expect(
      db.rows("audit_events").filter((row) => row.event_type === "operation.failed"),
    ).toHaveLength(1);
  });
});

/**
 * Pausing for the founder, and the two defects a real run found (CORE-2a.4).
 *
 * Both were invisible to every existing test and to the browser suite, because
 * both need a run that *pauses, is answered, and resumes* — which nothing
 * exercised until a real project did it.
 */
describe("resuming after a founder answer", () => {
  /**
   * The self-defeating bug.
   *
   * The audit's input hash includes the founder intent hash, so a run that asks
   * the founder something and receives an answer invalidates its own identity.
   * The first real interruption did exactly this: two questions answered, then
   * `inputs_changed` at `counting_tokens`, with the answers safely stored and
   * the audit they were collected for dead.
   */
  it("adopts the identity its own question created instead of failing on it", async () => {
    db = new FakeDatabase();
    provider = new FakeProvider();
    seed();

    const prepared = await prepareEvidenceStep(deps(), operationId);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    // The run asked something and the founder answered: the stored intent —
    // and therefore the identity the audit hashes — has moved underneath it.
    auditRows()[0].asked_intents = ["current_stage"];
    operationRow().input_identity = "f".repeat(64);

    const counted = await countTokensStep(deps(), operationId);
    expect(counted.ok).toBe(true);
    if (!counted.ok) return;

    const inferred = await runInferenceStep(deps(), operationId, counted.estimatedInputTokens);

    expect(inferred.ok).toBe(true);
    // Both rows carry the new identity, or the guards they exist for would keep
    // blocking the run that just satisfied them.
    expect(auditRows()[0].input_hash).toBe(operationRow().input_identity);
  });

  /**
   * The guard still does its job for a run that never asked anything. Evidence
   * changing under an ordinary audit is exactly what it was written for.
   */
  it("still refuses when the identity moved and nothing was asked", async () => {
    db = new FakeDatabase();
    provider = new FakeProvider();
    seed();

    const prepared = await prepareEvidenceStep(deps(), operationId);
    expect(prepared.ok).toBe(true);

    // Same drift, but this run never asked the founder anything.
    operationRow().input_identity = "f".repeat(64);

    const counted = await countTokensStep(deps(), operationId);
    expect(counted.ok).toBe(true);
    if (!counted.ok) return;

    const inferred = await runInferenceStep(deps(), operationId, counted.estimatedInputTokens);
    expect(inferred).toEqual({ ok: false, failureCode: "inputs_changed" });
    expect(provider.requests).toHaveLength(0);
  });
});

describe("a failed operation does not strand its audit row", () => {
  /**
   * The second defect, and the one that left a project unable to audit at all.
   *
   * `runInferenceStep` fails its own row, so failures at inference were always
   * recorded. Everything between claiming the row and reaching inference was
   * not — the operation failed, the audit stayed `analyzing`, and because both
   * the in-flight and one-included indexes count that status, every further
   * attempt would be refused. Nothing on screen looked broken.
   */
  it("fails the claimed audit when the operation fails before inference", async () => {
    db = new FakeDatabase();
    provider = new FakeProvider();
    seed();

    await prepareEvidenceStep(deps(), operationId);
    expect(auditRows()[0].status).toBe("analyzing");

    await failOperationStep(deps(), operationId, "inputs_changed");

    expect(auditRows()[0].status).toBe("failed");
    expect(auditRows()[0].failure_code).toBe("inputs_changed");
  });

  /**
   * And never the other way round: a late failure on the operation must not
   * overwrite an audit that already completed and was paid for.
   */
  it("leaves a completed audit alone", async () => {
    db = new FakeDatabase();
    provider = new FakeProvider();
    seed();

    const outcome = await runPipeline();
    expect(outcome.ok).toBe(true);
    expect(auditRows()[0].status).toBe("completed");

    await failOperationStep(deps(), operationId, "audit_failed");

    expect(auditRows()[0].status).toBe("completed");
  });
});
