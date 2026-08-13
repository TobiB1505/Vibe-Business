import "server-only";

import { Sandbox, Snapshot, type Command } from "@vercel/sandbox";
import { SANDBOX_BUDGETS, SANDBOX_RESOURCES } from "../budgets";
import { sanitizeCommandOutput } from "../logs";
import type {
  CreateSandboxInput,
  SandboxArtifact,
  SandboxHandle,
  SandboxLiveness,
  SandboxNetworkPolicy,
  SandboxProcess,
  SandboxProvider,
  SandboxUsage,
} from "../sandbox-port";

/**
 * Vercel Sandbox adapter (Sprint 10A §2, ADR 0015).
 *
 * **The only file in the codebase that imports `@vercel/sandbox`.** Everything
 * above it speaks `SandboxProvider`, so the orchestrator's security sequence is
 * tested against a fake and the provider's vocabulary never leaks into the
 * domain (CLAUDE.md rule 21).
 *
 * Checked against the current Vercel Sandbox documentation at implementation
 * time rather than recalled — the SDK's defaults are load-bearing here and two
 * of them are actively dangerous for this use case:
 *
 *  - `networkPolicy` defaults to **`allow-all`**. Every creation below passes
 *    an explicit policy, so a sandbox never exists with open egress.
 *  - `persistent` defaults to **`true`**, which snapshots the filesystem on
 *    stop and restores it on the next run of the same name. For validation
 *    that would persist a customer's source and `node_modules` into Vercel
 *    storage and hand the next run a dirty tree. Forced to `false` (§24).
 *
 * Also relevant, and deliberately unused: `ports` (no preview in 10A, §43) and
 * `drives`/snapshots (no reuse across runs).
 */

/** Maps the domain's policy vocabulary onto the SDK's. */
function toProviderPolicy(policy: SandboxNetworkPolicy) {
  // `deny-all` blocks DNS resolution as well as egress, which is what makes it
  // meaningful against exfiltration rather than merely inconvenient.
  if (policy.mode === "deny_all") return "deny-all" as const;
  return { allow: [...policy.domains] };
}

/** Combined stdout+stderr, bounded before it ever reaches our memory (§15). */
async function readOutput(command: {
  stdout: () => Promise<string>;
  stderr: () => Promise<string>;
}): Promise<string> {
  const [stdout, stderr] = await Promise.all([command.stdout(), command.stderr()]);
  const combined = `${stdout}${stderr.length > 0 ? `\n${stderr}` : ""}`;

  return combined.length > SANDBOX_BUDGETS.maxCapturedOutputBytes
    ? combined.slice(-SANDBOX_BUDGETS.maxCapturedOutputBytes)
    : combined;
}

/**
 * A safe description of a thrown provider value.
 *
 * Never serialize the object. The Vercel SDK's `APIError` carries the whole
 * response, headers and raw response text alongside the useful fields. The
 * first capture-failure fix kept only `Error.name` and `Error.message`, which
 * turned the provider's HTTP 400 back into another generic constant.
 *
 * Read only three allowlisted scalars: HTTP status, `error.code`, and
 * `error.message` (with top-level `message` as a documented-shape fallback).
 * Each string is bounded and secret-redacted before it crosses this adapter.
 */
function safeProviderField(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;

  const sanitized = sanitizeCommandOutput(value).text.replace(/\s+/g, " ").trim();
  if (sanitized.length <= SANDBOX_BUDGETS.maxLineChars) return sanitized;
  return `${sanitized.slice(0, SANDBOX_BUDGETS.maxLineChars)}…[truncated]`;
}

function providerJsonError(value: unknown): { code: string | null; message: string | null } {
  if (typeof value !== "object" || value === null) return { code: null, message: null };

  const json = value as Record<string, unknown>;
  const nested =
    typeof json.error === "object" && json.error !== null
      ? (json.error as Record<string, unknown>)
      : null;

  return {
    code: safeProviderField(nested?.code),
    message: safeProviderField(nested?.message) ?? safeProviderField(json.message),
  };
}

function describeProviderError(error: unknown): string {
  if (error instanceof Error) {
    const shaped = error as Error & {
      response?: { status?: unknown };
      json?: unknown;
    };
    const status =
      typeof shaped.response?.status === "number" && Number.isInteger(shaped.response.status)
        ? shaped.response.status
        : null;
    const provider = providerJsonError(shaped.json);
    const facts = [
      status === null ? null : `HTTP ${status}`,
      provider.code === null ? null : `code=${provider.code}`,
      provider.message === null ? null : `message=${provider.message}`,
    ].filter((fact): fact is string => fact !== null);

    const name = safeProviderField(error.name) ?? "ProviderError";
    if (facts.length > 0) return `${name}: ${facts.join(" ")}`;

    const message = safeProviderField(error.message);
    return message ? `${name}: ${message}` : name;
  }
  return "the sandbox provider threw a non-error value";
}

