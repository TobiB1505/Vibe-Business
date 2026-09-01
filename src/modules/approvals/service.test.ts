import { beforeEach, describe, expect, it } from "vitest";
import { FakeDatabase, fakeSupabase } from "@/modules/operations/test-support";
import { FIXTURE_COMMIT_SHA } from "@/modules/validation/test-support";
import {
  REVIEW_CLASSIFICATION_VERSION,
  type ReviewClassification,
  type ReviewClassificationResult,
} from "@/modules/review/classification";
import { computeApprovalIdentity, type ApprovalEvidence } from "./identity";
import { approvalBlockMessage } from "./messages";
import { APPROVAL_POLICY_VERSION } from "./schema";
import {
  approveChange,
  findActiveApprovalForCurrentArtifact,
  getApprovalCard,
  revokeChangeApproval,
} from "./service";

/**
 * Eligibility, identity, confirmation and authority (Sprint 11B §29–§33).
 *
 * These are the four ways a human approval goes wrong, and the fourth is the
 * one that matters most: an approval that quietly comes to mean something the
 * human never agreed to. Sprint 11C will read these rows as the reason it is
 * allowed to write to a customer's default branch, so "approved" has to keep
 * pointing at the exact bytes a person looked at — after a re-preparation,
 * after a second validation, after a fresh comparison.
 *
 * Everything runs against the in-memory database, which now models the
 * approval table's partial unique index and its CHECK constraints, so
 * idempotency and terminal-state assertions test the guarantee Postgres gives
 * rather than the application's own pre-check.
 */

const USER = "user_1";
const OTHER_USER = "user_2";
const PROJECT = "project_1";
const OTHER_PROJECT = "project_2";
const PREPARED = "prepared_1";
const VALIDATION = "validation_1";
const REVIEW = "review_1";
const BASE_SHA = "b".repeat(40);
const SECOND_COMMIT = "c".repeat(40);

let db: FakeDatabase;

const LATER = () => new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
const EARLIER = () => new Date(Date.now() - 60 * 1000).toISOString();

function client() {
  return fakeSupabase(db);
}

function identityFor(
  overrides: {
    commitSha?: string;
    baseSha?: string;
    validationRunId?: string;
    reviewArtifactId?: string;
    evidence?: ApprovalEvidence;
    policyVersion?: string;
  } = {},
) {
  return computeApprovalIdentity({
    projectId: PROJECT,
    preparedChangeId: PREPARED,
    preparedCommitSha: overrides.commitSha ?? FIXTURE_COMMIT_SHA,
    preparedBaseSha: overrides.baseSha ?? BASE_SHA,
    validationRunId: overrides.validationRunId ?? VALIDATION,
    evidence: overrides.evidence ?? {
      kind: "review_artifact",
      reviewArtifactId: overrides.reviewArtifactId ?? REVIEW,
    },
    approvalPolicyVersion: overrides.policyVersion ?? APPROVAL_POLICY_VERSION,
  });
}

/**
 * The classification a test runs under.
 *
 * `null` by default, which is the stricter path and exactly what every test
 * written before ADR 0063 assumed: a visual comparison is required. The
 * code-diff tests opt in explicitly.
 */
function classificationOf(
  classification: ReviewClassification,
  overrides: Partial<ReviewClassificationResult> = {},
): ReviewClassificationResult {
  return {
    classification,
    policyVersion: REVIEW_CLASSIFICATION_VERSION,
    visualPaths: [],
    codePaths: ["src/app/robots.ts"],
    routes: [],
    scopes: [],
    downgradedPaths: [],
    ...overrides,
  };
}

