import { beforeEach, describe, expect, it } from "vitest";
import { fakeSupabase } from "@/modules/operations/test-support";
import {
  completeOutcomeVerification,
  createOutcomeVerification,
  failOutcomeVerification,
  findVerificationByIdentity,
  openObservationWindow,
  recordObservationAttempt,
} from "./store";
import { OUTCOME_EVIDENCE_SCHEMA_VERSION, OUTCOME_POLICY_VERSION } from "./schema";
import type { ExpectedOutcome, OutcomeCheckResult } from "./schema";
import { FakeDatabase, OUTCOME_FIXTURES, OUTCOME_MERGED_COMMIT, OUTCOME_ORIGIN } from "./test-support";

/**
 * The persistence guards, tested where they actually live (Sprint 12A §36, §37, §42).
 *
 * ## Why these are unit-tested rather than only exercised through the workflow
 *
 * Because they are the **atomic** half of every invariant, and the step-level
 * checks above them are not. A durable step reads a row, decides, and writes —
 * three moments with gaps between them. The conditional predicate on each
 * `update` is what makes the decision and the write one act, and it is the only
 * layer that holds under a replay racing a retry.
 *
 * The in-memory database cannot express that race, so a workflow-level test can
 * never distinguish "the step guard stopped it" from "the store guard stopped
 * it". Testing the store directly is what keeps the atomic guard from looking
 * redundant and being deleted.
 */

let db: FakeDatabase;

const EXPECTED: ExpectedOutcome = {
  profile: "nextjs_seo_foundations_outcome_v1",
  profileVersion: "nextjs-seo-foundations-outcome-v1",
  publicOrigin: OUTCOME_ORIGIN,
  resources: ["robots_txt", "sitemap_xml"],
  checks: [{ kind: "robots_reachable", target: null, resource: "robots_txt" }],
  truncated: false,
};

const RESULTS: OutcomeCheckResult[] = [
  {
    checkId: "robots_reachable",
    kind: "robots_reachable",
    target: null,
    status: "passed",
    observedValue: { httpStatus: 200 },
    observedAt: "2026-08-14T14:50:00.000Z",
  },
];

function client() {
  return fakeSupabase(db);
}

async function create(identity = "v".repeat(64)) {
  const created = await createOutcomeVerification(client(), {
    projectId: OUTCOME_FIXTURES.project,
    userId: OUTCOME_FIXTURES.user,
    changeMergeId: OUTCOME_FIXTURES.merge,
    preparedChangeId: OUTCOME_FIXTURES.preparedChange,
    changeApprovalId: OUTCOME_FIXTURES.approval,
    mergedCommitSha: OUTCOME_MERGED_COMMIT,
    capability: "nextjs_seo_foundations_v2",
    capabilityVersion: "nextjs-seo-foundations-v2",
    outcomeProfile: "nextjs_seo_foundations_outcome_v1",
    outcomeProfileVersion: "nextjs-seo-foundations-outcome-v1",
    outcomePolicyVersion: OUTCOME_POLICY_VERSION,
    evidenceSchemaVersion: OUTCOME_EVIDENCE_SCHEMA_VERSION,
    publicOrigin: OUTCOME_ORIGIN,
    expectedOutcome: EXPECTED,
    verificationIdentity: identity,
    operationRunId: "operation_1",
  });

  if (!created.ok) throw new Error(`create failed: ${created.error}`);
  return created.verification;
}

async function open(verificationId: string) {
  const started = new Date("2026-08-14T14:45:00.000Z");
  return openObservationWindow(client(), {
    verificationId,
    projectId: OUTCOME_FIXTURES.project,
    windowStartedAt: started,
    windowEndsAt: new Date(started.getTime() + 15 * 60 * 1000),
  });
}

beforeEach(() => {
  db = new FakeDatabase();
});

