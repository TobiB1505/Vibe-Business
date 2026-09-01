import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startCluster, type Cluster } from "./harness";

/**
 * Sprint 0114 — the database contract behind a preview-backed approval (ADR 0065).
 *
 * ## What is actually at risk here
 *
 * Three things, and none of them can be proved anywhere but a real cluster.
 *
 * **The CHECKs.** A visual approval must name its evidence, and a preview must
 * never stand alone without the diff beside it. Those are two predicates, and a
 * predicate that matches nothing is valid SQL.
 *
 * **Project deletion.** `change_approvals.preview_session_id` is `on delete
 * restrict` between two tables that both cascade from `projects`. That is the
 * shape ADR 0056 was written about: a RESTRICT edge inside a cascade can refuse
 * the whole delete depending on the order PostgreSQL happens to walk it. If
 * deleting a project with a preview-backed approval fails, a customer cannot
 * delete their account — so it is asserted rather than reasoned about.
 *
 * **The insert policy.** This is the one that was already wrong. Sprint 0113
 * added the code-diff form without touching the policy, whose comparison clause
 * is `exists (… where ra.id = change_approvals.review_artifact_id …)` — false,
 * not vacuously true, when the column is null. Every domain test passed, and so
 * did the SQL constraint tests, because those insert as the table owner and RLS
 * does not apply to them. These run as `authenticated`, which is the only role
 * that proves anything about what a customer's own session can do (rule 69).
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SHA = "a".repeat(40);
const HEAD = "b".repeat(40);
const OTHER_HEAD = "c".repeat(40);

let db: Cluster;

type Artifact = {
  userId: string;
  projectId: string;
  preparedChangeId: string;
  validationRunId: string;
  reviewArtifactId: string;
  previewSessionId: string;
};

/** Runs statements with RLS in force, as one authenticated user. */
function asUser(userId: string, statements: string): string {
  return db.sqlLast(
    `begin; set local role authenticated;` +
      ` select set_config('request.jwt.claim.sub', '${userId}', true);` +
      ` ${statements} commit;`,
  );
}

function asUserExpectingError(userId: string, statements: string): string {
  return db.sqlExpectingError(
    `begin; set local role authenticated;` +
      ` select set_config('request.jwt.claim.sub', '${userId}', true);` +
      ` ${statements} commit;`,
  );
}

/**
 * One project with a prepared change, a passing validation, a historical
 * comparison and a preview session that became reachable.
 */
