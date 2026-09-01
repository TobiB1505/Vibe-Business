import type { SandboxCommand } from "@/modules/validation/commands";
import {
  SANDBOX_POLICY_VERSION,
  validationProfileVersionFor,
} from "@/modules/validation/schema";
import { buildExecutionSpec, type ExecutionSpec } from "@/modules/execution-contract/spec";
import {
  FIXTURE_PLAN,
  fakeBudget,
  fakePlanStep,
  fakeRepositoryBinding,
  fakeWriteScope,
} from "@/modules/execution-contract/test-support";
import { creditsToUnits } from "@/modules/credits/units";
import {
  EXECUTION_RESOLVER_VERSION,
  EXECUTION_RISK_POLICY_VERSION,
  type ExecutionResolution,
} from "@/modules/execution-contract/schema";
import { deriveAgentLimits, type AgentRuntimeLimits } from "./budget";
import type {
  AgentModelUsage,
  CodingAgentProvider,
  CodingAgentRequest,
  CodingAgentResult,
  DetachedCodingAgentProvider,
  ObservedRuntimeEntry,
} from "./provider";
import type {
  AgentWorkspace,
  WorkspaceCommandResult,
  WorkspaceEntry,
  WorkspaceMatch,
  WorkspaceReadResult,
  WorkspaceWriteResult,
} from "./workspace";

/**
 * Fixtures for the coding agent (EXECUTION CORE-4 §49–§59).
 *
 * ## The fake workspace executes nothing
 *
 * It is an in-memory map. That is not a shortcut — it is the same rule
 * `sandbox-port.ts` states for validation: a workspace implementation that
 * shelled out to the host would satisfy the interface perfectly and be a
 * critical vulnerability. Tests use fakes that never execute anything;
 * production uses the sandbox, and there is no third option (ADR 0015).
 *
 * ## The default fixture is one that *works*
 *
 * A repository with real files, a spec that grants the application-code-change
 * capabilities, and limits with room in them. Every test then changes exactly
 * one thing and asserts the refusal — because a safety check is only proven by
 * the case where it fires, and a fixture that starts refused proves nothing
 * when it stays refused.
 */

/* ---------------------------------------------------------------------------
 * Spec
 * ------------------------------------------------------------------------ */

export function fakeAgenticResolution(
  overrides: Partial<ExecutionResolution> = {},
): ExecutionResolution {
  return {
    resolverVersion: EXECUTION_RESOLVER_VERSION,
    riskPolicyVersion: EXECUTION_RISK_POLICY_VERSION,
    stepOrder: 1,
    stepKey: "1-ship-the-thing",
    mode: "agentic",
    intrinsicMode: "agentic",
    reason: "agentic_v1_eligible",
    riskClass: "moderate",
    executionClass: "application_code_change",
    capability: null,
    capabilityVersion: null,
    blockedBy: [],
    absorbedPreparation: [],
    unmetRequirements: [],
    requiresUserInput: false,
    admission: { admissible: true },
    ...overrides,
  };
}

export function fakeAgentSpec(overrides: Partial<Parameters<typeof buildExecutionSpec>[0]> = {}): ExecutionSpec {
  return buildExecutionSpec({
    resolution: fakeAgenticResolution(),
    step: fakePlanStep(),
    plan: FIXTURE_PLAN,
    projectId: "project-1",
    repository: fakeRepositoryBinding(),
    approvedDecisions: [],
    validation: {
      supported: true,
      authority: "vibe_observed",
      preconditions: [
        "source_revision_verified",
        "no_forbidden_paths_changed",
        "diff_scope_within_policy",
        "no_secret_material_introduced",
      ],
      profile: "nextjs_node_v1",
      profileVersion: validationProfileVersionFor("nextjs_node_v1"),
      sandboxPolicyVersion: SANDBOX_POLICY_VERSION,
      sandboxSteps: ["install", "typecheck", "test", "build"],
    },
    budget: { budgetPolicyVersion: "fixture", ...fakeBudget() },
    credit: { quoteId: "quote-1", maxAuthorizedCredits: creditsToUnits(200) },
    writeScope: fakeWriteScope(),
    createdAt: "2026-08-18T00:00:00.000Z",
    ...overrides,
  });
}

