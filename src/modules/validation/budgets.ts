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
export const SANDBOX_BUDGETS = {
  /** Whole-sandbox lifetime, including provisioning and cleanup. */
  totalLifetimeMs: 10 * 60 * 1000,
  /** Dependency install — the slowest step, and the one with network. */
  installTimeoutMs: 5 * 60 * 1000,
  /** Any single validation command. */
  commandTimeoutMs: 4 * 60 * 1000,
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
  vcpus: 2,
  /** A Vercel Managed Image; pinned so "validated" means a known toolchain. */
  image: "vercel/sandbox/node:24",
} as const;

export type SandboxBudgets = typeof SANDBOX_BUDGETS;
