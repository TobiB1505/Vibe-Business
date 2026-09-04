import { ANALYZER_VERSION as REPOSITORY_ANALYZER_VERSION } from "@/modules/repository-intelligence/schema";
import { LIVE_PRODUCT_ANALYZER_VERSION } from "@/modules/live-product-intelligence/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { BUSINESS_READINESS_AUDIT_CONFIG, NOVA_PRESENTATION_CONFIG } from "@/modules/ai/operations";
import type { AIProvider, StructuredRequest, StructuredResult } from "@/modules/ai/provider";
import { CURRENT_EVIDENCE_PACK_VERSION } from "@/modules/business-audit/evidence-v3";
import { PROMPT_VERSION } from "@/modules/business-audit/prompt";
import { RUBRIC_VERSION } from "@/modules/business-audit/rubric";
import {
  BUSINESS_AUDIT_SCHEMA_VERSION,
  BUSINESS_AUDIT_VERSION,
} from "@/modules/business-audit/schema";
import { computeAuditInputHash } from "@/modules/business-audit/store";
import {
  buildModelOutput,
  fakeLiveSnapshot,
  fakeRepositorySnapshot,
} from "@/modules/business-audit/test-support";
import { buildNovaAuditEntry } from "@/modules/nova/feed";
import { buildNovaAuditTemplate, readNovaAuditVoice } from "@/modules/nova/voice/audit-slot";
import { buildBusinessBrainView } from "@/modules/projects/business-brain-view";

import { FakeDatabase, fakeSupabase, seedProductUnderstanding } from "../test-support";
import {
  completeOperationStep,
  countTokensStep,
  failOperationStep,
  prepareEvidenceStep,
  runInferenceStep,
  type ExecutionDeps,
} from "./execution";

/**
 * The first real Nova voice slot, end to end through the actual audit pipeline.
 *
 * Not a test of `speakAfterOperation` — that has its own — but of the one
 * question a unit test cannot answer: does attaching a paid, fallible call to
 * the end of the Business Audit change the Business Audit? Every case here
 * runs the whole pipeline the workflow runs, and asserts on the audit's own
 * outcome as well as Nova's.
 */

const USER = "user_1";
const PROJECT = "project_1";
const CONTEXT_HASH = "c".repeat(64);

/**
 * A message that is grounded in the payload, not merely accepted by it.
 *
 * It restates the audit's own blocker — "People still don't have a clear way
 * to pay you" — and adds nothing. The first version of this fixture said
 * "standing between you and more signups", which `checks.ts` accepts and which
 * is exactly the failure the tier exists to prevent: an invented business
 * outcome, and the wrong one, since the audit found people cannot work out how
 * to *pay*, not that they do not sign up. A fixture is a specification of what
 * good looks like, and that one specified invention.
 */
const SPOKEN = "The thing in your way is that people cannot work out how to pay you.";

let db: FakeDatabase;
let provider: SlotAwareProvider;
let operationId: string;

/**
 * A provider that answers each operation in its own shape.
 *
 * `FakeProvider` returns one canned result whatever it is asked, which would
 * hand Nova the audit's own output and make every case here an
 * `invalid_output` fallback. Dispatching on `request.operation` is what lets a
 * successful voice and a failing one be two different tests rather than one.
 */
class SlotAwareProvider implements AIProvider {
  readonly name = "fake";
  readonly requests: StructuredRequest[] = [];

  constructor(
    private readonly nova: () => Promise<StructuredResult> = async () => voiceSaying(SPOKEN),
  ) {}

  novaRequests(): StructuredRequest[] {
    return this.requests.filter((request) => request.operation === "nova_presentation");
  }

  async countInputTokens(): Promise<{ ok: true; inputTokens: number }> {
    return { ok: true, inputTokens: 2_500 };
  }

  async generateStructured(request: StructuredRequest): Promise<StructuredResult> {
    this.requests.push(request);
    if (request.operation === "nova_presentation") return this.nova();

    return {
      ok: true,
      data: buildModelOutput(),
      usage: { inputTokens: 2_500, outputTokens: 900, thinkingTokens: 400 },
      model: BUSINESS_READINESS_AUDIT_CONFIG.model,
      latencyMs: 4_200,
    };
  }
}

function voiceSaying(message: string): StructuredResult {
  return {
    ok: true,
    data: { message },
    usage: { inputTokens: 480, outputTokens: 40, thinkingTokens: 0 },
    model: NOVA_PRESENTATION_CONFIG.model,
    latencyMs: 900,
  };
}

function deps(): ExecutionDeps {
  return { supabase: fakeSupabase(db), provider };
}

