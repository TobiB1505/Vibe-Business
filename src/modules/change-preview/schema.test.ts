import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
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

const MIGRATIONS_DIR = join(process.cwd(), "supabase/migrations");

function migrations(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) =>
      // Comments are stripped first, and that is not cosmetic: this file's own
      // constraints carry explanatory comments containing parentheses — "(§7)",
      // "(Sprint 10B-2 §23)" — and a naive `[^)]*` scan truncates the value
      // list at the first one. The first draft of this test did exactly that
      // and reported four permitted stages out of twenty-five.
      readFileSync(join(MIGRATIONS_DIR, name), "utf8").replace(/--[^\n]*/g, ""),
    );
}

/**
 * Values permitted by the most recent `check (column in (...))` in the schema.
 *
 * Anchored on `check` specifically, so a partial index predicate — `where
 * status in ('starting', 'running')` — is not mistaken for the constraint. That
 * predicate is a *subset* of the allowed values by design, so reading it as the
 * constraint would silently weaken every assertion below into a tautology.
 */
function allowedBySchema(column: string): string[] {
  let allowed: string[] | null = null;

  for (const sql of migrations()) {
    // The last definition wins, exactly as it does in Postgres: constraints are
    // dropped and re-added, so an earlier, narrower list is history.
    const matches = [...sql.matchAll(new RegExp(`check\\s*\\(\\s*${column} in \\(([^)]*)\\)`, "gi"))];
    const last = matches.at(-1);
    if (last) allowed = [...last[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
  }

  if (allowed === null) throw new Error(`no ${column} constraint found in migrations`);
  return allowed;
}

describe("operation types match the database constraint", () => {
  it("permits every declared operation type", () => {
    expect(allowedBySchema("operation_type").sort()).toEqual([...OPERATION_TYPES].sort());
  });

  it("permits change_preview", () => {
    // Stated separately from the set equality above, because this is the exact
    // value the live constraint did not have before this sprint.
    expect(allowedBySchema("operation_type")).toContain("change_preview");
  });

  it("still permits every historical operation type", () => {
    // Rows exist under all of these. A constraint that dropped one would make
    // history unreadable.
    for (const type of ["business_audit", "opportunity_generation", "change_preparation", "change_validation"]) {
      expect(allowedBySchema("operation_type")).toContain(type);
    }
  });
});

describe("operation stages match the database constraint", () => {
  it("permits every declared stage", () => {
    expect(allowedBySchema("stage").sort()).toEqual([...OPERATION_STAGES].sort());
  });

  it("permits every preview stage", () => {
    for (const stage of ["restoring_artifact", "verifying_artifact", "starting_server", "checking_preview"]) {
      expect(allowedBySchema("stage")).toContain(stage);
    }
  });
});

describe("preview session enums match the database constraints", () => {
  it("permits every declared preview status", () => {
    expect(allowedBySchema("status").sort()).toEqual([...PREVIEW_STATUSES].sort());
  });

  it("permits every declared preview profile", () => {
    expect(allowedBySchema("preview_profile")).toEqual([...PREVIEW_PROFILES]);
  });

  it("permits every declared cleanup status", () => {
    expect(allowedBySchema("cleanup_status").sort()).toEqual([...PREVIEW_CLEANUP_STATUSES].sort());
  });

  it("stores the preview policy version rather than enumerating it", () => {
    // A version string is deliberately not an enum: bumping it must not require
    // a migration, or the version would stop being cheap to bump and would stop
    // being bumped.
    const sql = migrations().join("\n");
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
    expect(computePreviewIdentity({ ...base, previewPolicyVersion: "preview-policy-v2" })).not.toBe(
      computePreviewIdentity(base),
    );
  });

  it("changes when the restored snapshot changes", () => {
    expect(computePreviewIdentity({ ...base, artifactSnapshotId: "snap_2" })).not.toBe(
      computePreviewIdentity(base),
    );
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
  it("supports Next.js validation and nothing else", () => {
    expect(previewProfileFor("nextjs_node_v1")).toBe("nextjs_preview_v1");
    // Refusing is the feature: a guessed start command produces a public URL
    // nobody should trust (§3).
    expect(
      previewProfileFor("some_future_framework_v1" as Parameters<typeof previewProfileFor>[0]),
    ).toBeNull();
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
