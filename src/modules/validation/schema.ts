/**
 * The validation domain (Sprint 10A §16, §17, §18).
 *
 * Sprint 9 ended with a distinction it could state but not yet act on:
 *
 * ```
 * repository_write_verified  — the bytes on the branch are the bytes we meant
 * sandbox_validation_passed  — those bytes install, typecheck, test and build
 * human_approved             — someone looked at it
 * merged / deployed          — neither exists yet
 * ```
 *
 * This module implements the second line and nothing else. The first real
 * prepared change was byte-perfect and still listed `/login` in a sitemap; no
 * amount of build validation would have caught that either. Validation raises
 * the floor, it does not close the gap.
 *
 * ## Why any of this needs a sandbox
 *
 * Validation is the first thing Vibe does that runs **code it did not write**.
 * A repository's `package.json` scripts, its dependencies' lifecycle hooks and
 * its build tooling are all attacker-controlled from our point of view. ADR
 * 0006 fixed the principle before there was code to break it; ADR 0015 names
 * the provider.
 */

/**
 * Validation profiles (§5, generalized in Stufe 4).
 *
 * A profile is a promise about which commands run and in what environment, so
 * "supports everything" would mean "promises nothing". What changed is what the
 * promise is *keyed on*.
 *
 * `nextjs_node_v1` was keyed on a framework, and that turned out to decorate
 * rather than describe: `planValidationSteps` takes no profile, and the
 * commands it plans — a locked install, then the repository's own `typecheck`,
 * `test` and `build` scripts — never mentioned Next.js. Requiring `next` in the
 * dependency list narrowed who could be checked without sharpening what the
 * check claimed.
 *
 * `node_build_v1` is keyed on the contract those commands actually need: one
 * manifest declaring a `build` script, and a lockfile in its own directory that
 * Vibe can install from exactly. That promise is no weaker — it is the same
 * sentence, now true for every repository that can honour it rather than for
 * one framework's worth of them.
 *
 * A repository that cannot honour it is still refused, and now refused by name:
 * no manifest, no build script, no lockfile, or more than one application and
 * nobody has said which.
 */
export const VALIDATION_PROFILES = ["nextjs_node_v1", "node_build_v1"] as const;
export type ValidationProfile = (typeof VALIDATION_PROFILES)[number];

/**
 * The profile every new run resolves.
 *
 * `nextjs_node_v1` stays in the union because sixteen rows carry it and a
 * record is not rewritten to match the present (rule 83). Nothing resolves it
 * any more, and it is deliberately **not** aliased to `node_build_v1`: reading
 * a stored pass as though it had been checked under today's rules is exactly
 * what the version exists to prevent (rule 65). It is retired, not renamed.
 */
export const CURRENT_VALIDATION_PROFILE: ValidationProfile = "node_build_v1";

/** Bumped when the commands a profile runs change meaning (§22). */
export const VALIDATION_PROFILE_VERSIONS: Record<ValidationProfile, string> = {
  nextjs_node_v1: "nextjs-node-v1",
  node_build_v1: "node-build-v1",
};

