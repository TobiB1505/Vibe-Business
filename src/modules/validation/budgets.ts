/**
 * Resource budgets for one validation run (Sprint 10A §14).
 *
 * Untrusted code decides how long it wants to run and how much it wants to
 * print. Neither of those may be its decision, so every number here is a hard
 * ceiling enforced by us, not a hint to the repository.
 *
 * Values are calibrated against the current Vercel Sandbox limits (checked at
 * implementation time, not recalled): 45 minutes maximum duration on Hobby,
 * 5-minute default session timeout, 2 vCPU / 4 GB by default, `iad1` only.
 * They sit well inside those so a budget breach is *our* refusal rather than a
 * platform error we have to interpret.
 *
 * Deliberately conservative. A run that needs longer than this is telling us
 * something about the repository, and the honest answer in V0.1 is to time out
 * and say so.
 */
/**
 * The hard ceiling on the durable step that awaits a validation.
 *
 * A Vercel Function is killed at 300 s. This is **not** the sandbox's limit —
 * a sandbox may live 45 minutes — and conflating the two is what the sixth
 * dogfood cost: budgets were calibrated against the sandbox and the function
 * awaiting them died first, at exactly `Task timed out after 300 seconds`.
 *
 * Everything below is derived from this number rather than chosen next to it.
 */
export const STEP_DEADLINE_MS = 300 * 1000;

export const SANDBOX_BUDGETS = {
  /**
   * Whole-sandbox lifetime.
   *
   * Deliberately **below** `STEP_DEADLINE_MS`, so the sandbox expires before
   * the function that owns it. That ordering is the leak bound: if the step is
   * killed anyway, its cleanup never runs, and the only thing left stopping a
   * paid VM is the sandbox's own timeout. It must therefore be short enough to
   * matter.
   */
  totalLifetimeMs: 260 * 1000,
  /**
   * When to stop starting new work.
   *
   * Reaching this ends the run *ourselves*, with cleanup, rather than being
   * killed mid-command with a sandbox still running.
   */
  stopStartingWorkAfterMs: 240 * 1000,
  /** Dependency install — the one step with network. */
  installTimeoutMs: 120 * 1000,
  /** Any single validation command. */
  commandTimeoutMs: 180 * 1000,
  /** Source acquisition and integrity verification, before any repository code. */
  sourceTimeoutMs: 90 * 1000,

  /** Bytes of combined stdout+stderr read back from any one command (§15). */
  maxCapturedOutputBytes: 64 * 1024,
  /** Characters of sanitized output persisted per step. */
  maxStoredOutputChars: 4 * 1024,
  maxStoredOutputLines: 60,
  /** A single line longer than this is truncated rather than stored. */
  maxLineChars: 500,

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
 *
 * Two vCPUs is the platform default and enough for a Next.js build. Larger
 * would be faster and directly more expensive — `vcpus` multiplies both Active
 * CPU and Provisioned Memory billing, so this stays small until a real run
 * shows it needs to grow.
 */
export const SANDBOX_RESOURCES = {
  /**
   * Four vCPUs, not the platform default of two.
   *
   * Not a performance preference — a correctness requirement. On two vCPUs the
   * real workload measured 281 s of commands (install 18 s, typecheck 79 s,
   * test 84 s, build 99 s) against a 300 s step ceiling, which is not a margin.
   * More vCPUs cost more per second and finish sooner, so the bill is roughly
   * unchanged while the run stops racing the platform.
   *
   * Four is also the Hobby maximum, so this is the whole of the available
   * headroom. If the work still does not fit, the answer is to split it across
   * steps or move to a plan with a longer function limit — a decision, not a
   * larger number.
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
