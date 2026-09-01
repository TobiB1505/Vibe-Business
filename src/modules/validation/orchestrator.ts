import { createHash } from "node:crypto";
import { SANDBOX_BUDGETS } from "./budgets";
import { describeCommand, planValidationSteps, type SandboxCommand } from "./commands";
import { sandboxNameFor } from "./identity";
import { sanitizeCommandOutput } from "./logs";
import {
  DEPENDENCY_HOSTS,
  SOURCE_HOSTS,
  type SandboxArtifact,
  type SandboxHandle,
  type SandboxProvider,
  type SandboxUsage,
} from "./sandbox-port";
import type {
  SourceIntegrity,
  SupportedPackageManager,
  ValidationFailureCode,
  ValidationProfile,
  ValidationStepName,
  ValidationStepResult,
} from "./schema";

/**
 * One validation run, phase by phase (Sprint 10A §30, §8 refactor).
 *
 * This file is the security boundary of the sprint. Everything above it decides
 * *whether* to validate; everything below it is a provider adapter.
 *
 * ## The sequence, and why each step is where it is
 *
 * ```
 * 1. provision                 network: github only        no secrets in env
 * 2. verify commit sha         our command, not theirs
 * 3. verify file hashes        prepared artifact == sandbox artifact
 * 4. destroy .git              the clone credential stops existing
 * 5. narrow network            github revoked, registry only
 * 6. install --ignore-scripts  the only networked step, no lifecycle hooks
 * 7. deny all network          nothing can phone home from here on
 * 8. typecheck / test / build  ← the first repository-controlled code
 * 9. stop sandbox              a durable step of its own, on every path
 * ```
 *
 * Steps 2–5 all happen **before** any repository-controlled code runs. That is
 * the point: by the time `pnpm build` executes someone else's JavaScript, the
 * GitHub credential is gone, the network is closed, and the environment holds
 * nothing of value.
 *
 * ## What changed in the durable-phase refactor
 *
 * The sequence above is unchanged. What changed is that it is no longer one
 * function call inside one durable step. Each phase is entered independently,
 * from a different function invocation, with no shared memory — so each phase
 * has to re-establish what it needs rather than inherit it from a closure.
 *
 * Three consequences shape the code below:
 *
 *  1. **Every phase reconnects by name.** Nothing about the sandbox is carried
 *     across a step boundary except a name derived from the validation run id,
 *     which the database already holds (§3).
 *  2. **Every phase asserts liveness before it commits to work.** A sandbox
 *     that is gone means `node_modules` is gone, and continuing on a
 *     replacement VM would answer a question about a tree that never existed.
 *     Refuse, never re-provision (§12).
 *  3. **`deny-all` is re-asserted at the start of every repository-controlled
 *     phase.** Under the single-step design the closed network was inherited
 *     from earlier lines in the same function. Across steps that inheritance is
 *     an assumption about a previous invocation, so each phase now makes the
 *     property locally true instead of trusting it.
 *
 * ## What "before repository code" means precisely
 *
 * `git rev-parse`, `rm -rf .git` and reading files are commands *Vibe*
 * constructs and runs. They execute inside the sandbox, but the sandbox is not
 * yet running anything the repository chose. The first genuinely
 * repository-controlled execution is the install step — and even that runs
 * with `--ignore-scripts`, so the first real one is `typecheck`.
 */

