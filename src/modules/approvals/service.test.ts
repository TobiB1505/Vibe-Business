import { beforeEach, describe, expect, it } from "vitest";
import { FakeDatabase, fakeSupabase } from "@/modules/operations/test-support";
import { FIXTURE_COMMIT_SHA } from "@/modules/validation/test-support";
import {
  REVIEW_CLASSIFICATION_VERSION,
  type ReviewClassification,
  type ReviewClassificationResult,
} from "@/modules/review/classification";
import { computeCodeReviewDigest } from "@/modules/execution/code-review-digest";
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
const PREVIEW = "preview_ready_1";
const REVIEW = "review_1";
const BASE_SHA = "b".repeat(40);
const SECOND_COMMIT = "c".repeat(40);

let db: FakeDatabase;

const LATER = () => new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
const EARLIER = () => new Date(Date.now() - 60 * 1000).toISOString();

function client() {
  return fakeSupabase(db);
}

/**
 * The digest the service computes for the same seeded change.
 *
 * Recomputed here rather than copied as a literal, so a change to what the
 * digest covers fails the assertions that care instead of silently agreeing
 * with a stale constant.
 */
function digestFor(commitSha: string = FIXTURE_COMMIT_SHA) {
  return computeCodeReviewDigest({
    projectId: PROJECT,
    preparedChangeId: PREPARED,
    preparedBaseSha: BASE_SHA,
    preparedCommitSha: commitSha,
    paths: ["src/app/robots.ts"],
  });
}

function identityFor(
  overrides: {
    commitSha?: string;
    baseSha?: string;
    validationRunId?: string;
    evidence?: ApprovalEvidence;
    policyVersion?: string;
  } = {},
) {
  const commitSha = overrides.commitSha ?? FIXTURE_COMMIT_SHA;

  return computeApprovalIdentity({
    projectId: PROJECT,
    preparedChangeId: PREPARED,
    preparedCommitSha: commitSha,
    preparedBaseSha: overrides.baseSha ?? BASE_SHA,
    validationRunId: overrides.validationRunId ?? VALIDATION,
    // The default is what a change of unknown classification is approved on
    // now: the diff, plus the preview that proves somebody could look at it
    // running (ADR 0065). The comparison form is history and is passed in
    // explicitly by the tests that still exercise it.
    evidence: overrides.evidence ?? {
      kind: "code_diff_with_preview",
      codeReviewDigest: digestFor(commitSha),
      previewSessionId: PREVIEW,
    },
    approvalPolicyVersion: overrides.policyVersion ?? APPROVAL_POLICY_VERSION,
  });
}

