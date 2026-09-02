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
    signal: new AbortController().signal,
    ...overrides,
  };
}

/**
 * Start, observe, collect — the three calls a durable workflow makes, driven
 * here in one helper so a test still reads as "run the agent".
 *
 * They are genuinely separate: each constructs its own provider from a
 * reconnected sandbox, exactly as three different function invocations would.
 */
function providerFor(sandbox: Awaited<ReturnType<typeof handle>>["sandbox"]) {
  return createSandboxCodingAgentProvider({
    sandbox,
    runtimeDir: RUNTIME_DIR,
    workspaceDir: "/vercel/sandbox/repo",
    workspaceCwd: "repo",
    gatewayBaseUrl: GATEWAY,
    gatewayToken: TOKEN,
  });
}

async function run(options: FakeSandboxOptions = {}, overrides: Partial<CodingAgentRequest> = {}) {
  /*
   * Two sandboxes, because the timeline is real.
   *
   * `start` sees a workspace the harness has not written to yet — that is the
   * whole basis of its "already started?" guard. `observe` and `collect` run
   * minutes later, against a workspace the harness has since filled in. A single
   * pre-seeded fake would let `start` see its own future.
   */
  const before = await handle();
  const started = await providerFor(before.sandbox).start(request(overrides));

  const after = await handle(options);
  const observation = await providerFor(after.sandbox).observe();
  const result = await providerFor(after.sandbox).collect({ startedAtMs: Date.now() - 1_234 });

  return { provider: before.provider, after: after.provider, started, observation, result };
}

/** The `node run.mjs` invocation, with the environment it was given. */
function cliCommand(provider: ReturnType<typeof fakeSandboxProvider>) {
  // `background`, not `command`: the harness outlives the step that starts it.
  return provider.events.find(
    (event) => event.kind === "background" && event.command.startsWith("node "),
  );
}

/** A finished run: the harness wrote both its progress and its result. */
const OK: FakeSandboxOptions = {
  files: {
    [`${RUNTIME_DIR}/result.json`]: runtimeResult(),
    [`${RUNTIME_DIR}/progress.ndjson`]: '{"t":"started"}\n{"t":"turn","n":1}\n{"t":"turn","n":2}\n{"t":"turn","n":3}\n',
  },
};

