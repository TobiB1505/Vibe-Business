import { beforeEach, describe, expect, it } from "vitest";
import { approvalBlockMessage } from "@/modules/approvals/messages";
import { getApprovalCard } from "@/modules/approvals/service";
import { getBusinessImpactCard } from "@/modules/business-measurement/service";
import { NoConnectedMetricSources } from "@/modules/business-measurement/source";
import { getPreviewCard } from "@/modules/change-preview/service";
import {
  FakeDatabase,
  fakeSupabase,
  newQueryRecorder,
  readsOf,
  selectsOf,
  type QueryRecorder,
} from "@/modules/operations/test-support";
import { OPERATION_FAILURE_MESSAGES } from "@/modules/operations/messages";
import { getOutcomeCard } from "@/modules/outcome-verification/service";
import { getReviewCard } from "@/modules/review/service";
import { getLatestValidation } from "@/modules/validation/service";
import { FIXTURE_ROUTES, fakeRepositorySnapshotFor } from "./test-support";
import { countPreparedChangesForProject } from "./store";
import { getPreparedChangeWorkspace, listPreparedChangeSummaries } from "./workspace";

/**
 * The prepared-change workspace, executed (VB-023).
 *
 * ## Why this file did not exist before
 *
 * It should have. `getPreparedChangeWorkspace` is the most expensive read model
 * in the product and it feeds the screen where a person approves a change to
 * their own repository — and until this file, nothing ran it. What existed was
 * `workspace-cost.test.ts`, which reads the *source* and asserts nobody wrote
 * `await` inside a loop. That is a real check and it is honest about being
 * textual; it cannot see a fan-out spread across six modules' services, where
 * every individual call site looks correct.
 *
 * ## What it proves
 *
 * Two things, and the second is the one that made the batching safe to do.
 *
 * **The cost is constant in the number of changes.** Measured, not asserted
 * from the shape of the code: the fake client counts every query, and the
 * count for eight changes equals the count for one.
 *
 * **Batching changed nothing about the answer.** Every card the batched
 * assembly produces is compared against the same card built by the ordinary
 * single-change service call, which reads for itself. If prefetching ever hands
 * a service a row that leads it somewhere different, these differ.
 */

const USER = "user_1";
const PROJECT = "project_1";
const COMMIT = "a".repeat(40);
const BASE_SHA = "b".repeat(40);

let db: FakeDatabase;
let recorder: QueryRecorder;

function client() {
  return fakeSupabase(db, recorder);
}

function seedProject() {
  db.seed("projects", { id: PROJECT, user_id: USER, production_url: "https://acme.test" });
}

/**
 * A snapshot whose `result` is a real analyzer shape.
 *
 * `{}` would do for the row to exist, and that is exactly why it will not do:
 * an empty result makes the outcome contract *unsupported*, so a card built
 * from the right snapshot and a card built from no snapshot at all come out
 * identical — and the comparison below would prove nothing about either.
 */
function seedSnapshot() {
  db.seed("repository_intelligence_snapshots", {
    id: "snapshot_1",
    project_id: PROJECT,
    status: "completed",
    source_commit_sha: COMMIT,
    source_branch: "main",
    analyzer_version: "repo-intelligence-v2",
    completeness: "complete",
    completeness_reasons: [],
    failure_code: null,
    result: { ...fakeRepositorySnapshotFor(), routes: { mode: "app_router", truncated: false, routes: FIXTURE_ROUTES } },
    created_at: new Date(Date.UTC(2026, 0, 1)).toISOString(),
    completed_at: new Date(Date.UTC(2026, 0, 1)).toISOString(),
  });
}

