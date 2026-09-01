import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { AGENT_RUNTIME_PROGRAM } from "../program";
import { AGENT_RUNTIME_TOOLS, AGENT_RUNTIME_VERSION, parseAgentRuntimeResult } from "../protocol";
import type { AgentRuntimeResult } from "../protocol";
import { parseRuntimeProgress, type RuntimeProgress } from "../provider";
import type { SandboxVerificationPolicy } from "@/modules/execution-context/verification";
import type { SandboxCompletionPolicy } from "@/modules/execution-context/completion";
import { startStubAnthropic, type ScriptedToolCall } from "./stub-anthropic";

/**
 * Runs the real runtime program, against the real SDK, for free.
 *
 * Production puts this program in a Vercel sandbox pointed at the Vibe Agent
 * Gateway. The canary puts the identical program in a temporary directory
 * pointed at a local stub. Everything between — the SDK binary, its tool
 * dispatch, its permission pipeline, Vibe's `PreToolUse` hook and `canUseTool`
 * — is the same code taking the same path.
 *
 * The one thing deliberately different is where the tool calls come from: a
 * script instead of a model, so a test can ask "what happens when the agent
 * tries a production build?" and get a deterministic answer.
 */

const REPO_ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));

/** The SDK's platform binary, which the harness cannot run without. */
export function sdkBinaryAvailable(): boolean {
  return existsSync(join(REPO_ROOT, "node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs"));
}

export type CanaryOutcome = {
  exitCode: number | string;
  progress: RuntimeProgress;
  result: AgentRuntimeResult | null;
  /** Raw feed, for assertions the parser does not model. */
  progressText: string;
  /** Files the scripted commands would have created had they executed. */
  markers: Record<string, boolean>;
  stdio: string;
  /** Every request body the SDK sent to the model (VB-035). */
  requestBodies: readonly string[];
};

export type CanaryInput = {
  script: readonly ScriptedToolCall[];
  policy?: SandboxVerificationPolicy;
  completion?: SandboxCompletionPolicy;
  /**
   * Paths whose existence afterwards proves a command really executed.
   *
   * The strongest available evidence: a refused command that nonetheless ran
   * would leave its marker behind, and no amount of correct-looking telemetry
   * could hide that.
   */
  markerPaths?: Record<string, string>;
  /** Repository-relative paths the script writes to, so their parents exist. */
  scriptedPaths?: readonly string[];
  /**
   * Arbitrary files planted in the workspace before the run (VB-035).
   *
   * The point of the canary is that the workspace is a *customer's* repository,
   * and a customer's repository can contain a `CLAUDE.md` addressed to the
   * agent.
   */
  workspaceFiles?: Record<string, string>;
  maxTurns?: number;
  timeoutMs?: number;
};

export async function runCanary(input: CanaryInput): Promise<CanaryOutcome> {
  const dir = await mkdtemp(join(tmpdir(), "vibe-agent-canary-"));
  const workspace = join(dir, "workspace");
  await mkdir(workspace, { recursive: true });

  // A minimal project, so a command the policy permits has something to run.
  await writeFile(
    join(workspace, "package.json"),
    JSON.stringify({ name: "canary-workspace", private: true, scripts: { build: "echo built" } }),
  );

  /*
   * Directories for every path the scripted calls touch.
   *
   * Without them a Write fails, `PostToolUseFailure` fires, and the run
   * legitimately enters repair — which is correct behaviour and a useless test.
   * The workspace has to be real enough that a failure means what it says.
   */
  for (const [path, content] of Object.entries(input.workspaceFiles ?? {})) {
    const parent = path.split("/").slice(0, -1).join("/");
    if (parent) await mkdir(join(workspace, parent), { recursive: true });
    await writeFile(join(workspace, path), content, "utf8");
  }

  for (const path of input.scriptedPaths ?? []) {
    const parent = path.split("/").slice(0, -1).join("/");
    if (parent) await mkdir(join(workspace, parent), { recursive: true });
    await writeFile(join(workspace, path), "// canary\n", "utf8");
  }

  /*
   * `node_modules` beside the program, which is the production shape.
   *
   * The sandbox installs the SDK into the runtime directory, so the program
   * resolves `@anthropic-ai/claude-agent-sdk` from its own neighbour. A symlink
   * reproduces that exactly — and it has to be a symlink rather than NODE_PATH,
   * because NODE_PATH does not participate in ESM resolution at all.
   */
  await symlink(join(REPO_ROOT, "node_modules"), join(dir, "node_modules"), "dir");

  await writeFile(join(dir, "program.mjs"), AGENT_RUNTIME_PROGRAM, "utf8");
  await writeFile(
    join(dir, "request.json"),
    JSON.stringify({
      version: AGENT_RUNTIME_VERSION,
      systemPrompt: "You are a canary. Do exactly what the script says.",
      userMessage: "canary",
      model: "claude-sonnet-5",
      effort: "low",
      maxTurns: input.maxTurns ?? 6,
      maxBudgetUsd: 1,
      tools: AGENT_RUNTIME_TOOLS,
      cwd: workspace,
      ...(input.policy ? { verification: input.policy } : {}),
      ...(input.completion ? { completion: input.completion } : {}),
    }),
    "utf8",
  );

  const stub = await startStubAnthropic(input.script);

  const child = spawn(process.execPath, [join(dir, "program.mjs"), dir], {
    cwd: workspace,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: dir,
      ANTHROPIC_BASE_URL: stub.url,
      ANTHROPIC_AUTH_TOKEN: "canary-token-not-a-credential",
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
      CLAUDE_CONFIG_DIR: join(dir, "claude"),
      CI: "1",
      NODE_ENV: "test",
    },
    stdio: ["ignore", "pipe", "pipe"] as const,
  });

  let stdio = "";
  child.stdout?.on("data", (chunk: unknown) => (stdio += String(chunk)));
  child.stderr?.on("data", (chunk: unknown) => (stdio += String(chunk)));

  const exitCode = await new Promise<number | string>((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve("timeout");
    }, input.timeoutMs ?? 120_000);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve(code ?? -1);
    });
  });

  await stub.close();

  const read = async (path: string): Promise<string | null> => {
    try {
      return await readFile(path, "utf8");
    } catch {
      return null;
    }
  };

  const progressText = (await read(join(dir, "progress.ndjson"))) ?? "";
  const markers: Record<string, boolean> = {};
  for (const [name, path] of Object.entries(input.markerPaths ?? {})) {
    markers[name] = existsSync(path);
  }

  return {
    exitCode,
    progress: parseRuntimeProgress(progressText),
    progressText,
    result: parseAgentRuntimeResult(await read(join(dir, "result.json"))),
    markers,
    stdio,
    requestBodies: stub.bodies,
  };
}

/** A marker path inside the canary's own temp area. */
export function markerPath(name: string): string {
  return join(tmpdir(), `vibe-canary-${name}-${process.pid}-${Math.trunc(performance.now())}`);
}
