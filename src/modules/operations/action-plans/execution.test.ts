import { beforeEach, describe, expect, it } from "vitest";
import { ACTION_PLANNING_CONFIG } from "@/modules/ai/operations";
import { ACTION_PLANNER_PROMPT_VERSION } from "@/modules/action-plans/prompt";
import { ACTION_PLANNER_RUBRIC_VERSION } from "@/modules/action-plans/rubric";
import {
  ACTION_PLANNER_CONTRACT_VERSION,
  ACTION_PLANNER_VERSION,
  ACTION_PLAN_SCHEMA_VERSION,
} from "@/modules/action-plans/schema";
import { computeActionPlanInputHash } from "@/modules/action-plans/store";
import { fakePlannedAudit } from "@/modules/action-plans/test-support";
import {
  FakeProvider,
  fakeLiveSnapshot,
  fakeRepositorySnapshot,
} from "@/modules/business-audit/test-support";
import type { ExecutionDeps } from "../business-audit/execution";
import { FakeDatabase, fakeSupabase, seedProductUnderstanding } from "../test-support";
import { prepareActionPlanStep } from "./execution";

/**
 * The Action Planner's durable step 1, which had no test of any kind.
 *
 * Every other consumer of the execution foundation has one; this one was wired
 * straight into the Vercel executor and never exercised below the workflow. The
 * gap surfaced while adding the rebuild-provenance guard: the guard went into
 * both `loadSources` implementations, and only one of them had a harness that
 * could go red.
 *
 * This file is deliberately narrow — step 1, and the inputs it refuses on. It
 * is not the coverage the planner deserves; it is the coverage the guard needs
 * in order to be a guard here rather than an unexercised line.
 */

const USER = "user_1";
const PROJECT = "project_1";
const AUDIT = "audit_1";
const AUDIT_HASH = "a".repeat(64);
const SET = "set_1";
const MOVE = "move_1";
const PROFILE = "profile_1";
const INTENT_HASH = "c".repeat(64);
const CONCLUSION_KEY = "blocker-1";

function identity() {
  return computeActionPlanInputHash({
    auditId: AUDIT,
    auditInputHash: AUDIT_HASH,
    opportunitySetId: SET,
    opportunityId: MOVE,
    conclusionKey: CONCLUSION_KEY,
    productProfileId: PROFILE,
    founderIntentHash: INTENT_HASH,
    evidencePackVersion: fakePlannedAudit().evidencePackVersion,
    contractVersion: ACTION_PLANNER_CONTRACT_VERSION,
    plannerVersion: ACTION_PLANNER_VERSION,
    promptVersion: ACTION_PLANNER_PROMPT_VERSION,
    rubricVersion: ACTION_PLANNER_RUBRIC_VERSION,
    schemaVersion: ACTION_PLAN_SCHEMA_VERSION,
    provider: "anthropic",
    model: ACTION_PLANNING_CONFIG.model,
  });
}

let db: FakeDatabase;
let provider: FakeProvider;
const operationId = "operation_1";

function deps(): ExecutionDeps {
  return { supabase: fakeSupabase(db), provider };
}

function seed() {
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
    // The planner reads the synthesis: a Move's conclusion key names a blocker
    // in it, and a source that cannot be resolved refuses before any spend.
    result: fakePlannedAudit(),
    overall_score: 40,
    repository_snapshot_id: "repo_snapshot_1",
    live_snapshot_id: "live_snapshot_1",
    product_profile_id: PROFILE,
    founder_intent_hash: INTENT_HASH,
    created_at: "2026-08-02T00:00:00.000Z",
    completed_at: "2026-08-02T00:00:00.000Z",
  });

  db.seed("opportunity_sets", {
    id: SET,
    project_id: PROJECT,
    business_audit_id: AUDIT,
    status: "completed",
    opportunity_count: 1,
    input_hash: "o".repeat(64),
    created_at: "2026-08-03T00:00:00.000Z",
    completed_at: "2026-08-03T00:00:00.000Z",
  });

  db.seed("business_opportunities", {
    id: MOVE,
    opportunity_set_id: SET,
    rank: 1,
    source_conclusion_key: CONCLUSION_KEY,
    title: "Name the first customer",
    problem: "The site speaks to founders in general.",
    why_now: "Everything downstream depends on it.",
    impact: "high",
    effort: "medium",
    confidence: "high",
    category: "positioning",
    primary_dimension: "product",
    secondary_dimensions: [],
    evidence_ids: ["profile.identity.description", "live.site.title"],
    execution_type: "founder_action",
    execution_readiness: "needs_decision",
    dependencies: [],
  });

  db.seed("operation_runs", {
    id: operationId,
    project_id: PROJECT,
    user_id: USER,
    operation_type: "action_planning",
    status: "queued",
    stage: "preparing",
    input_identity: identity(),
    subject_id: MOVE,
    workflow_run_id: "run_1",
    execution_provider: "fake_executor",
    result_id: null,
    inference_started_at: null,
    failure_code: null,
    started_at: null,
    completed_at: null,
    created_at: "2026-08-04T00:00:00.000Z",
  });
}

const operationRow = () => db.rows("operation_runs")[0];
const planRows = () => db.rows("action_plans");

beforeEach(() => {
  db = new FakeDatabase();
  provider = new FakeProvider({});
  seed();
});

describe("the fixture describes a world the planner accepts", () => {
  /**
   * Not decoration. Every refusal below asserts that step 1 *stopped*, and a
   * fixture that never got past sourcing would make all of them pass for the
   * wrong reason. This is the assertion that the refusals mean something.
   */
  it("claims a plan when nothing has moved", async () => {
    const outcome = await prepareActionPlanStep(deps(), operationId);

    expect(outcome.ok).toBe(true);
    expect(planRows()).toHaveLength(1);
    expect(planRows()[0].source_conclusion_key).toBe(CONCLUSION_KEY);
    expect(provider.requests).toHaveLength(0);
  });
});

describe("the rebuild-provenance guard", () => {
  /**
   * `computeActionPlanInputHash` carries the profile and the founder intent, so
   * those moving is already caught. It carries no snapshot id — and the pack
   * this step rebuilds is built from whatever the latest snapshot is now, not
   * from what the audit reasoned over.
   */
  it("refuses when a repository scan finished between the click and the step", async () => {
    db.seed("repository_intelligence_snapshots", {
      id: "repo_snapshot_2",
      project_id: PROJECT,
      status: "completed",
      result: fakeRepositorySnapshot(),
      created_at: "2026-08-05T00:00:00.000Z",
    });

    // Untouched by that scan, which is the whole reason the guard is needed.
    expect(operationRow().input_identity).toBe(identity());

    const outcome = await prepareActionPlanStep(deps(), operationId);

    expect(outcome).toEqual({ ok: false, failureCode: "inputs_changed" });
    expect(planRows()).toHaveLength(0);
    expect(provider.requests).toHaveLength(0);
  });

  it("refuses when a live scan finished between the click and the step", async () => {
    db.seed("live_product_intelligence_snapshots", {
      id: "live_snapshot_2",
      project_id: PROJECT,
      status: "completed",
      result: fakeLiveSnapshot(),
      created_at: "2026-08-05T00:00:00.000Z",
      completed_at: "2026-08-05T00:00:00.000Z",
    });

    expect(operationRow().input_identity).toBe(identity());

    const outcome = await prepareActionPlanStep(deps(), operationId);

    expect(outcome).toEqual({ ok: false, failureCode: "inputs_changed" });
    expect(planRows()).toHaveLength(0);
  });
});
