/**
 * The execution domain (Sprint 9 §3, §6, §22).
 *
 * Vibe's first repository write. The whole shape of this module is a reaction
 * to what Sprint 8 taught: a deterministic analyzer reported robots.txt as
 * present when the evidence was our own crawler's parser, the audit believed
 * it, and the Opportunity Engine produced confident wrong advice from it.
 *
 * Advice built on wrong evidence is a wrong sentence. **A repository write
 * built on wrong evidence is a wrong commit.** So execution does not inherit
 * the evidence chain's confidence — it re-establishes the premise from current
 * state immediately before writing, and refuses if anything disagrees.
 */

/**
 * The one supported capability (§6).
 *
 * Versioned in its identifier because the generated output is part of the
 * contract: changing what the generator emits must produce a new capability
 * version rather than silently changing what a "prepared" change means.
 */
export const EXECUTION_CAPABILITIES = [
  /**
   * Historical. Emitted a fixed sitemap that listed `/login` and `/signup`.
   *
   * Retained because the first real Vibe-prepared change (`2f05958` on
   * `vibe/seo-foundations-cc32273131c5`) was produced by it, and its
   * `PreparedChange` row must keep meaning what it meant when it was written.
   * Never resolved for new preparations.
   */
  "nextjs_seo_foundations_v1",
  /** Current. Sitemap derived from structured route intelligence. */
  "nextjs_seo_foundations_v2",
] as const;
export type ExecutionCapability = (typeof EXECUTION_CAPABILITIES)[number];

/** The capability new preparations resolve to. */
export const CURRENT_SEO_FOUNDATIONS_CAPABILITY = "nextjs_seo_foundations_v2" as const;

/**
 * Generator output versions (§10).
 *
 * Bumped whenever the emitted bytes change meaning. Both remain declared: v1 is
 * still the honest description of what the first dogfood commit contains.
 */
export const NEXTJS_SEO_FOUNDATIONS_VERSION = "nextjs-seo-foundations-v1" as const;
export const NEXTJS_SEO_FOUNDATIONS_V2_VERSION = "nextjs-seo-foundations-v2" as const;

/**
 * The generator version a capability produces.
 *
 * A single map rather than a constant read at each call site, because
 * capability and version both feed the execution identity: if they could drift
 * apart, two different generators could share one identity and the second would
 * silently reuse the first one's branch.
 */
export const CAPABILITY_VERSIONS: Record<ExecutionCapability, string> = {
  nextjs_seo_foundations_v1: NEXTJS_SEO_FOUNDATIONS_VERSION,
  nextjs_seo_foundations_v2: NEXTJS_SEO_FOUNDATIONS_V2_VERSION,
};

export function capabilityVersionFor(capability: ExecutionCapability): string {
  return CAPABILITY_VERSIONS[capability];
}

/**
 * Why a preflight refused (§3).
 *
 * A closed set. Each maps to user-facing copy that says what happened and,
 * where it is true, what the user can do — never an internal exception.
 */
export const EXECUTION_BLOCK_REASONS = [
  /** The opportunity set is older than the audit it should derive from. */
  "stale_opportunity",
  /** The audit is older than the evidence that exists now. */
  "stale_audit",
  /** The repository snapshot is not the newest successful one. */
  "stale_repository_intelligence",
  /** The default branch moved since the snapshot was taken (§4). */
  "repository_changed",
  /** The concrete claim behind this capability is no longer true (§8). */
  "premise_no_longer_true",
  "unsupported_framework",
  "unsupported_repository_layout",
  /** No trustworthy production origin to write into the generated files (§12). */
  "missing_required_context",
  "github_write_permission_required",
  /** A target file already exists — never overwritten (§13). */
  "conflicting_files_exist",
  /** This opportunity has no executor, whatever the model said about it (§33). */
  "unsupported_opportunity",
  "execution_not_available",
] as const;
export type ExecutionBlockReason = (typeof EXECUTION_BLOCK_REASONS)[number];

/** Failures that only arise once writing has begun. */
export const EXECUTION_FAILURE_REASONS = [
  /** A Vibe branch exists but points at something we did not prepare (§21). */
  "branch_conflict",
  /** GitHub accepted the write but the read-back did not match (§25). */
  "write_verification_failed",
  "github_unavailable",
  "change_preparation_failed",
] as const;
export type ExecutionFailureReason = (typeof EXECUTION_FAILURE_REASONS)[number];

export type ExecutionFailureCode = ExecutionBlockReason | ExecutionFailureReason;

export type PreparedChangeStatus = "preparing" | "prepared" | "failed" | "superseded";

/** One file the capability generated. Content lives on the branch, not here (§23). */
export type PreparedFile = {
  /** Repository-relative, produced only by capability code (§13). */
  path: string;
  /** sha256 of the generated content, for post-write verification (§25). */
  contentHash: string;
  bytes: number;
};

export type PreparedChange = {
  id: string;
  projectId: string;
  operationRunId: string;
  opportunitySetId: string;
  opportunityId: string;
  capability: ExecutionCapability;
  capabilityVersion: string;
  repositorySnapshotId: string;
  baseBranch: string;
  baseSha: string;
  branchName: string;
  commitSha: string | null;
  files: PreparedFile[];
  status: PreparedChangeStatus;
  failureCode: ExecutionFailureCode | null;
  createdAt: string;
  completedAt: string | null;
};

/**
 * How far verification actually got (§27).
 *
 * `repository_write_verified` means the branch and the file contents were read
 * back and matched. It explicitly does **not** mean the change was built,
 * tested, or run — Vibe has no sandbox, so claiming otherwise would be a lie
 * the user would reasonably act on.
 */
export type VerificationLevel = "repository_write_verified";

/** What the UI may offer for one opportunity (§33). */
export type OpportunityExecutionState =
  /** Vibe has an executor and the preflight passed. */
  | { kind: "executable"; capability: ExecutionCapability }
  /** The model called it ready; Vibe has no executor for it. */
  | { kind: "no_executor" }
  /** There is an executor, but something must change first. */
  | { kind: "blocked"; reason: ExecutionBlockReason }
  /** The model itself said this needs a human decision. */
  | { kind: "needs_user_input" }
  /** The model said this is not automatable. */
  | { kind: "not_automated" };