class SanitizedSandboxProviderError extends Error {
  constructor(error: unknown) {
    super(describeProviderError(error));
    this.name = "SandboxProviderError";
  }
}

/**
 * Maps the provider's session status onto the domain's two-value liveness.
 *
 * Only `running` is usable. Everything else — `stopped`, `failed`, `aborted`,
 * and the in-between states `pending`, `stopping`, `snapshotting` — is `gone`,
 * because a phase step is about to run a command that assumes a filesystem
 * built by earlier phases. A sandbox that is merely *becoming* available is not
 * the sandbox that installed `node_modules`, and treating an ambiguous status
 * as usable is how a partial-state continuation gets reported as a pass (§12).
 */
function toLiveness(status: string | undefined): SandboxLiveness {
  return status === "running" ? "running" : "gone";
}

/**
 * A detached command, reduced to the one question the domain asks.
 *
 * `exitedWithin` is implemented by racing the SDK's `wait()` against an abort,
 * rather than by polling a command-status endpoint. The polling shape would
 * need `Sandbox.getCommand`, which the SDK marks internal — building a
 * security-relevant health classification on an internal API is how a minor
 * version bump becomes an outage.
 *
 * Aborting rather than leaving the promise pending matters: an un-aborted
 * `wait()` per poll would accumulate one live request per iteration for the
 * whole health budget.
 */
class VercelSandboxProcess implements SandboxProcess {
  constructor(private readonly command: Command) {}

  get id(): string {
    return this.command.cmdId;
  }

  async exitedWithin(withinMs: number): Promise<number | null> {
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), withinMs);

    try {
      const finished = await this.command.wait({ signal: controller.signal });
      return finished.exitCode;
    } catch {
      // Two cases resolve the same way, deliberately. An abort means "still
      // running", which is the answer the caller wants. Anything else means the
      // provider could not tell us, and reporting a fabricated exit code would
      // turn an observability gap into a false `preview_process_exited`.
      return null;
    } finally {
      clearTimeout(deadline);
    }
  }

  async output(): Promise<string> {
    try {
      return await readOutput(this.command);
    } catch {
      // A process whose output cannot be read is still a process. Diagnosis is
      // worth less than the classification it would otherwise take down.
      return "";
    }
  }
}

class VercelSandboxHandle implements SandboxHandle {
  /**
   * Usage captured at termination.
   *
   * `sandbox.snapshot()` shuts the sandbox down, so a later `stop()` would
   * throw and take the accounting with it. Capturing usage at the moment of
   * termination keeps the ledger whole either way.
   */
  private terminalUsage: SandboxUsage | null = null;

  constructor(
    private readonly sandbox: Sandbox,
    readonly id: string,
    readonly runtime: string,
    readonly liveness: SandboxLiveness,
  ) {}

