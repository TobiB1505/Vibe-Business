import { describe, expect, it } from "vitest";
import { runMergePreflight, type MergePreflightInput } from "./preflight";

/**
 * The merge gate (Sprint 11C §35, §36, §37).
 *
 * Every test here is a refusal that must happen *before* anything reaches
 * GitHub. The preflight is pure, so "zero writes" is not something these tests
 * assert by counting calls — it is true because the function has nothing to
 * call. The write-path tests in `change-merge/execution.test.ts` do the
 * counting.
 */

const BASE = "a".repeat(40);
const TARGET = "b".repeat(40);
const OTHER = "c".repeat(40);

function input(overrides: {
  approval?: Partial<NonNullable<MergePreflightInput["approval"]>> | null;
  prepared?: Partial<MergePreflightInput["prepared"]>;
  probe?: Partial<MergePreflightInput["probe"]>;
} = {}): MergePreflightInput {
  const approval =
    overrides.approval === null
      ? null
      : {
          id: "approval_1",
          status: "approved" as const,
          preparedChangeId: "prepared_1",
          preparedCommitSha: TARGET,
          preparedBaseSha: BASE,
          ...overrides.approval,
        };

  return {
    approval,
    prepared: {
      id: "prepared_1",
      branchName: "vibe/seo-foundations",
      commitSha: TARGET,
      baseSha: BASE,
      ...overrides.prepared,
    },
    probe: {
      defaultBranch: { name: "main", commitSha: BASE },
      preparedBranchHead: TARGET,
      preparedCommitParents: [BASE],
      hasContentsWritePermission: true,
      ...overrides.probe,
    },
  };
}

describe("the happy path is narrow and explicit (§36, §52)", () => {
  it("is eligible when main is at the base, the commit is its child, and a human approved it", () => {
    const result = runMergePreflight(input());

    expect(result).toEqual({
      outcome: "eligible",
      defaultBranch: "main",
      observedDefaultHead: BASE,
      targetSha: TARGET,
    });
  });

  it("moves the branch to the approved commit, never to anything the prepared change says", () => {
    // The prepared change's own commit column is deliberately ignored in favour
    // of the approval's: if the two ever disagree the approval wins, because it
    // is the one a human looked at. Here they are made to disagree, and the
    // preflight refuses outright rather than picking one.
    const result = runMergePreflight(input({ prepared: { commitSha: OTHER } }));

    expect(result).toEqual({ outcome: "blocked", reason: "merge_approval_invalid" });
  });
});

describe("approval is required, and it must be this exact approval (§3, §35)", () => {
  it("blocks when no approval exists", () => {
    expect(runMergePreflight(input({ approval: null }))).toEqual({
      outcome: "blocked",
      reason: "merge_approval_required",
    });
  });

  it("blocks a revoked approval", () => {
    expect(runMergePreflight(input({ approval: { status: "revoked" } }))).toEqual({
      outcome: "blocked",
      reason: "merge_approval_required",
    });
  });

  it("blocks an invalidated approval", () => {
    expect(runMergePreflight(input({ approval: { status: "invalidated" } }))).toEqual({
      outcome: "blocked",
      reason: "merge_approval_required",
    });
  });

  it("blocks an approval of a different commit", () => {
    expect(runMergePreflight(input({ approval: { preparedCommitSha: OTHER } }))).toEqual({
      outcome: "blocked",
      reason: "merge_approval_invalid",
    });
  });

  it("blocks an approval prepared against a different base", () => {
    // The base is part of what a human approved. An approval of "this commit,
    // on top of that base" does not authorize the same commit somewhere else.
    expect(runMergePreflight(input({ approval: { preparedBaseSha: OTHER } }))).toEqual({
      outcome: "blocked",
      reason: "merge_approval_invalid",
    });
  });

  it("blocks an approval belonging to a different prepared change", () => {
    expect(runMergePreflight(input({ approval: { preparedChangeId: "prepared_2" } }))).toEqual({
      outcome: "blocked",
      reason: "merge_approval_invalid",
    });
  });

  it("blocks a prepared change that never produced a commit", () => {
    expect(runMergePreflight(input({ prepared: { commitSha: null } }))).toEqual({
      outcome: "blocked",
      reason: "merge_approval_invalid",
    });
  });
});