function seedChange(
  index: number,
  stage: "unvalidated" | "validated" | "reviewed" | "approved" | "merged",
): string {
  const id = `prepared_${index}`;

  db.seed("prepared_changes", {
    id,
    project_id: PROJECT,
    user_id: USER,
    operation_run_id: `run_${index}`,
    opportunity_set_id: null,
    opportunity_id: null,
    execution_capability: "nextjs_seo_foundations_v2",
    execution_version: "1",
    repository_snapshot_id: "snapshot_1",
    base_branch: "main",
    base_sha: BASE_SHA,
    branch_name: `vibe/change-${index}`,
    commit_sha: COMMIT,
    files: [{ path: "src/app/robots.ts", contentHash: "c".repeat(64), bytes: 400 }],
    execution_identity: `identity_${index}`,
    status: "prepared",
    failure_code: null,
    created_at: new Date(Date.UTC(2026, 0, index)).toISOString(),
    completed_at: null,
  });

  if (stage === "unvalidated") return id;

  db.seed("validation_runs", {
    id: `validation_${index}`,
    project_id: PROJECT,
    user_id: USER,
    prepared_change_id: id,
    status: "passed",
    prepared_commit_sha: COMMIT,
    validation_profile: "next_app_router",
    artifact_snapshot_id: `snapshot_${index}`,
    artifact_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    artifact_deleted_at: null,
    created_at: new Date(Date.UTC(2026, 0, index, 1)).toISOString(),
  });

  if (stage === "validated") return id;

  db.seed("review_artifacts", {
    id: `review_${index}`,
    project_id: PROJECT,
    user_id: USER,
    prepared_change_id: id,
    validation_run_id: `validation_${index}`,
    preview_session_id: `preview_${index}`,
    operation_run_id: `run_${index}`,
    status: "ready",
    review_policy_version: "review-policy-v1",
    review_identity: "r".repeat(64),
    created_at: new Date(Date.UTC(2026, 0, index, 2)).toISOString(),
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
  });

  if (stage === "reviewed") return id;

  db.seed("change_approvals", {
    id: `approval_${index}`,
    project_id: PROJECT,
    user_id: USER,
    prepared_change_id: id,
    validation_run_id: `validation_${index}`,
    review_artifact_id: `review_${index}`,
    status: "approved",
    prepared_commit_sha: COMMIT,
    prepared_base_sha: BASE_SHA,
    approval_identity: `stale_identity_${index}`,
    approval_policy_version: "approval-policy-v1",
    created_at: new Date(Date.UTC(2026, 0, index, 3)).toISOString(),
  });

  if (stage === "approved") return id;

  db.seed("change_merges", {
    id: `merge_${index}`,
    project_id: PROJECT,
    user_id: USER,
    prepared_change_id: id,
    change_approval_id: `approval_${index}`,
    prepared_commit_sha: COMMIT,
    prepared_base_sha: BASE_SHA,
    default_branch: "main",
    merge_policy_version: "merge-policy-v1",
    merge_strategy: "fast_forward_exact_commit",
    merge_identity: `m${index}`.padEnd(64, "0"),
    operation_run_id: `run_${index}`,
    status: "merged",
    // Read back and equal to the approved commit — the state that makes an
    // outcome verification eligible, and therefore the state that sends the
    // card down its most expensive branch.
    resulting_default_head_sha: COMMIT,
    created_at: new Date(Date.UTC(2026, 0, index, 4)).toISOString(),
  });

  /*
   * A merged change's measurement plan.
   *
   * Seeded for the same reason the snapshot carries a real analyzer result: a
   * merged change with no plan and a merged change whose plan was looked up
   * wrongly produce the same card, so without this the plan lookup is compared
   * against nothing.
   */
  db.seed("measurement_plans", {
    id: `plan_${index}`,
    project_id: PROJECT,
    user_id: USER,
    prepared_change_id: id,
    change_merge_id: `merge_${index}`,
    business_goal: `Grow signups for change ${index}`,
    primary_metric: "search_impressions",
    secondary_metrics: [],
    metric_direction: "higher_is_better",
    metric_category: "search_visibility",
    compatible_source_kinds: ["search_console"],
    baseline_days: 14,
    measurement_days: 14,
    settling_days: 1,
    minimum_observations: 500,
    measurement_profile: "seo_foundations_measurement_v1",
    measurement_profile_version: "1",
    measurement_policy_version: "measurement-policy-v1",
    status: "ready",
    unsupported_reason: null,
    created_at: new Date(Date.UTC(2026, 0, index, 5)).toISOString(),
    updated_at: new Date(Date.UTC(2026, 0, index, 5)).toISOString(),
  });

  return id;
}

