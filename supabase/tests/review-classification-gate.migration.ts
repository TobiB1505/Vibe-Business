import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startCluster, type Cluster } from "./harness";

/**
 * Sprint 0055 — the database contract behind two evidence forms (ADR 0063).
 *
 * ## Why this runs against a real cluster
 *
 * Because the whole point of this sprint's migration is a pair of CHECK
 * constraints, and neither the in-memory test database nor a TypeScript union
 * evaluates one. `approvals/schema.test.ts` reads the migration *text*, which
 * proves the SQL says what the union says and nothing about whether PostgreSQL
 * agrees — a constraint with a subtly wrong predicate is valid SQL that matches
 * nothing, which is exactly how ADR 0017 §9's storage policy shipped broken.
 *
 * The rule being proved is one sentence: **an approval names exactly one
 * evidence form, and it is the one its classification called for.** An approval
 * that names neither is a human's yes to nothing; one that names both leaves a
 * merge preflight two answers to the question of what was reviewed.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SHA = "a".repeat(40);
const HEAD = "b".repeat(40);

let db: Cluster;

/** Ids for one project with a prepared change, a passing validation and a review. */
type Artifact = {
  userId: string;
  projectId: string;
  preparedChangeId: string;
  validationRunId: string;
  reviewArtifactId: string;
};

function makeArtifact(label: string): Artifact {
  const [userId, projectId] = db
    .sql(`select user_id, project_id from public.build_lifecycle_fixture('${label}');`)
    .split("|");

  const [preparedChangeId, validationRunId, reviewArtifactId] = db
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
           before_origin, status, review_identity, expires_at)
        select '${projectId}', '${userId}', validation.prepared_change_id, validation.id, run.id,
               'public_visual_review_v1', 'v1', 'review-policy-v1', 'browserbase', '/',
               'https://fixture.test', 'capturing',
               md5(random()::text) || md5(random()::text), now() + interval '7 days'
        from validation, run
        returning id, prepared_change_id, validation_run_id
      )
      select review.prepared_change_id || '|' || review.validation_run_id || '|' || review.id
      from review;
    `,
    )
    .split("|");

  return { userId, projectId, preparedChangeId, validationRunId, reviewArtifactId };
}

/** One `change_approvals` insert, with the evidence columns under test. */
function insertApproval(
  artifact: Artifact,
  evidence: {
    reviewArtifactId?: string | null;
    codeReviewDigest?: string | null;
    reviewClassification?: string | null;
    policyVersion?: string | null;
  },
): string {
  const value = (v: string | null | undefined) => (v ? `'${v}'` : "null");

  return `
    insert into public.change_approvals
      (project_id, user_id, prepared_change_id, validation_run_id, review_artifact_id,
       code_review_digest, review_classification, review_classification_policy_version,
       prepared_commit_sha, prepared_base_sha, approval_policy_version, approval_identity)
    values ('${artifact.projectId}', '${artifact.userId}', '${artifact.preparedChangeId}',
            '${artifact.validationRunId}', ${value(evidence.reviewArtifactId)},
            ${value(evidence.codeReviewDigest)}, ${value(evidence.reviewClassification)},
            ${value(evidence.policyVersion)},
            '${HEAD}', '${SHA}', 'approval-policy-v2',
            md5(random()::text) || md5(random()::text));
  `;
}

beforeAll(() => {
  db = startCluster(REPO_ROOT);
  db.sql(readFileSync(join(REPO_ROOT, "supabase", "tests", "fixture.sql"), "utf8"));
}, 300_000);

afterAll(() => db?.stop());

describe("exactly one evidence form", () => {
  it("accepts a visual approval, which names a comparison and no digest", () => {
    const artifact = makeArtifact("evid-visual");

    db.sql(
      insertApproval(artifact, {
        reviewArtifactId: artifact.reviewArtifactId,
        reviewClassification: "visual",
        policyVersion: "review-classification-v2",
      }),
    );

    expect(
      db.sql(
        `select count(*) from public.change_approvals where prepared_change_id = '${artifact.preparedChangeId}';`,
      ),
    ).toBe("1");
  });

  it("accepts a code approval with no comparison at all", () => {
    // The defect ADR 0063 closes: before this migration `review_artifact_id`
    // was `not null`, so this row could not exist and a backend-only change
    // could not be approved without two identical screenshots.
    const artifact = makeArtifact("evid-code");

    db.sql(
      insertApproval(artifact, {
        codeReviewDigest: "f".repeat(64),
        reviewClassification: "code",
        policyVersion: "review-classification-v2",
      }),
    );

    expect(
      db.sql(
        `select review_artifact_id is null from public.change_approvals where prepared_change_id = '${artifact.preparedChangeId}';`,
      ),
    ).toBe("t");
  });

  it("refuses a row that names neither", () => {
    const artifact = makeArtifact("evid-neither");

    expect(
      db.sqlExpectingError(insertApproval(artifact, { reviewClassification: "code" })),
    ).toContain("change_approvals_has_exactly_one_evidence");
  });

  it("refuses a row that names both", () => {
    const artifact = makeArtifact("evid-both");

    expect(
      db.sqlExpectingError(
        insertApproval(artifact, {
          reviewArtifactId: artifact.reviewArtifactId,
          codeReviewDigest: "f".repeat(64),
          reviewClassification: "code",
          policyVersion: "review-classification-v2",
        }),
      ),
    ).toContain("change_approvals_has_exactly_one_evidence");
  });
});

describe("the evidence has to match the classification", () => {
  it("refuses a diff approval on a change classified visual", () => {
    // The shortcut this sprint must not create while removing the opposite one.
    const artifact = makeArtifact("match-visual");

    expect(
      db.sqlExpectingError(
        insertApproval(artifact, {
          codeReviewDigest: "f".repeat(64),
          reviewClassification: "visual",
          policyVersion: "review-classification-v2",
        }),
      ),
    ).toContain("change_approvals_evidence_matches_classification");
  });

  it("refuses a diff approval on a change classified visual and code", () => {
    const artifact = makeArtifact("match-both");

    expect(
      db.sqlExpectingError(
        insertApproval(artifact, {
          codeReviewDigest: "f".repeat(64),
          reviewClassification: "visual_and_code",
          policyVersion: "review-classification-v2",
        }),
      ),
    ).toContain("change_approvals_evidence_matches_classification");
  });

  it("refuses a diff approval that does not say which policy decided it", () => {
    // A digest is only reproducible under stated rules. A row that cannot name
    // them records a decision nobody can reconstruct.
    const artifact = makeArtifact("match-nopolicy");

    expect(
      db.sqlExpectingError(
        insertApproval(artifact, {
          codeReviewDigest: "f".repeat(64),
          reviewClassification: "code",
        }),
      ),
    ).toContain("change_approvals_code_evidence_states_policy");
  });
});

describe("the evidence a merge rests on cannot be deleted out from under it", () => {
  it("still refuses to delete a review artifact an approval names", () => {
    // Unchanged by this migration, and asserted here because making the column
    // nullable is exactly the kind of change that quietly relaxes a delete rule.
    const artifact = makeArtifact("restrict");

    db.sql(
      insertApproval(artifact, {
        reviewArtifactId: artifact.reviewArtifactId,
        reviewClassification: "visual",
        policyVersion: "review-classification-v2",
      }),
    );

    expect(
      db.sqlExpectingError(
        `delete from public.review_artifacts where id = '${artifact.reviewArtifactId}';`,
      ),
    ).toContain("change_approvals");
  });
});
