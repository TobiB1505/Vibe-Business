import type { SandboxCommand } from "./commands";

/**
 * The sandbox boundary (Sprint 10A §3, §4).
 *
 * ## What this interface is for
 *
 * Not portability theatre. Two concrete jobs:
 *
 *  1. **The domain never learns a provider's vocabulary.** `@vercel/sandbox`
 *     types appear in exactly one directory (`vercel/`), so the orchestrator —
 *     where every security decision lives — is testable without a network, an
 *     account, or a bill.
 *  2. **There is no second implementation, and cannot be a local one.** A
 *     `SandboxProvider` that shelled out to the host would satisfy this
 *     interface perfectly and be a critical vulnerability. See below.
 *
 * ## The rule that outranks convenience
 *
 * **Untrusted customer repository code executes only inside an approved
 * isolated sandbox provider. There is no local path, ever.**
 *
 * The tempting shortcut is a dev-only branch — `if (!process.env.VERCEL) exec(...)`
 * — so a developer can iterate without provisioning a VM. That branch would be
 * a remote code execution vulnerability wearing a developer-experience
 * costume: any repository a user connects could run arbitrary commands on
 * whatever machine took the shortcut.
 *
 * Tests use fakes that never execute anything. Production uses Vercel Sandbox.
 * If the sandbox is unavailable, validation **fails**; it does not degrade to
 * running the code somewhere less isolated (ADR 0015).
 *
 * ## Network policy is part of the interface
 *
 * Deliberately, rather than being a provider detail. The two-phase transition
 * — dependencies fetched under a narrow allowlist, then everything shut off
 * before repository code runs — is a security property of the *domain*. Making
 * it explicit here means the orchestrator's tests can assert the order in
 * which policies were applied without a real firewall (§32).
 */

/**
 * Egress policy for a sandbox.
 *
 * `deny-all` blocks DNS as well as traffic, which is what makes it meaningful
 * against exfiltration: an allowlist that still resolves arbitrary names
 * leaves a covert channel over DNS itself.
 */
export type SandboxNetworkPolicy =
  | { mode: "deny_all" }
  /** Domain allowlist. Enforced by SNI, and it also constrains DNS resolution. */
  | { mode: "allow_domains"; domains: readonly string[] };

export type SandboxCommandResult = {
  exitCode: number;
  durationMs: number;
  /** Combined stdout+stderr, raw. Sanitized by the caller before storage (§15). */
  output: string;
  timedOut: boolean;
};

/** Where the source comes from. Credentials are used once and never persisted (§7). */
export type SandboxSource = {
  repositoryUrl: string;
  /** The exact commit to check out. Never a branch name (§6). */
  revision: string;
  credential: { username: string; password: string } | null;
};

export type CreateSandboxInput = {
  name: string;
  source: SandboxSource;
  /** Applied at creation, so a sandbox never exists under a weaker policy. */
  networkPolicy: SandboxNetworkPolicy;
  timeoutMs: number;
  /**
   * Environment for every command.
   *
   * Must contain no privilege. Enforced by the orchestrator and asserted by
   * tests, because the interface cannot prevent a caller passing a secret (§8).
   */
  env: Record<string, string>;
};

/** Usage the provider reports once the sandbox has stopped (§25). */
export type SandboxUsage = {
  activeCpuDurationMs: number | null;
  networkIngressBytes: number | null;
  networkEgressBytes: number | null;
  /** Null unless the provider exposes attributable cost. Never estimated (§25). */
  costUsd: number | null;
};

export interface SandboxHandle {
  readonly id: string;
  readonly runtime: string;

  /** Runs one Vibe-constructed command. Never a repository-supplied string. */
  run(input: {
    command: SandboxCommand;
    cwd: string;
    timeoutMs: number;
  }): Promise<SandboxCommandResult>;

  /** Reads a bounded file back out, for integrity checks. Null when absent. */
  readFile(input: { path: string; maxBytes: number }): Promise<string | null>;

  /**
   * Replaces the egress policy on the running sandbox.
   *
   * The security-critical operation of the sprint: it is what closes the
   * network between dependency acquisition and repository execution.
   */
  applyNetworkPolicy(policy: SandboxNetworkPolicy): Promise<void>;

  /** Terminates the sandbox and reports usage. Safe to call more than once. */
  stop(): Promise<SandboxUsage>;
}

export interface SandboxProvider {
  readonly id: "vercel_sandbox";
  create(input: CreateSandboxInput): Promise<SandboxHandle>;
}

/**
 * Hosts reachable while dependencies are fetched (§10 Phase A).
 *
 * The narrowest set that lets a locked install succeed. Notably absent:
 * everything else. A repository whose build needs an unlisted host fails
 * validation, and that is the designed outcome — the global policy does not
 * get widened to make one project pass (§42).
 */
export const DEPENDENCY_HOSTS: readonly string[] = [
  "registry.npmjs.org",
  "*.npmjs.org",
  "*.npmjs.com",
];

/** Hosts reachable while the source is cloned. GitHub only. */
export const SOURCE_HOSTS: readonly string[] = ["github.com", "*.github.com", "codeload.github.com"];