export function fakeAgentLimits(overrides: Partial<AgentRuntimeLimits> = {}): AgentRuntimeLimits {
  const spec = fakeAgentSpec();
  return {
    ...deriveAgentLimits({ budget: spec.budget!, policy: spec.policy }),
    ...overrides,
  };
}

/* ---------------------------------------------------------------------------
 * Workspace
 * ------------------------------------------------------------------------ */

export type FakeWorkspaceOptions = {
  /** Repository-relative path → contents. */
  files?: Record<string, string>;
  /** Result for each check name, keyed by the command's display form. */
  commandResults?: WorkspaceCommandResult[];
};

export type FakeWorkspace = AgentWorkspace & {
  readonly files: Map<string, string>;
  readonly commandsRun: SandboxCommand[];
  /**
   * Every path `read` was asked for, in order.
   *
   * Recorded so a test can assert that a path's bytes were **never fetched**,
   * which is a different claim from "the path was refused" — VB-029 is about
   * the order those two happen in.
   */
  readonly readPaths: string[];
};

const DEFAULT_FILES: Record<string, string> = {
  "package.json": JSON.stringify({ scripts: { typecheck: "tsc", test: "vitest", build: "next build" } }),
  "src/app/page.tsx": "export default function Page() {\n  return <main>Home</main>;\n}\n",
  "src/components/Button.tsx": "export function Button() {\n  return <button>Go</button>;\n}\n",
  ".env.local": "STRIPE_SECRET_KEY=sk_live_totally_real\n",
  ".github/workflows/deploy.yml": "on: push\njobs: {}\n",
};

export function fakeWorkspace(options: FakeWorkspaceOptions = {}): FakeWorkspace {
  const files = new Map(Object.entries({ ...DEFAULT_FILES, ...options.files }));
  const commandsRun: SandboxCommand[] = [];
  const readPaths: string[] = [];
  const results = [...(options.commandResults ?? [])];

  return {
    files,
    commandsRun,
    readPaths,

    async list(input: { path: string; maxEntries: number }): Promise<readonly WorkspaceEntry[]> {
      const prefix = input.path.length === 0 ? "" : `${input.path.replace(/\/+$/, "")}/`;
      const entries = new Map<string, WorkspaceEntry>();

      for (const path of files.keys()) {
        if (!path.startsWith(prefix)) continue;
        const rest = path.slice(prefix.length);
        if (rest.length === 0) continue;
        const separator = rest.indexOf("/");
        const name = separator === -1 ? rest : rest.slice(0, separator);
        entries.set(`${prefix}${name}`, {
          path: `${prefix}${name}`,
          kind: separator === -1 ? "file" : "directory",
        });
      }

      return [...entries.values()].slice(0, input.maxEntries);
    },

    async search(input: {
      query: string;
      path: string;
      maxResults: number;
    }): Promise<readonly WorkspaceMatch[]> {
      const matches: WorkspaceMatch[] = [];
      const prefix = input.path.length === 0 ? "" : `${input.path.replace(/\/+$/, "")}/`;

      for (const [path, content] of files) {
        if (!path.startsWith(prefix)) continue;
        content.split("\n").forEach((text, index) => {
          if (matches.length >= input.maxResults) return;
          if (text.includes(input.query)) matches.push({ path, line: index + 1, text });
        });
      }

      return matches;
    },

    async read(input: { path: string; maxBytes: number }): Promise<WorkspaceReadResult> {
      readPaths.push(input.path);
      const content = files.get(input.path);
      if (content === undefined) return { kind: "absent" };
      if (Buffer.byteLength(content, "utf8") > input.maxBytes) return { kind: "too_large" };
      return { kind: "content", content };
    },

    async write(input: { path: string; content: string }): Promise<WorkspaceWriteResult> {
      files.set(input.path, input.content);
      return { ok: true };
    },

    async remove(input: { path: string }): Promise<WorkspaceWriteResult> {
      files.delete(input.path);
      return { ok: true };
    },

    async run(input: { command: SandboxCommand; timeoutMs: number }) {
      commandsRun.push(input.command);
      return (
        results.shift() ?? {
          exitCode: 0,
          durationMs: 10,
          output: "ok",
          timedOut: false,
        }
      );
    },
  };
}