  async run(input: {
    command: { command: string; args: string[] };
    cwd: string;
    timeoutMs: number;
  }) {
    // Per-command deadline. The sandbox's own timeout is a backstop for the
    // whole run; this stops one hanging command consuming the entire budget.
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), input.timeoutMs);
    const startedAt = Date.now();

    try {
      const result = await this.sandbox.runCommand({
        cmd: input.command.command,
        // Never a shell string: args stay a real array, so there is no place
        // for injection even if a value were ever attacker-influenced (§13).
        args: input.command.args,
        cwd: input.cwd,
        signal: controller.signal,
      });

      return {
        exitCode: result.exitCode,
        durationMs: result.durationMs ?? Date.now() - startedAt,
        output: await readOutput(result),
        timedOut: false,
      };
    } catch (error) {
      // An abort is a timeout; anything else is reported as a non-zero exit so
      // the orchestrator treats it as a failed step rather than crashing.
      //
      // The message is carried through rather than replaced with a placeholder.
      // A generic "[command could not be executed]" is what turned the fourth
      // dogfood run into another guess: the orchestrator had been taught to
      // explain itself, and this layer was still swallowing the one fact that
      // mattered. Callers sanitize and bound it like any other output.
      const timedOut = controller.signal.aborted;
      return {
        exitCode: timedOut ? -1 : 1,
        durationMs: Date.now() - startedAt,
        output: timedOut ? "[command exceeded its time budget]" : describeProviderError(error),
        timedOut,
      };
    } finally {
      clearTimeout(deadline);
    }
  }

  async runBackground(input: {
    command: { command: string; args: string[] };
    cwd: string;
    env?: Record<string, string>;
  }): Promise<SandboxProcess> {
    // The SDK's own detached primitive. Not `nohup`, not a backgrounding shell
    // string: those would need a shell line to manage the process, which is the
    // one place a command string could ever be assembled rather than passed as
    // an argument array.
    const command = await this.sandbox.runCommand({
      cmd: input.command.command,
      args: input.command.args,
      cwd: input.cwd,
      ...(input.env ? { env: input.env } : {}),
      detached: true,
    });

    return new VercelSandboxProcess(command);
  }

  async readFile(input: { path: string; maxBytes: number }): Promise<string | null> {
    try {
      const buffer = await this.sandbox.readFileToBuffer({ path: input.path });
      if (!buffer) return null;
      return buffer.subarray(0, input.maxBytes).toString("utf8");
    } catch {
      // A missing file is a legitimate answer (no lockfile, no `.git`), and the
      // caller distinguishes the cases. Never throw for absence.
      return null;
    }
  }

  async applyNetworkPolicy(policy: SandboxNetworkPolicy): Promise<void> {
    // Applies to the running session, which is what makes the two-phase
    // transition possible without a second sandbox.
    await this.sandbox.update({ networkPolicy: toProviderPolicy(policy) });
  }

  async snapshot(input: { expirationMs: number }): Promise<SandboxArtifact> {
    let snapshot: Awaited<ReturnType<Sandbox["snapshot"]>>;
    try {
      // Explicit expiry, never the provider's 30-day default — an unbounded
      // retention of a customer's filesystem is not a policy anyone chose.
      snapshot = await this.sandbox.snapshot({ expiration: input.expirationMs });
    } catch (error) {
      // `APIError` contains the actual provider classification, but also raw
      // response material. Convert it here, at the provider boundary: callers
      // receive enough to diagnose the 400 without receiving headers, request
      // context, raw JSON/text or a credential-bearing cause object.
      throw new SanitizedSandboxProviderError(error);
    }

    // The sandbox is now unreachable, so read what it measured before losing it.
    this.terminalUsage = {
      activeCpuDurationMs: this.sandbox.totalActiveCpuDurationMs ?? null,
      networkIngressBytes: this.sandbox.totalIngressBytes ?? null,
      networkEgressBytes: this.sandbox.totalEgressBytes ?? null,
      costUsd: null,
    };

    return {
      snapshotId: snapshot.snapshotId,
      sizeBytes: snapshot.sizeBytes ?? null,
      expiresAt: snapshot.expiresAt ? snapshot.expiresAt.toISOString() : null,
    };
  }

  async publicOrigin(port: number): Promise<string> {
    // Derived by the provider. Vibe never assembles a preview host from parts,
    // because a guessed origin is a guessed trust boundary.
    return this.sandbox.domain(port);
  }

  async stop(): Promise<SandboxUsage> {
    // Already terminated by a snapshot: report, do not re-stop.
    if (this.terminalUsage) return this.terminalUsage;

    const result = await this.sandbox.stop();

    return {
      activeCpuDurationMs: result.activeCpuDurationMs ?? null,
      networkIngressBytes: result.networkTransfer?.ingress ?? null,
      networkEgressBytes: result.networkTransfer?.egress ?? null,
      // Vercel meters Active CPU, provisioned memory, creations and egress, but
      // exposes no per-sandbox billed amount. Deriving one from public rates
      // would be a guess presented as an accounting figure, so it stays null
      // and the measured inputs are stored instead (§25).
      costUsd: null,
    };
  }
}