describe("what the sandbox is given", () => {
  it("samples through the Vibe gateway, not through Anthropic", async () => {
    const { provider } = await run(OK);
    const command = cliCommand(provider);

    expect(command?.kind === "background" && command.env?.ANTHROPIC_BASE_URL).toBe(GATEWAY);
    expect(JSON.stringify(command)).not.toContain("api.anthropic.com");
  });

  /**
   * The whole reason the gateway exists. A key inside this VM would be a key
   * inside a machine running a customer's build scripts.
   */
  it("carries a scoped token and no provider key", async () => {
    const { provider } = await run(OK);
    const command = cliCommand(provider);
    const env = command?.kind === "background" ? (command.env ?? {}) : {};

    expect(env.ANTHROPIC_AUTH_TOKEN).toBe(TOKEN);
    expect(env).not.toHaveProperty("ANTHROPIC_API_KEY");
    expect(Object.values(env).some((value) => value.startsWith("sk-ant"))).toBe(false);
  });

  it("gives the run its own config directory, outside the repository", async () => {
    const { provider } = await run(OK);
    const command = cliCommand(provider);
    const env = command?.kind === "background" ? (command.env ?? {}) : {};

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

    expect(command?.kind === "background" && command.env?.CLAUDE_CODE_DISABLE_AUTO_MEMORY).toBe("1");
  });

  it("runs the agent in the repository workspace", async () => {
    const { provider } = await run(OK);
    const command = cliCommand(provider);

    expect(command?.kind === "background" && command.cwd).toBe("repo");
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
    expect(result.assistantMessages).toBe(3);
    expect(result.sessionId).toBe("session-1");
    expect(result.runtimeFounderInput).toBeNull();
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

  it("returns a sandbox-discovered founder-input blocker as an aborted run", async () => {
    const runtimeFounderInput = {
      kind: "input",
      question: "Which verified domain should this change use?",
      options: [],
    };
    const { result } = await run({
      files: {
        [`${RUNTIME_DIR}/result.json`]: runtimeResult({
          subtype: "founder_input_required",
          runtimeFounderInput,
        }),
      },
    });

    expect(result.outcome).toBe("aborted");
    expect(result.runtimeFounderInput).toEqual(runtimeFounderInput);
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
  /** Progress the harness appended before it died, read back off the workspace. */
  function progress(...lines: string[]) {
    return { [`${RUNTIME_DIR}/progress.ndjson`]: `${lines.join("\n")}\n` };
  }

  /**
   * §37 forbids resolving a paid ambiguity optimistically — and it forbids the
   * reverse too. A run that took two turns and then lost its result did take
   * two turns, and reporting zero would understate what was billed.
   *
   * This is the exact shape of the first real failure: the harness worked, the
   * step that was watching it was killed, and the run row said `turns: 0`.
   */
  it("still reports the turns the progress file recorded", async () => {
    const { result } = await run({
      files: progress('{"t":"started"}', '{"t":"turn","n":1}', '{"t":"turn","n":2}'),
    });

    expect(result.outcome).toBe("provider_error");
    expect(result.assistantMessages).toBe(2);
    expect(result.failureDetail).toBe("the agent runtime produced no result");
  });

  it("distinguishes a harness that never started from one that died", async () => {
    const { result } = await run();

    expect(result.assistantMessages).toBe(0);
    expect(result.failureDetail).toBe("the agent runtime did not start");
  });

  /** The repository's own build output shares this file's directory, not its lines. */
  it("ignores progress lines that are not the runtime's own", async () => {
    const { result } = await run({
      files: progress('building...', '{"t":"turn","n":1}', '{ not json', 'Done in 4s'),
    });

    expect(result.assistantMessages).toBe(1);
  });
});

describe("watching a run that has not finished", () => {
  /**
   * The signal a polling step reads. `result.json` is the completion marker
   * because a file survives a step boundary and a process handle does not.
   */
  it("reports it as started but unfinished, with the turns so far", async () => {
    const { observation } = await run({
      files: {
        [`${RUNTIME_DIR}/progress.ndjson`]: '{"t":"started"}\n{"t":"turn","n":4}\n',
      },
    });

    expect(observation).toMatchObject({ started: true, finished: false, assistantMessages: 4 });
  });

  it("reports a finished run once the result file exists", async () => {
    const { observation } = await run(OK);

    expect(observation).toMatchObject({ started: true, finished: true, assistantMessages: 3 });
  });

  it("reports a harness that has not written anything yet", async () => {
    const { observation } = await run();

    expect(observation).toEqual({ started: false, finished: false, assistantMessages: 0, entries: [] });
  });
});

describe("a run that must not start twice", () => {
  /**
   * The second, independent guard. The caller's database claim is the primary
   * one, but two paid harnesses on one execution is expensive enough to deserve
   * an answer that does not depend on the database being reachable.
   */
  it("refuses to start when the workspace shows a harness already ran", async () => {
    const { sandbox, provider } = await handle({
      files: { [`${RUNTIME_DIR}/progress.ndjson`]: '{"t":"started"}\n' },
    });

    const started = await providerFor(sandbox).start(request());

    expect(started).toEqual({
      ok: false,
      failureDetail: "the agent runtime was already started for this run",
    });
    expect(cliCommand(provider)).toBeUndefined();
  });

  it("never launches a cancelled run", async () => {
    const controller = new AbortController();
    controller.abort();
    const { sandbox, provider } = await handle();

    const started = await providerFor(sandbox).start(request({ signal: controller.signal }));

    expect(started).toEqual({ ok: false, failureDetail: "the run was cancelled" });
    expect(cliCommand(provider)).toBeUndefined();
  });

  it("reports a harness the provider refused to launch", async () => {
    const { sandbox } = await handle({ failBackground: true });

    const started = await providerFor(sandbox).start(request());

    expect(started.ok).toBe(false);
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
