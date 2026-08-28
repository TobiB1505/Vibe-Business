import type { RepositoryIntelligenceSnapshot } from "@/modules/repository-intelligence/schema";
import {
  buildSatisfiesProfile,
  provisionSandbox,
  runCheckPhase,
  stopSandbox,
  verifySource,
  type CleanupStatus,
  type SourceManifestPort,
  type ValidationTarget,
} from "./orchestrator";
import type {
  SourceIntegrity,
  ValidationFailureCode,
  ValidationStepName,
  ValidationStepResult,
} from "./schema";
import type {
  CreateSandboxInput,
  SandboxHandle,
  SandboxLiveness,
  SandboxNetworkPolicy,
  SandboxProvider,
  SandboxUsage,
} from "./sandbox-port";

/**
 * A sandbox provider that executes nothing (Sprint 10A §39).
 *
 * Every normal test runs against this. `pnpm test` must never provision a real
 * microVM: it would cost money, need credentials CI does not have, and make
 * the suite depend on npm's uptime.
 *
 * More importantly, this fake is what makes the *security* properties testable
 * at all. It records the full ordered transcript — creation input, every
 * network-policy transition, every command, every file read — so assertions
 * like "the network was closed before repository code ran" and "no secret was
 * ever in the environment" are checks against a recording rather than a
 * reading of the source.
 */

export type FakeEvent =
  | { kind: "create"; input: CreateSandboxInput }
  | { kind: "reconnect"; name: string; found: boolean }
  | { kind: "policy"; policy: SandboxNetworkPolicy }
  /**
   * `env` is recorded because its *absence* is the assertion.
   *
   * Validation passes none, and a test that could not see that would not
   * notice the day something started passing one. The agent runtime passes
   * exactly one thing — a scoped gateway token — and the same visibility is
   * what proves no provider key travels with it.
   */
  | { kind: "command"; command: string; cwd: string; env?: Record<string, string> }
  | { kind: "read"; path: string }
  | { kind: "snapshot"; expirationMs: number }
  | { kind: "origin"; port: number }
  | { kind: "delete_artifact"; snapshotId: string }
  /**
   * `env` is recorded for the same reason it is on `command`: its contents are
   * the assertion. The agent harness is started detached and is handed exactly
   * one thing — a scoped gateway token — and a fake that could not show that
   * would not notice the day a provider key travelled with it.
   */
  | { kind: "background"; command: string; cwd: string; env?: Record<string, string> }
  | { kind: "inspect"; name: string }
  | { kind: "stop" };

