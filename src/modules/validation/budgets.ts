/**
 * Resource budgets for one validation run (Sprint 10A §14, §8 refactor).
 *
 * Untrusted code decides how long it wants to run and how much it wants to
 * print. Neither of those may be its decision, so every number here is a hard
 * ceiling enforced by us, not a hint to the repository.
 *
 * ## The mistake these numbers are calibrated against
 *
 * Two independent limits govern a validation, and for two sprints they were
 * conflated:
 *
 * ```
 * the sandbox's own lifetime      45 minutes (provider maximum)
 * the durable step's lifetime     the platform function ceiling
 * ```
 *
 * The smaller one binds. The v2 budgets were sized against the sandbox and the
 * step awaiting them died first, at exactly `Task timed out after 300 seconds`,
 * with a paid VM still running and nothing responsible for it.
 *
 * The v3 answer is not a larger number. It is that **each phase is its own
 * durable step**, so the pipeline is no longer one workload racing one ceiling:
 * install, typecheck, test and build each get a fresh function invocation and a
 * fresh ceiling. On Vercel the Workflow SDK deploys step execution as its own
 * queue-consumer function (`maxDuration: max`), while the orchestrating workflow
 * function is short-lived and suspended between steps — verified against the
 * SDK's own shipped documentation for the installed version, not recalled.
 *
 * So per-command budgets no longer need to add up to anything. Each only has to
 * fit inside one step.
 */

/**
 * The platform ceiling on a single durable step.
 *
 * Not configurable by us and deliberately not raised: it is recorded here so
 * every per-command budget below can be read against the limit it must fit
 * inside. One phase, one step, one ceiling.
 */
export const STEP_DEADLINE_MS = 300 * 1000;

/**
 * Headroom reserved inside a step for work that is not the command.
 *
 * A phase step reconnects to the sandbox, runs one command, and persists the
 * result. The command must finish early enough that the persistence still
 * happens — a phase that completes and fails to record itself is indistinguish-
 * able from one that never ran, and would be re-run on re-entry.
 */
export const STEP_OVERHEAD_MS = 60 * 1000;

export const SANDBOX_BUDGETS = {
  /**
   * Whole-sandbox lifetime, spanning every phase.
   *
   * Sized to outlive the pipeline rather than to sit under one step: the
   * measured baseline is ~290 s of real work, and the sandbox must survive
   * provisioning, six phase steps, the queue latency between them, and cleanup.
   *
   * It is also the **leak bound**. If the workflow dies outright and its
   * cleanup step never runs, this timeout is the only thing left stopping a
   * paid VM. v2 set it to 260 s precisely because a killed step ran no cleanup;
   * v3 raises it to 15 minutes and buys that back structurally instead — the
   * cleanup step is a separate durable step that runs on the failure path too,
   * including the path where a phase step was killed mid-command. The bound is
   * looser, the expected leak is smaller.
   *
   * Not unbounded, and deliberately far below the provider's 45-minute maximum:
   * a run that needs longer than this is telling us something about the
   * repository, and the honest answer in V0.1 is to stop and say so.
   */
  totalLifetimeMs: 15 * 60 * 1000,

  /** Dependency install — the one step with network. */
  installTimeoutMs: STEP_DEADLINE_MS - STEP_OVERHEAD_MS,
  /** Any single repository-controlled check: typecheck, test or build. */
  commandTimeoutMs: STEP_DEADLINE_MS - STEP_OVERHEAD_MS,
  /**
   * Source acquisition and integrity verification.
   *
   * Runs entirely inside the verify step, several commands deep, so it is sized
   * per-command rather than per-phase.
   */
  sourceTimeoutMs: 90 * 1000,

  /** Bytes of combined stdout+stderr read back from any one command (§15). */
  maxCapturedOutputBytes: 64 * 1024,
  /** Characters of sanitized output persisted per step. */
  maxStoredOutputChars: 4 * 1024,
  maxStoredOutputLines: 60,
  /** A single line longer than this is truncated rather than stored. */
  maxLineChars: 500,

  /**
   * How long a validated artifact may be retained (Sprint 10B §5).
   *
   * Twenty-four hours, explicit: the shortest expiry Vercel accepts. The
   * provider's default is 30 days, which is not a retention policy anyone chose
   * — it is what happens when nobody decides. A customer's built filesystem is
   * still deleted sooner when the preview ends; this TTL is only the backstop
   * when explicit deletion cannot be confirmed or no preview is ever started.
   */
  validatedArtifactTtlMs: 24 * 60 * 60 * 1000,

  /** Files read back out of the sandbox for integrity checking (§29). */
  maxIntegrityFiles: 20,
  maxIntegrityFileBytes: 256 * 1024,
  /**
   * Build-identity files get their own, larger budget.
   *
   * Lockfiles are the reason. This repository's is ~310 KB, so the first
   * passing dogfood verified `package.json`, `next.config.ts` and
   * `tsconfig.json` but recorded `pnpm-lock.yaml` as *unverified* — the single
   * most security-relevant file of the four, since it decides which code gets
   * installed. A budget that silently excludes the important case is worse than
   * a larger number.
   */
  maxBuildIdentityFileBytes: 4 * 1024 * 1024,
} as const;

/**
 * Sandbox shape.
 */
export const SANDBOX_RESOURCES = {
  /**
   * Four vCPUs.
   *
   * Introduced under v2 as a *correctness* requirement: 281 s of measured
   * commands against a single 300 s ceiling was not a margin, and more vCPUs
   * finish sooner for roughly the same bill.
   *
   * That argument no longer holds. Under v3 each phase has its own ceiling and
   * the longest single command measured 99 s, so nothing is racing anything.
   * The value is kept unchanged anyway, because dropping to two would change
   * every measured timing in this sprint's record and re-tuning resources is
   * not what this refactor is for. Revisiting it is real, deliberate work —
   * with a re-measurement — not a number to quietly lower here.
   */
  vcpus: 4,
  /**
   * The documented default Vercel Managed Image.
   *
   * Chosen over a minimal `node:*` image because validation runs `git` inside
   * the VM to verify the checked-out commit, and `universal` is the image
   * documented to carry Node plus common utilities. The first real dogfood
   * failed at `git rev-parse HEAD` on a node image — the clone itself is done
   * by the platform, outside the VM, so a missing `git` only surfaces at
   * verification.
   */
  image: "vercel/sandbox/universal",
} as const;

export type SandboxBudgets = typeof SANDBOX_BUDGETS;