describe("repository state is read live and never inherited (§4, §36)", () => {
  it("blocks when the default branch has moved off the base", () => {
    expect(runMergePreflight(input({ probe: { defaultBranch: { name: "main", commitSha: OTHER } } }))).toEqual(
      { outcome: "blocked", reason: "merge_repository_changed" },
    );
  });

  it("does not attempt to merge, rebase or reason about a moved default branch", () => {
    // The whole content of §7 as a test: there is exactly one non-blocked
    // outcome shape, and drift is not one of its inputs.
    const drifted = runMergePreflight(
      input({ probe: { defaultBranch: { name: "main", commitSha: OTHER } } }),
    );

    expect(drifted.outcome).toBe("blocked");
    expect(drifted).not.toHaveProperty("targetSha");
  });

  it("blocks when the approved commit no longer exists", () => {
    expect(runMergePreflight(input({ probe: { preparedCommitParents: null } }))).toEqual({
      outcome: "blocked",
      reason: "merge_prepared_commit_missing",
    });
  });

  it("blocks when the approved commit is not a direct child of the base", () => {
    expect(runMergePreflight(input({ probe: { preparedCommitParents: [OTHER] } }))).toEqual({
      outcome: "blocked",
      reason: "merge_not_fast_forward",
    });
  });

  it("blocks a merge commit, which is not the shape this sprint supports", () => {
    expect(runMergePreflight(input({ probe: { preparedCommitParents: [BASE, OTHER] } }))).toEqual({
      outcome: "blocked",
      reason: "merge_not_fast_forward",
    });
  });

  it("blocks when the prepared branch has moved past the approved commit", () => {
    // Approval binds to a commit, not a branch (§13) — but a branch that has
    // moved on means unreviewed work is sitting one commit past what is about
    // to become the default branch.
    expect(runMergePreflight(input({ probe: { preparedBranchHead: OTHER } }))).toEqual({
      outcome: "blocked",
      reason: "merge_prepared_branch_changed",
    });
  });

  it("blocks when the prepared branch is gone", () => {
    expect(runMergePreflight(input({ probe: { preparedBranchHead: null } }))).toEqual({
      outcome: "blocked",
      reason: "merge_prepared_branch_changed",
    });
  });

  it("resolves the default branch name from GitHub rather than assuming main", () => {
    const result = runMergePreflight(
      input({ probe: { defaultBranch: { name: "trunk", commitSha: BASE } } }),
    );

    expect(result).toMatchObject({ outcome: "eligible", defaultBranch: "trunk" });
  });
});

describe("permissions and reachability (§37)", () => {
  it("blocks when the installation no longer carries write permission", () => {
    expect(runMergePreflight(input({ probe: { hasContentsWritePermission: false } }))).toEqual({
      outcome: "blocked",
      reason: "merge_permission_missing",
    });
  });

  it("blocks when GitHub could not be reached at all", () => {
    // Unreachable must never read as eligible. It is the one probe answer that
    // makes every other check unanswerable.
    expect(runMergePreflight(input({ probe: { defaultBranch: null } }))).toEqual({
      outcome: "blocked",
      reason: "merge_provider_unavailable",
    });
  });
});

describe("the already-applied case (§20)", () => {
  it("reports already applied when the default branch is at the approved commit", () => {
    const result = runMergePreflight(
      input({ probe: { defaultBranch: { name: "main", commitSha: TARGET } } }),
    );

    expect(result).toEqual({ outcome: "already_applied", defaultBranch: "main", targetSha: TARGET });
  });

  it("recognises it even when the prepared branch has since been deleted", () => {
    // A replay after a successful merge and a manual branch cleanup. The
    // outcome exists; refusing here would report a completed merge as a failure.
    const result = runMergePreflight(
      input({
        probe: {
          defaultBranch: { name: "main", commitSha: TARGET },
          preparedBranchHead: null,
          preparedCommitParents: null,
        },
      }),
    );

    expect(result.outcome).toBe("already_applied");
  });

  it("still requires an approval before reporting anything about the branch", () => {
    // Ordering matters: without an approval there is no artifact to ask the
    // question about, and "already applied" would be a claim about something
    // nobody authorized.
    const result = runMergePreflight(
      input({ approval: null, probe: { defaultBranch: { name: "main", commitSha: TARGET } } }),
    );

    expect(result).toEqual({ outcome: "blocked", reason: "merge_approval_required" });
  });
});
