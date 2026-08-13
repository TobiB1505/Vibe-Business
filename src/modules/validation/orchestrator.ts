import { createHash } from "node:crypto";
import { SANDBOX_BUDGETS } from "./budgets";
import { describeCommand, planValidationSteps, type SandboxCommand } from "./commands";
import { sandboxNameFor } from "./identity";
import { sanitizeCommandOutput } from "./logs";
import {
  DEPENDENCY_HOSTS,
  SOURCE_HOSTS,
  type SandboxHandle,
  type SandboxProvider,
  type SandboxUsage,
} from "./sandbox-port";
import type {
  SourceIntegrity,
  SupportedPackageManager,
  ValidationFailureCode,
  ValidationProfile,
  ValidationStage,
  ValidationStepName,
  ValidationStepResult,
} from "./schema";

/**
 * One validation run, start to finish (Sprint 10A §30).
 *
 * This file is the security boundary of the sprint. Everything above it
 * decides *whether* to validate; everything below it is a provider adapter.
 * The order of operations here is the entire safety argument, so it is written
 * as one linear sequence rather than spread across steps that could be
 * reordered by a future refactor without anyone noticing.
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
 * 9. stop sandbox              in `finally`, on every path
 * ```
 *
 * Steps 2–5 all happen **before** any repository-controlled code runs. That is
 * the point: by the time `pnpm build` executes someone else's JavaScript, the
 * GitHub credential is gone, the network is closed, and the environment holds
 * nothing of value.
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
  /** Short-lived, single-purpose, destroyed at step 4. Never persisted (§7). */
  cloneCredential: { username: string; password: string } | null;
  profile: ValidationProfile;
  packageManager: SupportedPackageManager;
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

