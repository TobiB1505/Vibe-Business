/**
 * The temporary change preview domain (Sprint 10B-2 §2, §3, §4, §5).
 *
 * ## What a preview is allowed to claim
 *
 * Sprint 10A ended with a chain of gates that the product states explicitly
 * rather than blurring:
 *
 * ```
 * repository_write_verified     the bytes on the branch are the bytes we meant
 * sandbox_validation_passed     those bytes install, typecheck, test and build
 * validated_artifact_available  that exact filesystem was kept, briefly
 * preview_available             ← this sprint
 * human_approved                someone looked at it
 * merged / deployed             neither exists
 * ```
 *
 * `preview_available` means exactly one thing:
 *
 * > The exact validated artifact can run and become reachable in an isolated
 * > temporary environment.
 *
 * It does **not** mean the change is good, correct, on-brand, SEO-sound,
 * secure, approved, or production ready. A preview that renders a beautiful
 * broken page is a successful preview. The vocabulary lives in the type system
 * for the same reason `ValidationVerdict` does — copy drifts, types do not.
 *
 * ## Why this is a separate module from `validation`
 *
 * They share a sandbox provider and nothing else. Validation runs
 * repository-controlled commands and throws the filesystem away; preview
 * restores a filesystem it already trusts, runs one server, and **exposes a
 * public port** — which is a category of risk validation never takes. Keeping
 * the exposure decision in its own module is what stops it being inherited by
 * accident.
 *
 * It is also separate from `modules/previews`, which reserves the
 * `PreviewProvider` boundary for Vercel *Preview Deployments* (ADR 0004). That
 * is a deploy; this is not. Conflating them would let "preview" mean two
 * different trust levels in one codebase.
 */

/**
 * Preview profiles (§3).
 *
 * One, deliberately, for the same reason validation has one: a profile is a
 * promise about which runtime starts which server on which port. "Supports
 * everything" would mean "promises nothing", and a guessed start command
 * produces a URL nobody should trust.
 *
 * Eligibility is derived from the *validation* profile that produced the
 * artifact — never from an Opportunity's prose, a repository's README, or any
 * other text a model or a customer wrote (CLAUDE.md rules 25, 57).
 */
export const PREVIEW_PROFILES = ["nextjs_preview_v1"] as const;
export type PreviewProfile = (typeof PREVIEW_PROFILES)[number];

/** Bumped when what a profile *starts* changes meaning. */
export const PREVIEW_PROFILE_VERSIONS: Record<PreviewProfile, string> = {
  nextjs_preview_v1: "nextjs-preview-v1",
};

import type { ValidationProfile } from "@/modules/validation/schema";

/**
 * Which validated artifacts `nextjs_preview_v1` can start.
 *
 * A `Record` over the closed validation-profile union rather than an `if`:
 * adding a validation profile without deciding whether preview supports it
 * becomes a type error instead of a silent `false` or, worse, a silent `true`.
 */
export const PREVIEWABLE_VALIDATION_PROFILES: Record<ValidationProfile, PreviewProfile | null> = {
  nextjs_node_v1: "nextjs_preview_v1",
};

/**
 * The preview runtime policy version (§4).
 *
 * Versions, together, everything that decides what a running preview *is*:
 *
 *  - the runtime it starts in (restored artifact, never a fresh image);
 *  - the single Vibe-controlled port;
 *  - the server command strategy (production server, never `next dev`);
 *  - the network policy (inbound one port, outbound `deny-all`);
 *  - the TTL;
 *  - health-check behaviour;
 *  - the secret policy (none, and proven absent before the server starts);
 *  - cleanup and snapshot-deletion semantics.
 *
 * It is part of the preview identity, so a policy change invalidates preview
 * reuse by construction rather than by anyone remembering to. That is the same
 * discipline `SANDBOX_POLICY_VERSION` applies to validation, and for the same
 * reason: a stored "this ran fine" must never be reinterpreted under rules it
 * was not checked against (CLAUDE.md rule 65).
 */
export const PREVIEW_POLICY_VERSION = "preview-policy-v1" as const;

export const PREVIEW_PROVIDERS = ["vercel_sandbox"] as const;
export type PreviewProviderId = (typeof PREVIEW_PROVIDERS)[number];

/**
 * The lifecycle of one preview session (§5).
 *
 * `expired` and `stopped` are distinct on purpose. Both mean "not reachable",
 * but only one of them is something the user did, and a product that cannot
 * tell them apart cannot explain why a link stopped working.
 */
export const PREVIEW_STATUSES = [
  "starting",
  "running",
  "stopping",
  "stopped",
  "expired",
  "failed",
] as const;
export type PreviewStatus = (typeof PREVIEW_STATUSES)[number];

/** Statuses in which a preview may still be reachable and still costs money. */
export const ACTIVE_PREVIEW_STATUSES: readonly PreviewStatus[] = ["starting", "running"];

export function isPreviewActive(status: PreviewStatus): boolean {
  return ACTIVE_PREVIEW_STATUSES.includes(status);
}

/**
 * How far a starting preview has got (§23).
 *
 * Mirrors the validation stage vocabulary: named phases, no percentages. A
 * restore-plus-boot is tens of seconds, and the only honest estimate would be
 * the previous run's timing.
 */
export const PREVIEW_STAGES = [
  "preflight",
  "restoring_artifact",
  "verifying_artifact",
  "starting_server",
  "checking_preview",
  "completed",
] as const;
export type PreviewStage = (typeof PREVIEW_STAGES)[number];

