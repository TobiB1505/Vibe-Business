import { describe, expect, it } from "vitest";
import { checkedValues, migrationSql } from "@/modules/operations/migration-test-support";
import { computeApprovalIdentity } from "./identity";
import {
  APPROVAL_INVALIDATION_REASONS,
  APPROVAL_POLICY_VERSION,
  APPROVAL_STATUSES,
  isApprovalActive,
} from "./schema";

/**
 * The database contract, and the identity that keeps approval honest
 * (Sprint 11B §18, §30, §34).
 *
 * ## Why a contract test exists at all
 *
 * Because a TypeScript union and a SQL CHECK are the same rule written twice
 * with nothing forcing them to agree, and the in-memory database evaluates
 * neither. This project has been bitten three times now — a capability bump, an
 * `operation_type` that did not permit `change_preview`, and a storage policy
 * that matched nothing. Each was invisible to a green suite.
 *
 * Approval is the worst place for that class of defect: the failure mode is
 * either "nobody can approve" or, far worse, a row that exists and says
 * something nobody checked.
 */

const APPROVALS = "change_approvals";

describe("status union matches the database", () => {
  it("permits exactly the TypeScript statuses", () => {
    expect(checkedValues(APPROVALS, "status").sort()).toEqual([...APPROVAL_STATUSES].sort());
  });

  it("permits exactly the TypeScript invalidation reasons", () => {
    expect(checkedValues(APPROVALS, "invalidation_reason").sort()).toEqual(
      [...APPROVAL_INVALIDATION_REASONS].sort(),
    );
  });
});

describe("constraints the product depends on", () => {
  const sql = migrationSql().join("\n");

  it("keeps at most one active approval per exact artifact", () => {
    // The partial index is what makes a double click harmless. Without the
    // `where status = 'approved'` predicate it would also make re-approval
    // after a revoke impossible, so both halves are asserted.
    expect(sql).toMatch(
      /create unique index change_approvals_active_identity_idx[\s\S]*?\(project_id, approval_identity\)[\s\S]*?where status = 'approved'/i,
    );
  });

  it("refuses an approved row that is also terminated", () => {
    // The one defect in this table that would silently grant standing
    // authority: a revoked approval still reading as `approved`.
    expect(sql).toContain("change_approvals_active_is_not_terminated");
  });

  it("requires a reason for an invalidated approval", () => {
    expect(sql).toContain("change_approvals_invalidated_has_reason");
  });

  it("requires a timestamp for a revoked approval", () => {
    expect(sql).toContain("change_approvals_revoked_has_timestamp");
  });

  it("never allows an approval to be deleted through the product", () => {
    // Approval history is the record of who authorized what (§16). No delete
    // policy exists, so RLS refuses it even from a raw authenticated token.
    expect(sql).not.toMatch(/create policy[^;]*on public\.change_approvals[\s\S]*?for delete/i);
  });

  it("verifies the commit and review linkage in the insert policy", () => {
    // The forge-proof half of §19: a caller holding nothing but an
    // authenticated token still cannot record an approval for a commit that
    // was never prepared, never validated or never reviewed.
    const policy = sql.slice(sql.indexOf('create policy "insert own change_approvals"'));
    const insertPolicy = policy.slice(0, policy.indexOf(";"));

    expect(insertPolicy).toContain("pc.commit_sha = change_approvals.prepared_commit_sha");
    expect(insertPolicy).toContain("pc.base_sha = change_approvals.prepared_base_sha");
    expect(insertPolicy).toContain("vr.status = 'passed'");
    expect(insertPolicy).toContain("ra.status = 'ready'");
    expect(insertPolicy).toContain("change_approvals.user_id = auth.uid()");
  });

  it("qualifies every reference to the approval row inside the policy subqueries", () => {
    // `prepared_change_id` exists on `validation_runs` and `review_artifacts`
    // too, so an unqualified reference binds to the inner table and the check
    // passes for the wrong row — silently, with no error. Migration
    // 20260814101000 is that exact bug, learned in a storage policy that
    // matched nothing and reported nothing.
    const policy = sql.slice(sql.indexOf('create policy "insert own change_approvals"'));
    const insertPolicy = policy.slice(0, policy.indexOf(";"));

    for (const line of insertPolicy.split("\n")) {
      if (!line.includes("prepared_change_id")) continue;
      // Every mention is either the approval's own, qualified, or an inner
      // table's, qualified by its alias.
      expect(line).toMatch(/(change_approvals|pc|vr|ra)\.prepared_change_id|pc\.id/);
    }
  });
});

describe("approval identity", () => {
  const base = {
    projectId: "project_1",
    preparedChangeId: "prepared_1",
    preparedCommitSha: "a".repeat(40),
    preparedBaseSha: "b".repeat(40),
    validationRunId: "validation_1",
    reviewArtifactId: "review_1",
    approvalPolicyVersion: APPROVAL_POLICY_VERSION,
  };

  it("is stable for the same artifact", () => {
    expect(computeApprovalIdentity(base)).toBe(computeApprovalIdentity(base));
  });

  it("changes when any part of what was approved changes", () => {
    const identity = computeApprovalIdentity(base);

    // Each of these is a different thing to approve, and §13 turns on that
    // being true by construction rather than by anyone remembering it.
    for (const change of [
      { preparedCommitSha: "c".repeat(40) },
      { preparedBaseSha: "d".repeat(40) },
      { validationRunId: "validation_2" },
      { reviewArtifactId: "review_2" },
      { approvalPolicyVersion: "approval-policy-v2" },
      { projectId: "project_2" },
      { preparedChangeId: "prepared_2" },
    ]) {
      expect(computeApprovalIdentity({ ...base, ...change })).not.toBe(identity);
    }
  });
});

describe("active means standing", () => {
  it("counts only approved", () => {
    expect(isApprovalActive({ status: "approved" })).toBe(true);
    expect(isApprovalActive({ status: "revoked" })).toBe(false);
    expect(isApprovalActive({ status: "invalidated" })).toBe(false);
  });
});
