import { describeThrown } from "@/lib/errors/describe";
import { describeCommand, installCommand } from "@/modules/validation/commands";
import { sanitizeCommandOutput } from "@/modules/validation/logs";
import { inSandbox } from "@/modules/validation/orchestrator";
import {
  DEPENDENCY_HOSTS,
  SOURCE_HOSTS,
  type SandboxHandle,
  type SandboxProcess,
  type SandboxProvider,
  type SandboxUsage,
} from "@/modules/validation/sandbox-port";
import { PREVIEW_BUDGETS, PREVIEW_RESOURCES } from "./budgets";
import {
  healthyStatusCode,
  parseProbeStatus,
  previewHealthProbeCommand,
  previewServerCommand,
} from "./commands";
import { previewSandboxNameFor } from "./identity";
import type { SupportedPackageManager } from "@/modules/validation/schema";
import type { PreviewCleanupStatus, PreviewFailureCode } from "./schema";

/**
 * One preview session, phase by phase (Sprint 10B-2 §9–§17; Sprint 0114).
 *
 * This file is the security boundary of the preview, the way
 * `validation/orchestrator.ts` is of a validation run. Everything above it
 * decides *whether* a preview may start; everything below it is a provider
 * adapter.
 *
 * ## The sequence, and why each step is where it is
 *
 * ```
 * 1. clone the pinned commit   GitHub only, one inbound port, no secrets
 * 2. prove it is that commit   the provider's word is not the answer
 * 3. destroy the credential    and verify its absence, before any repo code
 * 4. install                   registry reachable, and only here
 * 5. close the network         deny-all, before the first repository command
 * 6. start the dev server      ← the first repository-controlled code
 * 7. health check              answered, or classified as why not
 * ```
 *
 * Steps 2–5 all happen **before** the application starts. By the time
 * `next dev` runs someone else's JavaScript on a public URL, the commit has
 * been proved to be the one Vibe prepared, the clone credential has been proved
 * gone, and the network has been proved shut.
 *
 * ## What changed in Sprint 0114, and why
 *
 * This used to restore the filesystem snapshot a *passing* validation captured.
 * That made a preview strictly later than validation — and validation's last
 * step is the build, so a person waited roughly five minutes to look at code
 * that had been written before the wait began.
 *
 * A development server needs no build, so a preview can now be offered as soon
 * as a change is prepared and run *alongside* validation instead of after it.
 * The cost of that is stated rather than hidden: what runs here is the prepared
 * code, not the validated artifact, and nothing in this module or above it may
 * describe it as validated (ADR 0064).
 *
 * The whole ValidatedArtifact mechanism goes with it — capture, restore,
 * integrity re-verification, deletion, and a customer's built filesystem
 * sitting in provider storage for 24 hours. There is no longer anything that
 * needs it.
 *
 * ## What is deliberately absent
 *
 * No typecheck, no test, no build — `modules/validation` answers whether the
 * change is sound and remains the only thing that does. No Repository
 * Intelligence. No model call of any kind. No second acquisition path: the
 * clone is the one, it uses a credential minted for it alone, and that
 * credential is destroyed before anything from the repository executes.
 *
 * ## Network direction is two decisions, not one
 *
 * Confirmed against the current Vercel firewall documentation rather than
 * assumed: the network policy governs **egress**. `deny-all` denies outbound
 * traffic including DNS; exposed ports are a separate, inbound concern with
 * their own routes.
 *
 * So a preview is inbound-public on exactly one port and outbound-restricted,
 * and those are independent settings rather than a compromise between them.
 * Egress is open to GitHub while cloning and to the registry while installing,
 * and to nothing at all from the moment repository code can run (rule 81).
 */

export type PreviewTarget = {
  previewSessionId: string;
  /** The commit Vibe prepared and verified. Never a branch, never client-supplied. */
  preparedCommitSha: string;
  repositoryUrl: string;
  /**
   * Short-lived, single-purpose, destroyed in phase 3. Never persisted.
   *
   * Only provisioning has any use for it. Every later phase reconnects without
   * one, because by then there is nothing left to authenticate to (rule 63).
   */
  cloneCredential: { username: string; password: string } | null;
  packageManager: SupportedPackageManager;
  /**
   * The directory the provider clones into, relative to the sandbox home.
   *
   * Vercel materializes a git source at `/vercel/sandbox/<repo>/`, not at
   * `/vercel/sandbox` — taken from the repository name on the server, never
   * guessed inside the sandbox. The same fact validation records.
   */
  sourceRoot: string;
  workspaceRoot: string;
};