export function createVercelSandboxProvider(): SandboxProvider {
  return {
    id: "vercel_sandbox",

    async create(input: CreateSandboxInput): Promise<SandboxHandle> {
      // Shared across both source kinds. `persistent: false` stays: a sandbox
      // must never snapshot *itself* on stop. Artifacts are captured
      // explicitly, only after a validation has actually succeeded and the
      // credential scrub has been re-verified (Sprint 10B §5).
      const common = {
        name: input.name,
        resources: { vcpus: input.vcpus ?? SANDBOX_RESOURCES.vcpus },
        timeout: input.timeoutMs,
        networkPolicy: toProviderPolicy(input.networkPolicy),
        env: input.env,
        persistent: false,
        ...(input.ports && input.ports.length > 0 ? { ports: [...input.ports] } : {}),
      };

      // A snapshot carries its own image, and the SDK's types refuse the
      // combination — restoring a validated artifact must not re-image it,
      // because then it would not be the validated artifact.
      const sandbox =
        input.source.kind === "snapshot"
          ? await Sandbox.create({
              ...common,
              source: { type: "snapshot", snapshotId: input.source.snapshotId },
            })
          : await Sandbox.create({
              ...common,
              image: SANDBOX_RESOURCES.image,
              source: {
                type: "git",
                url: input.source.repositoryUrl,
                // The exact prepared commit, never a branch (§6).
                revision: input.source.revision,
                // A shallow clone: validation needs the tree, not the history.
                depth: 1,
                ...(input.source.credential
                  ? {
                      username: input.source.credential.username,
                      password: input.source.credential.password,
                    }
                  : {}),
              },
            });

      // Reassert the lifetime against the running session. The provider
      // accepted `timeout` on create during dogfood but the session still died
      // at its five-minute default, immediately before artifact capture. The
      // SDK's update path compares the requested sandbox timeout with the live
      // session timeout and extends that session when it is shorter. Keeping
      // the create option as well means the VM is bounded from its first
      // instant; this second call verifies/enforces the same chosen bound.
      await sandbox.update({ timeout: input.timeoutMs });

      // Freshly created, so liveness is not in question — and asserting it here
      // would turn a provider quirk in the status field into a failure to run
      // at all. Reconnection is where liveness is a real question.
      return new VercelSandboxHandle(
        sandbox,
        sandbox.name,
        sandbox.runtime ?? SANDBOX_RESOURCES.image,
        "running",
      );
    },

    async reconnect(input: { name: string }): Promise<SandboxHandle | null> {
      try {
        const sandbox = await Sandbox.get({
          name: input.name,
          // A third SDK default that is wrong for this use case, alongside
          // `networkPolicy` and `persistent`.
          //
          // `resume` defaults to **true**, which restores a stopped session —
          // potentially from a snapshot. For validation that is the worst
          // possible outcome: the next phase would silently continue on a
          // filesystem that is not the one the previous phase built, and report
          // a verdict about a tree that never existed. We want the opposite —
          // observe that it is gone and refuse.
          //
          // The status check below is not redundant with this. It is a second,
          // independent defence: `resume: false` states the intent to the
          // provider, and the status assertion holds even if a future SDK
          // version reinterprets it.
          resume: false,
        });

        const liveness = toLiveness(sandbox.status);
        if (liveness === "gone") return null;

        return new VercelSandboxHandle(
          sandbox,
          sandbox.name,
          sandbox.runtime ?? SANDBOX_RESOURCES.image,
          liveness,
        );
      } catch {
        // Not found is the ordinary answer here — an expired sandbox is a
        // normal outcome, not an exception the caller should have to classify.
        // Every other provider fault resolves the same way on purpose: a
        // reconnect that cannot be confirmed must never be treated as success,
        // because the next thing the caller does is run a command that assumes
        // a filesystem.
        return null;
      }
    },

    async inspect(input: { name: string }): Promise<string | null> {
      try {
        const sandbox = await Sandbox.get({ name: input.name, resume: false });

        // Status and timeout together, because they answer different halves of
        // the same question. A `stopped` session whose timeout reads 300000 ms
        // means the lifetime we asked for never took effect; one that reads
        // 900000 ms means it did and something else ended the session.
        const facts = [
          `status=${safeProviderField(sandbox.status) ?? "unknown"}`,
          sandbox.timeout === undefined ? null : `timeout=${sandbox.timeout}`,
        ].filter((fact): fact is string => fact !== null);

        return facts.join(" ");
      } catch (error) {
        // The sandbox is not merely unusable, it cannot be described. That is
        // itself the finding — "no longer exists" and "the provider refused to
        // say" are different failures.
        return describeProviderError(error);
      }
    },
    async deleteArtifact(snapshotId: string): Promise<void> {
      // Reported rather than swallowed. A snapshot that cannot be deleted still
      // expires on the explicit TTL it was created with, so the failure is
      // never fatal — but the caller has to *know* in order to record
      // `artifact_delete_failed` and leave the cleanup retryable. Swallowing it
      // here would make "the customer's filesystem is gone" a claim nothing in
      // the system could contradict.
      //
      // A snapshot that no longer exists is a success: `Snapshot.get` is the
      // idempotence point, because deletion's recovery path is retry.
      let snapshot: Snapshot;
      try {
        snapshot = await Snapshot.get({ snapshotId });
      } catch {
        return;
      }

      await snapshot.delete();
    },
  };
}
