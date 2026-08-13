import { describe, expect, it } from "vitest";
import { checkedValues, migrationSql } from "@/modules/operations/migration-test-support";
import { OPERATION_STAGES, OPERATION_TYPES } from "@/modules/operations/schema";
import { computeReviewIdentity, reviewObjectPath } from "./identity";
import { REVIEW_POLICY } from "./policy";
import {
  CAPTURE_STATUSES,
  REVIEW_POLICY_VERSION,
  REVIEW_PROFILES,
  REVIEW_STATUSES,
  bothSidesCaptured,
  isReviewExpired,
  reviewProfileVersionFor,
} from "./schema";

/**
 * The TypeScript unions against the deployed schema (Sprint 11A §35).
 *
 * This family of test exists because of a near-miss in Sprint 9 and a repeat in
 * 10B: a union and a SQL CHECK express the same rule in two places that nothing
 * forces to agree, and the in-memory test database evaluates no constraints, so
 * no behavioural test can see the drift.
 *
 * The live `operation_runs` CHECK was inspected before this sprint's migration
 * was written and did **not** permit `change_review`. Without the migration
 * every real comparison would have failed at INSERT, after the UI had already
 * told the user it was capturing.
 */

describe("operation types and stages match the database", () => {
  it("permits every declared operation type", () => {
    expect(checkedValues("operation_runs", "operation_type").sort()).toEqual(
      [...OPERATION_TYPES].sort(),
    );
  });

  it("permits change_review", () => {
    // Stated separately, because this is the exact value the live constraint
    // did not have before this sprint.
    expect(checkedValues("operation_runs", "operation_type")).toContain("change_review");
  });

  it("permits every declared stage", () => {
    expect(checkedValues("operation_runs", "stage").sort()).toEqual([...OPERATION_STAGES].sort());
  });

  it("permits every review stage", () => {
    for (const stage of ["capturing_before", "capturing_after", "persisting_artifacts"]) {
      expect(checkedValues("operation_runs", "stage")).toContain(stage);
    }
  });

  it("still permits every historical operation type", () => {
    // Rows exist under all of these. A constraint that dropped one would make
    // history unreadable.
    for (const type of [
      "business_audit",
      "opportunity_generation",
      "change_preparation",
      "change_validation",
      "change_preview",
      "preview_teardown",
    ]) {
      expect(checkedValues("operation_runs", "operation_type")).toContain(type);
    }
  });
});