function seed(
  options: {
    preparedStatus?: string;
    commitSha?: string | null;
    validationStatus?: string;
    reviewStatus?: string;
    reviewExpiresAt?: string;
    reviewValidationRunId?: string;
    withReview?: boolean;
  } = {},
) {
  db.seed("projects", { id: PROJECT, user_id: USER, production_url: "https://example.test" });
  db.seed("projects", { id: OTHER_PROJECT, user_id: OTHER_USER, production_url: null });

  db.seed("prepared_changes", {
    id: PREPARED,
    project_id: PROJECT,
    user_id: USER,
    status: options.preparedStatus ?? "prepared",
    commit_sha: options.commitSha === undefined ? FIXTURE_COMMIT_SHA : options.commitSha,
    base_sha: BASE_SHA,
    base_branch: "main",
    branch_name: "vibe/seo",
    files: [{ path: "src/app/robots.ts", contentHash: "a".repeat(64), bytes: 408 }],
  });

  db.seed("validation_runs", {
    id: VALIDATION,
    project_id: PROJECT,
    user_id: USER,
    prepared_change_id: PREPARED,
    status: options.validationStatus ?? "passed",
    prepared_commit_sha: FIXTURE_COMMIT_SHA,
    created_at: "2026-08-14T00:00:00.000Z",
  });

  if (options.withReview !== false) {
    db.seed("review_artifacts", {
      id: REVIEW,
      project_id: PROJECT,
      user_id: USER,
      prepared_change_id: PREPARED,
      validation_run_id: options.reviewValidationRunId ?? VALIDATION,
      preview_session_id: "preview_1",
      operation_run_id: "op_1",
      status: options.reviewStatus ?? "ready",
      review_policy_version: "review-policy-v1",
      review_identity: "r".repeat(64),
      created_at: "2026-08-14T01:00:00.000Z",
      expires_at: options.reviewExpiresAt ?? LATER(),
    });
  }
}

function approve(
  overrides: {
    reviewArtifactId?: string | null;
    confirmed?: boolean;
    userId?: string;
    classification?: ReviewClassificationResult | null;
  } = {},
) {
  return approveChange(client(), {
    projectId: PROJECT,
    userId: overrides.userId ?? USER,
    preparedChangeId: PREPARED,
    reviewArtifactId:
      overrides.reviewArtifactId === undefined ? REVIEW : overrides.reviewArtifactId,
    classification: overrides.classification ?? null,
    confirmed: overrides.confirmed ?? true,
  });
}

function card(userId = USER, classification: ReviewClassificationResult | null = null) {
  return getApprovalCard(client(), {
    projectId: PROJECT,
    userId,
    preparedChangeId: PREPARED,
    classification,
    resolveBlockMessage: approvalBlockMessage,
  });
}

beforeEach(() => {
  db = new FakeDatabase();
});

describe("eligibility", () => {
  it("approves a prepared, validated, reviewed change", async () => {
    seed();

    const outcome = await approve();

    expect(outcome.kind).toBe("approved");
    expect(db.rows("change_approvals")).toHaveLength(1);
  });

  it("refuses without a completed comparison", async () => {
    seed({ withReview: false });

    const outcome = await approve();

    expect(outcome).toEqual({ kind: "blocked", reason: "approval_review_required" });
    expect(db.rows("change_approvals")).toHaveLength(0);
  });

  it("refuses when the comparison failed", async () => {
    seed({ reviewStatus: "failed" });

    expect(await approve()).toEqual({ kind: "blocked", reason: "approval_review_required" });
  });

  it("refuses a comparison of a different validation run", async () => {
    // Evidence about different bytes. The images may look fine and still be a
    // picture of something else (§4).
    seed({ reviewValidationRunId: "validation_other" });

    expect(await approve()).toEqual({ kind: "blocked", reason: "approval_review_required" });
  });

  it("refuses when the comparison is past retention", async () => {
    seed({ reviewExpiresAt: EARLIER() });

    // Its own reason: "you never made one" and "the one you made can no longer
    // be looked at" have different remedies, and only the second costs money.
    expect(await approve()).toEqual({ kind: "blocked", reason: "approval_review_expired" });
  });

  it("refuses without a passing validation", async () => {
    seed({ validationStatus: "failed" });

    expect(await approve()).toEqual({ kind: "blocked", reason: "approval_validation_required" });
  });

  it("refuses a change that never produced a commit", async () => {
    seed({ commitSha: null, preparedStatus: "failed" });

    expect(await approve()).toEqual({ kind: "blocked", reason: "approval_change_not_prepared" });
  });

  it("does not require the preview to still be running", async () => {
    // The whole lifecycle this product is built around: preview → comparison →
    // preview stopped → the human reviews later. Nothing here reads a preview
    // session at all, and no session is seeded (§5).
    seed();

    expect((await approve()).kind).toBe("approved");
  });
});