describe("a terminal verification is immutable (§37, §42)", () => {
  it("refuses to re-complete a verification that already concluded", async () => {
    // The atomic guard. Without it, a replayed conclude step racing a
    // concurrent one could overwrite an answer the user has already been shown
    // — with a *different* answer, because the site moved in between.
    const verification = await create();
    await open(verification.id);

    const first = await completeOutcomeVerification(client(), {
      verificationId: verification.id,
      projectId: OUTCOME_FIXTURES.project,
      status: "verified",
      checkResults: RESULTS,
      attemptNumber: 1,
      effectiveOrigin: OUTCOME_ORIGIN,
    });
    expect(first?.status).toBe("verified");

    const second = await completeOutcomeVerification(client(), {
      verificationId: verification.id,
      projectId: OUTCOME_FIXTURES.project,
      status: "not_observed",
      checkResults: [],
      attemptNumber: 7,
      effectiveOrigin: null,
    });

    // Null is the signal a replayed step needs to skip a second audit event.
    expect(second).toBeNull();
    expect(db.rows("change_outcome_verifications")[0].status).toBe("verified");
  });

  it("refuses to fail a verification that already concluded", async () => {
    const verification = await create();
    await open(verification.id);
    await completeOutcomeVerification(client(), {
      verificationId: verification.id,
      projectId: OUTCOME_FIXTURES.project,
      status: "verified",
      checkResults: RESULTS,
      attemptNumber: 1,
      effectiveOrigin: OUTCOME_ORIGIN,
    });

    const failed = await failOutcomeVerification(client(), {
      verificationId: verification.id,
      projectId: OUTCOME_FIXTURES.project,
      failureCode: "outcome_origin_unreachable",
    });

    expect(failed).toBeNull();
    expect(db.rows("change_outcome_verifications")[0].status).toBe("verified");
  });

  it("refuses to record a further observation once terminal", async () => {
    const verification = await create();
    await open(verification.id);
    await completeOutcomeVerification(client(), {
      verificationId: verification.id,
      projectId: OUTCOME_FIXTURES.project,
      status: "verified",
      checkResults: RESULTS,
      attemptNumber: 1,
      effectiveOrigin: OUTCOME_ORIGIN,
    });

    const recorded = await recordObservationAttempt(client(), {
      verificationId: verification.id,
      projectId: OUTCOME_FIXTURES.project,
      attemptNumber: 2,
      checkResults: [],
      effectiveOrigin: null,
    });

    expect(recorded).toBeNull();
    expect(db.rows("change_outcome_verifications")[0].attempt_count).toBe(1);
  });
});

describe("the window opens exactly once (§17, §42)", () => {
  it("keeps the original deadline on a second call", async () => {
    const verification = await create();

    const first = await open(verification.id);
    const deadline = first?.verificationWindowEndsAt;

    // A second call with a *later* start must not move the deadline.
    const second = await openObservationWindow(client(), {
      verificationId: verification.id,
      projectId: OUTCOME_FIXTURES.project,
      windowStartedAt: new Date("2026-08-14T14:59:00.000Z"),
      windowEndsAt: new Date("2026-08-14T15:14:00.000Z"),
    });

    expect(second?.verificationWindowEndsAt).toBe(deadline);
  });

  it("returns the row on replay so the caller can read the stored deadline", async () => {
    const verification = await create();
    await open(verification.id);

    const replayed = await open(verification.id);

    expect(replayed).not.toBeNull();
    expect(replayed?.verificationWindowEndsAt).not.toBeNull();
  });
});

describe("attempt counts cannot be inflated by a retry", () => {
  it("sets the count from the schedule index rather than incrementing", async () => {
    const verification = await create();
    await open(verification.id);

    await recordObservationAttempt(client(), {
      verificationId: verification.id,
      projectId: OUTCOME_FIXTURES.project,
      attemptNumber: 3,
      checkResults: RESULTS,
      effectiveOrigin: OUTCOME_ORIGIN,
    });
    await recordObservationAttempt(client(), {
      verificationId: verification.id,
      projectId: OUTCOME_FIXTURES.project,
      attemptNumber: 3,
      checkResults: RESULTS,
      effectiveOrigin: OUTCOME_ORIGIN,
    });

    // The count says how many attempts the schedule reached, not how many times
    // a step ran.
    expect(db.rows("change_outcome_verifications")[0].attempt_count).toBe(3);
  });
});