/** The commands a gateway is given for the default fixture repository. */
export function fakeCheckCommands(): Record<string, SandboxCommand> {
  return {
    typecheck: { command: "pnpm", args: ["run", "typecheck"] },
    test: { command: "pnpm", args: ["run", "test"] },
    build: { command: "pnpm", args: ["run", "build"] },
  };
}

/* ---------------------------------------------------------------------------
 * Provider
 * ------------------------------------------------------------------------ */

export type ScriptedToolCall = { tool: string; input: unknown };

export type FakeProviderOptions = {
  /** Tool calls the fake agent makes, in order. */
  calls?: readonly ScriptedToolCall[];
  outcome?: CodingAgentResult["outcome"];
  runtimeFounderInput?: CodingAgentResult["runtimeFounderInput"];
  usage?: readonly AgentModelUsage[];
  /** Throw instead of returning, to exercise the caller's error path. */
  throws?: Error;
  /** The harness's progress feed, as `observe` would read it back. */
  entries?: readonly ObservedRuntimeEntry[];
  /**
   * What the harness counted at its own decision point (Sprint 0042).
   *
   * Null by default, which is what a provider that hosts no shell reports. A
   * test that wants to prove Vibe notices a disagreement between this and the
   * feed sets them explicitly.
   */
  verificationCommands?: number | null;
  verificationRefusals?: number | null;
  policyDecisions?: number | null;
  repairCycles?: number | null;
  implementationMutations?: number | null;
  convergenceMutations?: number | null;
  requiredVerificationActions?: number | null;
  requiredVerificationOverrides?: number | null;
};

export type FakeCodingAgentProvider = CodingAgentProvider & {
  /** Every tool call the fake actually attempted, with what came back. */
  readonly attempted: { tool: string; outcomeKind: string }[];
  readonly requests: CodingAgentRequest[];
};

/**
 * A scripted agent.
 *
 * Deliberately not "an agent that does something sensible" — it replays a fixed
 * list of tool calls, which is what makes an adversarial test a test rather than
 * a hope. Every §50 case is a scripted call the gateway must refuse.
 *
 * It stops replaying the moment the gateway halts, exactly as a real provider
 * would: the adapter aborts on a halt, and a fake that kept calling would prove
 * a property no real run has.
 */
export function fakeCodingAgentProvider(
  options: FakeProviderOptions = {},
): FakeCodingAgentProvider {
  const attempted: { tool: string; outcomeKind: string }[] = [];
  const requests: CodingAgentRequest[] = [];

  return {
    id: "fake_provider",
    harness: "fake_harness",
    attempted,
    requests,

    async run(request: CodingAgentRequest): Promise<CodingAgentResult> {
      requests.push(request);
      if (options.throws) throw options.throws;

      let turns = 0;
      for (const call of options.calls ?? []) {
        if (request.signal.aborted) break;
        turns += 1;
        const outcome = await request.invokeTool(call.tool, call.input);
        attempted.push({ tool: call.tool, outcomeKind: outcome.kind });
        if (outcome.kind === "halt") break;
      }

      return {
        outcome: options.outcome ?? "completed",
        runtimeFounderInput: options.runtimeFounderInput ?? null,
        assistantMessages: turns,
        sdkLoopIterations: turns,
        // This fake hosts no shell, so it makes no verification decisions.
        // Null rather than zero: nothing counted is not the same as none.
        verificationCommands: null,
        verificationRefusals: null,
        policyDecisions: null,
        repairCycles: null,
        implementationMutations: null,
        convergenceMutations: null,
        requiredVerificationActions: null,
        requiredVerificationOverrides: null,
        usage: options.usage ?? [
          {
            model: "claude-sonnet-5",
            inputTokens: 1_000,
            outputTokens: 500,
            cacheReadInputTokens: 4_000,
            cacheCreationInputTokens: 2_000,
            reportedCostUsd: 0.02,
          },
        ],
        sessionId: "session-1",
        providerDeniedToolCalls: 0,
        durationMs: 1_234,
        failureDetail: null,
      };
    },
  };
}