export type ValidationTarget = {
  preparedChangeId: string;
  preparedCommitSha: string;
  repositoryUrl: string;
  /**
   * Short-lived, single-purpose, destroyed at step 4. Never persisted (§7).
   *
   * Only the provisioning phase has any use for this. Every later phase is
   * resolved without one — the credential is minted in the one step that
   * clones, rather than for every step that happens to need a target.
   */
  cloneCredential: { username: string; password: string } | null;
  profile: ValidationProfile;
  packageManager: SupportedPackageManager;
  /**
   * The directory the provider clones into, relative to the sandbox home.
   *
   * Vercel materializes a git source at `/vercel/sandbox/<repo>/`, not at
   * `/vercel/sandbox`. Discovered by listing the directory after four runs
   * looked in the wrong place — and taken from the repository name on the
   * server, never guessed inside the sandbox.
   */
  sourceRoot: string;
  workspaceRoot: string;
  /** Path + sha256 of every file Vibe prepared, for integrity checking (§29). */
  preparedFiles: readonly { path: string; contentHash: string }[];
  /** Unique per attempt. Names the sandbox, so a retry cannot collide (§21). */
  validationRunId: string;
};

export type CleanupStatus = "stopped" | "stop_failed" | "not_provisioned";

/**
 * Resolves a file's bytes from GitHub at an exact commit.
 *
 * Injected so the orchestrator stays testable without a network. Reuses the
 * repository reader the analyzer already uses — this is an ordinary bounded
 * read, not a new capability.
 */
export type SourceManifestPort = {
  getTextFile(path: string, commitSha: string, maxBytes: number): Promise<string | null>;
};

/**
 * Environment for every command in the sandbox (§8).
 *
 * The complete list. Three variables, none of which grants anything: they tell
 * a build it is running non-interactively and should not phone telemetry home.
 *
 * What is deliberately absent is the whole point — no Supabase service role, no
 * Anthropic key, no GitHub App private key or installation token, no Vercel
 * management token, no customer production configuration. A build that needs a
 * secret fails, and that failure is a true statement about the change rather
 * than a reason to hand untrusted code a credential (§9).
 */
export const SANDBOX_ENVIRONMENT: Readonly<Record<string, string>> = Object.freeze({
  CI: "1",
  NODE_ENV: "production",
  NEXT_TELEMETRY_DISABLED: "1",
});

/**
 * Files whose bytes define what a build *is* (§ post-dogfood).
 *
 * The prepared change's own files are verified against stored hashes, which
 * proves Vibe's edit arrived intact. These prove the rest of the build identity
 * arrived intact too: a matching `robots.ts` beside a different lockfile would
 * be a different build.
 *
 * Deliberately a short list, not a Merkle tree over the repository. A full
 * source manifest digest is a real future capability; building one now would be
 * overengineering for a profile that supports one framework.
 */
const BUILD_IDENTITY_FILES: readonly string[] = [
  "package.json",
  "pnpm-lock.yaml",
  "package-lock.json",
  "next.config.ts",
  "next.config.js",
  "next.config.mjs",
  "tsconfig.json",
];

const LOCKFILES: Record<SupportedPackageManager, string> = {
  pnpm: "pnpm-lock.yaml",
  npm: "package-lock.json",
};

/** Deterministic markers that a build failed for missing configuration (§9). */
const MISSING_ENVIRONMENT_MARKERS: readonly RegExp[] = [
  /missing (?:required )?environment variable/i,
  /environment variable ["'`]?[A-Z][A-Z0-9_]{2,}["'`]? is (?:not set|required|missing)/i,
  /invalid environment variables/i,
];

/**
 * A safe description of an unknown thrown value.
 *
 * Provider errors can carry request context, headers and occasionally
 * credentials, so the object is never stored. Its name and message are, after
 * the same sanitizer step output goes through — which is the difference
 * between "we refuse to look" and "we cannot find out".
 */
function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return "non-error value thrown";
}

/**
 * Reads a file only when it fits entirely within the budget.
 *
 * The distinction matters: the adapter truncates at `maxBytes`, so hashing a
 * truncated prefix against a complete file would report a **content mismatch**
 * for a file that is merely large. That is a false integrity failure — the
 * worst kind, because it looks exactly like a real one.
 *
 * Reading one byte past the budget makes "too large" observable, and too large
 * is recorded as unverified rather than compared.
 */
