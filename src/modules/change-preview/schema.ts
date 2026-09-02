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

import type { ValidationProfile } from "@/modules/validation/schema";

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
export const PREVIEW_PROFILES = ["nextjs_preview_v1", "nextjs_dev_preview_v1"] as const;
export type PreviewProfile = (typeof PREVIEW_PROFILES)[number];

/**
 * The profile every new preview uses (Sprint 0114).
 *
 * `nextjs_preview_v1` — a production server on a restored validated artifact —
 * remains in the union because sessions that ran under it are history and their
 * rows still say so. Nothing creates one any more.
 */
export const CURRENT_PREVIEW_PROFILE: PreviewProfile = "nextjs_dev_preview_v1";

/** Bumped when what a profile *starts* changes meaning. */
export const PREVIEW_PROFILE_VERSIONS: Record<PreviewProfile, string> = {
  nextjs_preview_v1: "nextjs-preview-v1",
  nextjs_dev_preview_v1: "nextjs-dev-preview-v1",
};

/**
 * Which repositories a preview can be started for.
 *
 * Answered by `resolveValidationProfile`, not by a second detection of the same
 * facts. That resolver already decides — from the analyzer's snapshot, never
 * from an Opportunity's prose, a README, or any other text a model or customer
 * wrote (rules 25, 57) — whether this is a single-app Next.js repository with a
 * package manager Vibe supports. A preview needs exactly the same three things,
 * and it needs the package manager and workspace root the resolver returns
 * anyway.
 *
 * Keying it on the validation *profile* rather than on a completed validation
 * *run* is the change Sprint 0114 made: a preview no longer waits for a run.
 *
 * One entry, deliberately, for the same reason validation has one: a profile is
 * a promise about which runtime starts which server on which port. "Supports
 * everything" would mean "promises nothing", and a guessed start command
 * produces a URL nobody should trust.
 */
export const PREVIEWABLE_VALIDATION_PROFILES: Record<ValidationProfile, PreviewProfile | null> = {
  nextjs_node_v1: CURRENT_PREVIEW_PROFILE,
  /**
   * Interim, and narrower than the profile it belongs to.
   *
   * `node_build_v1` admits any repository with a build contract, but the only
   * server command that exists is `next dev` — so a preview is offered for a
   * Next.js application and refused for everything else. The refusal is
   * temporary and honest in the meantime: validation and merge work, and there
   * is nothing to look at.
   *
   * A framework this coarse mapping cannot express is exactly why the next
   * slice replaces it with a dev-server table keyed on the *application's own*
   * frameworks rather than on its validation profile.
   */
  node_build_v1: CURRENT_PREVIEW_PROFILE,
};

/**
 * Which preview a resolved application gets, if any.
 *
 * Keyed on the frameworks the chosen application's own manifest declares, not
 * on the repository-wide union: a repository holding a Next.js app in
 * `frontend/` and a Python service in `backend/` reports `nextjs` either way,
 * and only one of its directories can be started with `next dev`.
 */
export function previewProfileFor(
  validationProfile: ValidationProfile,
  frameworks: readonly string[],
): PreviewProfile | null {
  const profile = PREVIEWABLE_VALIDATION_PROFILES[validationProfile] ?? null;
  return profile !== null && frameworks.includes("nextjs") ? profile : null;
}

/**
 * The preview runtime policy version (§4).
 *
 * Versions, together, everything that decides what a running preview *is*:
 *
 *  - the runtime it starts in (a fresh clone of the prepared commit);
 *  - the single Vibe-controlled port;
 *  - the server command strategy (a development server — see ADR 0064);
 *  - the network policy at each phase (GitHub, then the registry, then
 *    `deny-all` before any repository code runs);
 *  - the TTL;
 *  - health-check behaviour, including a budget that covers a cold compile;
 *  - the secret policy (none, and proven absent before the sandbox exists);
 *  - cleanup semantics.
 *
 * It is part of the preview identity, so a policy change invalidates preview
 * reuse by construction rather than by anyone remembering to. That is the same
 * discipline `SANDBOX_POLICY_VERSION` applies to validation, and for the same
 * reason: a stored "this ran fine" must never be reinterpreted under rules it
 * was not checked against (CLAUDE.md rule 65).
 */