export type FakeSandboxOptions = {
  /** Files the sandbox "contains", keyed by path. */
  files?: Record<string, string>;
  /** Per-command results, matched by the full command string. */
  results?: Record<string, { exitCode?: number; output?: string; timedOut?: boolean }>;
  /** Default for any command with no entry in `results`. */
  defaultExitCode?: number;
  /** Make `Sandbox.create` throw, for the provider-unavailable path. */
  failCreate?: boolean;
  /** Make `stop()` throw, for the cleanup-failure path. */
  failStop?: boolean;
  /** Throw on this exact command, for the unexpected-provider-error path. */
  throwOn?: string;
  /**
   * Paths `rm -rf .git` cannot remove.
   *
   * Drives the credential-scrub failure path, which is otherwise unreachable
   * because the fake genuinely deletes. `rm -f` reports success whether or not
   * it removed anything, so the orchestrator verifies rather than assumes — and
   * that verification needs a case where the file survives.
   */
  unremovablePaths?: readonly string[];
  /** Make artifact capture fail, for the snapshot-failure path. */
  failSnapshot?: boolean;
  /** The snapshot id the fake hands back. */
  snapshotId?: string;
  usage?: Partial<SandboxUsage>;
  /**
   * Make the sandbox vanish before the Nth reconnect (1-based).
   *
   * Models the failure the durable-phase design has to survive: the VM expired,
   * or the provider stopped it, between two steps. `node_modules` went with it,
   * so the only correct answer is `sandbox_lost` — never a replacement sandbox
   * and a continuation on a different filesystem (§12, §22).
   */
  loseSandboxBeforeReconnect?: number;
  /** Reconnect reports a live sandbox whose session is no longer running. */
  reconnectLiveness?: SandboxLiveness;

  // -------------------------------------------------------------------------
  // Preview (Sprint 10B-2). Modelled rather than stubbed, because the security
  // properties under test are *sequences*: the server must not start before the
  // integrity check, and the port must not be exposed before either.
  // -------------------------------------------------------------------------

  /** Make `runBackground` throw, for the server-could-not-start path. */
  failBackground?: boolean;
  /**
   * Exit code the detached server reports, or undefined to keep running.
   *
   * A number here models a crash-on-boot: `exitedWithin` answers immediately
   * instead of timing out, which is what lets the health loop distinguish
   * `preview_process_exited` from `preview_health_check_failed`.
   */
  backgroundExitCode?: number;
  /** What the detached process printed. Read only when it exits. */
  backgroundOutput?: string;
  /**
   * HTTP status the loopback probe reports, or null to make the probe fail.
   *
   * Defaults to 200. A `null` models a server that is up but not yet
   * answering — the probe exits non-zero, exactly as `curl` would.
   */
  healthStatus?: number | null;
  /** Probes that fail before `healthStatus` starts being returned. */
  healthFailingProbes?: number;
  /** Make `publicOrigin` throw, for the provider-has-no-route path. */
  failPublicOrigin?: boolean;
  /** Make `deleteArtifact` throw, for the cleanup-failure path. */
  failDeleteArtifact?: boolean;
  /** What `inspect` reports about an unusable sandbox. */
  inspectDetail?: string | null;
};

export type FakeSandboxProvider = SandboxProvider & {
  readonly events: FakeEvent[];
  /** Ordered command strings — the transcript most assertions care about. */
  commands(): string[];
  /** Ordered network policies, starting with the creation policy. */
  policies(): SandboxNetworkPolicy[];
  createdWith(): CreateSandboxInput | null;
  stopped(): boolean;
  /**
   * How many sandboxes were created across the whole run.
   *
   * The single most important assertion in the durable-phase design: one
   * ValidationRun must produce exactly one sandbox, however many steps it takes
   * (§23). A second creation means install ran against a filesystem the build
   * never saw.
   */
  createCount(): number;
  /** Names passed to `reconnect`, in order. */
  reconnects(): string[];
  snapshots(): number;
  deletedArtifacts(): string[];
  /** Ordered detached commands. Exactly one server, or the test has found a bug. */
  backgroundCommands(): string[];
  /** Ports the sandbox was created with. Exactly one, and Vibe's (§16, §31). */
  exposedPorts(): readonly number[];
  /** Origins handed out, for asserting the URL is never assembled by Vibe. */
  origins(): number[];
};

