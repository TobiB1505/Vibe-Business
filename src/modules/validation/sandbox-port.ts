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

/**
 * A command that outlives the call that started it (Sprint 10B §15).
 *
 * Preview needs one: a server that returns when it is ready would not be a
 * server. The provider's own detached primitive is used rather than `nohup`,
 * `tmux` or a backgrounding shell string — those would put process management
 * into a shell line, which is exactly where an injection point would live, and
 * they would leave the domain unable to answer the one question a health check
 * asks.
 *
 * That question is deliberately the whole interface:
 *
 * > has this process exited, and with what?
 *
 * Not "is it healthy" — a running process proves nothing about whether the
 * application answers — and not a stream of logs, which would pull unbounded
 * untrusted output into Vibe's memory for no decision.
 */
export type SandboxProcess = {
  /** Provider process id. Diagnostic only; never a credential, never exposed. */
  readonly id: string;
  /**
   * The exit code, or `null` if the process was still running after `withinMs`.
   *
   * Doubles as the health loop's delay, so a server that crashes on boot is
   * classified within one poll interval instead of after the whole budget.
   */
  exitedWithin(withinMs: number): Promise<number | null>;
  /** Bounded tail of what the process printed. For diagnosis, never for storage raw. */
  output(): Promise<string>;
};

/**
 * Where a sandbox's filesystem comes from.
 *
 * Three shapes, and the differences are trust boundaries. `git` acquires source
 * from GitHub with a credential; `snapshot` restores a filesystem Vibe already
 * validated, needing no credential at all — which is why preview never touches
 * GitHub (Sprint 10B §30). `image` brings **no source at all**: the VM holds
 * the base image and whatever Vibe puts there afterwards, and no customer byte
 * ever enters it.
 *
 * That third shape is what lets a sandbox exist for a reason other than running
 * a customer's repository. The rules that govern the other two — clone the
 * pinned commit, destroy the credential, deny the network before repository
 * code runs — describe a hazard `image` does not have, because there is no
 * repository code in it to run.
 */
export type SandboxSource =
  | {
      kind: "git";
      repositoryUrl: string;
      /** The exact commit to check out. Never a branch name (§6). */
      revision: string;
      credential: { username: string; password: string } | null;
    }
  | {
      kind: "snapshot";
      /** A provider snapshot id Vibe created and stored. Never client-supplied. */
      snapshotId: string;
    }
  | {
      /**
       * The base image and nothing else.
       *
       * No clone, no credential, no customer filesystem. Everything the VM
       * runs afterwards is a command Vibe constructed, which is why this shape
       * carries no fields: there is nothing about it for a caller to choose,
       * and a field here would be the first thing to point somewhere else.
       */
      kind: "image";
    };

/**
 * A filesystem Vibe captured after a validation succeeded (Sprint 10B §5).
 *
 * Created **only** after every check passed and the credential scrub was
 * re-verified, so what is retained is a known-clean artifact rather than
 * whatever a sandbox happened to contain. Expiry is always explicit — the
 * provider's own default is 30 days, which is not a retention policy anyone
 * chose.
 */
export type SandboxArtifact = {
  snapshotId: string;
  sizeBytes: number | null;
  /** Provider-reported expiry. Null only if the provider declines to say. */
  expiresAt: string | null;
};

export type CreateSandboxInput = {
  name: string;
  source: SandboxSource;
  /** Applied at creation, so a sandbox never exists under a weaker policy. */
  networkPolicy: SandboxNetworkPolicy;
  timeoutMs: number;
  /**
   * Inbound ports to expose publicly.
   *
   * Empty for validation: an exposed port serves untrusted code on a public URL,
   * which is a different exposure entirely and belongs to preview alone.
   */
  ports?: readonly number[];
  /**
   * Environment for every command.
   *
   * Must contain no privilege. Enforced by the orchestrator and asserted by
   * tests, because the interface cannot prevent a caller passing a secret (§8).
   */
  env: Record<string, string>;
  /**
   * vCPUs to provision. Defaults to the validation shape when omitted.
   *
   * Explicit because preview and validation want different shapes for reasons
   * that are not interchangeable — one races a build against a step deadline,
   * the other serves a handful of requests for fifteen billed minutes.
   */
  vcpus?: number;
};

/** Usage the provider reports once the sandbox has stopped (§25). */
export type SandboxUsage = {
  activeCpuDurationMs: number | null;
  networkIngressBytes: number | null;
  networkEgressBytes: number | null;
  /** Null unless the provider exposes attributable cost. Never estimated (§25). */
  costUsd: number | null;
};

/**
 * Whether a reconnected sandbox can still be worked in.
 *
 * Deliberately two values rather than the provider's six. The domain has
 * exactly one decision to make — continue, or refuse — and a richer status
 * would invite a future caller to treat `stopping` or `snapshotting` as
 * "probably fine". Anything that is not demonstrably running is `gone` (§12).
 */
export type SandboxLiveness = "running" | "gone";

export interface SandboxHandle {
  readonly id: string;
  readonly runtime: string;
  /**
   * Liveness as observed when this handle was obtained.
   *
   * A snapshot, not a subscription: it answers "was this sandbox usable when we
   * reconnected", which is the only question a phase step needs before it
   * commits to running a command.
   */
  readonly liveness: SandboxLiveness;

  /** Runs one Vibe-constructed command. Never a repository-supplied string. */
  run(input: {
    command: SandboxCommand;
    cwd: string;
    timeoutMs: number;
    /**
     * Merged over the sandbox environment, for this command only.
     *
     * Validation passes nothing and must keep passing nothing: §8 is that the
     * environment untrusted code runs in holds no privilege, and a per-command
     * override is exactly how that erodes.
     *
     * The agent runtime is the one caller, and what it passes is the one thing
     * that qualifies — a short-lived, execution-scoped gateway token whose whole
     * design is that it is worthless outside the run it names. Never a provider
     * key, never a GitHub credential, never a service role.
     */
    env?: Record<string, string>;
  }): Promise<SandboxCommandResult>;