function seed() {
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
    input_identity: computeAuditInputHash({
      repositorySnapshotId: "repo_snapshot_1",
      liveSnapshotId: "live_snapshot_1",
      productProfileId: "profile_1",
      founderIntentHash: CONTEXT_HASH,
      profileSchemaVersion: "product-profile.v1",
      profileBuilderVersion: "product-understanding-v1",
      authenticatedSnapshotId: null,
      schemaVersion: BUSINESS_AUDIT_SCHEMA_VERSION,
      auditVersion: BUSINESS_AUDIT_VERSION,
      evidencePackVersion: CURRENT_EVIDENCE_PACK_VERSION,
      promptVersion: PROMPT_VERSION,
      rubricVersion: RUBRIC_VERSION,
      provider: "anthropic",
      model: BUSINESS_READINESS_AUDIT_CONFIG.model,
    }),
    workflow_run_id: "run_1",
    execution_provider: "fake_executor",
    result_id: null,
    inference_started_at: null,
    failure_code: null,
    started_at: null,
    completed_at: null,
    created_at: "2026-08-02T00:00:00.000Z",
    pause_cycle: 0,
  });
  operationId = String(operation.id);
}

async function runPipeline(): Promise<{ ok: boolean; auditId?: string }> {
  const prepared = await prepareEvidenceStep(deps(), operationId);
  if (!prepared.ok) return prepared;

  const counted = await countTokensStep(deps(), operationId);
  if (!counted.ok) return counted;

  const inferred = await runInferenceStep(deps(), operationId, counted.estimatedInputTokens);
  if (!inferred.ok) {
    await failOperationStep(deps(), operationId, inferred.failureCode);
    return inferred;
  }

  await completeOperationStep(deps(), operationId, inferred.auditId);
  return inferred;
}

function operationRow() {
  return db.rows("operation_runs")[0] as unknown as { status: string; result_id: string };
}

function novaUsageRows() {
  return (db.rows("ai_usage_events") as unknown as { operation: string }[]).filter(
    (row) => row.operation === "nova_presentation",
  );
}

/** The entry a component builds, from the audit the pipeline just wrote. */
function renderedEntry() {
  const stored = db.rows("business_readiness_audits")[0] as unknown as {
    result: Parameters<typeof buildBusinessBrainView>[0]["audit"];
  };
  const audit = stored.result;
  const synthesis = audit.synthesis;
  if (synthesis === null) throw new Error("the pipeline must have written a synthesis");

  const view = buildBusinessBrainView({
    audit,
    lastScanAt: null,
    auditReadings: [],
    movesByConclusion: {},
  });
  if (view === null) throw new Error("the audit must build a view");

  return buildNovaAuditEntry(view, synthesis);
}

function readVoice() {
  return readNovaAuditVoice(fakeSupabase(db), { projectId: PROJECT, entry: renderedEntry() });
}

beforeEach(() => {
  db = new FakeDatabase();
  provider = new SlotAwareProvider();
  process.env.NOVA_VOICE_ENABLED = "1";
  seed();
});

afterEach(() => {
  delete process.env.NOVA_VOICE_ENABLED;
  delete process.env.PAID_OPERATIONS_DISABLED;
});

describe("the switch decides whether anything is spent", () => {
  it("spends nothing on presentation until it is thrown", async () => {
    delete process.env.NOVA_VOICE_ENABLED;

    const outcome = await runPipeline();

    expect(outcome.ok).toBe(true);
    expect(provider.novaRequests()).toEqual([]);
    expect(novaUsageRows()).toEqual([]);
  });

  /** A lever thrown to stop money leaving has to stop this too. */
  it("stops when paid operations are disabled", async () => {
    process.env.PAID_OPERATIONS_DISABLED = "1";

    await runPipeline();

    expect(provider.novaRequests()).toEqual([]);
  });

  /** Both off and disabled still leave a founder with a sentence. */
  it("still shows the template with the switch off", async () => {
    delete process.env.NOVA_VOICE_ENABLED;
    await runPipeline();

    const read = await readVoice();

    expect(read.source).toBe("template");
    expect(read.message).toBe(buildNovaAuditTemplate(renderedEntry()));
  });
});