/** One project holding a change at each stage of the lifecycle. */
function seedEveryStage(): string[] {
  seedProject();
  seedSnapshot();
  return [
    seedChange(1, "unvalidated"),
    seedChange(2, "validated"),
    seedChange(3, "reviewed"),
    seedChange(4, "approved"),
    // Merged changes stay `prepared`, so they stay on this screen — which
    // makes them the shape the equivalence check most needs to cover.
    seedChange(5, "merged"),
  ];
}

function seedIdenticalChanges(
  count: number,
  stage: Parameters<typeof seedChange>[1] = "validated",
) {
  seedProject();
  seedSnapshot();
  for (let index = 1; index <= count; index += 1) seedChange(index, stage);
}

function reset() {
  db = new FakeDatabase();
  recorder = newQueryRecorder();
}

beforeEach(reset);

async function workspace() {
  return getPreparedChangeWorkspace(client(), {
    projectId: PROJECT,
    userId: USER,
    repositoryFullName: null,
  });
}

describe("assembling the workspace", () => {
  it("returns one card per prepared change, newest first", async () => {
    seedEveryStage();

    const cards = await workspace();

    expect(cards.map((card) => card.id)).toEqual([
      "prepared_5",
      "prepared_4",
      "prepared_3",
      "prepared_2",
      "prepared_1",
    ]);
  });

  it("reports each change's own lifecycle state rather than the list's", async () => {
    seedEveryStage();

    const byId = new Map((await workspace()).map((card) => [card.id, card]));

    expect(byId.get("prepared_1")?.validation).toBeNull();
    expect(byId.get("prepared_2")?.validation?.status).toBe("passed");
    expect(byId.get("prepared_2")?.review.state).toBe("not_generated");
    expect(byId.get("prepared_3")?.review.state).toBe("ready");
    // Seeded with an approval identity that no longer matches the artifact,
    // so the card must say the decision no longer applies rather than
    // quietly retargeting it.
    expect(byId.get("prepared_4")?.approval.state).toBe("invalidated");
  });
});

