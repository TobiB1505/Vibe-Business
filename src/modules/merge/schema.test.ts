import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkedValues, migrationSql } from "@/modules/operations/migration-test-support";
import { OPERATION_STAGES, OPERATION_TYPES } from "@/modules/operations/schema";
import { MERGE_POLICY_VERSION, MERGE_STATUSES, MERGE_STRATEGIES } from "./schema";

/**
 * The database contract for merges (Sprint 11C §31, §43).
 *
 * ## Why this file exists at all
 *
 * A TypeScript union and a SQL CHECK state the same rule in two places nothing
 * forces to agree, and the in-memory test database does not evaluate
 * constraints — so no behavioural test can see them drift. This project has
 * been bitten three times now: a capability bump that would have failed every
 * INSERT with 1376 tests green, an `operation_type` that did not permit
 * `change_preview` live, and another that did not permit `change_review`.
 *
 * The stakes are higher here. A merge whose `operation_type` the database
 * rejects fails at INSERT, before any GitHub call — annoying. A merge whose
 * *status* CHECK disagrees with the code would fail at the transition **after
 * the default branch had already been moved**, which is the one place in this
 * product where a failed write is not the worst outcome.
 */

const MERGE_MIGRATION = join(
  process.cwd(),
  "supabase/migrations/20260814140000_change_merges.sql",
);

function mergeMigration(): string {
  return readFileSync(MERGE_MIGRATION, "utf8");
}

describe("the operation type and stages exist in the database (§31, §43)", () => {
  it("permits change_merge as an operation type", () => {
    // The live constraint was read before the migration was written and did not
    // include this value. Without the migration, every real merge would fail at
    // INSERT — which is exactly how Sprint 9 and 10B were spent.
    expect(checkedValues("operation_runs", "operation_type")).toContain("change_merge");
  });

  it("pins the operation type union to the SQL CHECK exactly", () => {
    expect([...checkedValues("operation_runs", "operation_type")].sort()).toEqual(
      [...OPERATION_TYPES].sort(),
    );
  });

  it("pins the stage union to the SQL CHECK exactly", () => {
    // Including the four merge stages. A stage the database refuses would fail
    // `setOperationStage` mid-merge, and the one before the write is the stage
    // that says the approval was rechecked.
    expect([...checkedValues("operation_runs", "stage")].sort()).toEqual([...OPERATION_STAGES].sort());
  });

  it("permits every merge stage", () => {
    const stages = checkedValues("operation_runs", "stage");
    for (const stage of ["authorizing", "writing_default_ref", "verifying_default_ref", "converging"]) {
      expect(stages).toContain(stage);
    }
  });
});

describe("the merge table's enumerations match the code (§31, §43)", () => {
  it("pins the merge status union to the SQL CHECK exactly", () => {
    expect([...checkedValues("change_merges", "status")].sort()).toEqual([...MERGE_STATUSES].sort());
  });

  it("pins the merge strategy union to the SQL CHECK exactly", () => {
    expect([...checkedValues("change_merges", "merge_strategy")].sort()).toEqual(
      [...MERGE_STRATEGIES].sort(),
    );
  });

  it("permits exactly one merge strategy, so a second one needs a migration", () => {
    // §12: the strategy is not user-selectable and there is nothing to select
    // between. A single-value CHECK looks redundant and is not — it is what
    // makes adding `squash` or `rebase` a deliberate act.
    expect(checkedValues("change_merges", "merge_strategy")).toEqual(["fast_forward_exact_commit"]);
  });

  it("does not constrain the merge policy version to an enumerated set", () => {
    // Same reasoning as the sandbox policy version: bumping it must not require
    // a migration, because a forgotten one fails only at INSERT.
    expect(mergeMigration()).toContain(
      "merge_policy_version text not null check (char_length(btrim(merge_policy_version)) > 0)",
    );
    expect(MERGE_POLICY_VERSION.trim().length).toBeGreaterThan(0);
  });
});

describe("the database refuses to store a merge that was not verified (§39, §43)", () => {
  const sql = () => mergeMigration();

  it("requires a merged row's observed result to be the approved commit", () => {
    // The single most load-bearing constraint in the schema. Application code
    // performs the read-back; this is what makes a bug in that code unable to
    // produce a row claiming a merge that did not happen.
    expect(sql()).toContain("constraint change_merges_merged_matches_approved_commit");
    expect(sql()).toMatch(/resulting_default_head_sha = prepared_commit_sha/);
  });

  it("refuses a merged row with no result at all", () => {
    // `resulting_default_head_sha = prepared_commit_sha` is null-propagating in
    // SQL, so a null result fails the CHECK rather than passing it. Asserted
    // because "null equals" is exactly the kind of thing that reads as safe and
    // sometimes is not.
    const constraint = sql().slice(sql().indexOf("change_merges_merged_matches_approved_commit"));
    expect(constraint).toMatch(/merged_at is not null/);
    expect(constraint).toMatch(/failure_code is null/);
  });

  it("guarantees a blocked merge never wrote anything", () => {
    expect(sql()).toContain("constraint change_merges_blocked_wrote_nothing");
    expect(sql()).toMatch(/started_at is null/);
  });

  it("refuses a write that precedes its own preflight", () => {
    expect(sql()).toContain("constraint change_merges_write_follows_preflight");
  });
});