/**
 * Why a preview could not start, or stopped being trustworthy (§26).
 *
 * Stable, safe, and closed. Raw provider errors never reach any of these: the
 * chain is `provider error → sanitized structured diagnostic → failure code →
 * user-safe copy` (ADR 0015 §9).
 */
export const PREVIEW_FAILURE_CODES = [
  /** No passing validation exists for this change, so there is nothing to preview. */
  "validation_required",
  /** The validation profile that produced the artifact has no preview profile. */
  "preview_not_supported",
  /**
   * The user did not explicitly confirm public exposure (§8).
   *
   * Load-bearing on the server, not a UI courtesy: without it, zero sandbox
   * creation, zero exposed port, zero provider spend.
   */
  "preview_exposure_not_confirmed",
  /** No artifact was captured, or it has already been deleted. */
  "preview_artifact_unavailable",
  /** The artifact's own deadline passed. Checked before any provider spend (§10). */
  "preview_artifact_expired",
  /**
   * The restored filesystem is not the validated filesystem (§11).
   *
   * Covers a changed-file hash mismatch, a build-identity mismatch, and a
   * credential-bearing `.git` that came back with the snapshot. Zero
   * repository-controlled code runs after this.
   */
  "preview_artifact_integrity_failed",
  /**
   * A privileged Vibe credential was found in the preview environment (§12).
   *
   * Distinct from an integrity failure because the remediation is completely
   * different: an integrity failure is about the customer's artifact, this is a
   * defect in Vibe's own environment construction.
   */
  "preview_privileged_environment",
  /** The application cannot start without configuration Vibe will not supply (§12). */
  "preview_missing_environment",
  /** The server command could not be started at all. */
  "preview_start_failed",
  /** The server started and then exited before it answered. */
  "preview_process_exited",
  /** The server never answered within its budget. */
  "preview_health_check_failed",
  /** The sandbox provider could not create, reconnect, or route. */
  "preview_provider_unavailable",
  /** Teardown or snapshot deletion did not verifiably complete. Never hides a result. */
  "preview_cleanup_failed",
  /** Anything else, reported honestly rather than guessed at. */
  "preview_failed",
] as const;
export type PreviewFailureCode = (typeof PREVIEW_FAILURE_CODES)[number];

/** Whether the sandbox was verifiably torn down. Recorded, never a verdict. */
export const PREVIEW_CLEANUP_STATUSES = [
  "stopped",
  "stop_failed",
  "not_provisioned",
  /** The sandbox is gone but its snapshot could not be deleted. Retryable (§19). */
  "artifact_delete_failed",
] as const;
export type PreviewCleanupStatus = (typeof PREVIEW_CLEANUP_STATUSES)[number];

/**
 * The artifact a preview restores from.
 *
 * Identified by its validation run, because capture is strictly one-per-passing
 * run: `validation_runs.artifact_snapshot_id` is set once, by the cleanup step
 * of the run that earned it, and never re-set. A separate `validated_artifacts`
 * table would be storage with no second row to hold.
 *
 * So `validatedArtifactId === validationRunId`, stated here once rather than
 * assumed in five call sites. The PreviewSession still records the **snapshot
 * id it actually restored from**, which is not derivable and is the thing an
 * audit would want.
 */
export type ValidatedArtifact = {
  /** The validation run that captured it. Also the artifact's public id. */
  validationRunId: string;
  projectId: string;
  preparedChangeId: string;
  validationProfile: ValidationProfile;
  preparedCommitSha: string;
  snapshotId: string;
  expiresAt: string;
  deletedAt: string | null;
};

export type PreviewSession = {
  id: string;
  projectId: string;
  userId: string;

  preparedChangeId: string;
  validationRunId: string;
  operationRunId: string;
  /** The exact snapshot this session restored. Never client-supplied. */
  artifactSnapshotId: string;

  previewProfile: PreviewProfile;
  previewProfileVersion: string;
  previewPolicyVersion: string;

  provider: PreviewProviderId;
  runtime: string | null;
  /** Vibe-controlled, from `preview-policy-v1`. Never a client choice (§14). */
  port: number;

  status: PreviewStatus;
  stage: PreviewStage;
  failureCode: PreviewFailureCode | null;
  cleanupStatus: PreviewCleanupStatus | null;

  previewIdentity: string;

  startedAt: string | null;
  readyAt: string | null;
  expiresAt: string;
  stoppedAt: string | null;
  /** When the ValidatedArtifact snapshot was deleted for this session (§19). */
  artifactDeletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export function previewProfileVersionFor(profile: PreviewProfile): string {
  return PREVIEW_PROFILE_VERSIONS[profile];
}

/**
 * The preview profile for a validated artifact, or null.
 *
 * Null is the answer for every framework that is not Next.js, and it stays the
 * answer until a second profile is deliberately built. Refusing is the feature.
 */
export function previewProfileFor(validationProfile: ValidationProfile): PreviewProfile | null {
  return PREVIEWABLE_VALIDATION_PROFILES[validationProfile] ?? null;
}

/**
 * A preview has expired when its own deadline has passed.
 *
 * Evaluated against the persisted `expires_at` rather than against the
 * provider's sandbox timeout. The provider timeout is what actually stops the
 * VM; this is what stops Vibe *offering* a preview it can no longer stand
 * behind, and the two must not be the same clock (§18, §25).
 */
export function isPreviewExpired(session: { expiresAt: string }, now: Date = new Date()): boolean {
  const deadline = Date.parse(session.expiresAt);
  return Number.isFinite(deadline) && deadline <= now.getTime();
}