describe("what a render costs", () => {
  async function readCount(
    changes: number,
    stage: Parameters<typeof seedChange>[1] = "validated",
  ): Promise<number> {
    reset();
    seedIdenticalChanges(changes, stage);
    await workspace();
    return recorder.reads.length;
  }

  async function tableCounts(
    changes: number,
    stage: Parameters<typeof seedChange>[1],
  ): Promise<Record<string, number>> {
    reset();
    seedIdenticalChanges(changes, stage);
    await workspace();

    const counts: Record<string, number> = {};
    for (const table of recorder.reads) counts[table] = (counts[table] ?? 0) + 1;
    return counts;
  }

  it("does not grow with the number of prepared changes", async () => {
    /*
     * The number itself is not the property — a future card needing a seventh
     * table would legitimately change it. What must not change is that eight
     * changes cost what one costs.
     */
    expect(await readCount(8)).toBe(await readCount(1));
  });

  it("adds only the three named per-change reads when changes are merged", async () => {
    /*
     * A merged change is the expensive branch, and the one that accumulates:
     * nothing moves a change out of `prepared`, so every change a founder has
     * ever merged stays on this screen. The outcome and business-impact cards
     * stop short-circuiting for it and go looking for a measurement plan, the
     * project's public origin and the repository snapshot it was prepared
     * against — all now read once for the list.
     *
     * What is left per change is deliberate, and this says exactly what:
     *
     *  - `change_approvals` — the standing approval for the *current artifact
     *    identity*. Never answered from a row handed in (rules 55, 70).
     *  - `review_artifacts` and `projects` — `getReviewImages` re-checks
     *    ownership, the ready state and the retention deadline immediately
     *    before it signs URLs. Ownership is the query, not a later check.
     *
     * A fourth entry appearing here is a fan-out that came back.
     */
    const one = await tableCounts(1, "merged");
    const eight = await tableCounts(8, "merged");

    const perChange: Record<string, number> = {};
    for (const table of new Set([...Object.keys(one), ...Object.keys(eight)])) {
      const growth = (eight[table] ?? 0) - (one[table] ?? 0);
      if (growth !== 0) perChange[table] = growth / 7;
    }

    expect(perChange).toEqual({
      change_approvals: 1,
      review_artifacts: 1,
      projects: 1,
    });
  });

  it("reads each lifecycle table exactly once", async () => {
    reset();
    seedIdenticalChanges(8);
    await workspace();

    for (const table of [
      "prepared_changes",
      "validation_runs",
      "preview_sessions",
      "review_artifacts",
      "change_approvals",
      "change_merges",
      "change_outcome_verifications",
    ]) {
      expect(readsOf(recorder, table), `${table} was read more than once`).toBe(1);
    }
  });

  it("summarises a list without a read per change", async () => {
    seedIdenticalChanges(8);

    const summaries = await listPreparedChangeSummaries(client(), {
      projectId: PROJECT,
      repositoryFullName: "acme/product",
    });

    expect(summaries).toHaveLength(8);
    expect(summaries.every((summary) => summary.validationStatus === "passed")).toBe(true);
    expect(recorder.reads).toEqual(["prepared_changes", "validation_runs"]);
  });

  it("counts prepared changes without transferring any", async () => {
    /*
     * What the Agent route's `<Suspense>` shell renders before the changes
     * arrive. It is a `head`-only count, and until VB-022 the in-memory client
     * dropped those options and answered zero for every such query — so this
     * asserts the number rather than trusting the double.
     */
    seedIdenticalChanges(5);

    expect(await countPreparedChangesForProject(client(), PROJECT)).toBe(5);
    expect(selectsOf(recorder, "prepared_changes")).toEqual(["id"]);
  });

  it("asks nothing at all when a project has no prepared changes", async () => {
    seedProject();

    expect(await workspace()).toEqual([]);
    expect(recorder.reads).toEqual(["prepared_changes"]);
  });
});

describe("batching did not change the answer", () => {
  /*
   * The refactor's real risk is not a wrong count — it is a card that reads
   * differently because a service was handed a row instead of reading one. So
   * every card is rebuilt here the ordinary way, by the same service with no
   * prefetch, and compared.
   */

  it("produces the cards the unbatched services produce", async () => {
    const ids = seedEveryStage();
    const cards = new Map((await workspace()).map((card) => [card.id, card]));

    for (const preparedChangeId of ids) {
      const card = cards.get(preparedChangeId);
      expect(card, `no card for ${preparedChangeId}`).toBeDefined();
      if (!card) continue;

      const scope = { projectId: PROJECT, preparedChangeId };

      const validation = await getLatestValidation(client(), scope);
      expect(card.validation?.status ?? null).toBe(validation?.status ?? null);

      expect(card.review).toEqual(
        await getReviewCard(client(), {
          ...scope,
          resolveFailureMessage: (code) =>
            OPERATION_FAILURE_MESSAGES[code as keyof typeof OPERATION_FAILURE_MESSAGES] ?? null,
        }),
      );

      expect(card.preview).toEqual(
        await getPreviewCard(client(), {
          ...scope,
          validation: validation ? { id: validation.id, status: validation.status } : null,
          resolveFailureMessage: (code) =>
            OPERATION_FAILURE_MESSAGES[code as keyof typeof OPERATION_FAILURE_MESSAGES] ?? null,
        }),
      );

      expect(card.outcome).toEqual(await getOutcomeCard(client(), scope));

      expect(card.businessImpact).toEqual(
        await getBusinessImpactCard(client(), new NoConnectedMetricSources(), scope),
      );

      expect(card.approval).toEqual(
        await getApprovalCard(client(), {
          ...scope,
          userId: USER,
          resolveBlockMessage: approvalBlockMessage,
        }),
      );
    }
  });
});