/**
 * The sandbox execution and integrity policy version (§22).
 *
 * Network policy, command sequence, timeouts, install flags, secret handling
 * **and source-integrity rules** together define what "validated" means.
 * Changing any of them changes the claim, so the version is part of the
 * validation identity and a previously passing run is never silently reused
 * under rules it was not checked against.
 *
 * ## v3 → v4 (2026-08-13)
 *
 * A successful validation now captures its filesystem as a bounded, resumable
 * artifact so a preview can start from the exact validated bytes rather than
 * rebuilding them. That adds a **retention semantic** to what "validated"
 * means: for up to an hour, a customer's built filesystem exists in provider
 * storage. Failed validations never produce one, and the artifact is deleted
 * when the preview using it ends.
 *
 * Nothing about the commands or the network changed. The claim did — a stored
 * pass now implies something was kept — so the version did too.
 *
 * ## v1 → v2 (2026-08-13)
 *
 * The first passing dogfood ran under v1 and recorded `pnpm-lock.yaml` as
 * **unverified**: this repository's lockfile is ~310 KB against a 256 KB
 * per-file read budget. The lockfile is the one build-identity file that
 * decides *which code gets installed*, so "validated" under v1 meant something
 * materially weaker than it appeared.
 *
 * Two integrity rules changed in response:
 *
 *  - build-identity files get a dedicated 4 MB budget, so lockfiles are
 *    actually compared rather than silently skipped;
 *  - reads request one byte past the budget, so an oversized file is recorded
 *    as *unverified* instead of being hashed as a truncated prefix — which
 *    would have reported a content **mismatch** for a file that is merely
 *    large, a false integrity failure indistinguishable from a real one.
 *
 * The command profile is untouched, so `nextjs_node_v1` stays as it is. This is
 * a security/integrity policy change, which is exactly what this version is
 * for. Run `61b8c9f1` remains historically v1 and is not rewritten; its
 * identity no longer matches, so it cannot be reused as though it had been
 * produced under v2.
 *
 * ## v2 → v3 (2026-08-13) — durable phases
 *
 * The commands did not change. What "validated" *means* did.
 *
 * Under v2 the whole pipeline ran inside one durable step, against one platform
 * function ceiling. A repository whose real work exceeded that ceiling could
 * only ever record `sandbox_timeout` — the verdict described our orchestration,
 * not the artifact. Under v3 each phase is its own durable step with its own
 * ceiling, so **a run that was terminally timed-out under v2 can legitimately
 * pass under v3**.
 *
 * That is the exact condition for a version bump: a stored `failed` and a fresh
 * `passed` would otherwise disagree about the same artifact with no recorded
 * reason. The bump also means no v2 result is reused to answer a v3 question,
 * which matters in the other direction too — v3 tolerates a longer sandbox
 * lifetime, so its passes were checked under a measurably different resource
 * policy.
 *
 * Timeouts are policy, not tuning. A budget decides which artifacts can pass at
 * all, which is why it lives behind a version rather than in a constant someone
 * can raise quietly.
 */
export const SANDBOX_POLICY_VERSION = "sandbox-policy-v5" as const;

export const SANDBOX_PROVIDERS = ["vercel_sandbox"] as const;
export type SandboxProviderId = (typeof SANDBOX_PROVIDERS)[number];

export const PACKAGE_MANAGERS = ["pnpm", "npm"] as const;
export type SupportedPackageManager = (typeof PACKAGE_MANAGERS)[number];

/**
 * Reads a stored package-manager string, or refuses.
 *
 * Exists because the alternative shape is a coercion, and a coercion here is a
 * wrong install command rather than an error: `x === "npm" ? "npm" : "pnpm"`
 * reads a yarn repository as pnpm and installs *something*, which is worse than
 * failing because it produces a dependency tree nobody committed and a verdict
 * about it. Refusing is the only honest answer for a value outside the set.
 */
export function supportedPackageManager(value: string): SupportedPackageManager | null {
  return (PACKAGE_MANAGERS as readonly string[]).includes(value)
    ? (value as SupportedPackageManager)
    : null;
}

export const VALIDATION_STATUSES = ["queued", "running", "passed", "failed", "cancelled"] as const;
export type ValidationStatus = (typeof VALIDATION_STATUSES)[number];

/** Where a run has got to. No percentages — see `operations/schema.ts`. */
export const VALIDATION_STAGES = [
  "provisioning",
  "acquiring_source",
  "verifying_source",
  "securing_sandbox",
  "installing",
  "typechecking",
  "testing",
  "building",
  "collecting_results",
  "cleaning_up",
  "completed",
] as const;
export type ValidationStage = (typeof VALIDATION_STAGES)[number];

/**
 * Why a validation could not run, or refused to (§5, §29).
 *
 * Separate from "the build failed". A failing build is a *successful*
 * validation of a broken change; these are the cases where Vibe learned
 * nothing about the change at all.
 */
export const VALIDATION_BLOCK_REASONS = [
  /**
   * No profile matches this repository. Never a guessed command sequence.
   *
   * Once the whole refusal; now the residue. A repository that fails the build
   * contract is refused for a *named* reason below, because "not supported yet"
   * tells a founder nothing they can act on. This still reaches them from one
   * place the contract cannot see in advance: `orchestrator.readPlan`, when the
   * manifest in the sandbox turns out not to be the one the snapshot described.
   */
  "validation_not_supported",
  /** The prepared change is not in a state that can be validated. */
  "prepared_change_not_ready",
  /**
   * The workspace root could not be resolved unambiguously (§5).
   *
   * Historical. Rows recorded it when a detected monorepo was refused outright;
   * the question "which app?" is now asked rather than refused, so nothing
   * resolves this any more.
   */
  "ambiguous_workspace",
  /** No lockfile, so a locked install is impossible. */
  "lockfile_missing",
  /** No `package.json` anywhere, so there is no Node application to build. */
  "not_a_node_project",
  /** A manifest, but no `build` script — nothing for a change to be checked against. */
  "no_build_script",
  /** More than one independently installable application. The founder names it. */
  "workspace_choice_required",
  /** The stored analysis predates the facts this check reads. The founder refreshes it. */
  "repository_analysis_outdated",
  "repository_connection_invalid",
] as const;
export type ValidationBlockReason = (typeof VALIDATION_BLOCK_REASONS)[number];