export type ValidationOutcome = {
  status: "passed" | "failed";
  failureCode: ValidationFailureCode | null;
  /**
   * Bounded, sanitized explanation for failures outside a validation step.
   *
   * Step failures already carry their own output tail. This covers the stages
   * that previously recorded a code and nothing else — provisioning, source
   * acquisition, credential scrubbing — which is what made the first real
   * dogfood failures impossible to diagnose.
   */
  failureDetail: string | null;
  steps: Partial<Record<ValidationStepName, ValidationStepResult>>;
  stage: ValidationStage;
  sandboxRuntime: string | null;
  cleanup: CleanupStatus;
  usage: SandboxUsage | null;
  sandboxDurationMs: number | null;
  /** What was actually established about the validated source. */
  sourceIntegrity: SourceIntegrity | null;
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
 * `fatal: not a git repository` came from the right directory. The checkout
 * genuinely has no `.git`.
 *
 * `SANDBOX_WORKDIR` is kept for messages, so a failure says where it looked.
 */
export function inWorkspace(root: string, path = ""): string {
  const base = root === "." || root === "" ? "" : root.replace(/\/+$/, "");
  if (path === "") return base === "" ? "." : base;
  return base === "" ? path : `${base}/${path}`;
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

export async function runValidation(
  provider: SandboxProvider,
  manifest: SourceManifestPort,
  target: ValidationTarget,
  hooks: { onStage?: (stage: ValidationStage) => Promise<void> | void } = {},
): Promise<ValidationOutcome> {
  const steps: Partial<Record<ValidationStepName, ValidationStepResult>> = {};
  let sandbox: SandboxHandle | null = null;
  let stage: ValidationStage = "provisioning";
  const startedAt = Date.now();

  const setStage = async (next: ValidationStage) => {
    stage = next;
    await hooks.onStage?.(next);
  };

  /** Terminal helper: cleanup always runs, so no path can leak a paid VM (§23). */
  let sourceIntegrity: SourceIntegrity | null = null;

  const finish = async (
    status: "passed" | "failed",
    failureCode: ValidationFailureCode | null,
    failureDetail: string | null = null,
  ): Promise<ValidationOutcome> => {
    let cleanup: CleanupStatus = "not_provisioned";
    let usage: SandboxUsage | null = null;

    if (sandbox) {
      try {
        usage = await sandbox.stop();
        cleanup = "stopped";
      } catch {
        // Recorded for observability, never allowed to overwrite the verdict:
        // a failed stop does not make a failed build succeed, or vice versa.
        cleanup = "stop_failed";
      }
    }

    return {
      status,
      failureCode,
      // Sanitized with the same function and limits as step output: this text
      // is untrusted either way, and a second code path would be a second bug.
      failureDetail: failureDetail === null ? null : sanitizeCommandOutput(failureDetail).text,
      steps,
      stage,
      sandboxRuntime: sandbox?.runtime ?? null,
      cleanup,
      usage,
      sandboxDurationMs: Date.now() - startedAt,
      sourceIntegrity,
    };
  };

  try {
    // ---- 1. Provision -----------------------------------------------------
    // Created with the source-only policy already applied. `Sandbox.create`
    // takes the network policy, so the VM never exists under a weaker one.
    await setStage("provisioning");
    try {
      sandbox = await provider.create({
        name: sandboxNameFor(target.validationRunId),
        source: {
          repositoryUrl: target.repositoryUrl,
          revision: target.preparedCommitSha,
          credential: target.cloneCredential,
        },
        networkPolicy: { mode: "allow_domains", domains: SOURCE_HOSTS },
        timeoutMs: SANDBOX_BUDGETS.totalLifetimeMs,
        env: { ...SANDBOX_ENVIRONMENT },
      });
    } catch (error) {
      return finish("failed", "sandbox_unavailable", describeError(error));
    }

    // ---- 2. Verify the source's identity ---------------------------------
    //
    // NOT by asking git. Vercel materializes a git source as a **filesystem**,
    // not a checkout: there is no `.git` in the sandbox, established over five
    // real runs rather than assumed. Reinstating `git rev-parse` would mean
    // cloning inside the sandbox ourselves, which carries a GitHub installation
    // token into a VM that later runs untrusted code — a real secret lifecycle
    // bought to obtain a weaker proof. Rejected deliberately.
    //
    // What is established instead, and recorded as exactly that:
    //
    //   - the revision is an immutable commit SHA pinned at creation, so the
    //     "branch moved" failure the original check existed to catch cannot
    //     occur;
    //   - the prepared change's own files are hashed against stored digests;
    //   - the build-identity files are hashed against GitHub at that same SHA.
    //
    // All of it before a single repository-controlled command (§29).
    await setStage("verifying_source");
    const workdir = inWorkspace(target.workspaceRoot);

    for (const file of target.preparedFiles.slice(0, SANDBOX_BUDGETS.maxIntegrityFiles)) {
      const content = await sandbox.readFile({
        path: inWorkspace(target.workspaceRoot, file.path),
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

        return finish(
          "failed",
          "source_integrity_failed",
          `prepared file missing: ${file.path} (looked in ${SANDBOX_WORKDIR}/${workdir})\n` +
            `directory contents:\n${listing.output}`,
        );
      }
      if (sha256(content) !== file.contentHash) {
        return finish("failed", "source_integrity_failed", `content hash mismatch: ${file.path}`);
      }
    }

    // ---- 3. Verify the build identity against GitHub ---------------------
    // A matching `robots.ts` beside a different lockfile would be a different
    // build. Compared against the pinned SHA, so this answers "did the provider
    // deliver the revision we asked for" without needing git metadata.
    const verified: string[] = [];
    const unverified: string[] = [];

    for (const path of BUILD_IDENTITY_FILES) {
      const inSandbox = await sandbox.readFile({
        path: inWorkspace(target.workspaceRoot, path),
        maxBytes: SANDBOX_BUDGETS.maxIntegrityFileBytes,
      });
      const atCommit = await manifest.getTextFile(
        inWorkspace(target.workspaceRoot, path),
        target.preparedCommitSha,
        SANDBOX_BUDGETS.maxIntegrityFileBytes,
      );

      // Absent on both sides is agreement, not a gap: most repositories have
      // only one lockfile and one next.config extension.
      if (inSandbox === null && atCommit === null) continue;

      // Absent on one side, or past the read budget, cannot be compared.
      // Recorded as unverified rather than quietly counted as verified.
      if (inSandbox === null || atCommit === null) {
        unverified.push(path);
        continue;
      }

      if (sha256(inSandbox) !== sha256(atCommit)) {
        return finish(
          "failed",
          "source_integrity_failed",
          `build identity mismatch against ${target.preparedCommitSha}: ${path}`,
        );
      }

      verified.push(path);
    }

    sourceIntegrity = {
      requestedRevision: target.preparedCommitSha,
      revisionMode: "provider_pinned",
      changedFilesVerified: target.preparedFiles.length > 0,
      buildIdentityFilesVerified: verified,
      buildIdentityFilesUnverified: unverified,
    };

    // ---- 4. Destroy any clone credential ---------------------------------
    // On this provider there is no `.git` to remove, so this is now defence in
    // depth rather than the primary control — and it is kept precisely because
    // that is a fact about *this* provider and image, not a guarantee. A future
    // provider that does leave a checkout would put a credential-bearing remote
    // on disk, and this step is what stops it reaching repository code (§7).
    await setStage("securing_sandbox");
    await sandbox.run({
      command: { command: "rm", args: ["-rf", inWorkspace(target.workspaceRoot, ".git")] },
      cwd: workdir,
      timeoutMs: SANDBOX_BUDGETS.sourceTimeoutMs,
    });

    // Verified, not assumed. If the credential store still exists, refuse to
    // run repository code at all rather than hope.
    const gitConfig = await sandbox.readFile({
      path: inWorkspace(target.workspaceRoot, ".git/config"),
      maxBytes: 4096,
    });
    if (gitConfig !== null) {
      return finish("failed", "credential_scrub_failed", "the git credential store survived removal");
    }

    // ---- 5. Read the manifest --------------------------------------------
    // Parsed in *our* process, not executed. This is what decides which steps
    // exist — never an opportunity's prose (§12).
    const manifestRaw = await sandbox.readFile({
      path: inWorkspace(target.workspaceRoot, "package.json"),
      maxBytes: SANDBOX_BUDGETS.maxIntegrityFileBytes,
    });
    if (manifestRaw === null) {
      return finish("failed", "validation_not_supported", `no package.json at ${target.workspaceRoot}`);
    }

    let scripts: string[] = [];
    try {
      const parsed = JSON.parse(manifestRaw) as { scripts?: Record<string, unknown> };
      scripts = Object.keys(parsed.scripts ?? {});
    } catch {
      return finish("failed", "validation_not_supported");
    }

    const lockfile = await sandbox.readFile({
      path: inWorkspace(target.workspaceRoot, LOCKFILES[target.packageManager]),
      maxBytes: 1024,
    });
    if (lockfile === null) {
      return finish("failed", "lockfile_missing", `expected ${LOCKFILES[target.packageManager]}`);
    }

    const plan = planValidationSteps({ packageManager: target.packageManager, scripts });

    // ---- 6. Install, under the narrowest useful network ------------------
    // GitHub is revoked here: the source is already on disk, so continued
    // access to it would be pure additional reach.
    await setStage("installing");
    await sandbox.applyNetworkPolicy({ mode: "allow_domains", domains: DEPENDENCY_HOSTS });

    const install = plan.find((entry) => entry.step === "install");
    if (!install || !install.run) return finish("failed", "validation_run_failed");

    const installResult = await sandbox.run({
      command: install.command,
      cwd: workdir,
      timeoutMs: SANDBOX_BUDGETS.installTimeoutMs,
    });
    steps.install = stepResult(install.command, installResult);

    if (steps.install.status !== "passed") {
      return finish("failed", installResult.timedOut ? "sandbox_timeout" : "validation_checks_failed");
    }

    // ---- 7. Close the network -------------------------------------------
    // Everything after this line is repository-controlled. `deny-all` blocks
    // DNS as well as traffic, closing the covert channel an allowlist leaves
    // open. Sandbox isolation protects Vibe's infrastructure; this protects
    // the customer's source from leaving (§10 Phase B).
    await sandbox.applyNetworkPolicy({ mode: "deny_all" });

    // ---- 8. The checks ---------------------------------------------------
    const stageFor: Record<string, ValidationStage> = {
      typecheck: "typechecking",
      test: "testing",
      build: "building",
    };

    for (const entry of plan) {
      if (entry.step === "install") continue;
      await setStage(stageFor[entry.step] ?? "building");

      if (!entry.run) {
        // A repository with no test script is not a repository that failed its
        // tests. Recorded as skipped, with why (§19).
        steps[entry.step] = skipped();
        continue;
      }

      const result = await sandbox.run({
        command: entry.command,
        cwd: workdir,
        timeoutMs: SANDBOX_BUDGETS.commandTimeoutMs,
      });
      const recorded = stepResult(entry.command, result);
      steps[entry.step] = recorded;

      if (recorded.status !== "passed") {
        if (result.timedOut) return finish("failed", "sandbox_timeout");
        if (entry.step === "build" && looksLikeMissingEnvironment(steps.build)) {
          return finish("failed", "build_failed_missing_environment");
        }
        return finish("failed", "validation_checks_failed");
      }
    }

    // The build is mandatory: "it builds" is the claim being made. A repository
    // with no build script cannot support that claim, so it is not validated.
    if (steps.build?.status !== "passed") {
      return finish("failed", "validation_not_supported");
    }

    await setStage("collecting_results");
    return finish("passed", null);
  } catch (error) {
    // Provider faults and unexpected errors land here. The value is untyped and
    // may carry provider prose, so only a sanitized, bounded description is
    // kept — enough to diagnose, never the raw object.
    return finish("failed", "validation_run_failed", describeError(error));
  }
}