/**
 * The classification a test runs under.
 *
 * `null` by default, which is the stricter path: the change must have been
 * previewed. The code-diff tests opt in explicitly.
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
    withPreview?: boolean;
    previewCommitSha?: string;
    previewReadyAt?: string | null;
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

  // Present unless a test is about its absence. A ready preview of the prepared
  // commit is what a change of any visual classification — including an
  // undetermined one — is approved on (ADR 0065).
  if (options.withPreview !== false) {
    db.seed("preview_sessions", {
      id: PREVIEW,
      project_id: PROJECT,
      user_id: USER,
      prepared_change_id: PREPARED,
      prepared_commit_sha: options.previewCommitSha ?? FIXTURE_COMMIT_SHA,
      operation_run_id: "op_preview",
      preview_profile: "nextjs_dev_preview_v1",
      preview_identity: "v".repeat(64),
      status: "stopped",
      port: 3000,
      // The whole of what a stopped session still proves: it once answered.
      ready_at:
        options.previewReadyAt === undefined ? "2026-08-14T01:30:00.000Z" : options.previewReadyAt,
      expires_at: "2026-08-14T01:45:00.000Z",
      created_at: "2026-08-14T01:00:00.000Z",
    });
  }

  // Absent unless a test asks for one. Nothing creates a comparison any more;
  // the rows that exist are historical (ADR 0065).
  if (options.withReview === true) {
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

/** Another ready preview session, for the identity tests. */
function seedPreview(id: string, commitSha: string, createdAt: string) {
  db.seed("preview_sessions", {
    id,
    project_id: PROJECT,
    user_id: USER,
    prepared_change_id: PREPARED,
    prepared_commit_sha: commitSha,
    operation_run_id: `op_${id}`,
    preview_profile: "nextjs_dev_preview_v1",
    preview_identity: id.padEnd(64, "0"),
    status: "stopped",
    port: 3000,
    ready_at: createdAt,
    expires_at: "2026-08-14T03:45:00.000Z",
    created_at: createdAt,
  });
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
    // Null by default, as the panel now always sends: both forms a new approval
    // may take are resolved server-side, so there is nothing for a client to
    // name. The tests about stale tabs pass one anyway.
    reviewArtifactId: overrides.reviewArtifactId ?? null,
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
  it("approves a prepared, validated, previewed change", async () => {
    seed();

    const outcome = await approve();

    expect(outcome.kind).toBe("approved");
    expect(db.rows("change_approvals")).toHaveLength(1);
  });

  it("refuses without a preview of this commit", async () => {
    seed({ withPreview: false });

    const outcome = await approve();

    expect(outcome).toEqual({ kind: "blocked", reason: "approval_preview_required" });
    expect(db.rows("change_approvals")).toHaveLength(0);
  });

  /*
   * The comparison eligibility tests that stood here are gone with the path
   * they described (ADR 0065): a failed comparison, a comparison of another
   * validation run and a comparison past retention were all reasons to refuse
   * an approval that would have rested on screenshots, and no approval rests on
   * screenshots any more. What replaces them is under "evidence form" below —
   * a preview of another commit, and one that never became reachable.
   */

  it("refuses without a passing validation", async () => {
    seed({ validationStatus: "failed" });

    expect(await approve()).toEqual({ kind: "blocked", reason: "approval_validation_required" });
  });

  it("refuses a change that never produced a commit", async () => {
    seed({ commitSha: null, preparedStatus: "failed" });

    expect(await approve()).toEqual({ kind: "blocked", reason: "approval_change_not_prepared" });
  });

  it("does not require the preview to still be running", async () => {
    // The lifecycle this product is built around: preview → look → preview
    // stopped → the human decides later. The seeded session is `stopped` and
    // long past its expiry, and it is still evidence — because what it proves
    // is that this commit once ran and answered, which stopping does not undo.
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

    // The preparation was re-run and the branch now points somewhere else, and
    // the new commit has been previewed — so the card can say *why* the old
    // approval no longer applies rather than only that nothing is approvable.
    db.rows("prepared_changes")[0].commit_sha = SECOND_COMMIT;
    seedPreview("preview_second", SECOND_COMMIT, "2026-08-14T03:00:00.000Z");

    const state = await card();

    // Never `approved`. The human approved bytes that are no longer there (§13).
    expect(state.state).toBe("invalidated");
    expect(state.invalidationReason).toBe("prepared_change_modified");
    expect(state.approvedCommitSha).toBe(FIXTURE_COMMIT_SHA);
    expect(state.currentCommitSha).toBe(SECOND_COMMIT);
  });

  it("keeps an approval when the same commit is previewed again", async () => {
    /*
     * Looking again is not changing your mind (rule 68).
     *
     * Every ready preview of one commit served identical bytes, so a second one
     * is the same evidence — and `findReadyPreviewForCommit` returns the
     * earliest precisely so the identity stops moving once it exists. The
     * newest-first alternative would invalidate a standing approval because a
     * person scrolled the same page twice.
     */
    seed();
    await approve();

    seedPreview("preview_again", FIXTURE_COMMIT_SHA, "2026-08-14T02:00:00.000Z");

    const state = await card();

    expect(state.state).toBe("approved");
    expect(state.invalidationReason).toBeNull();
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
    /*
     * And the change is approvable again immediately, which it was not before
     * ADR 0065: a second validation used to leave the change unapprovable until
     * somebody paid for a second comparison bound to it. The evidence is the
     * preview of this commit, and re-running a check does not change the commit.
     */
    expect(state.canApprove).toBe(true);
  });

  it("persists the invalidation rather than deriving it forever", async () => {
    seed();
    await approve();
    db.rows("prepared_changes")[0].commit_sha = SECOND_COMMIT;
    seedPreview("preview_second", SECOND_COMMIT, "2026-08-14T03:00:00.000Z");

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
    seedPreview("preview_second", SECOND_COMMIT, "2026-08-14T03:00:00.000Z");
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
    seed({ withPreview: false });

    const state = await card();

    expect(state.state).toBe("not_eligible");
    expect(state.canApprove).toBe(false);
    expect(state.blockMessage).toBe(approvalBlockMessage("approval_preview_required"));
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

  it("refuses a visual change nobody has previewed", async () => {
    // ADR 0065 changed which evidence a visual change needs, not whether it
    // needs any. The refusal names the preview, because that is what is
    // missing — asking for a comparison would point at the wrong thing.
    seed({ withPreview: false });

    expect(await approve({ reviewArtifactId: null, classification: VISUAL() })).toEqual({
      kind: "blocked",
      reason: "approval_preview_required",
    });
  });

  it("refuses a change that is visual *and* code with no preview", async () => {
    // Half of it is visible, and the half that is visible is the half a diff
    // cannot show. A partial answer is not a cheaper one.
    seed({ withPreview: false });

    expect(await approve({ reviewArtifactId: null, classification: BOTH() })).toEqual({
      kind: "blocked",
      reason: "approval_preview_required",
    });
  });

  it("approves a visual change on a preview of this exact commit", async () => {
    seed({ withReview: false, withPreview: true });

    const outcome = await approve({ reviewArtifactId: null, classification: VISUAL() });

    expect(outcome.kind).toBe("approved");
    if (outcome.kind !== "approved") return;
    expect(outcome.approval.previewSessionId).toBe(PREVIEW);
    // The diff is in every new form: a preview shows what a change looks like,
    // and only the diff shows what it does.
    expect(outcome.approval.codeReviewDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(outcome.approval.reviewArtifactId).toBeNull();
  });

  it("does not count a preview of a different commit", async () => {
    seed({ withReview: false, withPreview: true, previewCommitSha: "9".repeat(40) });

    expect(await approve({ reviewArtifactId: null, classification: VISUAL() })).toEqual({
      kind: "blocked",
      reason: "approval_preview_required",
    });
  });

  it("does not count a preview that never became reachable", async () => {
    // A session that failed to start is not something a person could have
    // looked at, whatever its row says about having been attempted.
    seed({ withReview: false, withPreview: true, previewReadyAt: null });

    expect(await approve({ reviewArtifactId: null, classification: VISUAL() })).toEqual({
      kind: "blocked",
      reason: "approval_preview_required",
    });
  });

  it("gives a preview approval a different identity than a diff-only one", async () => {
    seed({ withReview: false, withPreview: true });

    const withPreview = identityFor({
      evidence: {
        kind: "code_diff_with_preview",
        codeReviewDigest: "a".repeat(64),
        previewSessionId: PREVIEW,
      },
    });
    const diffOnly = identityFor({
      evidence: { kind: "code_diff", codeReviewDigest: "a".repeat(64) },
    });

    expect(withPreview).not.toBe(diffOnly);
  });

  it("takes the stricter path when the classification is unknown", async () => {
    /*
     * Missing evidence is never a good result (rule 44), and since ADR 0065 the
     * stricter path is the one that can still be walked: a change nobody could
     * classify must have been previewed, not merely diffed.
     *
     * It deliberately does *not* fall back to the comparison any more. Nothing
     * creates one, so that fallback would have made an unclassifiable change
     * permanently unapprovable.
     */
    seed({ withPreview: false });

    expect(await approve({ reviewArtifactId: null, classification: null })).toEqual({
      kind: "blocked",
      reason: "approval_preview_required",
    });

    seed({ withPreview: true });
    expect((await approve({ reviewArtifactId: null, classification: null })).kind).toBe(
      "approved",
    );
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

/**
 * What the merge gate will and will not find (Sprint 0113).
 *
 * The gate was narrowed when it stopped resolving evidence for itself: it now
 * asks whether the *latest* approval still describes the artifact, rather than
 * whether any active row's hash matches. These pin both sides of that.
 */
describe("the standing approval a merge may rest on", () => {
  it("finds the approval for the artifact on screen", async () => {
    seed();
    const approved = await approve();
    if (approved.kind !== "approved") throw new Error("expected an approval");

    const found = await findActiveApprovalForCurrentArtifact(client(), {
      projectId: PROJECT,
      preparedChangeId: PREPARED,
    });

    expect(found?.id).toBe(approved.approval.id);
  });

  it("finds nothing once the approval is revoked", async () => {
    seed();
    const approved = await approve();
    if (approved.kind !== "approved") throw new Error("expected an approval");

    await revokeChangeApproval(client(), {
      projectId: PROJECT,
      userId: USER,
      approvalId: approved.approval.id,
      confirmed: true,
    });

    expect(
      await findActiveApprovalForCurrentArtifact(client(), {
        projectId: PROJECT,
        preparedChangeId: PREPARED,
      }),
    ).toBeNull();
  });

  it("finds nothing when the standing approval names a different artifact", async () => {
    // The safe direction, and the one this gate must never get wrong: an
    // approval of other bytes is not authority for these.
    seed();
    db.seed("change_approvals", {
      id: "approval_other",
      project_id: PROJECT,
      user_id: USER,
      prepared_change_id: PREPARED,
      validation_run_id: VALIDATION,
      review_artifact_id: REVIEW,
      code_review_digest: null,
      review_classification: null,
      review_classification_policy_version: null,
      prepared_commit_sha: "9".repeat(40),
      prepared_base_sha: BASE_SHA,
      approval_policy_version: APPROVAL_POLICY_VERSION,
      approval_identity: identityFor({ commitSha: "9".repeat(40) }),
      status: "approved",
      approved_at: "2026-08-14T02:00:00.000Z",
      created_at: "2026-08-14T02:00:00.000Z",
    });

    expect(
      await findActiveApprovalForCurrentArtifact(client(), {
        projectId: PROJECT,
        preparedChangeId: PREPARED,
      }),
    ).toBeNull();
  });

  it("refuses a row that carries no evidence at all", async () => {
    // Unreachable through the product — the database refuses the shape — and
    // refused here anyway. An approval that cannot say what it rested on
    // authorizes nothing.
    seed();
    db.seed("change_approvals", {
      id: "approval_evidenceless",
      project_id: PROJECT,
      user_id: USER,
      prepared_change_id: PREPARED,
      validation_run_id: VALIDATION,
      review_artifact_id: null,
      code_review_digest: null,
      review_classification: null,
      review_classification_policy_version: null,
      prepared_commit_sha: FIXTURE_COMMIT_SHA,
      prepared_base_sha: BASE_SHA,
      approval_policy_version: APPROVAL_POLICY_VERSION,
      approval_identity: identityFor(),
      status: "approved",
      approved_at: "2026-08-14T02:00:00.000Z",
      created_at: "2026-08-14T02:00:00.000Z",
    });

    expect(
      await findActiveApprovalForCurrentArtifact(client(), {
        projectId: PROJECT,
        preparedChangeId: PREPARED,
      }),
    ).toBeNull();
  });
});