describe("authority", () => {
  it("refuses a user who does not own the project", async () => {
    seed();

    const outcome = await approveChange(client(), {
      projectId: PROJECT,
      userId: OTHER_USER,
      preparedChangeId: PREPARED,
      reviewArtifactId: REVIEW,
      classification: null,
      confirmed: true,
    });

    expect(outcome).toEqual({ kind: "blocked", reason: "approval_not_authorized" });
    expect(db.rows("change_approvals")).toHaveLength(0);
  });

  it("records the approver from the session, never from the caller's data", async () => {
    seed();

    await approve();

    expect(db.rows("change_approvals")[0].user_id).toBe(USER);
  });

  it("refuses a review artifact the client named but the server did not resolve", async () => {
    // A stale tab approving a comparison that has since been replaced.
    seed();

    expect(await approve({ reviewArtifactId: "review_from_another_tab" })).toEqual({
      kind: "blocked",
      reason: "approval_review_required",
    });
  });
});

describe("confirmation", () => {
  it("refuses an unconfirmed approval", async () => {
    seed();

    const outcome = await approve({ confirmed: false });

    expect(outcome).toEqual({ kind: "blocked", reason: "approval_confirmation_required" });
    expect(db.rows("change_approvals")).toHaveLength(0);
    // Not a single audit event either: an unconfirmed call must leave no trace
    // that anything was attempted (§8).
    expect(db.rows("audit_events")).toHaveLength(0);
  });

  it("refuses an unconfirmed revocation", async () => {
    seed();
    const approved = await approve();
    if (approved.kind !== "approved") throw new Error("expected approval");

    const outcome = await revokeChangeApproval(client(), {
      projectId: PROJECT,
      userId: USER,
      approvalId: approved.approval.id,
      confirmed: false,
    });

    expect(outcome).toEqual({ kind: "blocked", reason: "approval_confirmation_required" });
    expect(db.rows("change_approvals")[0].status).toBe("approved");
  });

  it("reading the card never writes an approval", async () => {
    seed();

    await card();

    expect(db.rows("change_approvals")).toHaveLength(0);
  });
});

describe("exact identity", () => {
  it("binds the approval to the commit that was reviewed", async () => {
    seed();

    const outcome = await approve();
    if (outcome.kind !== "approved") throw new Error("expected approval");

    expect(outcome.approval.preparedCommitSha).toBe(FIXTURE_COMMIT_SHA);
    expect(outcome.approval.preparedBaseSha).toBe(BASE_SHA);
    expect(outcome.approval.approvalIdentity).toBe(identityFor());
    expect(outcome.approval.approvalPolicyVersion).toBe(APPROVAL_POLICY_VERSION);
  });

  it("does not carry an approval forward to a new commit", async () => {
    seed();
    await approve();

    // The preparation was re-run and the branch now points somewhere else.
    db.rows("prepared_changes")[0].commit_sha = SECOND_COMMIT;

    const state = await card();

    // Never `approved`. The human approved bytes that are no longer there (§13).
    expect(state.state).toBe("invalidated");
    expect(state.invalidationReason).toBe("prepared_change_modified");
    expect(state.approvedCommitSha).toBe(FIXTURE_COMMIT_SHA);
    expect(state.currentCommitSha).toBe(SECOND_COMMIT);
  });

  it("does not carry an approval forward to a newer comparison", async () => {
    seed();
    await approve();

    db.seed("review_artifacts", {
      id: "review_2",
      project_id: PROJECT,
      user_id: USER,
      prepared_change_id: PREPARED,
      validation_run_id: VALIDATION,
      preview_session_id: "preview_2",
      operation_run_id: "op_2",
      status: "ready",
      review_policy_version: "review-policy-v1",
      review_identity: "s".repeat(64),
      created_at: "2026-08-14T02:00:00.000Z",
      expires_at: LATER(),
    });

    const state = await card();

    expect(state.state).toBe("invalidated");
    expect(state.invalidationReason).toBe("review_superseded");
    // And the new artifact is approvable on its own terms, explicitly (§26).
    expect(state.canApprove).toBe(true);
  });

  it("does not carry an approval forward to a newer validation", async () => {
    seed();
    await approve();

    db.seed("validation_runs", {
      id: "validation_2",
      project_id: PROJECT,
      user_id: USER,
      prepared_change_id: PREPARED,
      status: "passed",
      prepared_commit_sha: FIXTURE_COMMIT_SHA,
      created_at: "2026-08-14T03:00:00.000Z",
    });

    const state = await card();

    expect(state.state).toBe("invalidated");
    // The newest validation has no comparison of its own yet, so there is
    // nothing to approve until one exists — and the copy says so rather than
    // offering a button that would fail.
    expect(state.canApprove).toBe(false);
  });

  it("persists the invalidation rather than deriving it forever", async () => {
    seed();
    await approve();
    db.rows("prepared_changes")[0].commit_sha = SECOND_COMMIT;

    await card();

    const row = db.rows("change_approvals")[0];
    expect(row.status).toBe("invalidated");
    expect(row.invalidation_reason).toBe("prepared_change_modified");
    expect(row.invalidated_at).toBeTruthy();
    // History, not deletion (§16).
    expect(row.approved_at).toBeTruthy();
  });

  it("never revives an approval by reading it", async () => {
    seed();
    await approve();
    db.rows("prepared_changes")[0].commit_sha = SECOND_COMMIT;
    await card();

    // Put the commit back. A read must not resurrect a decision that was
    // recorded as no longer applying.
    db.rows("prepared_changes")[0].commit_sha = FIXTURE_COMMIT_SHA;

    const state = await card();

    expect(state.state).not.toBe("approved");
    expect(db.rows("change_approvals")[0].status).toBe("invalidated");
  });
});