async function readWhole(
  sandbox: SandboxHandle,
  path: string,
  maxBytes: number,
): Promise<{ kind: "content"; content: string } | { kind: "absent" } | { kind: "too_large" }> {
  const content = await sandbox.readFile({ path, maxBytes: maxBytes + 1 });
  if (content === null) return { kind: "absent" };
  if (content.length > maxBytes) return { kind: "too_large" };
  return { kind: "content", content };
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * The sandbox's working directory, per current Vercel Sandbox documentation.
 *
 * Every path is made absolute against it rather than relying on a relative
 * `cwd: "."`. The first dogfood could not distinguish "there is no `.git`" from
 * "we looked in the wrong place", and an ambiguity that costs a real run is
 * worth one constant.
 */
const SANDBOX_WORKDIR = "/vercel/sandbox";

/**
 * Paths stay **relative** to the sandbox's working directory.
 *
 * The fourth dogfood run tried absolute addressing and `runCommand` threw,
 * where the relative form had executed and produced a real git error. So the
 * provider wants relative paths, and — usefully — that also settles the
 * ambiguity the absolute experiment was meant to settle: the earlier
 * `fatal: not a git repository` came from the right directory.
 *
 * `SANDBOX_WORKDIR` is kept for messages, so a failure says where it looked.
 */
function join(...segments: string[]): string {
  const parts = segments
    .map((segment) => segment.replace(/^\/+|\/+$/g, ""))
    .filter((segment) => segment.length > 0 && segment !== ".");

  return parts.length === 0 ? "." : parts.join("/");
}

/**
 * A path relative to the **sandbox home**, for filesystem reads.
 *
 * `readFile` takes no working directory, so it resolves against
 * `/vercel/sandbox` — which means the clone directory has to be included.
 */
export function inSandbox(sourceRoot: string, workspaceRoot: string, path = ""): string {
  return join(sourceRoot, workspaceRoot, path);
}

/**
 * A path relative to the **repository root**, for commands and for GitHub.
 *
 * Commands run with `cwd` already set to the workspace directory, and GitHub
 * addresses files from the repository root. Both therefore want a path *without*
 * the clone directory — and including it is silent rather than loud:
 * `rm -rf <repo>/.git` from inside `<repo>` targets a path that does not exist,
 * which `-f` reports as success while the real `.git` survives. That cost a run,
 * so the two addressing schemes have separate names.
 */
export function inRepository(workspaceRoot: string, path = ""): string {
  return join(workspaceRoot, path);
}

function stepResult(
  command: SandboxCommand,
  result: { exitCode: number; durationMs: number; output: string; timedOut: boolean },
): ValidationStepResult {
  const sanitized = sanitizeCommandOutput(result.output);

  return {
    command: describeCommand(command),
    status: result.timedOut ? "timed_out" : result.exitCode === 0 ? "passed" : "failed",
    exitCode: result.timedOut ? null : result.exitCode,
    durationMs: result.durationMs,
    outputTail: sanitized.text,
    outputTruncated: sanitized.truncated,
    skipReason: null,
  };
}

function skipped(): ValidationStepResult {
  return {
    command: "",
    status: "skipped",
    exitCode: null,
    durationMs: 0,
    outputTail: "",
    outputTruncated: false,
    skipReason: "script_not_present",
  };
}

/** A build that failed specifically for want of configuration Vibe cannot supply. */
function looksLikeMissingEnvironment(step: ValidationStepResult | undefined): boolean {
  if (!step || step.status !== "failed") return false;
  return MISSING_ENVIRONMENT_MARKERS.some((marker) => marker.test(step.outputTail));
}

/** Sanitized with the same function and limits as step output — one code path. */
function detail(text: string | null): string | null {
  return text === null ? null : sanitizeCommandOutput(text).text;
}

// ---------------------------------------------------------------------------
// Phase outcomes
//
// Every phase reports a discriminated outcome rather than throwing. A durable
// step that returns a typed failure can persist it; one that throws hands the
// platform an untyped error and a retry decision, which is exactly the
// ambiguity §10 exists to remove.
// ---------------------------------------------------------------------------

export type ProvisionOutcome =
  | { ok: true; sandboxId: string; runtime: string }
  | { ok: false; failureCode: ValidationFailureCode; failureDetail: string | null };

export type VerifySourceOutcome =
  | { ok: true; sourceIntegrity: SourceIntegrity; runtime: string }
  | {
      ok: false;
      failureCode: ValidationFailureCode;
      failureDetail: string | null;
      /** Recorded even on failure: it says what *was* established before refusing. */
      sourceIntegrity: SourceIntegrity | null;
    };

export type CheckPhaseOutcome =
  | { ok: true; step: ValidationStepResult }
  | {
      ok: false;
      failureCode: ValidationFailureCode;
      failureDetail: string | null;
      /** Null when the phase never got as far as running its command. */
      step: ValidationStepResult | null;
    };

export type CleanupOutcome = {
  cleanup: CleanupStatus;
  usage: SandboxUsage | null;
  runtime: string | null;
};

/**
 * Reconnects, or reports that the sandbox is gone.
 *
 * The name is recomputed, never carried: `sandboxNameFor` is a pure function of
 * the validation run id, so no reconnect material is stored anywhere (§3).
 */
async function attach(
  provider: SandboxProvider,
  target: ValidationTarget,
): Promise<SandboxHandle | null> {
  const sandbox = await provider.reconnect({ name: sandboxNameFor(target.validationRunId) });
  if (!sandbox) return null;
  // Belt and braces: the adapter already refuses a non-running sandbox, and the
  // domain refuses one too. A liveness rule enforced in only one layer is a
  // liveness rule that a provider swap silently drops.
  if (sandbox.liveness !== "running") return null;
  return sandbox;
}

const SANDBOX_LOST_DETAIL =
  "the isolated environment was no longer available; its filesystem — including installed " +
  "dependencies — is gone, so validation stopped rather than continuing on a different machine";

// ---------------------------------------------------------------------------
// Phase 1 — provision
// ---------------------------------------------------------------------------

/**
 * Creates the sandbox, with the source-only policy already applied.
 *
 * `Sandbox.create` takes the network policy, so the VM never exists under a
 * weaker one. This phase deliberately does nothing else: it is the only
 * billable-and-ambiguous operation in the run, and keeping it alone in its own
 * durable step is what lets that step refuse retries without also refusing them
 * for work that is safe to repeat (§10).
 */
export async function provisionSandbox(
  provider: SandboxProvider,
  target: ValidationTarget,
): Promise<ProvisionOutcome> {
  // Re-entry, and a genuine hole in the naive version of this step.
  //
  // The sandbox name is deterministic per attempt, so a previous run of *this
  // step* that created the sandbox and then died — killed, redeployed, or
  // failed while returning — leaves a live sandbox whose name `create` will
  // refuse. Without this the retry would report `sandbox_unavailable` and the
  // run would be doomed by its own successful provisioning. That exact failure
  // mode cost a real dogfood run when the name was derived from the validation
  // *identity* rather than the attempt.
  //
  // Only reachable when no phase has run yet — the caller refuses to
  // re-provision once any phase state exists — so adopting an existing sandbox
  // here can never resume onto a filesystem some earlier phase depended on.
  const existing = await attach(provider, target);
  if (existing) return { ok: true, sandboxId: existing.id, runtime: existing.runtime };

  try {
    const sandbox = await provider.create({
      name: sandboxNameFor(target.validationRunId),
      source: {
        kind: "git",
        repositoryUrl: target.repositoryUrl,
        revision: target.preparedCommitSha,
        credential: target.cloneCredential,
      },
      networkPolicy: { mode: "allow_domains", domains: SOURCE_HOSTS },
      timeoutMs: SANDBOX_BUDGETS.totalLifetimeMs,
      env: { ...SANDBOX_ENVIRONMENT },
    });

    return { ok: true, sandboxId: sandbox.id, runtime: sandbox.runtime };
  } catch (error) {
    return { ok: false, failureCode: "sandbox_unavailable", failureDetail: detail(describeError(error)) };
  }
}

// ---------------------------------------------------------------------------
// Phase 2 — verify the source, then destroy the clone credential
// ---------------------------------------------------------------------------

/**
 * Establishes what the sandbox actually contains, before anything runs.
 *
 * NOT by asking git alone. Vercel materializes a git source provider-side, so
 * the strongest available proof is taken and the weaker ones always hold:
 *
 *   - the revision is an immutable commit SHA pinned at creation, so the
 *     "branch moved" failure cannot occur;
 *   - the prepared change's own files are hashed against stored digests;
 *   - the build-identity files are hashed against GitHub at that same SHA.
 *
 * All of it before a single repository-controlled command (§29).
 */
export async function verifySource(
  provider: SandboxProvider,
  manifest: SourceManifestPort,
  target: ValidationTarget,
): Promise<VerifySourceOutcome> {
  const sandbox = await attach(provider, target);
  if (!sandbox) {
    return {
      ok: false,
      failureCode: "sandbox_lost",
      failureDetail: detail(SANDBOX_LOST_DETAIL),
      sourceIntegrity: null,
    };
  }

  const fail = (
    failureCode: ValidationFailureCode,
    failureDetail: string | null,
    sourceIntegrity: SourceIntegrity | null = null,
  ): VerifySourceOutcome => ({
    ok: false,
    failureCode,
    failureDetail: detail(failureDetail),
    sourceIntegrity,
  });

  try {
    const workdir = inSandbox(target.sourceRoot, target.workspaceRoot);

    // The provider-side clone leaves a real checkout — in a subdirectory, which
    // is what four runs took to establish. Observing the commit is therefore
    // free: no credential enters the VM, because Vercel performed the clone.
    //
    // Recorded rather than required. A mismatch is a definitive integrity
    // failure and stops the run; an *unavailable* git is not, because pinning
    // plus hashing already carries the guarantee.
    const head = await sandbox.run({
      command: { command: "git", args: ["rev-parse", "HEAD"] },
      cwd: workdir,
      timeoutMs: SANDBOX_BUDGETS.sourceTimeoutMs,
    });

    // Empty output from a "successful" rev-parse is not an observation. Treated
    // as unavailable rather than compared, so a quirk cannot masquerade as a
    // mismatch and fail an otherwise sound run.
    const observedCommit =
      head.exitCode === 0 && head.output.trim().length > 0 ? head.output.trim() : null;
    if (observedCommit !== null && observedCommit !== target.preparedCommitSha) {
      return fail(
        "source_integrity_failed",
        `checked-out commit ${observedCommit} is not the prepared commit ${target.preparedCommitSha}`,
      );
    }

    for (const file of target.preparedFiles.slice(0, SANDBOX_BUDGETS.maxIntegrityFiles)) {
      const content = await sandbox.readFile({
        path: inSandbox(target.sourceRoot, target.workspaceRoot, file.path),
        maxBytes: SANDBOX_BUDGETS.maxIntegrityFileBytes,
      });

      if (content === null) {
        // Describe what is actually on disk. `ls -a` is Vibe's own command with
        // bounded output — no repository code runs — and it is the difference
        // between another hypothesis and a finding. That distinction cost this
        // sprint four runs.
        const listing = await sandbox.run({
          command: { command: "ls", args: ["-a"] },
          cwd: workdir,
          timeoutMs: SANDBOX_BUDGETS.sourceTimeoutMs,
        });

        return fail(
          "source_integrity_failed",
          `prepared file missing: ${file.path} (looked in ${SANDBOX_WORKDIR}/${workdir})\n` +
            `directory contents:\n${listing.output}`,
        );
      }
      if (sha256(content) !== file.contentHash) {
        return fail("source_integrity_failed", `content hash mismatch: ${file.path}`);
      }
    }

    // A matching `robots.ts` beside a different lockfile would be a different
    // build. Compared against the pinned SHA, so this answers "did the provider
    // deliver the revision we asked for" without needing git metadata.
    const verified: string[] = [];
    const unverified: string[] = [];
    // Recorded so a preview can prove the restored bytes are these bytes,
    // without acquiring the source a second time (Sprint 10B §11).
    const digests: Record<string, string> = {};

    for (const path of BUILD_IDENTITY_FILES) {
      const onDisk = await readWhole(
        sandbox,
        inSandbox(target.sourceRoot, target.workspaceRoot, path),
        SANDBOX_BUDGETS.maxBuildIdentityFileBytes,
      );
      const atCommit = await manifest.getTextFile(
        inRepository(target.workspaceRoot, path),
        target.preparedCommitSha,
        SANDBOX_BUDGETS.maxBuildIdentityFileBytes,
      );

      // Absent on both sides is agreement, not a gap: most repositories have
      // only one lockfile and one next.config extension.
      if (onDisk.kind === "absent" && atCommit === null) continue;

      // Absent on one side, or past the read budget, cannot be compared.
      // Recorded as unverified rather than quietly counted as verified.
      if (onDisk.kind !== "content" || atCommit === null) {
        unverified.push(path);
        continue;
      }

      const onDiskDigest = sha256(onDisk.content);
      if (onDiskDigest !== sha256(atCommit)) {
        return fail(
          "source_integrity_failed",
          `build identity mismatch against ${target.preparedCommitSha}: ${path}`,
        );
      }

      verified.push(path);
      digests[path] = onDiskDigest;
    }

    const sourceIntegrity: SourceIntegrity = {
      requestedRevision: target.preparedCommitSha,
      revisionMode: "provider_pinned",
      gitCommitObserved: observedCommit !== null,
      changedFilesVerified: target.preparedFiles.length > 0,
      buildIdentityFilesVerified: verified,
      buildIdentityFilesUnverified: unverified,
      buildIdentityDigests: digests,
    };

    // On this provider there is no `.git` to remove, so this is defence in
    // depth rather than the primary control — and it is kept precisely because
    // that is a fact about *this* provider and image, not a guarantee. A future
    // provider that does leave a checkout would put a credential-bearing remote
    // on disk, and this step is what stops it reaching repository code (§7).
    await sandbox.run({
      command: { command: "rm", args: ["-rf", ".git"] },
      cwd: workdir,
      timeoutMs: SANDBOX_BUDGETS.sourceTimeoutMs,
    });

    // Verified, not assumed. If the credential store still exists, refuse to
    // run repository code at all rather than hope.
    const gitConfig = await sandbox.readFile({
      path: inSandbox(target.sourceRoot, target.workspaceRoot, ".git/config"),
      maxBytes: 4096,
    });
    if (gitConfig !== null) {
      return fail(
        "credential_scrub_failed",
        "the git credential store survived removal",
        sourceIntegrity,
      );
    }

    return { ok: true, sourceIntegrity, runtime: sandbox.runtime };
  } catch (error) {
    return fail("validation_run_failed", describeError(error));
  }
}

// ---------------------------------------------------------------------------
// Phases 3–6 — install, typecheck, test, build
// ---------------------------------------------------------------------------

/**
 * Re-derives the command plan from the sandbox's own `package.json`.
 *
 * Read fresh in each phase rather than carried across the step boundary. That
 * is cheaper than it looks — one bounded file read — and it buys a real
 * property: the plan is always derived from the filesystem the command is about
 * to run against, never from a snapshot of an earlier invocation's belief about
 * it. Parsed in *our* process, never executed (§12).
 */
async function readPlan(sandbox: SandboxHandle, target: ValidationTarget) {
  const manifestRaw = await sandbox.readFile({
    path: inSandbox(target.sourceRoot, target.workspaceRoot, "package.json"),
    maxBytes: SANDBOX_BUDGETS.maxIntegrityFileBytes,
  });
  if (manifestRaw === null) {
    return { ok: false as const, failureCode: "validation_not_supported" as const, failureDetail: `no package.json at ${target.workspaceRoot}` };
  }

  let scripts: string[] = [];
  try {
    const parsed = JSON.parse(manifestRaw) as { scripts?: Record<string, unknown> };
    scripts = Object.keys(parsed.scripts ?? {});
  } catch {
    return { ok: false as const, failureCode: "validation_not_supported" as const, failureDetail: "package.json is not valid JSON" };
  }

  return {
    ok: true as const,
    plan: planValidationSteps({ packageManager: target.packageManager, scripts }),
  };
}

/**
 * Runs exactly one validation phase, in its own durable step.
 *
 * ## The install phase owns the entire networked window
 *
 * Opening the registry allowlist, installing, and closing the network to
 * `deny-all` all happen inside this one call. The ordering is load-bearing: the
 * network is shut **before this phase returns**, and the caller persists the
 * phase result only after it returns. So a persisted `install: passed` implies
 * the network was closed — the security property is carried by the recorded
 * state rather than by a later step remembering to re-establish it.
 *
 * ## Every other phase re-asserts `deny-all` anyway
 *
 * Under the single-step design the closed network was three lines above the
 * build command. Across durable steps it would be an assumption about a
 * previous function invocation, and an assumption is not a control. Each
 * repository-controlled phase therefore closes the network itself before
 * running anything — idempotent, cheap, and locally true.
 */
export async function runCheckPhase(
  provider: SandboxProvider,
  target: ValidationTarget,
  phase: ValidationStepName,
): Promise<CheckPhaseOutcome> {
  const sandbox = await attach(provider, target);
  if (!sandbox) {
    return {
      ok: false,
      failureCode: "sandbox_lost",
      failureDetail: detail(SANDBOX_LOST_DETAIL),
      step: null,
    };
  }

  try {
    const planned = await readPlan(sandbox, target);
    if (!planned.ok) {
      return {
        ok: false,
        failureCode: planned.failureCode,
        failureDetail: detail(planned.failureDetail),
        step: null,
      };
    }

    const entry = planned.plan.find((candidate) => candidate.step === phase);
    if (!entry) {
      return { ok: false, failureCode: "validation_run_failed", failureDetail: null, step: null };
    }

    if (!entry.run) {
      // A repository with no test script is not a repository that failed its
      // tests. Recorded as skipped, with why (§19).
      //
      // The build is the exception and is handled by the caller: "it builds" is
      // the claim being made, so a missing build script is not a skip that the
      // run can pass around.
      return { ok: true, step: skipped() };
    }

    const workdir = inSandbox(target.sourceRoot, target.workspaceRoot);

    if (phase === "install") {
      const lockfile = await sandbox.readFile({
        path: inSandbox(target.sourceRoot, target.workspaceRoot, LOCKFILES[target.packageManager]),
        maxBytes: 1024,
      });
      if (lockfile === null) {
        return {
          ok: false,
          failureCode: "lockfile_missing",
          failureDetail: detail(`expected ${LOCKFILES[target.packageManager]}`),
          step: null,
        };
      }

      // GitHub is revoked here: the source is already on disk, so continued
      // access to it would be pure additional reach.
      await sandbox.applyNetworkPolicy({ mode: "allow_domains", domains: DEPENDENCY_HOSTS });

      const installResult = await sandbox.run({
        command: entry.command,
        cwd: workdir,
        timeoutMs: SANDBOX_BUDGETS.installTimeoutMs,
      });
      const recorded = stepResult(entry.command, installResult);

      // Closed regardless of how the install ended. A failed install is not a
      // reason to leave the registry reachable for whatever runs next, and the
      // failure path is exactly where "we'll close it later" turns into "we
      // didn't". `deny-all` blocks DNS as well as traffic, closing the covert
      // channel an allowlist leaves open.
      await sandbox.applyNetworkPolicy({ mode: "deny_all" });

      if (recorded.status !== "passed") {
        return {
          ok: false,
          failureCode: installResult.timedOut ? "sandbox_timeout" : "validation_checks_failed",
          failureDetail: null,
          step: recorded,
        };
      }

      return { ok: true, step: recorded };
    }

    // Everything from here is repository-controlled. Close the network first,
    // in this invocation, rather than trusting that an earlier one did.
    await sandbox.applyNetworkPolicy({ mode: "deny_all" });

    const result = await sandbox.run({
      command: entry.command,
      cwd: workdir,
      timeoutMs: SANDBOX_BUDGETS.commandTimeoutMs,
    });
    const recorded = stepResult(entry.command, result);

    if (recorded.status !== "passed") {
      if (result.timedOut) {
        return { ok: false, failureCode: "sandbox_timeout", failureDetail: null, step: recorded };
      }
      if (phase === "build" && looksLikeMissingEnvironment(recorded)) {
        return {
          ok: false,
          failureCode: "build_failed_missing_environment",
          failureDetail: null,
          step: recorded,
        };
      }
      return { ok: false, failureCode: "validation_checks_failed", failureDetail: null, step: recorded };
    }

    return { ok: true, step: recorded };
  } catch (error) {
    return {
      ok: false,
      failureCode: "validation_run_failed",
      failureDetail: detail(describeError(error)),
      step: null,
    };
  }
}

// ---------------------------------------------------------------------------
// Phase 7 — cleanup
// ---------------------------------------------------------------------------

/**
 * Stops the sandbox, on every path (§13).
 *
 * Its own durable step, which is the single most important structural change in
 * this refactor. Under the previous design cleanup lived inside the same
 * function as the work, so the one failure mode that mattered most — the step
 * being killed at the platform ceiling — was precisely the one that ran no
 * cleanup and left a paid VM alive with nothing responsible for it.
 *
 * A separate step survives that: the phase step dies, the workflow catches it,
 * and cleanup runs as a fresh invocation.
 *
 * "Already gone" is a success, not an error. Stopping is idempotent and this
 * step is safe to retry, which is why it is one of the few that may be.
 */

export async function stopSandbox(
  provider: SandboxProvider,
  target: ValidationTarget,
): Promise<CleanupOutcome> {
  let sandbox: SandboxHandle | null = null;
  try {
    sandbox = await provider.reconnect({ name: sandboxNameFor(target.validationRunId) });
  } catch {
    sandbox = null;
  }

  // Nothing answering to the name: either it was never created, or it has
  // already stopped. Both mean no VM is running, which is the outcome cleanup
  // exists to produce.
  if (!sandbox) return { cleanup: "not_provisioned", usage: null, runtime: null };

  try {
    const usage = await sandbox.stop();
    return { cleanup: "stopped", usage, runtime: sandbox.runtime };
  } catch {
    // Recorded for observability, never allowed to overwrite the verdict: a
    // failed stop does not make a failed build succeed, or vice versa.
    return { cleanup: "stop_failed", usage: null, runtime: sandbox.runtime };
  }
}

/**
 * Whether a repository supports the claim this sprint makes (§6).
 *
 * The build is mandatory. A repository with no build script cannot support
 * "the application still builds", so it is not validated — a skipped build is
 * never a pass.
 */
export function buildSatisfiesProfile(
  steps: Partial<Record<ValidationStepName, ValidationStepResult>>,
): boolean {
  return steps.build?.status === "passed";
}
