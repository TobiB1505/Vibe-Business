import { describe, expect, it } from "vitest";
import { fakeSandboxProvider, type FakeSandboxOptions } from "@/modules/validation/test-support";
import type { CodingAgentRequest } from "../provider";
import { createSandboxCodingAgentProvider, installAgentRuntime } from "./provider";
import { AGENT_RUNTIME_VERSION, AGENT_SDK_VERSION } from "./protocol";

/**
 * The harness running where a 325 MB binary and a real shell are unremarkable,
 * and Vibe's Anthropic key staying where they are not.
 *
 * The assertions that matter here are about what crosses the boundary in each
 * direction: one scoped token in, counts and an outcome out. Everything else —
 * whether the model does good work — is not this layer's question.
 */

const RUNTIME_DIR = "/vercel/sandbox/.vibe-agent";
const GATEWAY = "https://app.vibe.test/api/agent-gateway";
const TOKEN = "eyJydW5JZCI6InJ1bi0xIn0.signature";

function runtimeResult(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    version: AGENT_RUNTIME_VERSION,
    subtype: "success",
    turns: 3,
    sessionId: "session-1",
    permissionDenials: 0,
    modelUsage: { "claude-sonnet-5": { inputTokens: 900, outputTokens: 210 } },
    error: null,
    ...overrides,
  });
}

async function handle(options: FakeSandboxOptions = {}) {
  const provider = fakeSandboxProvider(options);
  const sandbox = await provider.create({
    name: "agent-run-1",
    source: { kind: "git", repositoryUrl: "https://github.test/o/r", revision: "abc", credential: null },
    networkPolicy: { mode: "deny_all" },
    timeoutMs: 60_000,
    env: {},
  });

  return { provider, sandbox };
}

function request(overrides: Partial<CodingAgentRequest> = {}): CodingAgentRequest {
  return {
    runId: "run-1",
    instruction: {
      system: "You are Vibe's execution agent.",
      userMessage: "Add a robots.txt route.",
      compilerVersion: "agent-prompt-v1",
    },
    model: "claude-sonnet-5",
    effort: "high",
    tools: [],
    limits: { maxTurns: 30, maxWallClockMs: 600_000, maxProviderSpendUsd: 2.5 },
    invokeTool: async () => ({ kind: "ok", content: "" }),
    signal: new AbortController().signal,
    ...overrides,
  };
}

async function run(options: FakeSandboxOptions = {}, overrides: Partial<CodingAgentRequest> = {}) {
  const { provider, sandbox } = await handle(options);

  const result = await createSandboxCodingAgentProvider({
    sandbox,
    runtimeDir: RUNTIME_DIR,
    workspaceDir: "/vercel/sandbox/repo",
    workspaceCwd: "repo",
    gatewayBaseUrl: GATEWAY,
    gatewayToken: TOKEN,
  }).run(request(overrides));

  return { provider, result };
}

/** The `node run.mjs` invocation, with the environment it was given. */
function cliCommand(provider: ReturnType<typeof fakeSandboxProvider>) {
  return provider.events.find(
    (event) => event.kind === "command" && event.command.startsWith("node "),
  );
}

const OK: FakeSandboxOptions = {
  files: { [`${RUNTIME_DIR}/result.json`]: runtimeResult() },
};

describe("what the sandbox is given", () => {
  it("samples through the Vibe gateway, not through Anthropic", async () => {
    const { provider } = await run(OK);
    const command = cliCommand(provider);

    expect(command?.kind === "command" && command.env?.ANTHROPIC_BASE_URL).toBe(GATEWAY);
    expect(JSON.stringify(command)).not.toContain("api.anthropic.com");
  });

  /**
   * The whole reason the gateway exists. A key inside this VM would be a key
   * inside a machine running a customer's build scripts.
   */
  it("carries a scoped token and no provider key", async () => {
    const { provider } = await run(OK);
    const command = cliCommand(provider);
    const env = command?.kind === "command" ? (command.env ?? {}) : {};

    expect(env.ANTHROPIC_AUTH_TOKEN).toBe(TOKEN);
    expect(env).not.toHaveProperty("ANTHROPIC_API_KEY");
    expect(Object.values(env).some((value) => value.startsWith("sk-ant"))).toBe(false);
  });

  it("gives the run its own config directory, outside the repository", async () => {
    const { provider } = await run(OK);
    const command = cliCommand(provider);
    const env = command?.kind === "command" ? (command.env ?? {}) : {};

    expect(env.CLAUDE_CONFIG_DIR).toBe(`${RUNTIME_DIR}/claude`);
    expect(env.CLAUDE_CONFIG_DIR?.startsWith("/vercel/sandbox/repo")).toBe(false);
  });

  /**
   * Auto memory loads regardless of `settingSources`, and this harness runs
   * inside the customer's own tree — which is exactly where a `CLAUDE.md`
   * lives. Rule 25 says that file is data, never instructions.
   */
  it("disables auto memory", async () => {
    const { provider } = await run(OK);
    const command = cliCommand(provider);

    expect(command?.kind === "command" && command.env?.CLAUDE_CODE_DISABLE_AUTO_MEMORY).toBe("1");
  });

  it("runs the agent in the repository workspace", async () => {
    const { provider } = await run(OK);
    const command = cliCommand(provider);

    expect(command?.kind === "command" && command.cwd).toBe("repo");
  });

  it("writes the task as data rather than as program text", async () => {
    const { provider } = await run(OK);

    // The program is written verbatim; everything the run needs arrives beside
    // it as JSON. A task description never becomes something node parses.
    const writes = provider.events.filter(
      (event) => event.kind === "command" && event.command.startsWith("sh -c base64 -d"),
    );
    expect(writes).toHaveLength(2);
    expect(JSON.stringify(writes)).not.toContain("Add a robots.txt route");
  });
});

