/**
 * The program that runs inside the agent sandbox
 * (EXECUTION CORE-4 runtime placement).
 *
 * ## Why it is a string constant rather than a file
 *
 * Because it has to arrive in a microVM that Vibe creates seconds earlier, and
 * because what it contains is a security property. As a constant it is reviewed
 * in this repository, versioned with `AGENT_RUNTIME_VERSION`, and asserted
 * against by tests — none of which is true of a file fetched at run time or a
 * script assembled from parts.
 *
 * ## It contains no interpolation, deliberately
 *
 * Not one `${`, not one backtick. Everything the run needs arrives as JSON in
 * `request.json`, parsed inside the sandbox. That means there is no point where
 * a task description, a repository path or a model's output could become
 * program text — the same reason `validation/commands.ts` builds argument
 * arrays instead of shell strings, applied to a program instead of a command.
 * A test asserts the absence rather than trusting the reading.
 *
 * ## The four options that are not the SDK's defaults
 *
 * - **`tools`** is the explicit local set. The Claude Code preset would add
 *   `WebFetch` and `WebSearch`, and Rule 41 says a model gets no URL fetching:
 *   removing the capability is what bounds injection, not asking it nicely.
 * - **`settingSources: []`** so no `CLAUDE.md` or `.claude/settings.json` from
 *   the customer's repository becomes configuration. Repository content is
 *   untrusted data, never instructions (Rule 25) — and this program runs *in*
 *   that repository's tree, which is exactly where such a file would be.
 * - **`persistSession: false`** so no transcript of reasoning or customer
 *   source is written to disk (Rule 43).
 * - **`canUseTool`** answers deterministically. A sandbox has no terminal, so a
 *   harness that decided to prompt would hang until the run's wall clock
 *   expired — a permission model that fails by stalling is not one.
 *
 * `CLAUDE_CODE_DISABLE_AUTO_MEMORY` and `CLAUDE_CONFIG_DIR` are set on the
 * process environment by the caller, because auto memory loads regardless of
 * `settingSources`.
 */

export const AGENT_RUNTIME_PROGRAM = `
import { appendFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { query } from "@anthropic-ai/claude-agent-sdk";

const dir = process.argv[2];
const request = JSON.parse(await readFile(dir + "/request.json", "utf8"));
const allowed = new Set(request.tools);

/**
 * Progress, as it happens.
 *
 * Written to a **file** as well as stdout, and the file is the one that
 * matters. This process is detached: it outlives the Vibe step that started it,
 * so nothing is holding its stdout by the time anyone wants to read it. A later
 * step reads this file to learn how far the run has got.
 *
 * That is what stops a turn from being lost. The first real run reached
 * Anthropic 27 times and still recorded turns: 0, because the only record of
 * its progress died with the step that was watching.
 *
 * Appended synchronously and line-at-a-time so a reader that arrives mid-write
 * sees whole lines behind it, and never a torn one.
 */
let sequence = 0;

const emit = (event) => {
  sequence += 1;
  const line = JSON.stringify(Object.assign({ s: sequence }, event)) + "\\n";
  try {
    process.stdout.write(line);
  } catch {
    // Telemetry must never be the thing that ends a paid run.
  }
  try {
    appendFileSync(dir + "/progress.ndjson", line);
  } catch {
    // Same rule. A run that cannot report is still a run.
  }
};

const result = {
  version: request.version,
  subtype: "no_result",
  turns: 0,
  sessionId: null,
  permissionDenials: 0,
  modelUsage: {},
  error: null,
};

emit({ t: "started" });

try {
  const stream = query({
    prompt: request.userMessage,
    options: {
      systemPrompt: request.systemPrompt,
      model: request.model,
      effort: request.effort,
      maxTurns: request.maxTurns,
      maxBudgetUsd: request.maxBudgetUsd,
      tools: request.tools,
      allowedTools: request.tools,
      mcpServers: {},
      strictMcpConfig: true,
      settingSources: [],
      permissionMode: "default",
      allowDangerouslySkipPermissions: false,
      canUseTool: async (name) =>
        allowed.has(name)
          ? { behavior: "allow" }
          : {
              behavior: "deny",
              message: "That tool is not available to this execution.",
              interrupt: false,
            },
      cwd: request.cwd,
      persistSession: false,
      includePartialMessages: false,
    },
  });

  for await (const message of stream) {
    if (message.type === "assistant") {
      result.turns += 1;
      emit({ t: "turn", n: result.turns });

      /*
       * What the harness executed, taken from its own tool stream.
       *
       * A tool_use block is an instruction the harness carried out — a file it
       * read, an edit it applied, a command it ran. It is not the model talking
       * about itself, and nothing here reads the text blocks alongside it: the
       * loop looks only at type "tool_use" and copies three fields out of its
       * input. There is no path by which a sentence reaches Vibe.
       *
       * This is telemetry, never authority. What the run actually changed is
       * still established afterwards by comparing the workspace against the
       * pinned commit (Rule 77); these events say what to show a person while
       * they wait.
       */
      const blocks = message.message && Array.isArray(message.message.content)
        ? message.message.content
        : [];

      for (const block of blocks) {
        if (!block || block.type !== "tool_use") continue;
        const input = block.input && typeof block.input === "object" ? block.input : {};
        const detail = { t: "tool", name: String(block.name || "") };
        if (typeof input.file_path === "string") detail.path = input.file_path.slice(0, 400);
        if (typeof input.path === "string" && !detail.path) detail.path = input.path.slice(0, 400);
        if (typeof input.pattern === "string") detail.pattern = "1";
        if (typeof input.command === "string") detail.command = input.command.slice(0, 400);
        emit(detail);
      }
    }

    if (message.type === "result") {
      result.subtype = message.subtype;
      result.turns = typeof message.num_turns === "number" ? message.num_turns : result.turns;
      result.sessionId = message.session_id ?? null;
      result.permissionDenials = Array.isArray(message.permission_denials)
        ? message.permission_denials.length
        : 0;
      result.modelUsage = message.modelUsage ?? {};
      break;
    }
  }
} catch (error) {
  /*
   * The name and a bounded message, never the object.
   *
   * An SDK error can carry request context and headers, and this one would be
   * carrying them out of a VM and into Vibe's durable records. What is kept is
   * enough to tell "the gateway refused us" from "the binary is missing".
   */
  result.subtype = "error_runtime";
  const name = error && error.name ? String(error.name) : "Error";
  const message = error && error.message ? String(error.message) : "";
  result.error = (name + ": " + message).replace(/\\s+/g, " ").trim().slice(0, 400);
}

emit({ t: "finished", subtype: result.subtype, turns: result.turns });

await writeFile(dir + "/result.json", JSON.stringify(result), "utf8");
`;