describe("the audit completes, and then Nova speaks", () => {
  it("generates one presentation for one completed audit", async () => {
    const outcome = await runPipeline();

    expect(outcome.ok).toBe(true);
    expect(operationRow().status).toBe("completed");
    expect(provider.novaRequests()).toHaveLength(1);
    expect(db.rows("nova_voice_messages")).toHaveLength(1);
  });

  it("shows the model's sentence to a component that reads it", async () => {
    await runPipeline();

    expect(await readVoice()).toMatchObject({ message: SPOKEN, source: "voice" });
  });

  it("records the spend as nova_presentation on the existing ledger", async () => {
    await runPipeline();

    expect(novaUsageRows()).toHaveLength(1);
    expect(novaUsageRows()[0]).toMatchObject({
      operation: "nova_presentation",
      job_id: operationId,
      status: "succeeded",
      input_tokens: 480,
    });
  });

  /**
   * The accounting assumption, pinned. `job_id` is unique across the ledger, so
   * one operation may carry at most one presentation event — and the audit's
   * own usage row uses `result_id`, a different value, so the two do not
   * collide. A future slice that made one operation speak twice would break
   * here rather than silently dropping the second row.
   */
  it("keeps the audit's own usage row and Nova's apart", async () => {
    await runPipeline();

    const rows = db.rows("ai_usage_events") as unknown as { operation: string; job_id: string }[];
    const jobIds = rows.map((row) => row.job_id);

    expect(rows.map((row) => row.operation).sort()).toEqual([
      "business_readiness_audit",
      "nova_presentation",
    ]);
    expect(new Set(jobIds).size).toBe(2);
    expect(jobIds).toContain(operationId);
    expect(jobIds).toContain(operationRow().result_id);
  });

  /** Presentation is Vibe's infrastructure cost. */
  it("posts no credit entry for the presentation", async () => {
    const before = db.rows("billing_credit_ledger").length;
    await runPipeline();

    const novaEntries = (
      db.rows("billing_credit_ledger") as unknown as { reason?: string }[]
    ).filter((row) => String(row.reason ?? "").includes("nova"));

    expect(novaEntries).toEqual([]);
    expect(db.rows("billing_credit_ledger").length).toBeGreaterThanOrEqual(before);
  });
});

describe("the audit does not depend on Nova", () => {
  it.each([
    [
      "the voice model throws",
      async (): Promise<StructuredResult> => {
        throw new Error("socket hang up");
      },
    ],
    [
      "the voice model refuses",
      async (): Promise<StructuredResult> => ({
        ok: false,
        error: "provider_overloaded",
        model: NOVA_PRESENTATION_CONFIG.model,
        latencyMs: 40,
      }),
    ],
    [
      "the voice model returns nothing usable",
      async (): Promise<StructuredResult> => ({
        ok: true,
        data: { wrong: "shape" },
        usage: { inputTokens: 480, outputTokens: 5, thinkingTokens: 0 },
        model: NOVA_PRESENTATION_CONFIG.model,
        latencyMs: 300,
      }),
    ],
    [
      "the validator refuses what the voice model wrote",
      async (): Promise<StructuredResult> =>
        voiceSaying("Your score is 62 and your product is live."),
    ],
  ])("completes the audit when %s", async (_label, nova) => {
    provider = new SlotAwareProvider(nova);

    const outcome = await runPipeline();

    expect(outcome.ok).toBe(true);
    expect(operationRow().status).toBe("completed");
    expect(db.rows("business_readiness_audits")[0]).toMatchObject({ status: "completed" });
  });

  it("shows the template when the voice failed", async () => {
    provider = new SlotAwareProvider(async () => {
      throw new Error("socket hang up");
    });
    await runPipeline();

    const read = await readVoice();

    expect(read.message).toBe(buildNovaAuditTemplate(renderedEntry()));
    expect(read.source).toBe("template");
  });
});

describe("nothing a founder does afterwards spends again", () => {
  /** A refresh is a read. Reads have no provider. */
  it("generates nothing on eight refreshes", async () => {
    await runPipeline();
    const after = provider.novaRequests().length;

    for (let refresh = 0; refresh < 8; refresh += 1) await readVoice();

    expect(provider.novaRequests()).toHaveLength(after);
    expect(novaUsageRows()).toHaveLength(1);
  });

  it("generates nothing on four concurrent reads", async () => {
    await runPipeline();
    const after = provider.novaRequests().length;

    await Promise.all([readVoice(), readVoice(), readVoice(), readVoice()]);

    expect(provider.novaRequests()).toHaveLength(after);
  });

  /**
   * A replayed completion step. `completeOperationRun` returns whether *this*
   * call transitioned, so the second one returns early — which is what makes
   * one presentation per operation a property of the state machine.
   */
  it("generates nothing when the completion step is replayed", async () => {
    const outcome = await runPipeline();
    if (!outcome.auditId) throw new Error("the pipeline must produce an audit");

    await completeOperationStep(deps(), operationId, outcome.auditId);
    await completeOperationStep(deps(), operationId, outcome.auditId);

    expect(provider.novaRequests()).toHaveLength(1);
    expect(novaUsageRows()).toHaveLength(1);
  });

  /** And a fallback is as final as a sentence: a failure is not retried either. */
  it("does not try again after the voice failed", async () => {
    provider = new SlotAwareProvider(async () => ({
      ok: false,
      error: "provider_overloaded",
      model: NOVA_PRESENTATION_CONFIG.model,
      latencyMs: 40,
    }));
    const outcome = await runPipeline();
    if (!outcome.auditId) throw new Error("the pipeline must produce an audit");

    await completeOperationStep(deps(), operationId, outcome.auditId);
    await readVoice();

    expect(provider.novaRequests()).toHaveLength(1);
  });
});