describe("idempotency", () => {
  it("returns the same approval for a repeated confirmation", async () => {
    seed();

    const first = await approve();
    const second = await approve();

    if (first.kind !== "approved") throw new Error("expected approval");
    expect(second).toEqual({ kind: "already_approved", approval: first.approval });
    expect(db.rows("change_approvals")).toHaveLength(1);
  });

  it("lets the database refuse a concurrent second approval", async () => {
    seed();

    // Both callers pass the application's pre-check, as two clicks racing would.
    const [a, b] = await Promise.all([approve(), approve()]);

    expect(db.rows("change_approvals")).toHaveLength(1);
    expect([a.kind, b.kind].sort()).toEqual(["already_approved", "approved"]);
  });
});

describe("revocation", () => {
  it("withdraws an approval and keeps the record", async () => {
    seed();
    const approved = await approve();
    if (approved.kind !== "approved") throw new Error("expected approval");

    const outcome = await revokeChangeApproval(client(), {
      projectId: PROJECT,
      userId: USER,
      approvalId: approved.approval.id,
      confirmed: true,
    });

    expect(outcome.kind).toBe("revoked");
    const row = db.rows("change_approvals")[0];
    expect(row.status).toBe("revoked");
    expect(row.revoked_at).toBeTruthy();
    expect(row.approved_at).toBeTruthy();
    expect(db.rows("change_approvals")).toHaveLength(1);
  });

  it("is idempotent", async () => {
    seed();
    const approved = await approve();
    if (approved.kind !== "approved") throw new Error("expected approval");

    const revoke = () =>
      revokeChangeApproval(client(), {
        projectId: PROJECT,
        userId: USER,
        approvalId: approved.approval.id,
        confirmed: true,
      });

    await revoke();
    expect((await revoke()).kind).toBe("already_inactive");
    expect(db.rows("change_approvals")).toHaveLength(1);
  });

  it("refuses another user's approval", async () => {
    seed();
    const approved = await approve();
    if (approved.kind !== "approved") throw new Error("expected approval");

    const outcome = await revokeChangeApproval(client(), {
      projectId: PROJECT,
      userId: OTHER_USER,
      approvalId: approved.approval.id,
      confirmed: true,
    });

    expect(outcome).toEqual({ kind: "blocked", reason: "approval_not_authorized" });
    expect(db.rows("change_approvals")[0].status).toBe("approved");
  });

  it("leaves a revoked approval inactive, and offers re-approval explicitly", async () => {
    seed();
    const approved = await approve();
    if (approved.kind !== "approved") throw new Error("expected approval");
    await revokeChangeApproval(client(), {
      projectId: PROJECT,
      userId: USER,
      approvalId: approved.approval.id,
      confirmed: true,
    });

    const state = await card();

    expect(state.state).toBe("revoked");
    expect(state.canApprove).toBe(true);
  });

  it("allows a fresh approval after a revoke, as a new record", async () => {
    seed();
    const approved = await approve();
    if (approved.kind !== "approved") throw new Error("expected approval");
    await revokeChangeApproval(client(), {
      projectId: PROJECT,
      userId: USER,
      approvalId: approved.approval.id,
      confirmed: true,
    });

    const again = await approve();

    expect(again.kind).toBe("approved");
    // Two rows: the withdrawn decision and the new one. Never a resurrected
    // status on the original (§26).
    expect(db.rows("change_approvals")).toHaveLength(2);
    if (again.kind !== "approved") throw new Error("expected approval");
    expect(again.approval.id).not.toBe(approved.approval.id);
  });
});

