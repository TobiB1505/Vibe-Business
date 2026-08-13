/**
 * Resource and lifetime budgets for one preview session (Sprint 10B-2 §14, §18).
 *
 * Every number here is part of `preview-policy-v1`. Changing one changes what a
 * preview *is*, which is why they live behind a version rather than in a
 * constant someone can quietly retune.
 *
 * Checked against the current Vercel Sandbox limits at implementation time
 * rather than recalled: the default sandbox timeout is 5 minutes, the maximum
 * is 45 minutes on Hobby and 24 hours on Pro/Enterprise, and a sandbox may
 * expose up to 15 ports. A 15-minute preview sits inside every plan's ceiling.
 */

export const PREVIEW_BUDGETS = {
  /**
   * How long a preview may stay reachable (§18).
   *
   * Fifteen minutes, chosen rather than inherited. Two independent things
   * enforce it and both are needed:
   *
   *  - the **sandbox timeout** is set to this value at creation, so the VM
   *    stops even if nothing in Vibe ever runs again. This is what makes "the
   *    preview runtime must not live indefinitely" true rather than intended.
   *  - the **persisted `expires_at`** is what authorized reads check, so Vibe
   *    stops handing out a preview domain at the deadline whether or not the
   *    provider has got round to stopping the VM.
   *
   * Deliberately not longer. A preview serves untrusted application code on a
   * public URL; the honest way to extend one is to start another, deliberately,
   * and pay for it visibly.
   */
  ttlMs: 15 * 60 * 1000,

  /**
   * The port the preview server binds and the sandbox exposes.
   *
   * Vibe's, not the repository's and not the client's. Next.js defaults to
   * 3000, so choosing it means the fewest surprises for a customer looking at
   * their own application — but it is passed explicitly on the command line
   * anyway, because "it defaults to the value we want" is not a control.
   *
   * Exactly one port is exposed. No inspector, no debug port, no second server.
   */
  port: 3000,

  /** Bytes of combined output read back from any one command. */
  maxCapturedOutputBytes: 64 * 1024,

  /**
   * How long the server has to answer its first request (§17).
   *
   * A restored artifact has already been built, so this is boot time, not build
   * time. Generous enough for a cold Next.js production server on a fresh
   * microVM; short enough that a server which will never answer fails while the
   * user is still watching.
   */
  healthCheckBudgetMs: 90 * 1000,
  /**
   * Gap between health probes.
   *
   * Doubles as the window in which the server process is watched for an early
   * exit, so a crash-on-boot is reported as `preview_process_exited` within a
   * couple of seconds rather than after the full health budget.
   */
  healthPollIntervalMs: 2 * 1000,
  /** Per-probe deadline. A probe that hangs is a failed probe, not a hung step. */
  healthProbeTimeoutMs: 10 * 1000,

  /**
   * Integrity re-verification of the restored filesystem (§11).
   *
   * The same shape and the same limits as validation's source verification, and
   * deliberately the same numbers: this is the *second* half of one claim — the
   * artifact that was validated is the artifact that was restored — so a
   * different budget on each side would mean the two halves checked different
   * things.
   */
  integrityTimeoutMs: 60 * 1000,
  maxIntegrityFiles: 20,
  maxIntegrityFileBytes: 256 * 1024,
  maxBuildIdentityFileBytes: 4 * 1024 * 1024,
} as const;

/**
 * Sandbox shape for a preview.
 *
 * No `image`: a sandbox created from a snapshot carries the image the snapshot
 * was taken from, and the SDK's types refuse the combination. Re-imaging a
 * restored artifact would mean it is not the artifact.
 */
export const PREVIEW_RESOURCES = {
  /**
   * Two vCPUs.
   *
   * Fewer than validation's four, and for a reason rather than by omission.
   * Validation runs a build against a step deadline, where finishing sooner for
   * roughly the same bill is a correctness argument. A preview serves a handful
   * of requests from an already-built application for fifteen minutes, where
   * provisioned memory is billed by the minute regardless of load — so the
   * smaller shape is the cheaper one for the same user-visible result.
   */
  vcpus: 2,
} as const;

export type PreviewBudgets = typeof PREVIEW_BUDGETS;
