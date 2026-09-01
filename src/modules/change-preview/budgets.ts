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
 *
 * **Sprint 0114 changed what a preview *is*** — a development server on a fresh
 * clone rather than a production server on a restored snapshot — so the numbers
 * that describe restoring and verifying an artifact are gone, and the ones that
 * describe acquiring and installing a source have taken their place. Everything
 * here is `preview-policy-v2`.
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
   * How long the server has to answer its first request (§17, Sprint 0114).
   *
   * This used to be boot time: a restored artifact was already built, so the
   * server only had to start. A development server has no build behind it, so
   * the first request is what *compiles* the route it asks for — the probe is
   * the warm-up as well as the check.
   *
   * Raised to three minutes on that basis. Deliberately not "generous enough
   * for anything": a preview that will never answer must still fail while the
   * user is watching, and 180s is roughly twice the slowest measured cold
   * production build in this repository's own validation runs (99s) — the
   * closest available reference for how long a Next.js compile takes on this
   * microVM shape.
   *
   * The number is part of `preview-policy-v2`. If a real run shows a cold
   * compile that does not fit, the honest fix is to raise this deliberately and
   * bump the version, never to retry a preview that timed out.
   */
  healthCheckBudgetMs: 180 * 1000,
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
   * Per-command deadline for source acquisition and the credential scrub.
   *
   * The same number validation uses for the same commands (`sourceTimeoutMs`),
   * because they are the same commands doing the same work — a different budget
   * on each side would mean two answers to how long a `git rev-parse` may take.
   */
  sourceTimeoutMs: 90 * 1000,
  /**
   * Dependency installation.
   *
   * Validation allows 240s (`installTimeoutMs`), and this matches it: a preview
   * installs the same tree from the same lockfile. It is also the reason the
   * install lives in its own durable step — 240s of install plus 180s of health
   * check would not fit under one 300s step deadline.
   */
  installTimeoutMs: 240 * 1000,
} as const;

/**
 * Sandbox shape for a preview.
 *
 * No `image`: the port supplies validation's own base image for every git
 * source, so a preview and the validation of the same commit run on the same
 * machine shape without either side naming it.
 */
export const PREVIEW_RESOURCES = {
  /**
   * Two vCPUs.
   *
   * Fewer than validation's four, and still for a reason rather than by
   * omission — though the reason narrowed in Sprint 0114. A preview now
   * installs and compiles, so it is no longer pure idle time; but it compiles
   * *one route on demand* rather than building an application against a step
   * deadline, and it then sits mostly idle for fifteen minutes while
   * provisioned memory bills by the minute regardless of load.
   *
   * If a real run shows the install or the first compile dominating, four vCPUs
   * for a shorter wall time may well be cheaper. That is a measurement nobody
   * has yet, so this stays where it is and says so.
   */
  vcpus: 2,
} as const;

export type PreviewBudgets = typeof PREVIEW_BUDGETS;