describe("what comes back", () => {
  it("reports the harness's own counts", async () => {
    const { result } = await run(OK);

    expect(result.outcome).toBe("completed");
    expect(result.turns).toBe(3);
    expect(result.sessionId).toBe("session-1");
    expect(result.usage).toEqual([
      {
        model: "claude-sonnet-5",
        inputTokens: 900,
        outputTokens: 210,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        reportedCostUsd: null,
      },
    ]);
  });

  it.each([
    ["error_max_turns", "max_turns"],
    ["error_max_budget_usd", "max_cost"],
    ["error_during_execution", "provider_error"],
  ])("maps %s to %s", async (subtype, outcome) => {
    const { result } = await run({
      files: { [`${RUNTIME_DIR}/result.json`]: runtimeResult({ subtype }) },
    });

    expect(result.outcome).toBe(outcome);
  });
});

describe("a run that produced no result file", () => {
  /**
   * §37 forbids resolving a paid ambiguity optimistically — and it forbids the
   * reverse too. A run that took three turns and then lost its result file did
   * take three turns, and reporting zero would understate what was billed.
   */
  it("still reports the turns the progress stream showed", async () => {
    const { result } = await run({
      results: {
        [`node ${RUNTIME_DIR}/run.mjs ${RUNTIME_DIR}`]: {
          exitCode: 1,
          output: '{"t":"started"}\n{"t":"turn","n":1}\n{"t":"turn","n":2}\n',
        },
      },
    });

    expect(result.outcome).toBe("provider_error");
    expect(result.turns).toBe(2);
    expect(result.failureDetail).toBe("the agent runtime produced no result");
  });

  it("distinguishes a harness that never started from one that died", async () => {
    const { result } = await run({
      results: {
        [`node ${RUNTIME_DIR}/run.mjs ${RUNTIME_DIR}`]: { exitCode: 127, output: "node: not found" },
      },
    });

    expect(result.turns).toBe(0);
    expect(result.failureDetail).toBe("the agent runtime did not start");
  });

  it("names a wall-clock death as one", async () => {
    const { result } = await run({
      results: {
        [`node ${RUNTIME_DIR}/run.mjs ${RUNTIME_DIR}`]: {
          exitCode: -1,
          output: '{"t":"started"}',
          timedOut: true,
        },
      },
    });

    expect(result.failureDetail).toBe("the agent runtime exceeded its wall clock");
  });

  /** Repository build output shares stdout. A line that is not ours is not an error. */
  it("ignores output that is not the runtime's own", async () => {
    const { result } = await run({
      results: {
        [`node ${RUNTIME_DIR}/run.mjs ${RUNTIME_DIR}`]: {
          exitCode: 1,
          output: 'building...\n{"t":"turn","n":1}\n{ not json\nDone in 4s\n',
        },
      },
    });

    expect(result.turns).toBe(1);
  });
});

describe("a cancelled run", () => {
  it("never starts the harness", async () => {
    const controller = new AbortController();
    controller.abort();

    const { provider, result } = await run(OK, { signal: controller.signal });

    expect(result.outcome).toBe("aborted");
    expect(cliCommand(provider)).toBeUndefined();
  });
});

describe("installing the harness", () => {
  it("pins the version and runs no lifecycle script", async () => {
    const { provider, sandbox } = await handle();

    const installed = await installAgentRuntime({
      sandbox,
      runtimeCwd: ".vibe-agent",
      timeoutMs: 120_000,
    });

    expect(installed.ok).toBe(true);
    expect(provider.commands()).toContain(
      `npm install --no-save --no-audit --no-fund --ignore-scripts @anthropic-ai/claude-agent-sdk@${AGENT_SDK_VERSION}`,
    );
  });

  it("reports a failed install rather than leaving a run to discover it", async () => {
    const { sandbox } = await handle({ defaultExitCode: 1 });

    expect(
      await installAgentRuntime({ sandbox, runtimeCwd: ".vibe-agent", timeoutMs: 120_000 }),
    ).toEqual({ ok: false, output: "" });
  });
});