export function fakeSandboxProvider(options: FakeSandboxOptions = {}): FakeSandboxProvider {
  const events: FakeEvent[] = [];
  const files = { ...(options.files ?? {}) };
  let stopCount = 0;

  /*
   * Modification order, so `find -newer` means something.
   *
   * The agent runtime establishes what a run changed by planting a marker and
   * asking the filesystem what is newer than it. A fake with no notion of
   * "when" could only stub that answer — and the property under test is exactly
   * that Vibe reads the change back off the filesystem rather than believing
   * what the agent said it wrote. A monotonic counter is enough: nothing here
   * needs real clocks, only ordering.
   */
  let clock = 0;
  const writtenAt = new Map<string, number>();
  const touch = (path: string) => {
    clock += 1;
    writtenAt.set(path, clock);
  };
  for (const path of Object.keys(files)) touch(path);

  let createCount = 0;
  let reconnectCount = 0;
  let snapshotCount = 0;
  let probeCount = 0;
  let backgroundCount = 0;
  let terminated = false;
  const deletedArtifacts: string[] = [];

  /**
   * `find`, over the fake's own filesystem.
   *
   * Only the shape the agent runtime builds is understood: prune a few
   * directories, take regular files, print paths relative to the walk root, and
   * optionally restrict to what is newer than a marker. Enough to make the
   * change-discovery path real rather than stubbed, and narrow enough that a
   * command this does not recognise falls through to the configured results.
   */
  function runFind(command: string, cwd: string): string {
    const prefix = cwd === "." || cwd === "" ? "" : `${cwd}/`;
    const pruned = [...command.matchAll(/-name (\S+)/g)].map((match) => match[1]);
    const newer = /-newer (\S+)/.exec(command);
    const since = newer ? (writtenAt.get(newer[1]) ?? 0) : 0;

    const matched = Object.keys(files)
      .filter((path) => path.startsWith(prefix))
      .map((path) => path.slice(prefix.length))
      .filter((path) => path.length > 0 && !path.startsWith("/"))
      .filter((path) => !pruned.some((name) => path.split("/").includes(name)))
      .filter((path) => (writtenAt.get(`${prefix}${path}`) ?? 0) > since)
      .sort();

    // NUL-delimited, matching what `find -printf '%P\0'` emits and what
    // `parsePaths` splits on (VB-029). A newline is a legal character in a
    // filename, so it was never a safe delimiter.
    return matched.map((path) => `${path}\0`).join("");
  }

  const handle: SandboxHandle = {
    id: "sandbox_1",
    runtime: "vercel/sandbox/node:24",
    liveness: "running",

    async run(input) {
      const rendered = [input.command.command, ...input.command.args].join(" ");
      events.push({
        kind: "command",
        command: rendered,
        cwd: input.cwd,
        ...(input.env ? { env: input.env } : {}),
      });

      if (options.throwOn === rendered) throw new Error("provider exploded");

      // The loopback health probe, modelled as `curl` actually behaves: a
      // non-zero exit when nothing answers, and the status code on stdout when
      // something does. Keyed on the command rather than stubbed by name so a
      // test that changes the probe changes what the fake responds to.
      if (input.command.command === "curl") {
        // Nothing is listening until something is started. Modelling this is
        // the point: a fake whose port answered on a fresh sandbox would let
        // the re-entry short-circuit swallow the server start entirely, and
        // "exactly one server was started" would pass while none was.
        if (backgroundCount === 0) {
          return { exitCode: 7, durationMs: 5, output: "", timedOut: false };
        }

        probeCount += 1;
        const stillWarming = probeCount <= (options.healthFailingProbes ?? 0);
        const status = options.healthStatus === undefined ? 200 : options.healthStatus;

        if (stillWarming || status === null) {
          return { exitCode: 7, durationMs: 5, output: "", timedOut: false };
        }
        return { exitCode: 0, durationMs: 5, output: String(status), timedOut: false };
      }

      // Removing `.git` is a real mutation in the fake too, so the credential
      // scrub is verified against actual state rather than a hardcoded answer.
      // Removing `.git` is a real mutation in the fake too, so the credential
      // scrub is verified against actual state rather than a hardcoded answer.
      // Matched against the path actually removed, because the provider clones
      // into a subdirectory and an unprefixed match would delete nothing while
      // reporting success.
      // Resolved against the command's cwd, like a real shell. Modelling this
      // is the point: `rm -rf <repo>/.git` run from inside `<repo>` targets a
      // path that does not exist, and `-f` reports success while the real
      // `.git` survives. A fake that ignored cwd would have hidden that.
      /*
       * Workspace writes and deletes, as real mutations to the fake's
       * filesystem (EXECUTION CORE-4 §27).
       *
       * Modelled rather than stubbed, for the same reason `rm -rf .git` is:
       * the property under test is that Vibe reads the change *back off the
       * filesystem* rather than believing what the agent said it wrote. A fake
       * that acknowledged writes without performing them would make that
       * distinction invisible — extraction would find nothing and the test
       * would pass for the wrong reason.
       *
       * Matched against the exact shape `sandbox-workspace.ts` produces: a
       * quoted here-document piped into `base64 -d`, which is how content
       * reaches the filesystem without ever appearing on a command line.
       */
      const resolve = (path: string) =>
        input.cwd === "." || input.cwd === "" ? path : `${input.cwd}/${path}`;

      if (input.command.command === "sh" && input.command.args[0] === "-c") {
        const script = input.command.args[1] ?? "";
        const write = /^base64 -d > '(.+)' <<'VIBE_EOF'\n([\s\S]*)\nVIBE_EOF$/.exec(script);
        if (write) {
          const written = resolve(write[1]);
          files[written] = Buffer.from(write[2], "base64").toString("utf8");
          touch(written);
          return { exitCode: 0, durationMs: 5, output: "", timedOut: false };
        }

        /*
         * Every other script is refused, the way a real `sh` refuses one.
         *
         * This fake used to model a redirect (`find … > '<path>'`) with a regex
         * that never looked at the command in front of it. That is how the
         * first real agent run died: the baseline listing was built by joining
         * tokens written for an *argument array*, so `(` and `)` reached `sh -c`
         * unquoted, `find` never ran — and the fake, which parsed the redirect
         * and ignored the rest, reported success.
         *
         * A fake that accepts shell it cannot parse is not modelling a shell.
         * Vibe has exactly one legitimate `sh -c` shape, the here-document
         * above; anything else is either a quoting bug or a new construct that
         * must be modelled here before it can be relied on in a sandbox.
         */
        const stray = /[()<>|&;$`*?]/.exec(script);
        return stray
          ? {
              exitCode: 2,
              durationMs: 5,
              output: `sh: 1: Syntax error: "${stray[0]}" unexpected`,
              timedOut: false,
            }
          : { exitCode: 127, durationMs: 5, output: "sh: 1: not found", timedOut: false };
      }

      if (
        input.command.command === "rm" &&
        input.command.args[0] === "-f" &&
        input.command.args[1] === "--"
      ) {
        delete files[resolve(input.command.args[2] ?? "")];
        return { exitCode: 0, durationMs: 5, output: "", timedOut: false };
      }

      if (input.command.command === "mkdir") {
        return { exitCode: 0, durationMs: 5, output: "", timedOut: false };
      }

      // `touch -- <path>`: the change marker. Creates the file and stamps it.
      if (input.command.command === "touch") {
        const path = input.command.args.at(-1) ?? "";
        files[path] = "";
        touch(path);
        return { exitCode: 0, durationMs: 5, output: "", timedOut: false };
      }

      if (
        input.command.command === "find" &&
        options.results?.[rendered] === undefined &&
        // A configured default still wins: a test that says "every command
        // fails" is testing the walk-failed path, and a `find` that quietly
        // succeeded would take that path away from it.
        (options.defaultExitCode ?? 0) === 0
      ) {
        return {
          exitCode: 0,
          durationMs: 5,
          output: runFind(rendered, input.cwd),
          timedOut: false,
        };
      }

      const argument = input.command.args.at(-1) ?? "";
      if (input.command.command === "rm" && argument.endsWith(".git")) {
        const removed = argument.startsWith("/") || input.cwd === "." || input.cwd === ""
          ? argument
          : `${input.cwd}/${argument}`;

        for (const path of Object.keys(files)) {
          if (path !== removed && !path.startsWith(`${removed}/`)) continue;
          // A path the removal cannot reach, modelling the failure the scrub
          // exists for: `rm -f` reports success whether or not it removed
          // anything, so "the credential store is gone" must be *verified*
          // rather than inferred from an exit code (Sprint 10A §7).
          if (options.unremovablePaths?.includes(path)) continue;
          delete files[path];
        }
      }

      const configured = options.results?.[rendered];
      return {
        exitCode: configured?.exitCode ?? options.defaultExitCode ?? 0,
        durationMs: 10,
        output: configured?.output ?? "",
        timedOut: configured?.timedOut ?? false,
      };
    },

    async readFile(input) {
      events.push({ kind: "read", path: input.path });
      return files[input.path] ?? null;
    },

    async applyNetworkPolicy(policy) {
      events.push({ kind: "policy", policy });
    },

    async snapshot(input) {
      snapshotCount += 1;
      events.push({ kind: "snapshot", expirationMs: input.expirationMs });
      if (options.failSnapshot) throw new Error("snapshot failed");

      // The real provider terminates the sandbox here, so the fake does too:
      // a later `stop()` must still report usage rather than throw, and a test
      // that let the fake stay alive would not prove that.
      terminated = true;
      return {
        snapshotId: options.snapshotId ?? "snap_fake_1",
        sizeBytes: 1024,
        expiresAt: new Date(Date.now() + input.expirationMs).toISOString(),
      };
    },

    async runBackground(input) {
      const rendered = [input.command.command, ...input.command.args].join(" ");
      events.push({
        kind: "background",
        command: rendered,
        cwd: input.cwd,
        ...(input.env ? { env: input.env } : {}),
      });

      if (options.failBackground) throw new Error("could not start process");
      backgroundCount += 1;

      return {
        id: "cmd_fake_1",
        async exitedWithin() {
          // `undefined` means the process is still running, which is what the
          // health loop treats as "keep probing". A number is a crash.
          return options.backgroundExitCode ?? null;
        },
        async output() {
          return options.backgroundOutput ?? "";
        },
      };
    },

    async publicOrigin(port) {
      events.push({ kind: "origin", port });
      if (options.failPublicOrigin) throw new Error("no route for port");
      return `https://sandbox-${port}.example.invalid`;
    },

    async stop() {
      stopCount += 1;
      events.push({ kind: "stop" });
      // Terminated by a snapshot: report, never re-stop.
      if (terminated) {
        return {
          activeCpuDurationMs: options.usage?.activeCpuDurationMs ?? 1234,
          networkIngressBytes: options.usage?.networkIngressBytes ?? 5000,
          networkEgressBytes: options.usage?.networkEgressBytes ?? 10,
          costUsd: options.usage?.costUsd ?? null,
        };
      }
      if (options.failStop) throw new Error("stop failed");

      return {
        activeCpuDurationMs: options.usage?.activeCpuDurationMs ?? 1234,
        networkIngressBytes: options.usage?.networkIngressBytes ?? 5000,
        networkEgressBytes: options.usage?.networkEgressBytes ?? 10,
        costUsd: options.usage?.costUsd ?? null,
      };
    },
  };

  return {
    id: "vercel_sandbox",
    events,

    async create(input) {
      events.push({ kind: "create", input });
      if (options.failCreate) throw new Error("no capacity");
      createCount += 1;
      return handle;
    },

    async inspect(input) {
      events.push({ kind: "inspect", name: input.name });
      if (options.inspectDetail !== undefined) return options.inspectDetail;
      // Mirrors the adapter's shape, so a test asserting on a diagnosis is
      // asserting on something the real provider could actually return.
      return stopCount > 0 ? "status=stopped timeout=900000" : "status=running timeout=900000";
    },

    async deleteArtifact(snapshotId) {
      events.push({ kind: "delete_artifact", snapshotId });
      // Thrown rather than swallowed, matching the adapter: the caller has to
      // be able to record `artifact_delete_failed` and retry.
      if (options.failDeleteArtifact) throw new Error("snapshot could not be deleted");
      deletedArtifacts.push(snapshotId);
    },

    async reconnect(input) {
      reconnectCount += 1;

      // The sandbox is gone from this reconnect onwards, not just for one call:
      // a VM that expired stays expired, and a fake that healed itself would
      // let a "create a replacement and carry on" bug pass.
      const lost =
        options.loseSandboxBeforeReconnect !== undefined &&
        reconnectCount >= options.loseSandboxBeforeReconnect;

      // A stopped sandbox does not answer to its name any more. Modelling this
      // is not pedantry: the first real capture failure stopped the sandbox on
      // its way out, and the cleanup step that followed reconnected to nothing
      // and recorded a 326-second run as `not_provisioned` with null usage. A
      // fake that kept answering after `stop()` let that pass every test.
      if (lost || createCount === 0 || stopCount > 0) {
        events.push({ kind: "reconnect", name: input.name, found: false });
        return null;
      }

      events.push({ kind: "reconnect", name: input.name, found: true });

      const liveness = options.reconnectLiveness ?? "running";
      // A non-running session is reported as such rather than swallowed here,
      // so the domain's own liveness check is the thing under test.
      return liveness === "running" ? handle : { ...handle, liveness };
    },

    commands() {
      return events.filter((event) => event.kind === "command").map((event) => event.command);
    },

    policies() {
      const created = events.find((event) => event.kind === "create");
      const applied = events.filter((event) => event.kind === "policy").map((event) => event.policy);
      return created ? [created.input.networkPolicy, ...applied] : applied;
    },

    createdWith() {
      const created = events.find((event) => event.kind === "create");
      return created ? created.input : null;
    },

    stopped() {
      return stopCount > 0;
    },

    createCount() {
      return createCount;
    },

    snapshots() {
      return snapshotCount;
    },

    deletedArtifacts() {
      return [...deletedArtifacts];
    },

    reconnects() {
      return events.filter((event) => event.kind === "reconnect").map((event) => event.name);
    },

    backgroundCommands() {
      return events.filter((event) => event.kind === "background").map((event) => event.command);
    },

    exposedPorts() {
      const created = events.find((event) => event.kind === "create");
      return created?.input.ports ?? [];
    },

    origins() {
      return events.filter((event) => event.kind === "origin").map((event) => event.port);
    },
  };
}

export const FIXTURE_COMMIT_SHA = "2f05958e3410deaeb97029861abc05889139b4a7";

/**
 * A sandbox whose filesystem describes a healthy single-app Next.js project.
 *
 * Tests break exactly one thing from here, which is the same discipline the
 * Sprint 9 preflight tests use: a refusal is only proven by the case where it
 * fires.
 */
export function healthySandboxFiles(
  overrides: Record<string, string | null> = {},
): Record<string, string> {
  const files: Record<string, string> = {
    // Keyed the way the provider lays them out: inside the clone directory.
    "product/package.json": JSON.stringify({
      name: "product",
      scripts: { build: "next build", test: "vitest run", typecheck: "tsc --noEmit" },
    }),
    "product/pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
    "product/.git/config": "[remote \"origin\"]\n\turl = https://x-access-token:ghs_secret@github.com/acme/product.git\n",
  };

  for (const [path, content] of Object.entries(overrides)) {
    if (content === null) delete files[path];
    else files[path] = content;
  }

  return files;
}

export function fakeValidationTarget(overrides: Partial<ValidationTarget> = {}): ValidationTarget {
  return {
    preparedChangeId: "prepared_1",
    preparedCommitSha: FIXTURE_COMMIT_SHA,
    repositoryUrl: "https://github.com/acme/product.git",
    cloneCredential: { username: "x-access-token", password: "ghs_cloneTokenValue123456" },
    profile: "nextjs_node_v1",
    packageManager: "pnpm",
    sourceRoot: "product",
    workspaceRoot: ".",
    preparedFiles: [],
    validationRunId: "11111111-2222-3333-4444-555555555555",
    ...overrides,
  };
}

export type AggregatedValidationOutcome = {
  status: "passed" | "failed";
  failureCode: ValidationFailureCode | null;
  failureDetail: string | null;
  steps: Partial<Record<ValidationStepName, ValidationStepResult>>;
  sourceIntegrity: SourceIntegrity | null;
  cleanup: CleanupStatus;
  usage: Awaited<ReturnType<typeof stopSandbox>>["usage"];
  sandboxRuntime: string | null;
};

/** The phase order, mirroring the durable workflow. */
const PHASES: readonly ValidationStepName[] = ["install", "typecheck", "test", "build"];

/**
 * Drives one whole validation through the real phase functions.
 *
 * ## Why a driver and not a call to a single function
 *
 * There is no longer a single function to call: each phase is entered
 * independently from its own durable step. This helper is the *test's* stand-in
 * for that orchestration — it provisions, verifies, runs each phase in order,
 * fails fast, and always cleans up, exactly as the workflow does.
 *
 * What it deliberately does **not** do is short-circuit the seam under test.
 * Every phase goes through `provider.reconnect()` just as it does in
 * production, so assertions about ordering, network transitions and sandbox
 * reuse are made against the same code path a real run takes — and a phase that
 * forgot to reconnect, or that quietly created a second sandbox, fails here.
 *
 * The durable ordering itself is *not* proven by this helper. It is proven
 * against the real workflow in `change-validation/execution.test.ts`, because a
 * driver that agreed with a mistaken workflow would prove nothing.
 */
export async function runValidationPhases(
  provider: SandboxProvider,
  manifest: SourceManifestPort,
  target: ValidationTarget,
): Promise<AggregatedValidationOutcome> {
  const steps: Partial<Record<ValidationStepName, ValidationStepResult>> = {};
  let failureCode: ValidationFailureCode | null = null;
  let failureDetail: string | null = null;
  let sourceIntegrity: SourceIntegrity | null = null;

  const provisioned = await provisionSandbox(provider, target);
  if (!provisioned.ok) {
    failureCode = provisioned.failureCode;
    failureDetail = provisioned.failureDetail;
  }

  if (failureCode === null) {
    const verified = await verifySource(provider, manifest, target);
    sourceIntegrity = verified.ok ? verified.sourceIntegrity : verified.sourceIntegrity;
    if (!verified.ok) {
      failureCode = verified.failureCode;
      failureDetail = verified.failureDetail;
    }
  }

  if (failureCode === null) {
    for (const phase of PHASES) {
      const outcome = await runCheckPhase(provider, target, phase);
      if (outcome.step) steps[phase] = outcome.step;
      if (!outcome.ok) {
        failureCode = outcome.failureCode;
        failureDetail = outcome.failureDetail;
        break;
      }
    }
  }

  // The build gate, applied where the finalize step applies it: a pipeline that
  // ran to the end without a passing build has not established the claim.
  if (failureCode === null && !buildSatisfiesProfile(steps)) {
    failureCode = "validation_not_supported";
  }

  const cleanup = await stopSandbox(provider, target);

  return {
    status: failureCode === null ? "passed" : "failed",
    failureCode,
    failureDetail,
    steps,
    sourceIntegrity,
    cleanup: cleanup.cleanup,
    usage: cleanup.usage,
    sandboxRuntime: cleanup.runtime,
  };
}

/** A snapshot describing a repository the profile resolver should accept. */
export function fakeValidatableSnapshot(
  overrides: {
    frameworks?: { id: string; name: string }[];
    packageManager?: string;
    monorepo?: { detected?: boolean; ambiguous?: boolean };
  } = {},
): RepositoryIntelligenceSnapshot {
  const frameworks = overrides.frameworks ?? [{ id: "nextjs", name: "Next.js" }];

  return {
    schemaVersion: "repository_intelligence.v1",
    source: { branch: "main", commitSha: FIXTURE_COMMIT_SHA, treeComplete: true, analyzerVersion: "repo-intelligence-v2" },
    repository: { private: false, fullName: "acme/product", defaultBranch: "main" },
    packageManager: overrides.packageManager ?? "pnpm",
    languages: [],
    frameworks: frameworks.map((framework) => ({ ...framework, evidence: [], confidence: "high" as const })),
    runtime: [],
    integrationSignals: [],
    businessSurfaces: [],
    routes: { mode: "app_router", truncated: false, routes: [] },
    projectStructure: {
      monorepo: {
        detected: overrides.monorepo?.detected ?? false,
        tool: null,
        apps: [],
        packages: [],
        evidence: [],
        ambiguous: overrides.monorepo?.ambiguous ?? false,
      },
      sourceFileCount: 120,
      totalTreeEntries: 160,
      topLevelDirectories: ["src"],
    },
    metrics: { durationMs: 400, bytesFetched: 1000, filesFetched: 1, candidatesSelected: 20, treeEntriesConsidered: 160 },
    completeness: { status: "complete", reasons: [] },
    warnings: [],
  } as unknown as RepositoryIntelligenceSnapshot;
}