describe("a normal user cannot forge a merge result (§32, §43)", () => {
  const sql = () => mergeMigration();

  it("has no update policy, so only durable execution can record an outcome", () => {
    // The strongest available form of §32: not "the update policy is narrow"
    // but "there is no update policy". Every authoritative transition —
    // merging, merged, blocked, failed, the resulting SHA, the failure code —
    // is unreachable from a browser session by construction.
    expect(sql()).not.toMatch(/create policy[^;]*for update[^;]*change_merges/i);
    expect(sql()).not.toMatch(/on public\.change_merges\s+for update/i);
  });

  it("has no delete policy, so a default-branch write leaves a permanent record", () => {
    expect(sql()).not.toMatch(/on public\.change_merges\s+for delete/i);
  });

  it("only lets a client open a row that claims nothing", () => {
    const insertPolicy = sql().slice(sql().indexOf('create policy "insert own change_merges"'));

    expect(insertPolicy).toMatch(/change_merges\.status = 'preflight'/);
    expect(insertPolicy).toMatch(/change_merges\.resulting_default_head_sha is null/);
    expect(insertPolicy).toMatch(/change_merges\.failure_code is null/);
    expect(insertPolicy).toMatch(/change_merges\.started_at is null/);
    expect(insertPolicy).toMatch(/change_merges\.merged_at is null/);
  });

  it("requires an active approval for this exact commit and base at the database level", () => {
    const insertPolicy = sql().slice(sql().indexOf('create policy "insert own change_merges"'));

    // The database saying what §3 says. A caller holding nothing but an
    // authenticated token cannot open a merge for bytes nobody approved.
    expect(insertPolicy).toMatch(/from public\.change_approvals ca/);
    expect(insertPolicy).toMatch(/ca\.prepared_commit_sha = change_merges\.prepared_commit_sha/);
    expect(insertPolicy).toMatch(/ca\.prepared_base_sha = change_merges\.prepared_base_sha/);
    expect(insertPolicy).toMatch(/ca\.status = 'approved'/);
  });

  it("qualifies every reference to the new row, so no subquery binds the wrong table", () => {
    // Migration 20260814101000 is this lesson learned expensively: a storage
    // policy with an unqualified column matched nothing and reported nothing.
    // `prepared_change_id` exists on `change_approvals` too.
    const policies = sql().slice(sql().indexOf('create policy "select own change_merges"'));
    const bareReferences = policies.match(/\b(?<!\.)(prepared_change_id|prepared_commit_sha)\s*=\s*(?!change_merges\.)/g);

    // Every occurrence must be either qualified on the outer table or comparing
    // an inner alias against a qualified outer column.
    for (const reference of bareReferences ?? []) {
      expect(reference).toMatch(/^(pc|ca|vr|ra|rc|orn)\./);
    }
  });

  it("keeps the written-identity index scoped to merges that touched GitHub", () => {
    // `preflight` is deliberately outside the predicate: including it would add
    // a lock with no release, so an operation that failed to enqueue would
    // block that merge forever.
    expect(sql()).toContain("create unique index change_merges_written_identity_idx");
    expect(sql()).toMatch(/where status in \('merging', 'merged'\)/);
  });
});

describe("no other migration weakens this one", () => {
  it("is the only place change_merges policies are defined", () => {
    // Anchored on `create policy … on public.change_merges`, not on "a policy
    // statement mentioning change_merges anywhere". The looser form was a false
    // positive waiting to happen and duly fired in Sprint 12A: the outcome
    // verification migration's insert policy *reads* `change_merges` in a
    // subquery to prove the change was genuinely merged, which is the opposite
    // of weakening this table — and the assertion flagged it as a second
    // definition.
    //
    // The guarantee this test exists for is narrower and still exact: nothing
    // else may create a policy **on** `change_merges`, which is what would let
    // another migration grant the UPDATE that Sprint 11C deliberately withheld.
    const definitions = migrationSql().filter((sql) =>
      /create\s+policy[\s\S]*?\bon\s+public\.change_merges\b/i.test(sql),
    );
    expect(definitions).toHaveLength(1);
  });

  it("no migration ever grants update or delete on change_merges", () => {
    // The property the assertion above is a proxy for, stated directly across
    // the whole history rather than by counting files.
    for (const sql of migrationSql()) {
      expect(sql).not.toMatch(/on\s+public\.change_merges\s+for\s+(update|delete)/i);
    }
  });
});