/**
 * Environment for every command in a preview sandbox (§12).
 *
 * The complete list, and it is the validation list minus nothing and plus
 * nothing. Three variables, none of which grants anything.
 *
 * Deliberately absent, and asserted absent by tests rather than merely omitted
 * here: Supabase service role, Anthropic key, GitHub App private key or
 * installation token, Browserbase key, Vercel management token, and the
 * customer's own production configuration.
 *
 * An application that cannot start without configuration fails as
 * `preview_missing_environment`. That is an honest statement about the change,
 * not a reason to hand a public-facing untrusted server a credential — and
 * preview-safe environment configuration is a later capability, not a gap to
 * route around now (ADR 0015 §5).
 */
export const PREVIEW_ENVIRONMENT: Readonly<Record<string, string>> = Object.freeze({
  CI: "1",
  /*
   * `development`, not `production` — and this is a real difference, not a
   * detail (Sprint 0114).
   *
   * A development server *is* a development environment: React runs its
   * development build, warnings appear, and an application that branches on
   * `NODE_ENV` takes the other branch. Forcing `production` here would not undo
   * any of that; it would only produce a Next.js warning about a non-standard
   * value and an application whose two halves disagree about which environment
   * they are in.
   *
   * So it says what is true. What follows from it — that a preview is not
   * evidence about production behaviour — is the product's to state, and
   * `modules/validation` is what actually answers that question.
   */
  NODE_ENV: "development",
  NEXT_TELEMETRY_DISABLED: "1",
});

/**
 * Environment variable names that must never exist in a preview runtime.
 *
 * Matched as a prefix set against the constructed environment, so a future
 * variable in one of these families is caught by the check rather than by
 * whoever reviews the diff. This is a check on **Vibe's own** construction: if
 * it ever fires, the defect is here, not in the customer's repository — which
 * is why it has its own failure code (§12).
 */
export const PRIVILEGED_ENVIRONMENT_PREFIXES: readonly string[] = [
  "GITHUB_",
  "GH_",
  "ANTHROPIC_",
  "SUPABASE_",
  "NEXT_PUBLIC_SUPABASE_",
  "VERCEL_",
  "BROWSERBASE_",
  "AWS_",
  "OPENAI_",
];