export const PREVIEW_POLICY_VERSION = "preview-policy-v2" as const;

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
  /** Cloning the prepared commit, and proving it is that commit. */
  "acquiring_source",
  /** Installing from the committed lockfile, with the registry reachable. */
  "installing",
  "starting_dev_server",
  "checking_preview",
  "completed",
  /*
   * v1 stages. No new session reaches one — a preview restores nothing — but
   * rows recorded them and a stored fact is not rewritten to match the present.
   */
  "restoring_artifact",
  "verifying_artifact",
  "starting_server",
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
  /** The change has no commit to serve. */
  "preview_change_not_prepared",
  /** This repository's framework has no preview profile. */
  "preview_not_supported",
  /**
   * The user did not explicitly confirm public exposure (§8).
   *
   * Load-bearing on the server, not a UI courtesy: without it, zero sandbox
   * creation, zero exposed port, zero provider spend.
   */
  "preview_exposure_not_confirmed",
  /**
   * The provider did not produce the prepared commit (Sprint 0114).
   *
   * Either the clone failed or what came back is not what Vibe prepared. Zero
   * repository-controlled code runs after this: a preview of the wrong bytes on
   * a public URL is worse than no preview.
   */
  "preview_source_unavailable",
  /**
   * The clone credential survived its removal (rule 63).
   *
   * The one failure here that is about Vibe's own boundary rather than about
   * the customer's code, and the reason nothing is allowed to run afterwards.
   */
  "preview_credential_scrub_failed",
  /** Dependencies could not be installed from the committed lockfile. */
  "preview_install_failed",
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
  /** Teardown did not verifiably complete. Never hides a result. */
  "preview_cleanup_failed",
  /** Anything else, reported honestly rather than guessed at. */
  "preview_failed",
] as const;
export type PreviewFailureCode = (typeof PREVIEW_FAILURE_CODES)[number];

/** Whether the sandbox was verifiably torn down. Recorded, never a verdict. */
/** The terminal status a teardown is heading for. */
export const TEARDOWN_REASONS = ["stopped", "expired"] as const;
export type TeardownReason = (typeof TEARDOWN_REASONS)[number];

export const PREVIEW_CLEANUP_STATUSES = [
  "stopped",
  "stop_failed",
  "not_provisioned",
  /**
   * A v1 session whose sandbox stopped but whose snapshot could not be deleted.
   *
   * Unreachable under `preview-policy-v2`, which captures no snapshot. Kept
   * because rows recorded it.
   */
  "artifact_delete_failed",
] as const;
export type PreviewCleanupStatus = (typeof PREVIEW_CLEANUP_STATUSES)[number];

/**
 * The artifact a v1 preview restored from.
 *
 * **Historical under `preview-policy-v2`.** Validation captures no snapshot any
 * more (ADR 0064), so no new artifact comes into existence and nothing restores
 * one. The type and its reader remain because rows recorded before the change
 * still carry the columns, and a stored fact is not rewritten to match the
 * present.
 *
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
  /**
   * The commit this session served. Server-resolved, never client-supplied.
   *
   * The whole answer to *what was previewed* under `preview-policy-v2`. It used
   * to be implied by a snapshot id, which meant reading it required a join to a
   * validation run that no longer has to exist.
   */
  preparedCommitSha: string;
  /**
   * The validation this session was started alongside, when one existed.
   *
   * Null under `preview-policy-v2` whenever a preview is started before
   * validation — which is the normal case and the point of the sprint. Recorded
   * when it is known, never required.
   */
  validationRunId: string | null;
  operationRunId: string;
  /** The snapshot a v1 session restored. Always null under v2. */
  artifactSnapshotId: string | null;

  previewProfile: PreviewProfile;
  previewProfileVersion: string;
  previewPolicyVersion: string;

  provider: PreviewProviderId;
  runtime: string | null;
  /** Vibe-controlled, from the preview policy. Never a client choice (§14). */
  port: number;

  status: PreviewStatus;
  stage: PreviewStage;
  failureCode: PreviewFailureCode | null;
  /**
   * Why teardown was requested, once it has been (Sprint 10B-3).
   *
   * Set by whoever initiates it and read by the durable workflow, because what
   * crosses a step boundary is an operation id and nothing else. Deriving it
   * later from `expires_at` would report a manual stop made seconds before the
   * deadline as an expiry, once queue latency is counted.
   */
  teardownReason: TeardownReason | null;
  cleanupStatus: PreviewCleanupStatus | null;

  previewIdentity: string;

  startedAt: string | null;
  readyAt: string | null;
  expiresAt: string;
  stoppedAt: string | null;
  /**
   * When this session's ValidatedArtifact snapshot was deleted.
   *
   * Always null under `preview-policy-v2`, which captures no snapshot. Kept
   * because sessions that ran under v1 did, and their rows still say when.
   */
  artifactDeletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export function previewProfileVersionFor(profile: PreviewProfile): string {
  return PREVIEW_PROFILE_VERSIONS[profile];
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
