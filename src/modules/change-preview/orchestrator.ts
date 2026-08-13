import { createHash } from "node:crypto";
import { describeCommand } from "@/modules/validation/commands";
import { sanitizeCommandOutput } from "@/modules/validation/logs";
import { inSandbox } from "@/modules/validation/orchestrator";
import type {
  SandboxHandle,
  SandboxProcess,
  SandboxProvider,
  SandboxUsage,
} from "@/modules/validation/sandbox-port";
import { PREVIEW_BUDGETS, PREVIEW_RESOURCES } from "./budgets";
import {
  healthyStatusCode,
  parseProbeStatus,
  previewHealthProbeCommand,
  previewServerCommand,
} from "./commands";
import { previewSandboxNameFor } from "./identity";
import type { PreviewCleanupStatus, PreviewFailureCode } from "./schema";

/**
 * One preview session, phase by phase (Sprint 10B-2 §9–§17).
 *
 * This file is the security boundary of the sprint, the way
 * `validation/orchestrator.ts` was of 10A. Everything above it decides
 * *whether* a preview may start; everything below it is a provider adapter.
 *
 * ## The sequence, and why each step is where it is
 *
 * ```
 * 1. restore from snapshot     egress deny-all, one inbound port, no secrets
 * 2. re-verify file hashes     the restored tree is the validated tree
 * 3. re-verify .git absence    a snapshot could have carried a credential back
 * 4. re-verify env             no Vibe privilege reached the preview runtime
 * 5. start the server          ← the first repository-controlled code
 * 6. health check              answered, or classified as why not
 * ```
 *
 * Steps 2–4 all happen **before** the application starts. That is the point:
 * by the time `next start` runs someone else's JavaScript on a public URL, the
 * bytes have been proved to be the validated bytes and the environment has been
 * proved to hold nothing of value.
 *
 * ## What is deliberately absent
 *
 * No clone. No GitHub token. No `main`, no branch, no fetch. No install, no
 * typecheck, no test, no build — all four already ran, and re-running them
 * would mean the artifact was not trusted, which would mean there was no point
 * capturing it. No Repository Intelligence. No model call of any kind.
 *
 * The only source is `ValidatedArtifact.snapshotId`, resolved server-side from
 * a row the user owns. There is no code path that searches for a recent
 * sandbox, resumes an arbitrary stopped one, or rebuilds when the snapshot is
 * missing — a hidden rebuild would be a *different* artifact wearing the
 * validated one's name (§9).
 *
 * ## Network direction is two decisions, not one
 *
 * Confirmed against the current Vercel firewall documentation rather than
 * assumed: the network policy governs **egress**. `deny-all` denies outbound
 * traffic including DNS; exposed ports are a separate, inbound concern with
 * their own routes.
 *
 * So a preview is inbound-public on exactly one port and outbound-denied, and
 * those are independent settings rather than a compromise between them. "The
 * preview needs the internet to be reachable" is a confusion between the two
 * directions, and it is not a reason to widen egress for a server whose job is
 * to render an already-built application (§13).
 */

export type PreviewTarget = {
  previewSessionId: string;
  /** Resolved from the owned ValidatedArtifact. Never client-supplied (§9). */
  snapshotId: string;
  /** Directory the provider cloned into during validation, preserved in the snapshot. */
  sourceRoot: string;
  workspaceRoot: string;
  /** Path + sha256 of every file Vibe prepared, re-checked after restore (§11). */
  preparedFiles: readonly { path: string; contentHash: string }[];
  /**
   * Build-identity files and their digests as recorded at validation time.
   *
   * Compared against the restored filesystem. Never re-fetched from GitHub:
   * preview must not acquire a source, and a second acquisition path would be a
   * second credential (§9).
   */
  buildIdentityFiles: readonly { path: string; contentHash: string }[];
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
  NODE_ENV: "production",
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

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * A safe description of an unknown thrown value.
 *
 * Provider errors can carry request context, headers and occasionally
 * credentials, so the object is never stored. Its name and message are, after
 * the same sanitizer the validation step output goes through — the difference
 * between "we refuse to look" and "we cannot find out" (ADR 0015 §9).
 */
function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return "non-error value thrown";
}

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
// Phase 1 — restore the artifact
// ---------------------------------------------------------------------------

export type RestoreOutcome =
  | { ok: true; sandboxId: string; runtime: string }
  | { ok: false; failureCode: PreviewFailureCode; failureDetail: string | null };

/**
 * Creates a fresh sandbox from exactly the validated snapshot (§9).
 *
 * Everything security-relevant is passed at creation, so the VM never exists
 * under weaker settings for even a moment:
 *
 *  - `deny_all` egress, from the first instant;
 *  - exactly one inbound port, Vibe's;
 *  - the preview environment, which holds no privilege;
 *  - the TTL as the provider's own timeout, so the VM stops even if Vibe never
 *    runs again (§18).
 *
 * Re-entry is safe and is what makes the durable step idempotent: a replay
 * finds the sandbox already answering to the deterministic name and adopts it
 * rather than creating a second paid VM.
 */
