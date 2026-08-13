import "server-only";

import { Sandbox } from "@vercel/sandbox";
import { SANDBOX_BUDGETS, SANDBOX_RESOURCES } from "../budgets";
import type {
  CreateSandboxInput,
  SandboxHandle,
  SandboxLiveness,
  SandboxNetworkPolicy,
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
 * Name and message only. The object itself can carry request context, headers
 * and occasionally credentials, so it is never stored or logged whole — but
 * refusing to record *anything* is how a failure becomes undiagnosable.
 */
function describeProviderError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return "the sandbox provider threw a non-error value";
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

class VercelSandboxHandle implements SandboxHandle {
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

  async stop(): Promise<SandboxUsage> {
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
      const sandbox = await Sandbox.create({
        name: input.name,
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
        image: SANDBOX_RESOURCES.image,
        resources: { vcpus: SANDBOX_RESOURCES.vcpus },
        timeout: input.timeoutMs,
        networkPolicy: toProviderPolicy(input.networkPolicy),
        env: input.env,
        // See the file comment: persistence is the SDK default and must not be.
        persistent: false,
      });

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
  };
}
