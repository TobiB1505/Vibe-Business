import type { RepositoryIntelligenceSnapshot } from "@/modules/repository-intelligence/schema";
import type { ValidationTarget } from "./orchestrator";
import type {
  CreateSandboxInput,
  SandboxHandle,
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
  | { kind: "policy"; policy: SandboxNetworkPolicy }
  | { kind: "command"; command: string; cwd: string }
  | { kind: "read"; path: string }
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
  usage?: Partial<SandboxUsage>;
};

export type FakeSandboxProvider = SandboxProvider & {
  readonly events: FakeEvent[];
  /** Ordered command strings — the transcript most assertions care about. */
  commands(): string[];
  /** Ordered network policies, starting with the creation policy. */
  policies(): SandboxNetworkPolicy[];
  createdWith(): CreateSandboxInput | null;
  stopped(): boolean;
};

/**
 * The real sandbox's working directory.
 *
 * The fake models it because the orchestrator addresses everything absolutely.
 * A fake that accepted bare relative paths would pass while production failed —
 * which is precisely the trap that made the first dogfood's `.git` failure
 * indistinguishable from looking in the wrong place.
 */
const SANDBOX_WORKDIR = "/vercel/sandbox";

/** Fixtures stay relative and readable; lookups arrive absolute. */
function relative(path: string): string {
  if (path === SANDBOX_WORKDIR) return "";
  return path.startsWith(`${SANDBOX_WORKDIR}/`) ? path.slice(SANDBOX_WORKDIR.length + 1) : path;
}

export function fakeSandboxProvider(options: FakeSandboxOptions = {}): FakeSandboxProvider {
  const events: FakeEvent[] = [];
  const files = { ...(options.files ?? {}) };
  let stopCount = 0;

  const handle: SandboxHandle = {
    id: "sandbox_1",
    runtime: "vercel/sandbox/node:24",

    async run(input) {
      const rendered = [input.command.command, ...input.command.args].join(" ");
      events.push({ kind: "command", command: rendered, cwd: input.cwd });

      if (options.throwOn === rendered) throw new Error("provider exploded");

      // Removing `.git` is a real mutation in the fake too, so the credential
      // scrub is verified against actual state rather than a hardcoded answer.
      if (input.command.command === "rm" && relative(input.command.args.at(-1) ?? "") === ".git") {
        for (const path of Object.keys(files)) {
          if (path === ".git" || path.startsWith(".git/")) delete files[path];
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
      return files[relative(input.path)] ?? null;
    },

    async applyNetworkPolicy(policy) {
      events.push({ kind: "policy", policy });
    },

    async stop() {
      stopCount += 1;
      events.push({ kind: "stop" });
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
      return handle;
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
    "package.json": JSON.stringify({
      name: "product",
      scripts: { build: "next build", test: "vitest run", typecheck: "tsc --noEmit" },
    }),
    "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
    ".git/config": "[remote \"origin\"]\n\turl = https://x-access-token:ghs_secret@github.com/acme/product.git\n",
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
    workspaceRoot: ".",
    preparedFiles: [],
    validationRunId: "11111111-2222-3333-4444-555555555555",
    ...overrides,
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