describe("the card the user is shown", () => {
  it("says not approved when everything is in place", async () => {
    seed();

    const state = await card();

    expect(state.state).toBe("not_approved");
    expect(state.canApprove).toBe(true);
    expect(state.currentCommitSha).toBe(FIXTURE_COMMIT_SHA);
  });

  it("says why approval is unavailable", async () => {
    seed({ withReview: false });

    const state = await card();

    expect(state.state).toBe("not_eligible");
    expect(state.canApprove).toBe(false);
    expect(state.blockMessage).toBe(approvalBlockMessage("approval_review_required"));
  });

  it("shows the approval with the commit it applies to", async () => {
    seed();
    await approve();

    const state = await card();

    expect(state.state).toBe("approved");
    expect(state.approvedCommitSha).toBe(FIXTURE_COMMIT_SHA);
    expect(state.approvedAt).toBeTruthy();
    // Nothing further to approve while a decision stands.
    expect(state.canApprove).toBe(false);
  });

  it("survives a reload — the state comes from the database, not the client", async () => {
    seed();
    await approve();

    // Two independent reads, as a page load and a reload are.
    expect((await card()).state).toBe("approved");
    expect((await card()).state).toBe("approved");
  });
});

describe("no side effects", () => {
  /**
   * The regression §27 asks for, expressed as a count rather than a reading of
   * the source. There is no sandbox provider, no browser provider, no AI
   * provider and no GitHub client anywhere in the approval module's imports —
   * so the strongest available assertion is that nothing durable or billable is
   * written by any approval path.
   */
  const spendTables = [
    "operation_runs",
    "ai_usage_events",
    "sandbox_usage_events",
    "review_browser_usage",
    "validation_runs_started",
    "preview_sessions",
  ];

  function spendRows() {
    return spendTables.flatMap((table) => db.rows(table));
  }

  it("approving starts nothing and bills nothing", async () => {
    seed();
    const before = spendRows().length;

    await approve();

    expect(spendRows()).toHaveLength(before);
  });

  it("revoking starts nothing and bills nothing", async () => {
    seed();
    const approved = await approve();
    if (approved.kind !== "approved") throw new Error("expected approval");
    const before = spendRows().length;

    await revokeChangeApproval(client(), {
      projectId: PROJECT,
      userId: USER,
      approvalId: approved.approval.id,
      confirmed: true,
    });

    expect(spendRows()).toHaveLength(before);
  });

  it("opening the approval card starts nothing and bills nothing", async () => {
    seed();
    const before = spendRows().length;

    await card();

    expect(spendRows()).toHaveLength(before);
  });

  it("records an audit event that names the commit and no evidence", async () => {
    seed();

    await approve();

    const event = db.rows("audit_events")[0];
    expect(event.event_type).toBe("change_approval.created");
    const metadata = JSON.stringify(event.metadata);
    expect(metadata).toContain(FIXTURE_COMMIT_SHA);
    // A commit SHA identifies content; a signed URL grants access to it. Only
    // the first belongs in a durable, widely readable log (§17).
    expect(metadata).not.toContain("signed:");
    expect(metadata).not.toContain("http");
  });
});