/**
 * Ways a run ends without a trustworthy verdict.
 *
 * `source_integrity_failed` is the important one: the sandbox did not contain
 * what Vibe prepared, so **zero repository-controlled commands run** (§29).
 */
export const VALIDATION_FAILURE_REASONS = [
  "source_integrity_failed",
  "sandbox_unavailable",
  "sandbox_timeout",
  /**
   * The sandbox stopped existing between two phases.
   *
   * Its filesystem went with it — `node_modules` above all — so continuing on a
   * replacement VM would typecheck a different tree than the one that installed.
   * Vibe refuses instead: a partial-state continuation is a result nobody can
   * interpret, and a wrong "passed" is worse than an honest failure (§12).
   */
  "sandbox_lost",
  /** Credential scrubbing did not verifiably succeed — refuse rather than run. */
  "credential_scrub_failed",
  /** A required check failed. The ordinary outcome of validating a broken change. */
  "validation_checks_failed",
  /** Deterministically identifiable missing configuration (§9). */
  "build_failed_missing_environment",
  "validation_run_failed",
] as const;
export type ValidationFailureReason = (typeof VALIDATION_FAILURE_REASONS)[number];

export type ValidationFailureCode = ValidationBlockReason | ValidationFailureReason;

/** One executed (or deliberately skipped) validation step (§19). */
export const STEP_STATUSES = ["passed", "failed", "skipped", "timed_out"] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

/**
 * Why a step did not run. Three genuinely different statements:
 *
 * - `script_not_present` — the repository defines no such script.
 * - `not_in_profile` — the resolved profile does not include this step.
 * - `outside_depth` — the profile includes it; this change did not need it
 *   (Sprint 0047).
 *
 * The third was added rather than reusing the second, because a reader is
 * entitled to know the difference between "your project cannot be checked this
 * way" and "your change did not require it". The first dogfood of depth
 * rendered a skipped step as "no script for this in the project", which was
 * simply false.
 */
export const STEP_SKIP_REASONS = ["script_not_present", "not_in_profile", "outside_depth"] as const;
export type StepSkipReason = (typeof STEP_SKIP_REASONS)[number];

export type ValidationStepResult = {
  /** The command Vibe constructed. Never a repository-supplied string (§13). */
  command: string;
  status: StepStatus;
  exitCode: number | null;
  durationMs: number;
  /**
   * Sanitized, bounded tail of combined output (§15).
   *
   * A tail rather than a head: the reason a build failed is at the end.
   */
  outputTail: string;
  outputTruncated: boolean;
  skipReason: StepSkipReason | null;
};

export const VALIDATION_STEPS = ["install", "typecheck", "test", "build"] as const;
export type ValidationStepName = (typeof VALIDATION_STEPS)[number];

