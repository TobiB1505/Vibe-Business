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
  | { kind: "command"; command: string; cwd: string }
  | { kind: "read"; path: string }
  | { kind: "snapshot"; expirationMs: number }
  | { kind: "origin"; port: number }
  | { kind: "delete_artifact"; snapshotId: string }
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
};

export function fakeSandboxProvider(options: FakeSandboxOptions = {}): FakeSandboxProvider {
  const events: FakeEvent[] = [];
  const files = { ...(options.files ?? {}) };
  let stopCount = 0;

  let createCount = 0;
  let reconnectCount = 0;
  let snapshotCount = 0;
  let terminated = false;
  const deletedArtifacts: string[] = [];

  const handle: SandboxHandle = {
    id: "sandbox_1",
    runtime: "vercel/sandbox/node:24",
    liveness: "running",

    async run(input) {
      const rendered = [input.command.command, ...input.command.args].join(" ");
      events.push({ kind: "command", command: rendered, cwd: input.cwd });

      if (options.throwOn === rendered) throw new Error("provider exploded");

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
      const argument = input.command.args.at(-1) ?? "";
      if (input.command.command === "rm" && argument.endsWith(".git")) {
        const removed = argument.startsWith("/") || input.cwd === "." || input.cwd === ""
          ? argument
          : `${input.cwd}/${argument}`;

        for (const path of Object.keys(files)) {
          if (path === removed || path.startsWith(`${removed}/`)) delete files[path];
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

    async publicOrigin(port) {
      events.push({ kind: "origin", port });
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

    async deleteArtifact(snapshotId) {
      events.push({ kind: "delete_artifact", snapshotId });
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

      if (lost || createCount === 0) {
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