function makeArtifact(label: string): Artifact {
  const [userId, projectId] = db
    .sql(`select user_id, project_id from public.build_lifecycle_fixture('${label}');`)
    .split("|");

  const [preparedChangeId, validationRunId, reviewArtifactId, previewSessionId] = db
    .sqlLast(
      `
      with run as (
        insert into public.operation_runs (project_id, user_id, operation_type, input_identity, status)
        values ('${projectId}', '${userId}', 'change_preparation', md5(random()::text) || md5(random()::text), 'running')
        returning id
      ), oset as (
        select id from public.opportunity_sets where project_id = '${projectId}' limit 1
      ), opp as (
        select o.id from public.business_opportunities o join oset on o.opportunity_set_id = oset.id limit 1
      ), snap as (
        select id from public.repository_intelligence_snapshots where project_id = '${projectId}' limit 1
      ), change as (
        insert into public.prepared_changes
          (project_id, user_id, operation_run_id, opportunity_set_id, opportunity_id,
           execution_capability, execution_version, repository_snapshot_id, base_branch, base_sha,
           branch_name, commit_sha, files, execution_identity, status, completed_at)
        select '${projectId}', '${userId}', run.id, oset.id, opp.id,
               'nextjs_seo_foundations_v2', 'v2', snap.id, 'main', '${SHA}',
               'vibe/fixture-${label}', '${HEAD}',
               '[{"path":"src/lib/pricing.ts","contentHash":"c","bytes":10}]'::jsonb,
               md5(random()::text) || md5(random()::text), 'prepared', now()
        from run, oset, opp, snap
        returning id
      ), validation as (
        insert into public.validation_runs
          (project_id, user_id, prepared_change_id, operation_run_id, validation_profile,
           validation_profile_version, sandbox_policy_version, sandbox_provider, package_manager,
           prepared_commit_sha, status, stage, validation_identity, completed_at)
        select '${projectId}', '${userId}', change.id, run.id, 'nextjs_node_v1', 'v1', 'v1',
               'vercel_sandbox', 'pnpm', '${HEAD}', 'passed', 'completed',
               md5(random()::text) || md5(random()::text), now()
        from change, run
        returning id, prepared_change_id
      ), review as (
        insert into public.review_artifacts
          (project_id, user_id, prepared_change_id, validation_run_id, operation_run_id,
           review_profile, review_profile_version, review_policy_version, provider, route,
           before_origin, status, review_identity, expires_at,
           before_capture_status, after_capture_status,
           before_object_path, after_object_path, before_sha256, after_sha256,
           before_width, after_width, before_height, after_height)
        select '${projectId}', '${userId}', validation.prepared_change_id, validation.id, run.id,
               'public_visual_review_v1', 'v1', 'review-policy-v1', 'browserbase', '/',
               'https://fixture.test', 'ready',
               md5(random()::text) || md5(random()::text), now() + interval '7 days',
               'captured', 'captured',
               '${label}/before.png', '${label}/after.png', repeat('1', 64), repeat('2', 64),
               1440, 1440, 1000, 1000
        from validation, run
        returning id, prepared_change_id, validation_run_id
      ), preview as (
        insert into public.preview_sessions
          (project_id, user_id, prepared_change_id, operation_run_id, prepared_commit_sha,
           preview_profile, preview_profile_version, preview_policy_version, provider, port,
           status, stage, preview_identity, started_at, ready_at, expires_at, stopped_at)
        select '${projectId}', '${userId}', review.prepared_change_id, run.id, '${HEAD}',
               'nextjs_dev_preview_v1', 'v1', 'preview-policy-v2', 'vercel_sandbox', 3000,
               'stopped', 'completed', md5(random()::text) || md5(random()::text),
               now() - interval '30 minutes', now() - interval '29 minutes',
               now() - interval '15 minutes', now() - interval '15 minutes'
        from review, run
        -- No validation run: a v2 preview does not wait for one, and that
        -- column being nullable is half of what this sprint changed.
        returning id, prepared_change_id
      )
      select review.prepared_change_id || '|' || review.validation_run_id || '|'
             || review.id || '|' || preview.id
      from preview, review;
    `,
    )
    .split("|");

  return {
    userId,
    projectId,
    preparedChangeId,
    validationRunId,
    reviewArtifactId,
    previewSessionId,
  };
}

/** One `change_approvals` insert, with the evidence columns under test. */
function insertApproval(
  artifact: Artifact,
  evidence: {
    reviewArtifactId?: string | null;
    codeReviewDigest?: string | null;
    previewSessionId?: string | null;
    reviewClassification?: string | null;
    policyVersion?: string | null;
    commitSha?: string;
  },
): string {
  const value = (v: string | null | undefined) => (v ? `'${v}'` : "null");

  return `
    insert into public.change_approvals
      (project_id, user_id, prepared_change_id, validation_run_id, review_artifact_id,
       code_review_digest, preview_session_id, review_classification,
       review_classification_policy_version,
       prepared_commit_sha, prepared_base_sha, approval_policy_version, approval_identity)
    values ('${artifact.projectId}', '${artifact.userId}', '${artifact.preparedChangeId}',
            '${artifact.validationRunId}', ${value(evidence.reviewArtifactId)},
            ${value(evidence.codeReviewDigest)}, ${value(evidence.previewSessionId)},
            ${value(evidence.reviewClassification)}, ${value(evidence.policyVersion)},
            '${evidence.commitSha ?? HEAD}', '${SHA}', 'approval-policy-v3',
            md5(random()::text) || md5(random()::text));
  `;
}

const DIGEST = "d".repeat(64);

beforeAll(() => {
  db = startCluster(REPO_ROOT);
  db.sql(readFileSync(join(REPO_ROOT, "supabase", "tests", "fixture.sql"), "utf8"));
}, 300_000);

afterAll(() => db?.stop());