export async function restoreValidatedArtifact(
  provider: SandboxProvider,
  target: PreviewTarget,
): Promise<RestoreOutcome> {
  const existing = await attach(provider, target);
  if (existing) return { ok: true, sandboxId: existing.id, runtime: existing.runtime };

  try {
    const sandbox = await provider.create({
      name: previewSandboxNameFor(target.previewSessionId),
      source: { kind: "snapshot", snapshotId: target.snapshotId },
      // Outbound. Closed before the restored filesystem exists, and never
      // reopened: nothing a preview does legitimately requires egress.
      networkPolicy: { mode: "deny_all" },
      // Inbound. Exactly one, and a different direction from the line above.
      ports: [PREVIEW_BUDGETS.port],
      timeoutMs: PREVIEW_BUDGETS.ttlMs,
      env: { ...PREVIEW_ENVIRONMENT },
      vcpus: PREVIEW_RESOURCES.vcpus,
    });

    return { ok: true, sandboxId: sandbox.id, runtime: sandbox.runtime };
  } catch (error) {
    // Includes the case where the snapshot no longer exists provider-side. The
    // application already refused an expired or deleted artifact before
    // spending anything; this is the residual race, and the answer is still to
    // fail rather than to acquire the source some other way (§10).
    return {
      ok: false,
      failureCode: "preview_provider_unavailable",
      failureDetail: detail(describeError(error)),
    };
  }
}

// ---------------------------------------------------------------------------
// Phase 2 — prove the restored artifact is the validated artifact
// ---------------------------------------------------------------------------

export type IntegrityOutcome =
  | { ok: true; runtime: string }
  | { ok: false; failureCode: PreviewFailureCode; failureDetail: string | null };

/**
 * Re-verifies the restored filesystem before any application code runs (§11).
 *
 * ## Why this is not redundant with validation
 *
 * Validation proved that *a* filesystem contained the prepared change. This
 * proves that the filesystem which came back out of provider storage is that
 * same one. Between the two there is a snapshot, a storage system, and a
 * restore — three things Vibe does not implement — and a preview that skipped
 * this would be serving a public URL on the strength of a provider's word.
 *
 * It is deliberately **not** a re-validation. No install, no typecheck, no
 * test, no build: those establish that the code works, which is already
 * settled, and re-running them would be spending minutes to re-answer a
 * question whose answer is the reason we are here.
 *
 * ## The credential check is the important one
 *
 * A snapshot is a filesystem image. If a `.git` with a credential-bearing
 * remote ever survived into one, restoring it would put that credential in a
 * VM that is about to serve a public port. Capture re-verified its absence
 * before snapshotting (Sprint 10B-1); this verifies it again after restoring,
 * because the two checks are separated by everything above.
 */
export async function verifyRestoredArtifact(
  provider: SandboxProvider,
  target: PreviewTarget,
  environment: Readonly<Record<string, string>> = PREVIEW_ENVIRONMENT,
): Promise<IntegrityOutcome> {
  // Vibe's own environment construction, checked before anything is started.
  // Ordered first because it needs no provider call: a defect here should not
  // cost a reconnect to discover.
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

  const sandbox = await attach(provider, target);
  if (!sandbox) {
    return {
      ok: false,
      failureCode: "preview_provider_unavailable",
      failureDetail: detail("the preview environment was no longer available"),
    };
  }

  const fail = (failureDetail: string): IntegrityOutcome => ({
    ok: false,
    failureCode: "preview_artifact_integrity_failed",
    failureDetail: detail(failureDetail),
  });

  try {
    // A credential-bearing git store must not survive a restore. Checked before
    // the file hashes, because a credential present is a refusal regardless of
    // whether the rest of the tree is perfect.
    const gitConfig = await sandbox.readFile({
      path: inSandbox(target.sourceRoot, target.workspaceRoot, ".git/config"),
      maxBytes: 4096,
    });
    if (gitConfig !== null) {
      return fail("a git credential store was present in the restored artifact");
    }

    for (const file of target.preparedFiles.slice(0, PREVIEW_BUDGETS.maxIntegrityFiles)) {
      const content = await sandbox.readFile({
        path: inSandbox(target.sourceRoot, target.workspaceRoot, file.path),
        maxBytes: PREVIEW_BUDGETS.maxIntegrityFileBytes,
      });

      if (content === null) return fail(`prepared file missing after restore: ${file.path}`);
      if (sha256(content) !== file.contentHash) {
        return fail(`content hash mismatch after restore: ${file.path}`);
      }
    }

    // Build identity, compared against what validation recorded rather than
    // against GitHub. Preview acquires no source and holds no credential, so
    // the recorded digest is the only honest reference — and it is the right
    // one: the question is whether the artifact changed in storage, not whether
    // the repository has moved on since.
    for (const file of target.buildIdentityFiles) {
      const content = await sandbox.readFile({
        path: inSandbox(target.sourceRoot, target.workspaceRoot, file.path),
        maxBytes: PREVIEW_BUDGETS.maxBuildIdentityFileBytes,
      });

      if (content === null) return fail(`build identity file missing after restore: ${file.path}`);
      if (sha256(content) !== file.contentHash) {
        return fail(`build identity mismatch after restore: ${file.path}`);
      }
    }

    return { ok: true, runtime: sandbox.runtime };
  } catch (error) {
    return {
      ok: false,
      failureCode: "preview_failed",
      failureDetail: detail(describeError(error)),
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
        failureDetail: detail(describeError(error)),
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
    return { ok: false, failureCode: "preview_failed", failureDetail: detail(describeError(error)) };
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
      failureDetail: detail(describeError(error)),
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
  // reconnect with and a snapshot to delete. Asking for the integrity manifest
  // as well would invite a caller to believe cleanup depends on it.
  target: { previewSessionId: string; snapshotId: string },
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

  if (!options.deleteArtifact) {
    return { cleanup, usage, runtime, artifactDeleted: false };
  }

  let artifactDeleted = true;
  try {
    await provider.deleteArtifact(target.snapshotId);
  } catch {
    artifactDeleted = false;
    // Deliberately does not overwrite a `stop_failed`: the sandbox is the thing
    // that costs money by the minute, so its status is the one worth reporting
    // when both went wrong.
    if (cleanup !== "stop_failed") cleanup = "artifact_delete_failed";
  }

  return { cleanup, usage, runtime, artifactDeleted };
}
