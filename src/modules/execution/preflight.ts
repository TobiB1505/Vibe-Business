import type { RepositoryIntelligenceSnapshot } from "@/modules/repository-intelligence/schema";
import type { BusinessOpportunity } from "@/modules/opportunities/schema";
import { resolveExecutionCapability } from "./capabilities";
import type { ExecutionBlockReason, ExecutionCapability } from "./schema";

/**
 * Execution preflight (Sprint 9 §2, §3, §4, §5, §8).
 *
 * ## The lesson this file encodes
 *
 * In Sprint 8 the repository analyzer reported `robots: detected: true`,
 * citing our own crawler's `robots.ts` parser. The audit believed it, the
 * Opportunity Engine reasoned validly from it, and the product told the
 * founder to "restore" files that did not exist. Every layer worked; the
 * premise was false.
 *
 * Advice built on a false premise is a wrong sentence. **A repository write
 * built on a false premise is a wrong commit.** So execution is not allowed to
 * inherit the confidence of the evidence chain:
 *
 *   `executionReadiness === "ready"` authorizes nothing.
 *   Stored evidence ids authorize nothing.
 *   Only current, independently re-checked state authorizes a write.
 *
 * ## What is re-checked, and against what
 *
 * | Check | Source of truth |
 * | --- | --- |
 * | Opportunity set is current | the audit it was derived from |
 * | Audit is current | today's evidence identity |
 * | Snapshot is current | the newest successful snapshot |
 * | Repository unchanged | GitHub's live default-branch HEAD |
 * | Files still absent | the live repository tree |
 * | Routes still unserved | the live production origin |
 * | Write permission | the live GitHub installation |
 *
 * Pure and port-injected, so every refusal is a unit test rather than a
 * production incident.
 */

/** Live facts the preflight cannot derive and must be handed (§4, §8). */
export type PreflightProbe = {
  /** GitHub's current default branch and HEAD sha. */
  head: { defaultBranch: string; commitSha: string };
  /**
   * Repository paths that currently exist at the capability's targets.
   *
   * Read from the live tree, not from the snapshot — the snapshot is exactly
   * what proved untrustworthy.
   */
  existingTargetPaths: string[];
  /** Whether the production site currently serves these (§8). */
  liveRobotsServed: boolean;
  liveSitemapServed: boolean;
  /** Whether the installation currently holds `Contents: write` (§14). */
  hasWritePermission: boolean;
};

export type PreflightInput = {
  opportunity: BusinessOpportunity;
  repository: RepositoryIntelligenceSnapshot;
  /** The snapshot the opportunity chain was built on. */
  repositorySnapshotId: string;
  /** The newest successful snapshot right now. */
  latestRepositorySnapshotId: string;
  /** The commit the snapshot analyzed. */
  snapshotCommitSha: string;
  auditCurrent: boolean;
  opportunitySetCurrent: boolean;
  /** Verified production origin, or null when none is trustworthy (§12). */
  productionOrigin: string | null;
  /** Resolved app root with trailing slash, or null when ambiguous (§9). */
  appRoot: string | null;
  probe: PreflightProbe;
};

export type PreflightResult =
  | {
      eligible: true;
      capability: ExecutionCapability;
      appRoot: string;
      productionOrigin: string;
      baseBranch: string;
      baseSha: string;
    }
  | { eligible: false; reason: ExecutionBlockReason };

export function runExecutionPreflight(input: PreflightInput): PreflightResult {
  const { probe } = input;

  // 1. Is this even something Vibe can do? Structured resolution only — the
  //    opportunity's prose is never consulted (§7).
  const capability = resolveExecutionCapability({
    opportunity: input.opportunity,
    repository: input.repository,
    hasProductionOrigin: input.productionOrigin !== null,
  });

  if (!capability.supported) {
    return {
      eligible: false,
      reason:
        capability.reason === "unsupported_framework" ? "unsupported_framework" : "unsupported_opportunity",
    };
  }

  // 2. Is the reasoning that produced this opportunity still current? Executing
  //    a recommendation derived from a stale diagnosis is exactly the Sprint 8
  //    failure with a commit attached (§5).
  if (!input.auditCurrent) return { eligible: false, reason: "stale_audit" };
  if (!input.opportunitySetCurrent) return { eligible: false, reason: "stale_opportunity" };

  if (input.repositorySnapshotId !== input.latestRepositorySnapshotId) {
    return { eligible: false, reason: "stale_repository_intelligence" };
  }

  // 3. Has the repository moved since we analyzed it? No merge attempt, no
  //    cleverness — the sprint deliberately refuses rather than reasoning about
  //    a tree it has not seen (§4).
  if (probe.head.commitSha !== input.snapshotCommitSha) {
    return { eligible: false, reason: "repository_changed" };
  }

  // 4. Do we know where to write, and what to write into the files?
  if (input.appRoot === null) return { eligible: false, reason: "unsupported_repository_layout" };
  if (input.productionOrigin === null) return { eligible: false, reason: "missing_required_context" };

  // 5. Is the premise still true *right now*? This is the check that would
  //    have caught Sprint 8: the stored evidence said the files were missing,
  //    and here we ask the repository and the live site directly.
  if (probe.liveRobotsServed || probe.liveSitemapServed) {
    return { eligible: false, reason: "premise_no_longer_true" };
  }

  // 6. Never overwrite. A file at a target path means somebody solved this
  //    already, possibly better (§13).
  if (probe.existingTargetPaths.length > 0) {
    return { eligible: false, reason: "conflicting_files_exist" };
  }

  // 7. Last, because it is the only one the user can fix by clicking something.
  if (!probe.hasWritePermission) {
    return { eligible: false, reason: "github_write_permission_required" };
  }

  return {
    eligible: true,
    capability: capability.capability,
    appRoot: input.appRoot,
    productionOrigin: input.productionOrigin,
    baseBranch: probe.head.defaultBranch,
    baseSha: probe.head.commitSha,
  };
}