describe("the third evidence form", () => {
  it("accepts a visual approval that names a preview and the diff", () => {
    const artifact = makeArtifact("prev-visual");

    db.sql(
      insertApproval(artifact, {
        codeReviewDigest: DIGEST,
        previewSessionId: artifact.previewSessionId,
        reviewClassification: "visual",
        policyVersion: "review-classification-v3",
      }),
    );

    expect(
      db.sql(
        `select count(*) from public.change_approvals where preview_session_id = '${artifact.previewSessionId}';`,
      ),
    ).toBe("1");
  });

  it("refuses a preview without the diff beside it", () => {
    // The diff is in every new form. A preview shows what a change looks like;
    // only the diff shows what it does — and a row that names only what was
    // looked at would be an approval of an appearance.
    //
    // Written with the historical artifact present, because a row with neither
    // digest nor artifact fails the older "exactly one evidence form" check
    // first and would prove that constraint instead of this one.
    const artifact = makeArtifact("prev-nodiff");

    expect(
      db.sqlExpectingError(
        insertApproval(artifact, {
          reviewArtifactId: artifact.reviewArtifactId,
          previewSessionId: artifact.previewSessionId,
          reviewClassification: "visual",
          policyVersion: "review-classification-v3",
        }),
      ),
    ).toContain("change_approvals_preview_accompanies_a_diff");
  });

  it("refuses a diff-only approval of a change that alters a rendered page", () => {
    // The shortcut the gate exists to prevent, asserted where the gate cannot
    // be bypassed: a `visual` change approved on the diff and nothing else.
    const artifact = makeArtifact("prev-bare");

    expect(
      db.sqlExpectingError(
        insertApproval(artifact, {
          codeReviewDigest: DIGEST,
          reviewClassification: "visual",
          policyVersion: "review-classification-v3",
        }),
      ),
    ).toContain("change_approvals_evidence_matches_classification");
  });

  it("still accepts a code-only approval on the diff alone", () => {
    const artifact = makeArtifact("prev-code");

    db.sql(
      insertApproval(artifact, {
        codeReviewDigest: DIGEST,
        reviewClassification: "code",
        policyVersion: "review-classification-v3",
      }),
    );

    expect(
      db.sql(
        `select count(*) from public.change_approvals where prepared_change_id = '${artifact.preparedChangeId}';`,
      ),
    ).toBe("1");
  });

  it("still accepts a historical approval that names a comparison", () => {
    // The rows Sprint 11B and Sprint 0113 produced stay valid exactly as they
    // are. A constraint that invalidated history would be rewriting what a
    // person decided (rule 83).
    const artifact = makeArtifact("prev-history");

    db.sql(
      insertApproval(artifact, {
        reviewArtifactId: artifact.reviewArtifactId,
        reviewClassification: "visual",
        policyVersion: "review-classification-v2",
      }),
    );

    expect(
      db.sql(
        `select count(*) from public.change_approvals where review_artifact_id = '${artifact.reviewArtifactId}';`,
      ),
    ).toBe("1");
  });
});

/**
 * The riskiest edge in the migration.
 *
 * `preview_sessions` cascades from `projects`, `change_approvals` cascades from
 * `projects`, and there is now a RESTRICT edge from the second to the first. If
 * PostgreSQL walks the cascade in the wrong order, deleting the project raises
 * a foreign-key violation — and a customer who has ever approved a visual
 * change can no longer delete their project or their account.
 */
describe("project deletion still works", () => {
  it("deletes a project whose approval names a preview session", () => {
    const artifact = makeArtifact("prev-delete");
    db.sql(
      insertApproval(artifact, {
        codeReviewDigest: DIGEST,
        previewSessionId: artifact.previewSessionId,
        reviewClassification: "visual",
        policyVersion: "review-classification-v3",
      }),
    );

    // Through the one door a project may be deleted by (ADR 0056): a direct
    // delete is refused by the lifecycle trigger whoever asks, so testing the
    // cascade with one would prove nothing about what a customer's deletion
    // actually does.
    expect(
      db.sql(
        `select public.erase_project_lifecycle('${artifact.projectId}', '${artifact.userId}');`,
      ),
    ).toBe("t");

    expect(
      db.sql(`select count(*) from public.projects where id = '${artifact.projectId}';`),
    ).toBe("0");
    expect(
      db.sql(
        `select count(*) from public.change_approvals where project_id = '${artifact.projectId}';`,
      ),
    ).toBe("0");
    expect(
      db.sql(
        `select count(*) from public.preview_sessions where project_id = '${artifact.projectId}';`,
      ),
    ).toBe("0");
  });

  it("refuses to delete the preview session an approval rests on", () => {
    // The other half of the same edge, and the reason it is RESTRICT: an
    // approval that cannot say what it rested on is not an audit record.
    const artifact = makeArtifact("prev-restrict");
    db.sql(
      insertApproval(artifact, {
        codeReviewDigest: DIGEST,
        previewSessionId: artifact.previewSessionId,
        reviewClassification: "visual",
        policyVersion: "review-classification-v3",
      }),
    );

    expect(
      db.sqlExpectingError(
        `delete from public.preview_sessions where id = '${artifact.previewSessionId}';`,
      ),
    ).toContain("change_approvals");
  });
});