  /**
   * Starts a Vibe-constructed command in the background and returns immediately.
   *
   * Only preview uses this. Validation deliberately does not: every validation
   * command has a verdict, and a command with no verdict has no place in a run
   * that produces one.
   */
  runBackground(input: {
    command: SandboxCommand;
    cwd: string;
    /** Merged over the sandbox environment. Must contain no privilege (§12). */
    env?: Record<string, string>;
  }): Promise<SandboxProcess>;

  /** Reads a bounded file back out, for integrity checks. Null when absent. */
  readFile(input: { path: string; maxBytes: number }): Promise<string | null>;

  /**
   * Replaces the egress policy on the running sandbox.
   *
   * The security-critical operation of the sprint: it is what closes the
   * network between dependency acquisition and repository execution.
   */
  applyNetworkPolicy(policy: SandboxNetworkPolicy): Promise<void>;

  /**
   * Captures the filesystem and terminates the sandbox.
   *
   * Terminating is the provider's behaviour, not ours: after a snapshot the
   * sandbox is unreachable and `stop()` would fail. So this is a *terminal*
   * operation, and `stop()` afterwards must still report usage rather than
   * throw — otherwise capturing an artifact would cost us the accounting.
   */
  snapshot(input: { expirationMs: number }): Promise<SandboxArtifact>;

  /**
   * The public origin for an exposed port. Provider-derived, never assembled.
   *
   * Throws when the provider has no route for the port, which is a real and
   * distinct failure: the server may be running perfectly and still be
   * unreachable. Callers classify it as `preview_provider_unavailable` rather
   * than blaming the application (Sprint 10B §17).
   *
   * The returned origin is capability-like. It is an unlisted public URL to a
   * VM serving untrusted code, so it is never persisted, never logged broadly,
   * never placed in an audit event, in AI evidence, or in analytics (§16).
   */
  publicOrigin(port: number): Promise<string>;

  /** Terminates the sandbox and reports usage. Safe to call more than once. */
  stop(): Promise<SandboxUsage>;
}

export interface SandboxProvider {
  readonly id: "vercel_sandbox";
  create(input: CreateSandboxInput): Promise<SandboxHandle>;

  /**
   * Reconnects to a sandbox created earlier in this run, by name.
   *
   * ## Why a name and not a handle
   *
   * Each validation phase is its own durable step, in its own function
   * invocation, with no shared memory. Something has to carry the sandbox
   * across that boundary — and the safe options are narrower than they look.
   *
   * A serialized provider handle would put connection material into a
   * third-party durable log. A capability URL would be a bearer credential in
   * the same place. Both are refused (§3, CLAUDE.md rule 52).
   *
   * What crosses instead is a **name derived from the validation run id** —
   * `sandboxNameFor()`, a pure function of a row that is already persisted. So
   * nothing new is stored at all: not a token, not a URL, not an opaque id.
   * The reconnect key is recomputed from state the database already holds, and
   * authorization comes from the provider credentials of the process doing the
   * reconnecting, exactly as it does at creation.
   *
   * Returns `null` when no usable sandbox answers to that name — expired,
   * stopped, or never created. The caller must treat that as `sandbox_lost` and
   * must **not** create a replacement: the filesystem is the state (§12).
   */
  reconnect(input: { name: string }): Promise<SandboxHandle | null>;

  /**
   * A sanitized description of why a sandbox is not usable.
   *
   * ## Why this exists as a separate call
   *
   * `reconnect` deliberately answers one question — can I work in this sandbox
   * — and collapses every other answer to `null`, because the caller's next act
   * is to run a command that assumes a filesystem. That collapse is correct for
   * control flow and useless for diagnosis, and the difference cost three
   * dogfood runs.
   *
   * The first said `capture_failed` with nothing else. The second said
   * `Status code 400 is not ok`. The third finally said `` `expiration` must be
   * 0 or >= 86400000 ms `` and the real cause was fixed in one attempt. Then
   * capture started failing as `sandbox_lost`, which carries no detail at all —
   * the same blind spot, one layer down (ADR 0015 §9).
   *
   * So this is asked **only on a path that has already failed**: it costs one
   * extra provider call when something is already wrong, and nothing at all
   * when things work. It returns the observed status and the session's own
   * timeout, because "stopped at a 300000 ms timeout" and "stopped at a 900000
   * ms timeout" are different bugs with different fixes.
   *
   * Never shown to a user. Bounded and secret-redacted like any other untrusted
   * text, and recorded on the audit event an operator reads.
   */
  inspect(input: { name: string }): Promise<string | null>;

  /**
   * Deletes a stored artifact.
   *
   * Explicit rather than left to expiry. A preview that has ended should not
   * leave a customer's filesystem sitting in provider storage for the remainder
   * of its TTL — the TTL is a backstop for the cases where we cannot delete,
   * not the plan.
   *
   * **Throws when deletion could not be confirmed.** Swallowing that here would
   * make "the snapshot is gone" unfalsifiable at every layer above; the caller
   * catches it, records `artifact_delete_failed`, and leaves the cleanup
   * retryable — without letting storage housekeeping overwrite the preview's
   * own result (Sprint 10B §19).
   *
   * Deleting an already-deleted snapshot must succeed: idempotence is the
   * point, since retry is the recovery path.
   */
  deleteArtifact(snapshotId: string): Promise<void>;
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