/** Deterministic markers that a server failed for want of configuration. */
const MISSING_ENVIRONMENT_MARKERS: readonly RegExp[] = [
  /missing (?:required )?environment variable/i,
  /environment variable ["'`]?[A-Z][A-Z0-9_]{2,}["'`]? is (?:not set|required|missing)/i,
  /invalid environment variables/i,
];



function detail(text: string | null): string | null {
  return text === null ? null : sanitizeCommandOutput(text).text;
}

/**
 * Reconnects to this session's preview sandbox, or reports it gone.
 *
 * The name is recomputed from the session id, never carried across a step
 * boundary, so nothing about the sandbox is persisted anywhere — not a handle,
 * not a capability URL, not an opaque provider id (ADR 0015 §10).
 */
async function attach(
  provider: SandboxProvider,
  target: { previewSessionId: string },
): Promise<SandboxHandle | null> {
  let sandbox: SandboxHandle | null = null;
  try {
    sandbox = await provider.reconnect({ name: previewSandboxNameFor(target.previewSessionId) });
  } catch {
    return null;
  }

  if (!sandbox) return null;
  // The adapter already refuses a non-running sandbox and the domain refuses
  // one too. A liveness rule enforced in one layer is a rule a provider swap
  // silently drops.
  if (sandbox.liveness !== "running") return null;
  return sandbox;
}

// ---------------------------------------------------------------------------
// Phase 1 — acquire the source and install, before any repository code runs
// ---------------------------------------------------------------------------

export type ProvisionPreviewOutcome =
  | { ok: true; sandboxId: string; runtime: string }
  | { ok: false; failureCode: PreviewFailureCode; failureDetail: string | null };

/**
 * Creates the sandbox, proves the commit, destroys the credential, installs.
 *
 * Everything security-relevant is passed at creation, so the VM never exists
 * under weaker settings for even a moment:
 *
 *  - egress limited to GitHub, which is all a clone needs;
 *  - exactly one inbound port, Vibe's, and a different direction from the line
 *    above — `ports` can only be set here, so this is where the decision to
 *    serve publicly is actually made;
 *  - the preview environment, which holds no privilege;
 *  - the TTL as the provider's own timeout, so the VM stops even if Vibe never
 *    runs again.
 *
 * Re-entry is safe and is what makes the durable step idempotent: a replay
 * finds the sandbox already answering to the deterministic name and adopts it
 * rather than creating a second paid VM.
 *
 * ## Why the credential is destroyed here rather than trusted to expire
 *
 * Because short expiry is not a security boundary (rule 63). The clone
 * credential exists for one command; the moment the source is on disk it is
 * pure additional reach, and everything after this point is repository-
 * controlled. Its absence is *verified*, not assumed — a scrub that silently
 * failed would leave a token in a VM that is about to serve a public port.
 */
export async function provisionPreviewWorkspace(
  provider: SandboxProvider,
  target: PreviewTarget,
  environment: Readonly<Record<string, string>> = PREVIEW_ENVIRONMENT,
): Promise<ProvisionPreviewOutcome> {
  // Vibe's own environment construction, checked before anything is created.
  // Ordered first because it needs no provider call: a defect here should not
  // cost a sandbox to discover.
  const privileged = Object.keys(environment).filter((name) =>
    PRIVILEGED_ENVIRONMENT_PREFIXES.some((prefix) => name.startsWith(prefix)),
  );
  if (privileged.length > 0) {
    return {
      ok: false,
      failureCode: "preview_privileged_environment",
      // Names only. A value here would be the exact secret being refused.
      failureDetail: detail(`privileged variables present: ${privileged.sort().join(", ")}`),
    };
  }

  const sandbox = (await attach(provider, target)) ?? (await create(provider, target, environment));
  if (!("liveness" in sandbox)) return sandbox;

  const workdir = inSandbox(target.sourceRoot, target.workspaceRoot);

  try {
    /*
     * The provider cloned a revision; this proves it cloned *that* revision.
     * Validation asks the same question of the same commit for the same reason:
     * a preview of the wrong bytes on a public URL is worse than no preview.
     */
    const head = await sandbox.run({
      command: { command: "git", args: ["rev-parse", "HEAD"] },
      cwd: workdir,
      timeoutMs: PREVIEW_BUDGETS.sourceTimeoutMs,
    });
    const observed = head.output.trim().split(/\s+/).pop() ?? "";
    if (head.exitCode !== 0 || observed !== target.preparedCommitSha) {
      return {
        ok: false,
        failureCode: "preview_source_unavailable",
        failureDetail: detail(
          head.exitCode === 0
            ? `expected ${target.preparedCommitSha}, found ${observed}`
            : "the prepared commit could not be resolved",
        ),
      };
    }

    /*
     * On this provider there is no `.git` to remove, so this is defence in
     * depth rather than the primary control — and it is kept precisely because
     * that is a fact about *this* provider and image, not a guarantee. A future
     * provider that does leave a checkout would put a credential-bearing remote
     * on disk, and this is what stops it reaching repository code.
     */
    await sandbox.run({
      command: { command: "rm", args: ["-rf", ".git"] },
      cwd: workdir,
      timeoutMs: PREVIEW_BUDGETS.sourceTimeoutMs,
    });

    const gitConfig = await sandbox.readFile({
      path: inSandbox(target.sourceRoot, target.workspaceRoot, ".git/config"),
      maxBytes: 4096,
    });
    if (gitConfig !== null) {
      return {
        ok: false,
        failureCode: "preview_credential_scrub_failed",
        failureDetail: detail("the git credential store survived removal"),
      };
    }

    // GitHub is revoked here: the source is already on disk, so continued
    // access to it would be pure additional reach.
    await sandbox.applyNetworkPolicy({ mode: "allow_domains", domains: DEPENDENCY_HOSTS });

    const install = await sandbox.run({
      command: installCommand(target.packageManager),
      cwd: workdir,
      timeoutMs: PREVIEW_BUDGETS.installTimeoutMs,
    });

    /*
     * Closed regardless of how the install ended. A failed install is not a
     * reason to leave the registry reachable for whatever runs next, and the
     * failure path is exactly where "we'll close it later" turns into "we
     * didn't". `deny-all` blocks DNS as well as traffic, closing the covert
     * channel an allowlist leaves open (rule 81).
     */
    await sandbox.applyNetworkPolicy({ mode: "deny_all" });

    if (install.exitCode !== 0) {
      return {
        ok: false,
        failureCode: "preview_install_failed",
        failureDetail: detail(sanitizeCommandOutput(install.output).text),
      };
    }

    return { ok: true, sandboxId: sandbox.id, runtime: sandbox.runtime };
  } catch (error) {
    return { ok: false, failureCode: "preview_failed", failureDetail: detail(describeThrown(error)) };
  }
}

/** The create half, split out so the happy path above reads as one sequence. */
async function create(
  provider: SandboxProvider,
  target: PreviewTarget,
  environment: Readonly<Record<string, string>>,
): Promise<SandboxHandle | { ok: false; failureCode: PreviewFailureCode; failureDetail: string | null }> {
  try {
    return await provider.create({
      name: previewSandboxNameFor(target.previewSessionId),
      source: {
        kind: "git",
        repositoryUrl: target.repositoryUrl,
        revision: target.preparedCommitSha,
        credential: target.cloneCredential,
      },
      // Outbound, and only what a clone needs. Narrowed twice below, never
      // widened.
      networkPolicy: { mode: "allow_domains", domains: SOURCE_HOSTS },
      // Inbound. Exactly one, settable only here, and the whole reason this
      // sandbox is separate from validation's.
      ports: [PREVIEW_BUDGETS.port],
      timeoutMs: PREVIEW_BUDGETS.ttlMs,
      env: { ...environment },
      vcpus: PREVIEW_RESOURCES.vcpus,
    });
  } catch (error) {
    return {
      ok: false,
      failureCode: "preview_provider_unavailable",
      failureDetail: detail(describeThrown(error)),
    };
  }
}

// ---------------------------------------------------------------------------
// Phase 3 — start the server and prove it answers
// ---------------------------------------------------------------------------

export type StartOutcome =
  | {
      ok: true;
      /** Provider-derived, never assembled, never persisted (§16). */
      origin: string;
      port: number;
      runtime: string;
    }
  | { ok: false; failureCode: PreviewFailureCode; failureDetail: string | null };

/**
 * A clock the tests can stand still, so a 90-second budget costs no seconds.
 *
 * Only `exitedWithin` waits, and it is already the provider's concern, so there
 * is no separate sleep to inject — the poll interval *is* the wait. This exists
 * for the deadline comparison alone.
 */
export type PreviewClock = { now(): number };

const SYSTEM_CLOCK: PreviewClock = { now: () => Date.now() };

/**
 * Starts the production server and health-checks it (§14, §15, §17).
 *
 * ## Why the server start and the health check share one step
 *
 * A detached process handle cannot cross a durable step boundary: serializing
 * one would put provider connection material into a third-party log, and
 * re-deriving one on the far side needs an SDK method marked internal. So the
 * process is started and watched in the same invocation, and re-entry is made
 * safe by a property that needs no handle at all — **if the port already
 * answers, the work is done**. A replay therefore never starts a second server.
 *
 * ## The four classifications, kept apart on purpose
 *
 * ```
 * process exited            the application crashed; its own output says why
 * probe never succeeded     started, never answered inside the budget
 * probe answered 5xx        the application is up and erroring
 * no route for the port     the provider, not the application
 * ```
 *
 * Collapsing these into "preview failed" is what makes a failure unactionable.
 * A user whose build has a missing env var and a user whose provider had no
 * capacity need completely different sentences.
 */
export async function startPreviewServer(
  provider: SandboxProvider,
  target: PreviewTarget,
  options: { clock?: PreviewClock } = {},
): Promise<StartOutcome> {
  const clock = options.clock ?? SYSTEM_CLOCK;

  const sandbox = await attach(provider, target);
  if (!sandbox) {
    return {
      ok: false,
      failureCode: "preview_provider_unavailable",
      failureDetail: detail("the preview environment was no longer available"),
    };
  }

  const workdir = inSandbox(target.sourceRoot, target.workspaceRoot);

  try {
    // Re-entry check, and the reason no process handle needs to be persisted.
    // A previous attempt that started the server and then died leaves a port
    // that answers; starting a second server would race the first for the bind.
    const already = await probe(sandbox, workdir);
    if (already.kind === "healthy") {
      return resolveOrigin(sandbox);
    }

    let server: SandboxProcess;
    try {
      server = await sandbox.runBackground({
        command: previewServerCommand(),
        cwd: workdir,
        // No additional environment. The sandbox's own is the whole story, and
        // a per-command override would be a second place a secret could enter.
      });
    } catch (error) {
      return {
        ok: false,
        failureCode: "preview_start_failed",
        failureDetail: detail(describeThrown(error)),
      };
    }

    const deadline = clock.now() + PREVIEW_BUDGETS.healthCheckBudgetMs;
    // Bounded by attempts *as well as* by the clock, and the second bound is
    // not belt-and-braces. The loop's only delay is the provider's
    // `exitedWithin`; a provider that returns instantly — an error path, a
    // degraded control plane, a future adapter that cannot wait — turns this
    // into a busy loop that hammers the provider's per-minute quota for a
    // minute and a half. A fake that returns instantly found it first.
    const maxAttempts = Math.ceil(
      PREVIEW_BUDGETS.healthCheckBudgetMs / PREVIEW_BUDGETS.healthPollIntervalMs,
    );

    for (let attempt = 0; attempt < maxAttempts && clock.now() < deadline; attempt += 1) {
      // Doubles as the poll delay. A server that exits on boot is classified
      // within one interval rather than after the whole budget.
      const exitCode = await server.exitedWithin(PREVIEW_BUDGETS.healthPollIntervalMs);

      if (exitCode !== null) {
        const output = sanitizeCommandOutput(await server.output());
        const missingEnvironment = MISSING_ENVIRONMENT_MARKERS.some((marker) =>
          marker.test(output.text),
        );

        return {
          ok: false,
          // A deterministically identifiable missing-configuration failure is a
          // different thing from a crash, and the user can act on exactly one
          // of them.
          failureCode: missingEnvironment ? "preview_missing_environment" : "preview_process_exited",
          failureDetail: detail(
            `${describeCommand(previewServerCommand())} exited with code ${exitCode}\n${output.text}`,
          ),
        };
      }

      const attempt = await probe(sandbox, workdir);
      if (attempt.kind === "healthy") return resolveOrigin(sandbox);
      if (attempt.kind === "application_error") {
        return {
          ok: false,
          failureCode: "preview_health_check_failed",
          failureDetail: detail(`the application answered with HTTP ${attempt.statusCode}`),
        };
      }
    }

    return {
      ok: false,
      failureCode: "preview_health_check_failed",
      failureDetail: detail(
        `the server did not answer on port ${PREVIEW_BUDGETS.port} within ` +
          `${Math.round(PREVIEW_BUDGETS.healthCheckBudgetMs / 1000)}s`,
      ),
    };
  } catch (error) {
    return { ok: false, failureCode: "preview_failed", failureDetail: detail(describeThrown(error)) };
  }
}

type ProbeResult =
  | { kind: "healthy"; statusCode: number }
  | { kind: "application_error"; statusCode: number }
  | { kind: "no_answer" };

/** One bounded loopback request. Never a crawl, never a body (§17). */
async function probe(sandbox: SandboxHandle, cwd: string): Promise<ProbeResult> {
  const result = await sandbox.run({
    command: previewHealthProbeCommand(),
    cwd,
    timeoutMs: PREVIEW_BUDGETS.healthProbeTimeoutMs,
  });

  if (result.exitCode !== 0) return { kind: "no_answer" };

  const statusCode = parseProbeStatus(result.output);
  if (statusCode === null) return { kind: "no_answer" };

  return healthyStatusCode(statusCode)
    ? { kind: "healthy", statusCode }
    : { kind: "application_error", statusCode };
}

/**
 * Asks the provider for the port's public origin.
 *
 * A failure here is the provider's, not the application's: the server is
 * demonstrably answering, and what is missing is the route. Classified as such
 * so the user is not told their change is broken.
 */
async function resolveOrigin(sandbox: SandboxHandle): Promise<StartOutcome> {
  try {
    const origin = await sandbox.publicOrigin(PREVIEW_BUDGETS.port);
    return { ok: true, origin, port: PREVIEW_BUDGETS.port, runtime: sandbox.runtime };
  } catch (error) {
    return {
      ok: false,
      failureCode: "preview_provider_unavailable",
      failureDetail: detail(describeThrown(error)),
    };
  }
}

/**
 * The preview's public origin, for an authorized read (§16).
 *
 * Fetched on demand rather than persisted. A preview URL is capability-like —
 * an unlisted public address of a VM serving untrusted code — and the cheapest
 * way to guarantee it is never leaked from the database, an audit event, an AI
 * evidence pack or an analytics payload is for the database never to hold it.
 *
 * Returns null when the sandbox is gone, which is also the honest answer to
 * "where can I see this preview?" once it has stopped.
 */
export async function resolvePreviewOrigin(
  provider: SandboxProvider,
  target: { previewSessionId: string },
): Promise<string | null> {
  const sandbox = await attach(provider, target);
  if (!sandbox) return null;

  try {
    return await sandbox.publicOrigin(PREVIEW_BUDGETS.port);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Phase 4 — teardown
// ---------------------------------------------------------------------------

export type PreviewTeardown = {
  cleanup: PreviewCleanupStatus;
  usage: SandboxUsage | null;
  runtime: string | null;
  /** Whether the ValidatedArtifact snapshot is now gone. Retryable when false. */
  artifactDeleted: boolean;
};

/**
 * Stops the preview and deletes the artifact it restored from (§19, §24).
 *
 * ## Why the snapshot goes at the end of the preview
 *
 * A ValidatedArtifact is a customer's built filesystem sitting in a third
 * party's storage. It exists for one reason — so a preview can start from the
 * exact validated bytes — and once that preview has ended, keeping it would be
 * paying a provider to retain customer data for a purpose that no longer
 * exists. The provider-minimum 24-hour TTL is the backstop for the cases where
 * deletion cannot be confirmed, not the plan.
 *
 * The consequence is deliberate and is stated in the product rather than
 * hidden: a future preview of the same change will usually need an explicit
 * re-validation, and that spend is the user's to authorize. Silently
 * re-validating on their behalf would be exactly the kind of invisible cost
 * this codebase refuses (CLAUDE.md rule 60).
 *
 * ## What is not deleted
 *
 * The ValidationRun and the PreparedChange. The run stays historically
 * `passed` and the change stays historically `prepared` — deleting the artifact
 * removes the ability to preview again without re-validating, and nothing else.
 * Conflating artifact availability with validation history would rewrite the
 * past to tidy up storage (§20).
 *
 * ## Idempotent by construction
 *
 * "Already gone" is a success on both halves. Stopping a stopped sandbox and
 * deleting a deleted snapshot are the outcomes this function exists to produce,
 * so calling it twice produces one logical result and no error.
 */
export async function teardownPreview(
  provider: SandboxProvider,
  // Narrower than a full `PreviewTarget` on purpose: teardown needs a name to
  // reconnect with, and — for a v1 session — a snapshot to delete. Asking for
  // the repository as well would invite a caller to believe cleanup depends on
  // it, and cleanup must work when nothing else does.
  target: { previewSessionId: string; snapshotId: string | null },
  options: { deleteArtifact: boolean },
): Promise<PreviewTeardown> {
  let sandbox: SandboxHandle | null = null;
  try {
    sandbox = await provider.reconnect({ name: previewSandboxNameFor(target.previewSessionId) });
  } catch {
    sandbox = null;
  }

  let cleanup: PreviewCleanupStatus;
  let usage: SandboxUsage | null = null;
  let runtime: string | null = null;

  if (!sandbox) {
    // Never created, already stopped, or expired at the provider's own timeout.
    // All three mean no VM is running, which is what cleanup exists to produce.
    cleanup = "not_provisioned";
  } else {
    runtime = sandbox.runtime;
    try {
      usage = await sandbox.stop();
      cleanup = "stopped";
    } catch {
      // Recorded for observability, never allowed to overwrite the preview's
      // own result: a failed stop does not make a working preview broken.
      cleanup = "stop_failed";
    }
  }

  /*
   * `snapshotId === null` is the normal case from Sprint 0114 onward: a preview
   * clones rather than restoring, so there is no artifact to delete. A v1
   * session still carries one and still has it deleted.
   */
  if (!options.deleteArtifact || target.snapshotId === null) {
    return { cleanup, usage, runtime, artifactDeleted: false };
  }

  const snapshotId = target.snapshotId;
  let artifactDeleted = true;
  try {
    await provider.deleteArtifact(snapshotId);
  } catch {
    artifactDeleted = false;
    // Deliberately does not overwrite a `stop_failed`: the sandbox is the thing
    // that costs money by the minute, so its status is the one worth reporting
    // when both went wrong.
    if (cleanup !== "stop_failed") cleanup = "artifact_delete_failed";
  }

  return { cleanup, usage, runtime, artifactDeleted };
}