/**
 * How the validated source's identity was established.
 *
 * Named for what is actually proven, because the honest answer turned out
 * narrower than the sprint brief assumed. Vercel materializes a git source as a
 * **filesystem**, not a git checkout — there is no `.git` in the sandbox, which
 * five real runs established rather than assumed. Vibe therefore cannot
 * re-observe the commit with `git rev-parse`.
 *
 * Reinstating that check would mean cloning inside the sandbox ourselves, which
 * carries a GitHub installation token into a VM that later runs untrusted code.
 * That is a real secret lifecycle bought to obtain a weaker proof, and it was
 * rejected deliberately: **do not introduce a stronger secret to obtain a
 * weaker proof.**
 *
 * ## Corrected 2026-08-13
 *
 * The paragraph above was written on a wrong inference. `git rev-parse` failed
 * because Vercel clones into `/vercel/sandbox/<repo>/` and the command ran in
 * the home directory — not because the checkout lacks git metadata. Four runs
 * were spent before a directory listing settled it.
 *
 * The provider-side clone does leave a real checkout, so observing the commit
 * costs nothing: no credential enters the VM, because Vercel performed the
 * clone. The Option A machinery stays and the observation is layered on top:
 *
 * ```
 * source_revision_pinned              ✅ immutable SHA passed to the provider
 * prepared_change_files_verified      ✅ hashed in the sandbox, before any repo code
 * build_identity_files_verified       ✅ hashed against GitHub at that same SHA
 * git_commit_observed                 ✅ where the provider leaves a checkout
 * ```
 *
 * A commit SHA is immutable, so "the branch moved" cannot happen to a pinned
 * revision — which is why the observation is *recorded* rather than *required*.
 * A mismatch is a definitive integrity failure and stops the run; an
 * unavailable git is not, because pinning plus hashing still carries the
 * guarantee on a provider that materializes a bare filesystem.
 *
 * What has not changed is the rejection of a self-managed clone: carrying an
 * installation token into a VM that later runs untrusted code would still be
 * introducing a stronger secret to obtain a weaker proof.
 */
export const REVISION_MODES = [
  /** An immutable commit SHA was passed to the provider as the source revision. */
  "provider_pinned",
] as const;
export type RevisionMode = (typeof REVISION_MODES)[number];

export type SourceIntegrity = {
  requestedRevision: string;
  revisionMode: RevisionMode;
  /**
   * Whether the checked-out commit was read back from git inside the sandbox.
   *
   * False is a statement about the provider, not a failure: pinning and hashing
   * carry the guarantee either way.
   */
  gitCommitObserved: boolean;
  /** The prepared change's own files, hashed against their stored digests. */
  changedFilesVerified: boolean;
  /** Build-identity files whose sandbox bytes matched GitHub at the pinned SHA. */
  buildIdentityFilesVerified: string[];
  /**
   * Files that could not be compared — absent on one side, or past the read
   * budget. Recorded rather than silently counted as verified.
   */
  buildIdentityFilesUnverified: string[];
  /**
   * sha256 of each verified build-identity file, by repository-relative path.
   *
   * ## Why a hash and not just the path
   *
   * Preview restores a snapshot of this filesystem and has to prove the bytes
   * that came back are the bytes that were validated (Sprint 10B §11). It
   * cannot re-fetch them from GitHub: preview acquires no source and holds no
   * credential, by design. So the digest has to travel with the run.
   *
   * These hashes are already computed during verification — this records what
   * was measured instead of throwing it away, so it costs no read and no time.
   *
   * ## Why this does not bump the sandbox policy version
   *
   * The policy version answers "what did *validated* mean when this ran": the
   * commands, the network, the timeouts, the install flags, the secrets. This
   * changes none of them and can fail nothing that previously passed. A run
   * recorded before this field existed is still exactly as validated as it was;
   * it simply carries less forward, and preview treats an absent digest as
   * *unverifiable* rather than as agreement.
   *
   * Optional for that reason: historical rows do not have it and are not
   * rewritten.
   */
  buildIdentityDigests?: Record<string, string>;
};

/**
 * What a passing run is allowed to claim (§18, §45).
 *
 * Named for what was actually observed. `sandbox_validation_passed` means a
 * profile's commands exited zero inside an isolated VM — not that the change
 * is safe, correct, secure, or production ready. The vocabulary is the product
 * guarantee, so it lives in the type system rather than in copy.
 */
export type ValidationVerdict = "sandbox_validation_passed";

export type ValidationRun = {
  id: string;
  projectId: string;
  preparedChangeId: string;
  operationRunId: string;
  validationProfile: ValidationProfile;
  validationProfileVersion: string;
  sandboxPolicyVersion: string;
  sandboxProvider: SandboxProviderId;
  sandboxRuntime: string;
  packageManager: SupportedPackageManager;
  preparedCommitSha: string;
  status: ValidationStatus;
  stage: ValidationStage;
  steps: Partial<Record<ValidationStepName, ValidationStepResult>>;
  failureCode: ValidationFailureCode | null;
  sourceIntegrity: SourceIntegrity | null;
  sandboxDurationMs: number | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
};

export function validationProfileVersionFor(profile: ValidationProfile): string {
  return VALIDATION_PROFILE_VERSIONS[profile];
}