/**
 * Which evidence a change may be approved on (Sprint 0055, ADR 0063).
 *
 * The defect this closes is concrete: before it, `approval_review_required`
 * blocked every change until a before/after comparison existed — including a
 * change that alters no rendered page, where the comparison is two identical
 * pictures the user paid a browser session for.
 *
 * The properties that matter are symmetric. A code-only change must be
 * approvable without one; everything else must still be refused without one.
 */
describe("evidence form (ADR 0063)", () => {
  const CODE = () => classificationOf("code");
  const VISUAL = () => classificationOf("visual", { visualPaths: ["src/app/page.tsx"] });
  const BOTH = () =>
    classificationOf("visual_and_code", { visualPaths: ["src/app/page.tsx"] });

  it("approves a code-only change with no comparison at all", async () => {
    seed({ withReview: false });

    const outcome = await approve({ reviewArtifactId: null, classification: CODE() });

    expect(outcome.kind).toBe("approved");
    if (outcome.kind !== "approved") return;
    expect(outcome.approval.reviewArtifactId).toBeNull();
    expect(outcome.approval.codeReviewDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(outcome.approval.reviewClassification).toBe("code");
  });

  it("still refuses a visual change with no comparison", async () => {
    seed({ withReview: false });

    expect(await approve({ reviewArtifactId: null, classification: VISUAL() })).toEqual({
      kind: "blocked",
      reason: "approval_review_required",
    });
  });

  it("still refuses a change that is visual *and* code", async () => {
    // Half of it is visible, and the half that is visible is the half a diff
    // cannot show. A partial answer is not a cheaper one.
    seed({ withReview: false });

    expect(await approve({ reviewArtifactId: null, classification: BOTH() })).toEqual({
      kind: "blocked",
      reason: "approval_review_required",
    });
  });

  it("falls back to requiring a comparison when the classification is unknown", async () => {
    // Missing evidence is never a good result (rule 44). An undeterminable
    // classification leaves exactly the behaviour that existed before ADR 0063.
    seed({ withReview: false });

    expect(await approve({ reviewArtifactId: null, classification: null })).toEqual({
      kind: "blocked",
      reason: "approval_review_required",
    });
  });

  it("refuses a client that sends an artifact id for a code-only change", async () => {
    // A stale tab, rendered before the classification said no comparison was
    // needed. The server's answer wins, and it wins by refusing rather than by
    // ignoring what the client sent.
    seed();

    expect(await approve({ reviewArtifactId: REVIEW, classification: CODE() })).toEqual({
      kind: "blocked",
      reason: "approval_review_required",
    });
  });

  it("gives a code approval a different identity than a visual one", async () => {
    // The same commit, the same base, the same validation — and two different
    // things to approve, because the evidence differs.
    seed();

    const visual = identityFor();
    const code = identityFor({
      evidence: { kind: "code_diff", codeReviewDigest: "a".repeat(64) },
    });

    expect(visual).not.toBe(code);
  });

  it("keeps a standing code approval usable by the merge gate", async () => {
    seed({ withReview: false });
    const approved = await approve({ reviewArtifactId: null, classification: CODE() });
    if (approved.kind !== "approved") throw new Error("expected an approval");

    /*
     * The merge gate is given no classification at all, on purpose (rule 68):
     * the analyzer's route table moves, and a human's decision must not stop
     * being findable because a table they never saw now says something else.
     */
    const found = await findActiveApprovalForCurrentArtifact(client(), {
      projectId: PROJECT,
      preparedChangeId: PREPARED,
    });

    expect(found?.id).toBe(approved.approval.id);
  });

  it("records which evidence the human actually looked at", async () => {
    seed({ withReview: false });

    await approve({ reviewArtifactId: null, classification: CODE() });

    const event = db.rows("audit_events")[0];
    expect(event.event_type).toBe("change_approval.created");
    expect(JSON.stringify(event.metadata)).toContain("code_diff");
  });

  it("shows a code-only change as approvable on the card", async () => {
    seed({ withReview: false });

    const state = await card(USER, CODE());

    expect(state.state).toBe("not_approved");
    expect(state.canApprove).toBe(true);
    expect(state.blockReason).toBeNull();
  });
});