export type FakeDetachedAgentProvider = DetachedCodingAgentProvider & {
  /** Every tool call the fake actually attempted, with what came back. */
  readonly attempted: { tool: string; outcomeKind: string }[];
  readonly requests: CodingAgentRequest[];
  /** How many times a harness was launched. Must never exceed one per run. */
  starts(): number;
  /** Make `observe()` report "still working" for the first N polls. */
  finishAfterPolls(polls: number): void;
};

/**
 * The same scripted agent, in the shape production actually runs
 * (ADR 0029, A1).
 *
 * The harness now outlives the step that starts it, so the durable layer calls
 * `start`, then `observe` on a timer, then `collect`. A fake that still offered
 * one awaited `run()` would let the step graph be tested against a shape no
 * deployment uses — the failure rule 69 keeps warning about.
 *
 * The scripted tool calls run inside `start`, not because a real harness works
 * that way, but because it is the only moment this fake is handed the gateway.
 * What the tests using it care about is what the gateway did with each call,
 * and that is unchanged.
 */
export function fakeDetachedAgentProvider(
  options: FakeProviderOptions = {},
): FakeDetachedAgentProvider {
  const attempted: { tool: string; outcomeKind: string }[] = [];
  const requests: CodingAgentRequest[] = [];
  let started = 0;
  let polls = 0;
  let pollsBeforeFinished = 0;
  let turns = 0;
  let threw: unknown = null;

  return {
    id: "fake_provider",
    harness: "fake_harness",
    attempted,
    requests,

    starts: () => started,
    finishAfterPolls: (count: number) => {
      pollsBeforeFinished = count;
    },

    async start(request: CodingAgentRequest) {
      requests.push(request);
      started += 1;

      if (options.throws) {
        // Carried rather than raised: a provider fault must reach the caller as
        // a typed outcome, never as an exception the durable layer cannot
        // classify (§37).
        threw = options.throws;
        return { ok: false as const, failureDetail: "fake provider refused to start" };
      }

      for (const call of options.calls ?? []) {
        if (request.signal.aborted) break;
        turns += 1;
        const outcome = await request.invokeTool(call.tool, call.input);
        attempted.push({ tool: call.tool, outcomeKind: outcome.kind });
        if (outcome.kind === "halt") break;
      }

      return { ok: true as const };
    },

    async observe() {
      polls += 1;
      return {
        started: started > 0,
        finished: started > 0 && polls > pollsBeforeFinished,
        assistantMessages: turns,
        /*
         * The whole feed, every time — as the real provider returns it.
         *
         * Re-offered rather than deltaed, because the durable write is an
         * upsert keyed on the harness's own sequence. A fake that returned
         * each line once would let a duplicate-write bug pass every test.
         */
        entries: options.entries ?? [],
      };
    },

    async collect() {
      return {
        outcome: threw ? ("provider_error" as const) : (options.outcome ?? "completed"),
        runtimeFounderInput: options.runtimeFounderInput ?? null,
        assistantMessages: turns,
        sdkLoopIterations: threw ? null : turns,
        verificationCommands: options.verificationCommands ?? null,
        verificationRefusals: options.verificationRefusals ?? null,
        policyDecisions: options.policyDecisions ?? null,
        repairCycles: options.repairCycles ?? null,
        implementationMutations: options.implementationMutations ?? null,
        convergenceMutations: options.convergenceMutations ?? null,
        requiredVerificationActions: options.requiredVerificationActions ?? null,
        requiredVerificationOverrides: options.requiredVerificationOverrides ?? null,
        usage: options.usage ?? [
          {
            model: "claude-sonnet-5",
            inputTokens: 1_000,
            outputTokens: 500,
            cacheReadInputTokens: 4_000,
            cacheCreationInputTokens: 2_000,
            reportedCostUsd: 0.02,
          },
        ],
        sessionId: "session-1",
        providerDeniedToolCalls: 0,
        durationMs: 1_234,
        failureDetail: threw ? "fake provider failed" : null,
      };
    },
  };
}
