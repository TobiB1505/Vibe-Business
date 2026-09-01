import { computeApprovalIdentity } from "@/modules/approvals/identity";
import { APPROVAL_POLICY_VERSION } from "@/modules/approvals/schema";
import { FakeDatabase } from "@/modules/operations/test-support";
import { FIXTURE_COMMIT_SHA } from "@/modules/validation/test-support";
import type { FastForwardOutcome, MergeApprovedChangePort } from "./git-port";

/**
 * Test doubles for merging (Sprint 11C §38, §40, §41, §42).
 *
 * ## What the fake port models honestly
 *
 * **Every call is counted.** "Exactly one non-force update" and "zero writes on
 * every refusal path" are the two properties this sprint rests on, and a double
 * that cannot count cannot prove either.
 *
 * **The branch is real state.** `fastForwardDefaultBranch` actually moves the
 * fake's head, so a replayed step observes what a replayed step would observe
 * in production, rather than whatever a test author remembered to stub.
 *
 * **There is no way to force anything.** The double implements the same port as
 * the real adapter, so it has no `force` parameter either. A test that wanted
 * to exercise forcing could not express it.
 *
 * Nothing here touches a network or a repository.
 */

export const MERGE_BASE_SHA = "b".repeat(40);
export const MERGE_TARGET_SHA = FIXTURE_COMMIT_SHA;
export const MERGE_THIRD_SHA = "d".repeat(40);

export type FakeMergePortOptions = {
  defaultBranchName?: string;
  /** Where the default branch starts. Defaults to the prepared base. */
  headSha?: string | null;
  preparedBranchHead?: string | null;
  preparedCommitParents?: string[] | null;
  hasWritePermission?: boolean;
  /**
   * Outcomes for successive writes.
   *
   * A queue rather than a single value so a test can say "the first attempt was
   * ambiguous, the second would succeed" — and then assert that the second
   * never happens.
   */
  writeOutcomes?: FastForwardOutcome[];
  /** Head observed after an ambiguous write, when it differs from the real one. */
  headAfterAmbiguous?: string | null;
};

export class FakeMergePort implements MergeApprovedChangePort {
  /** Every consequential write attempted, in order. The core assertion surface. */
  readonly writes: { branch: string; toSha: string }[] = [];
  readonly headReads: number[] = [];

  private head: string | null;
  private ambiguousSeen = false;

  constructor(private readonly options: FakeMergePortOptions = {}) {
    this.head = options.headSha === undefined ? MERGE_BASE_SHA : options.headSha;
  }

  get writeCount(): number {
    return this.writes.length;
  }

  get currentHead(): string | null {
    return this.head;
  }

  async getDefaultBranch() {
    this.headReads.push(this.headReads.length + 1);

    // After an ambiguous write a test may want the branch to read as something
    // other than what the fake would otherwise say — that is the whole point of
    // the recovery path.
    if (this.ambiguousSeen && this.options.headAfterAmbiguous !== undefined) {
      const observed = this.options.headAfterAmbiguous;
      return observed === null ? null : { name: this.branchName, commitSha: observed };
    }

    return this.head === null ? null : { name: this.branchName, commitSha: this.head };
  }

  async getBranchHead() {
    return this.options.preparedBranchHead === undefined
      ? MERGE_TARGET_SHA
      : this.options.preparedBranchHead;
  }

  async getCommitParents() {
    return this.options.preparedCommitParents === undefined
      ? [MERGE_BASE_SHA]
      : this.options.preparedCommitParents;
  }

  async hasContentsWritePermission() {
    return this.options.hasWritePermission ?? true;
  }

  async fastForwardDefaultBranch(input: { branch: string; toSha: string }) {
    this.writes.push(input);

    const scripted = this.options.writeOutcomes?.[this.writes.length - 1];

    if (scripted?.kind === "rejected") return scripted;

    if (scripted?.kind === "ambiguous") {
      this.ambiguousSeen = true;
      // Deliberately does *not* move the head. A test that wants "the write
      // landed but the response was lost" says so via `headAfterAmbiguous`,
      // which keeps the two situations distinguishable.
      return scripted;
    }

    this.head = input.toSha;
    return { kind: "updated", refSha: input.toSha } as const;
  }

  private get branchName(): string {
    return this.options.defaultBranchName ?? "main";
  }
}

/** A port that fails every read, for provider-unavailable paths. */
export class UnreachableMergePort implements MergeApprovedChangePort {
  readonly writes: { branch: string; toSha: string }[] = [];

  async getDefaultBranch() {
    return null;
  }
  async getBranchHead() {
    return null;
  }
  async getCommitParents() {
    return null;
  }
  async hasContentsWritePermission() {
    return false;
  }
  async fastForwardDefaultBranch(input: { branch: string; toSha: string }) {
    this.writes.push(input);
    return { kind: "ambiguous" } as const;
  }
}