describe("one verification per question (§27)", () => {
  it("refuses a second row for the same identity", async () => {
    await create();

    const second = await createOutcomeVerification(client(), {
      projectId: OUTCOME_FIXTURES.project,
      userId: OUTCOME_FIXTURES.user,
      changeMergeId: OUTCOME_FIXTURES.merge,
      preparedChangeId: OUTCOME_FIXTURES.preparedChange,
      changeApprovalId: OUTCOME_FIXTURES.approval,
      mergedCommitSha: OUTCOME_MERGED_COMMIT,
      capability: "nextjs_seo_foundations_v2",
      capabilityVersion: "nextjs-seo-foundations-v2",
      outcomeProfile: "nextjs_seo_foundations_outcome_v1",
      outcomeProfileVersion: "nextjs-seo-foundations-outcome-v1",
      outcomePolicyVersion: OUTCOME_POLICY_VERSION,
      evidenceSchemaVersion: OUTCOME_EVIDENCE_SCHEMA_VERSION,
      publicOrigin: OUTCOME_ORIGIN,
      expectedOutcome: EXPECTED,
      verificationIdentity: "v".repeat(64),
      operationRunId: "operation_2",
    });

    expect(second).toEqual({ ok: false, error: "already_exists" });
    expect(db.rows("change_outcome_verifications")).toHaveLength(1);
  });

  it("finds a terminal answer by identity, so it is never asked again", async () => {
    const verification = await create();
    await open(verification.id);
    await completeOutcomeVerification(client(), {
      verificationId: verification.id,
      projectId: OUTCOME_FIXTURES.project,
      status: "not_observed",
      checkResults: RESULTS,
      attemptNumber: 7,
      effectiveOrigin: OUTCOME_ORIGIN,
    });

    const found = await findVerificationByIdentity(client(), {
      projectId: OUTCOME_FIXTURES.project,
      verificationIdentity: "v".repeat(64),
    });

    expect(found?.status).toBe("not_observed");
  });

  it("does not hold the identity against a Vibe-side failure (§27)", async () => {
    // `failed` is the state a Vibe-side problem lands in. A lock with no
    // release would block that verification forever with no way to clear it
    // through the product.
    const verification = await create();
    await open(verification.id);
    await failOutcomeVerification(client(), {
      verificationId: verification.id,
      projectId: OUTCOME_FIXTURES.project,
      failureCode: "outcome_origin_unreachable",
    });

    const found = await findVerificationByIdentity(client(), {
      projectId: OUTCOME_FIXTURES.project,
      verificationIdentity: "v".repeat(64),
    });

    expect(found).toBeNull();

    // …and a fresh attempt at the same question is therefore possible.
    const retried = await createOutcomeVerification(client(), {
      projectId: OUTCOME_FIXTURES.project,
      userId: OUTCOME_FIXTURES.user,
      changeMergeId: OUTCOME_FIXTURES.merge,
      preparedChangeId: OUTCOME_FIXTURES.preparedChange,
      changeApprovalId: OUTCOME_FIXTURES.approval,
      mergedCommitSha: OUTCOME_MERGED_COMMIT,
      capability: "nextjs_seo_foundations_v2",
      capabilityVersion: "nextjs-seo-foundations-v2",
      outcomeProfile: "nextjs_seo_foundations_outcome_v1",
      outcomeProfileVersion: "nextjs-seo-foundations-outcome-v1",
      outcomePolicyVersion: OUTCOME_POLICY_VERSION,
      evidenceSchemaVersion: OUTCOME_EVIDENCE_SCHEMA_VERSION,
      publicOrigin: OUTCOME_ORIGIN,
      expectedOutcome: EXPECTED,
      verificationIdentity: "v".repeat(64),
      operationRunId: "operation_3",
    });

    expect(retried.ok).toBe(true);
  });
});