/**
 * What a customer's own session can insert (rule 69).
 *
 * Everything above runs as the table owner, where RLS is not applied at all.
 * These are the same rows through the policy that a request-scoped client
 * actually meets.
 */
describe("the insert policy, as the customer", () => {
  it("accepts a code-only approval — the form Sprint 0113 could not insert", () => {
    /*
     * The regression this file exists for. The comparison clause was
     * unconditional, and `ra.id = null` matches nothing, so `exists` was false
     * and a code-diff approval was refused for every customer while passing
     * every test that ran as the owner.
     */
    const artifact = makeArtifact("rls-code");

    asUser(
      artifact.userId,
      insertApproval(artifact, {
        codeReviewDigest: DIGEST,
        reviewClassification: "code",
        policyVersion: "review-classification-v3",
      }),
    );

    expect(
      db.sql(
        `select count(*) from public.change_approvals where prepared_change_id = '${artifact.preparedChangeId}';`,
      ),
    ).toBe("1");
  });

  it("accepts a preview-backed approval of this exact commit", () => {
    const artifact = makeArtifact("rls-preview");

    asUser(
      artifact.userId,
      insertApproval(artifact, {
        codeReviewDigest: DIGEST,
        previewSessionId: artifact.previewSessionId,
        reviewClassification: "visual",
        policyVersion: "review-classification-v3",
      }),
    );

    expect(
      db.sql(
        `select count(*) from public.change_approvals where preview_session_id = '${artifact.previewSessionId}';`,
      ),
    ).toBe("1");
  });

  it("refuses a preview session belonging to another project", () => {
    // The evidence has to be the customer's own, and about this change. A
    // caller who could name any session id could approve one change on the
    // strength of having previewed another.
    const mine = makeArtifact("rls-mine");
    const theirs = makeArtifact("rls-theirs");

    expect(
      asUserExpectingError(
        mine.userId,
        insertApproval(mine, {
          codeReviewDigest: DIGEST,
          previewSessionId: theirs.previewSessionId,
          reviewClassification: "visual",
          policyVersion: "review-classification-v3",
        }),
      ),
    ).toContain("row-level security");
  });

  it("refuses a preview of a different commit", () => {
    // A preview of an earlier attempt is a preview of different bytes. The
    // policy compares the session's commit with the approval's, so a stale
    // session cannot become evidence for the commit that replaced it.
    const artifact = makeArtifact("rls-commit");
    db.sql(
      `update public.prepared_changes set commit_sha = '${OTHER_HEAD}' where id = '${artifact.preparedChangeId}';`,
    );

    expect(
      asUserExpectingError(
        artifact.userId,
        insertApproval(artifact, {
          codeReviewDigest: DIGEST,
          previewSessionId: artifact.previewSessionId,
          reviewClassification: "visual",
          policyVersion: "review-classification-v3",
          commitSha: OTHER_HEAD,
        }),
      ),
    ).toContain("row-level security");
  });

  it("refuses a preview that never became reachable", () => {
    // A session that failed to start is not something a person could have
    // looked at, whatever its row says about having been attempted.
    const artifact = makeArtifact("rls-unready");
    db.sql(
      `update public.preview_sessions set ready_at = null, status = 'failed',` +
        ` failure_code = 'preview_server_failed' where id = '${artifact.previewSessionId}';`,
    );

    expect(
      asUserExpectingError(
        artifact.userId,
        insertApproval(artifact, {
          codeReviewDigest: DIGEST,
          previewSessionId: artifact.previewSessionId,
          reviewClassification: "visual",
          policyVersion: "review-classification-v3",
        }),
      ),
    ).toContain("row-level security");
  });

  it("still refuses a comparison that is not ready", () => {
    // The historical clause has to keep working, not merely keep existing: a
    // guarded `exists` that never runs is the same defect in the other
    // direction.
    const artifact = makeArtifact("rls-capturing");
    db.sql(
      `update public.review_artifacts set status = 'capturing' where id = '${artifact.reviewArtifactId}';`,
    );

    expect(
      asUserExpectingError(
        artifact.userId,
        insertApproval(artifact, {
          reviewArtifactId: artifact.reviewArtifactId,
          reviewClassification: "visual",
          policyVersion: "review-classification-v2",
        }),
      ),
    ).toContain("row-level security");
  });
});