export const MERGE_FIXTURES = {
  user: "user_1",
  project: "project_1",
  preparedChange: "prepared_1",
  validation: "validation_1",
  review: "review_1",
  approval: "approval_1",
  connection: "connection_1",
  installationRow: "installation_row_1",
  operation: "operation_1",
  merge: "merge_1",
} as const;

/**
 * Seeds a project whose change is prepared, validated, reviewed and approved.
 *
 * The full trust pipeline, because a merge test that stubbed the approval away
 * would not be testing the thing the sprint is about.
 */
export function seedApprovedChange(
  db: FakeDatabase,
  options: {
    approvalStatus?: "approved" | "revoked" | "invalidated";
    approvalCommitSha?: string;
    approvalBaseSha?: string;
    withApproval?: boolean;
    approvalIdentity?: string;
  } = {},
): void {
  const later = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  db.seed("projects", {
    id: MERGE_FIXTURES.project,
    user_id: MERGE_FIXTURES.user,
    production_url: "https://example.test",
  });

  db.seed("github_installations", {
    id: MERGE_FIXTURES.installationRow,
    installation_id: 4242,
  });

  db.seed("repository_connections", {
    id: MERGE_FIXTURES.connection,
    project_id: MERGE_FIXTURES.project,
    owner: "acme",
    name: "product",
    full_name: "acme/product",
    default_branch: "main",
    github_installation_id: MERGE_FIXTURES.installationRow,
  });

  db.seed("prepared_changes", {
    id: MERGE_FIXTURES.preparedChange,
    project_id: MERGE_FIXTURES.project,
    user_id: MERGE_FIXTURES.user,
    status: "prepared",
    commit_sha: MERGE_TARGET_SHA,
    base_sha: MERGE_BASE_SHA,
    base_branch: "main",
    branch_name: "vibe/seo-foundations",
    files: [{ path: "src/app/sitemap.ts", contentHash: "a".repeat(64), bytes: 512 }],
  });

  db.seed("validation_runs", {
    id: MERGE_FIXTURES.validation,
    project_id: MERGE_FIXTURES.project,
    user_id: MERGE_FIXTURES.user,
    prepared_change_id: MERGE_FIXTURES.preparedChange,
    status: "passed",
    prepared_commit_sha: MERGE_TARGET_SHA,
    created_at: "2026-08-14T00:00:00.000Z",
  });

  db.seed("review_artifacts", {
    id: MERGE_FIXTURES.review,
    project_id: MERGE_FIXTURES.project,
    user_id: MERGE_FIXTURES.user,
    prepared_change_id: MERGE_FIXTURES.preparedChange,
    validation_run_id: MERGE_FIXTURES.validation,
    preview_session_id: "preview_1",
    operation_run_id: "op_review_1",
    status: "ready",
    review_policy_version: "review-policy-v1",
    review_identity: "r".repeat(64),
    created_at: "2026-08-14T01:00:00.000Z",
    expires_at: later,
  });

  if (options.withApproval === false) return;

  db.seed("change_approvals", {
    id: MERGE_FIXTURES.approval,
    project_id: MERGE_FIXTURES.project,
    user_id: MERGE_FIXTURES.user,
    prepared_change_id: MERGE_FIXTURES.preparedChange,
    validation_run_id: MERGE_FIXTURES.validation,
    review_artifact_id: MERGE_FIXTURES.review,
    prepared_commit_sha: options.approvalCommitSha ?? MERGE_TARGET_SHA,
    prepared_base_sha: options.approvalBaseSha ?? MERGE_BASE_SHA,
    approval_policy_version: "approval-policy-v1",
    approval_identity: options.approvalIdentity ?? approvalIdentityForFixture(),
    status: options.approvalStatus ?? "approved",
    approved_at: "2026-08-14T02:00:00.000Z",
    revoked_at: options.approvalStatus === "revoked" ? "2026-08-14T03:00:00.000Z" : null,
    invalidated_at: options.approvalStatus === "invalidated" ? "2026-08-14T03:00:00.000Z" : null,
    invalidation_reason: options.approvalStatus === "invalidated" ? "prepared_change_modified" : null,
    created_at: "2026-08-14T02:00:00.000Z",
  });
}

/**
 * The approval identity the approval service will resolve for the fixture.
 *
 * Computed with the real function rather than hardcoded, so a change to what
 * identity means breaks these tests loudly instead of silently making the
 * merge's approval lookup miss.
 */
export function approvalIdentityForFixture(): string {
  return computeApprovalIdentity({
    projectId: MERGE_FIXTURES.project,
    preparedChangeId: MERGE_FIXTURES.preparedChange,
    preparedCommitSha: MERGE_TARGET_SHA,
    preparedBaseSha: MERGE_BASE_SHA,
    validationRunId: MERGE_FIXTURES.validation,
    evidence: { kind: "review_artifact", reviewArtifactId: MERGE_FIXTURES.review },
    approvalPolicyVersion: APPROVAL_POLICY_VERSION,
  });
}
