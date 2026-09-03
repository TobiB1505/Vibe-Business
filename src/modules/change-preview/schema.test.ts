import { describe, expect, it } from "vitest";
import { checkedValues, migrationSql } from "@/modules/operations/migration-test-support";
import { OPERATION_STAGES, OPERATION_TYPES } from "@/modules/operations/schema";
import { PREVIEW_BUDGETS } from "./budgets";
import { computePreviewIdentity, previewSandboxNameFor } from "./identity";
import {
  PREVIEW_CLEANUP_STATUSES,
  PREVIEW_POLICY_VERSION,
  PREVIEW_PROFILES,
  PREVIEW_STATUSES,
  isPreviewExpired,
  previewProfileFor,
  previewProfileVersionFor,
} from "./schema";
import { FIXTURE_COMMIT_SHA } from "./test-support";

/**
 * The TypeScript unions against the deployed schema (Sprint 10B-2 §35).
 *
 * This family of test exists because of a near-miss in Sprint 9: a capability
 * bump passed lint, typecheck, build and every unit test while the database
 * still held the old CHECK, and every real preparation would have failed at
 * INSERT.
 *
 * The gap is structural — a TypeScript union and a SQL constraint express the
 * same rule in two places that nothing forces to agree — and the in-memory test
 * database does not evaluate CHECK constraints, so no behavioural test can see
 * it. These make them agree.
 *
 * It matters more here than it did there. The live `operation_runs` CHECK was
 * inspected before this sprint's migration was written and did **not** permit
 * `change_preview`: without the migration, every preview would have failed at
 * the first insert, after the UI had already told the user it was starting.
 */

/**
 * The migration reader is shared and **table-aware**.
 *
 * The first version of this test took the last `check (<column> in (...))`
 * anywhere in the history, which broke the moment a second table used the same
 * column name: `review_browser_usage.status` silently redirected the preview
 * status assertion at the wrong constraint. A column name is not a unique key
 * across a schema.
 */

describe("operation types match the database constraint", () => {
  it("permits every declared operation type", () => {
    expect(checkedValues("operation_runs", "operation_type").sort()).toEqual(
      [...OPERATION_TYPES].sort(),
    );
  });

  it("permits change_preview", () => {
    // Stated separately from the set equality above, because this is the exact
    // value the live constraint did not have before this sprint.
    expect(checkedValues("operation_runs", "operation_type")).toContain("change_preview");
  });

  it("still permits every historical operation type", () => {
    // Rows exist under all of these. A constraint that dropped one would make
    // history unreadable.
    for (const type of [
      "business_audit",
      "opportunity_generation",
      "change_preparation",
      "change_validation",
    ]) {
      expect(checkedValues("operation_runs", "operation_type")).toContain(type);
    }
  });
});

describe("operation stages match the database constraint", () => {
  it("permits every declared stage", () => {
    expect(checkedValues("operation_runs", "stage").sort()).toEqual([...OPERATION_STAGES].sort());
  });

  it("permits every preview stage", () => {
    for (const stage of [
      "restoring_artifact",
      "verifying_artifact",
      "starting_server",
      "checking_preview",
    ]) {
      expect(checkedValues("operation_runs", "stage")).toContain(stage);
    }
  });
});

describe("preview session enums match the database constraints", () => {
  it("permits every declared preview status", () => {
    expect(checkedValues("preview_sessions", "status").sort()).toEqual(
      [...PREVIEW_STATUSES].sort(),
    );
  });

  it("permits every declared preview profile", () => {
    expect(checkedValues("preview_sessions", "preview_profile")).toEqual([...PREVIEW_PROFILES]);
  });

  it("permits every declared cleanup status", () => {
    expect(checkedValues("preview_sessions", "cleanup_status").sort()).toEqual(
      [...PREVIEW_CLEANUP_STATUSES].sort(),
    );
  });

  it("stores the preview policy version rather than enumerating it", () => {
    // A version string is deliberately not an enum: bumping it must not require
    // a migration, or the version would stop being cheap to bump and would stop
    // being bumped.
    const sql = migrationSql().join("\n");
    expect(sql).toMatch(/preview_policy_version text not null check \(char_length/);
  });
});

describe("preview identity", () => {
  const base = {
    projectId: "project_1",
    preparedChangeId: "prepared_1",
    validationRunId: "validation_1",
    artifactSnapshotId: "snap_1",
    preparedCommitSha: FIXTURE_COMMIT_SHA,
    previewProfile: "nextjs_preview_v1" as const,
    previewProfileVersion: previewProfileVersionFor("nextjs_preview_v1"),
    previewPolicyVersion: PREVIEW_POLICY_VERSION,
  };

  it("is stable for the same inputs", () => {
    expect(computePreviewIdentity(base)).toBe(computePreviewIdentity(base));
  });

  it("changes when the policy version changes", () => {
    // The load-bearing property: tightening the preview policy invalidates
    // reuse by construction rather than by anyone remembering to (§22).
    expect(
      computePreviewIdentity({ ...base, previewPolicyVersion: "preview-policy-v99" }),
    ).not.toBe(computePreviewIdentity(base));
  });

  it("changes when the prepared commit changes", () => {
    expect(computePreviewIdentity({ ...base, preparedCommitSha: "0".repeat(40) })).not.toBe(
      computePreviewIdentity(base),
    );
  });

  it("names the sandbox after the session and carries no customer identifiers", () => {
    const name = previewSandboxNameFor("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");

    expect(name).toBe("vibe-preview-aaaaaaaabbbbccccdddd");
    // Sandbox names are third-party metadata: no project, no user, no
    // repository, and no raw uuid punctuation to make one guessable by shape.
    expect(previewSandboxNameFor("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee").slice(13)).not.toContain(
      "-",
    );
  });
});

describe("preview policy", () => {
  it("resolves the server from the application, not from how it was checked", () => {
    // Both validation profiles admit the same application, and the same server
    // starts it. What decides is the framework — which is the whole change: a
    // validation profile says how a change is *checked*, and every framework is
    // checked by the same locked install and the repository's own scripts.
    expect(previewProfileFor("nextjs_node_v1", ["nextjs"])).toBe("next_dev_v1");
    expect(previewProfileFor("node_build_v1", ["nextjs", "react"])).toBe("next_dev_v1");
  });

  it("refuses an application no server command can start", () => {
    // Refusing is the feature: a guessed start command produces a public URL
    // nobody should trust (§3). Vite is validated and merged like anything
    // else — it simply has nothing to look at until its row is proven.
    expect(previewProfileFor("node_build_v1", ["vite", "react"])).toBeNull();
    expect(previewProfileFor("node_build_v1", [])).toBeNull();
  });

  it("reads the application's own frameworks, not the repository's", () => {
    // A repository with a Next.js app in `frontend/` and a Python service in
    // `backend/` reports `nextjs` either way. Only one of its directories can
    // be started with `next dev`, and the resolved application says which.
    expect(previewProfileFor("node_build_v1", ["react"])).toBeNull();
  });

  it("bounds the preview at fifteen minutes", () => {
    expect(PREVIEW_BUDGETS.ttlMs).toBe(15 * 60 * 1000);
  });

  it("treats a passed deadline as expired", () => {
    const now = new Date("2026-08-13T12:00:00.000Z");

    expect(isPreviewExpired({ expiresAt: "2026-08-13T11:59:59.000Z" }, now)).toBe(true);
    expect(isPreviewExpired({ expiresAt: "2026-08-13T12:00:01.000Z" }, now)).toBe(false);
  });
});