describe("review artifact enums match the database", () => {
  it("permits every declared review status", () => {
    expect(checkedValues("review_artifacts", "status").sort()).toEqual([...REVIEW_STATUSES].sort());
  });

  it("permits every declared review profile", () => {
    expect(checkedValues("review_artifacts", "review_profile")).toEqual([...REVIEW_PROFILES]);
  });

  it("permits every declared capture status, on both sides", () => {
    expect(checkedValues("review_artifacts", "before_capture_status").sort()).toEqual(
      [...CAPTURE_STATUSES].sort(),
    );
    expect(checkedValues("review_artifacts", "after_capture_status").sort()).toEqual(
      [...CAPTURE_STATUSES].sort(),
    );
  });

  it("stores the policy version rather than enumerating it", () => {
    // A version string is deliberately not an enum: bumping it must not require
    // a migration, or it would stop being cheap to bump and stop being bumped.
    const sql = migrationSql().join("\n");
    expect(sql).toMatch(/review_policy_version text not null check \(char_length/);
  });
});

describe("what the database refuses", () => {
  const sql = migrationSql().join("\n");

  it("refuses a ready comparison missing either side", () => {
    // The last line of defence behind §32. Even if the workflow were wrong, a
    // one-sided comparison cannot be marked ready.
    expect(sql).toContain("review_artifacts_ready_has_both_sides");
    expect(sql).toMatch(/before_capture_status = 'captured' and after_capture_status = 'captured'/);
  });

  it("refuses a ready comparison whose sides differ in size", () => {
    // Comparability, enforced rather than trusted: two images at different
    // sizes are two pictures, not a before and an after.
    expect(sql).toContain("review_artifacts_ready_has_equal_viewport");
    expect(sql).toMatch(/before_width = after_width and before_height = after_height/);
  });

  it("keeps the screenshot bucket private", () => {
    // A public bucket would put images of a customer's product on a guessable
    // URL forever (§16).
    expect(sql).toMatch(/'review-screenshots',\s*\n\s*'review-screenshots',\s*\n\s*false/);
  });

  it("gives the usage ledger no insert policy", () => {
    // The Sprint 10B lesson, applied before it can bite again: a ledger written
    // from a request is one RLS refusal away from silence.
    expect(sql).toContain('create policy "select own review_browser_usage"');
    expect(sql).not.toContain('insert own review_browser_usage');
  });

  it("lets a review outlive the preview it photographed", () => {
    // ON DELETE SET NULL, not CASCADE. The artifact exists precisely so the
    // sandbox can be stopped (§7, §42).
    expect(sql).toMatch(
      /preview_session_id uuid references public\.preview_sessions \(id\) on delete set null/,
    );
  });
});

describe("review identity", () => {
  const base = {
    projectId: "project_1",
    preparedChangeId: "prepared_1",
    preparedCommitSha: "2f05958e3410deaeb97029861abc05889139b4a7",
    validationRunId: "validation_1",
    previewSessionId: "preview_1",
    beforeOrigin: "https://example.com",
    route: "/",
    reviewProfile: "public_visual_review_v1" as const,
    reviewProfileVersion: reviewProfileVersionFor("public_visual_review_v1"),
    reviewPolicyVersion: REVIEW_POLICY_VERSION,
  };

  it("is stable for the same inputs", () => {
    expect(computeReviewIdentity(base)).toBe(computeReviewIdentity(base));
  });

  it("changes when the preview session changes", () => {
    // "After" is a photograph of one specific running sandbox, not of a commit.
    expect(computeReviewIdentity({ ...base, previewSessionId: "preview_2" })).not.toBe(
      computeReviewIdentity(base),
    );
  });

  it("changes when the policy version changes", () => {
    expect(computeReviewIdentity({ ...base, reviewPolicyVersion: "review-policy-v2" })).not.toBe(
      computeReviewIdentity(base),
    );
  });

  it("changes when the prepared commit changes", () => {
    expect(computeReviewIdentity({ ...base, preparedCommitSha: "0".repeat(40) })).not.toBe(
      computeReviewIdentity(base),
    );
  });

  it("puts the project first in the storage path", () => {
    // Storage authorization is a path prefix rule; the project has to lead for
    // it to be expressible at all.
    expect(reviewObjectPath({ projectId: "p1", reviewArtifactId: "r1", side: "before" })).toBe(
      "p1/r1/before.png",
    );
  });
});

describe("review policy", () => {
  it("compares one route at a fixed desktop viewport", () => {
    expect(REVIEW_POLICY.route).toBe("/");
    expect(REVIEW_POLICY.viewport).toEqual({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  });

  it("captures a fixed frame rather than a full page", () => {
    // Full-page height varies with content, so two of them cannot be laid side
    // by side without scaling one — and scaling is how a comparison lies.
    expect(REVIEW_POLICY.fullPage).toBe(false);
  });

  it("bounds the settle rather than waiting for network idle", () => {
    // A modern app can hold a connection open indefinitely, so `networkidle`
    // may never arrive and would bill by the second while it did not (§13).
    expect(REVIEW_POLICY.settleMs).toBeGreaterThan(0);
    expect(REVIEW_POLICY.settleMs).toBeLessThanOrEqual(5_000);
    expect(REVIEW_POLICY.captureTimeoutMs).toBeGreaterThan(REVIEW_POLICY.settleMs);
  });

  it("keeps comparisons for a bounded, chosen period", () => {
    // Seven days: longer than the preview it came from, because the artifact
    // exists so the sandbox can be stopped — and not indefinite (§17).
    expect(REVIEW_POLICY.retentionMs).toBe(7 * 24 * 60 * 60 * 1000);
  });
});

describe("domain rules", () => {
  it("treats a passed deadline as expired", () => {
    const now = new Date("2026-08-14T12:00:00.000Z");
    expect(isReviewExpired({ expiresAt: "2026-08-14T11:59:59.000Z" }, now)).toBe(true);
    expect(isReviewExpired({ expiresAt: "2026-08-14T12:00:01.000Z" }, now)).toBe(false);
  });

  it("does not call a one-sided capture a comparison", () => {
    const captured = {
      objectPath: "p/r/before.png",
      status: "captured" as const,
      sha256: "a".repeat(64),
      width: 1440,
      height: 1000,
      capturedAt: "2026-08-14T12:00:00.000Z",
    };
    const missing = {
      objectPath: null,
      status: "failed" as const,
      sha256: null,
      width: null,
      height: null,
      capturedAt: null,
    };

    expect(bothSidesCaptured({ before: captured, after: captured })).toBe(true);
    expect(bothSidesCaptured({ before: captured, after: missing })).toBe(false);
    expect(bothSidesCaptured({ before: missing, after: captured })).toBe(false);
  });
});
