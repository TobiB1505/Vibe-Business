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
const startedAt = Date.now();

/*
 * Milliseconds since this harness started, on every line.
 *
 * Relative rather than absolute, and that is the point: the sandbox's clock is
 * not Vibe's, so an absolute timestamp from inside the VM would be a number
 * nobody could safely compare to anything. An offset from a start Vibe recorded
 * on its own clock survives any skew and gives real per-step durations.
 *
 * Without it every line of a poll's batch was stamped with the moment Vibe read
 * the file, so run #3's sixty-eight events all carried 11:10:38 and the feed
 * could not show that a typecheck took ninety seconds.
 */
const emit = (event) => {
  sequence += 1;
  const line = JSON.stringify(Object.assign({ s: sequence, ms: Date.now() - startedAt }, event)) + "\\n";
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

/*
 * The verification policy, rebuilt from data (Sprint 0042).
 *
 * Rules and integers arrive in request.json; nothing here is program text
 * assembled from a string. A request with no policy leaves every command
 * permitted, which is what v2 did — a missing field must never mean "refuse
 * everything", because that turns a version skew into a run that cannot check
 * its own work at all.
 */
const policy = request.verification || null;
const categoryRules = policy && Array.isArray(policy.categoryRules)
  ? policy.categoryRules.map((rule) => ({ category: rule.category, re: new RegExp(rule.pattern) }))
  : [];
const permitted = new Set(policy ? policy.permittedChecks : []);

const verification = { commands: 0, firstAt: null, refusals: 0, decisions: 0 };

const categoryOf = (command) => {
  const text = String(command || "").toLowerCase();
  for (const rule of categoryRules) {
    if (rule.re.test(text)) return rule.category;
  }
  return "other";
};

/*
 * Targeted or whole-suite, decided by argument shape.
 *
 * A shell cannot tell them apart any other way: "vitest run src/x.test.ts" and
 * "vitest run" are the same category. The pattern arrives with the policy
 * rather than being written here, so Vibe and this harness answer the question
 * with one string instead of two that drift.
 *
 * Anything that does not look clearly targeted counts as the full suite, so the
 * error lands on refusing a narrow test rather than admitting a long one.
 */
const targetedTest = policy && policy.targetedTestPattern
  ? new RegExp(policy.targetedTestPattern)
  : /$^/;

const checkOf = (command, category) => {
  if (category === "test") return targetedTest.test(String(command || "")) ? "targeted_test" : "full_test";
  if (category === "typecheck") return "typecheck";
  if (category === "build") return "build";
  if (category === "lint") return "lint";
  return null;
};

/**
 * Whether one Bash command may run.
 *
 * Only check commands are ever refused. Reading, searching, editing and
 * anything that classifies as something other than a check pass through
 * untouched — this bounds how much the agent spends proving its work, not what
 * it is able to do.
 *
 * It is a convergence control, not a security boundary. What makes a change
 * safe is decided afterwards by Vibe, outside this VM.
 */
const messageFor = (reason) =>
  (policy && policy.messages && policy.messages[reason]) ||
  "That action is outside this task's execution policy.";

const decide = (toolName, input) => {
  if (!policy) return null;
  const args = input && typeof input === "object" ? input : {};

  if (toolName !== "Bash") return null;
  const command = typeof args.command === "string" ? args.command : "";

  const category = categoryOf(command);
  const check = checkOf(command, category);
  if (!check) return null;

  if (!permitted.has(check)) {
    return { reason: "check_not_permitted", check: check, category: category };
  }
  if (verification.commands >= policy.maxVerificationCommands) {
    return { reason: "command_budget_exhausted", check: check, category: category };
  }
  if (verification.firstAt !== null &&
      Date.now() - verification.firstAt >= policy.maxVerificationWallClockMs) {
    return { reason: "wall_clock_exhausted", check: check, category: category };
  }

  verification.commands += 1;
  if (verification.firstAt === null) verification.firstAt = Date.now();
  emit({ t: "verify", check: check, category: category, n: verification.commands });
  return null;
};

const result = {
  version: request.version,
  subtype: "no_result",
  /*
   * Two counters, because they count two different things.
   *
   * assistantMessages is one per model response. sdkLoopIterations is the
   * harness's own loop count, which advances on tool results as well — so it is
   * the unit maxTurns bounds, and the two are not a ratio.
   *
   * They used to be one field that switched units at the end: the running tally
   * counted messages and the terminal write replaced it with num_turns. Run
   * b33635a1 recorded 66 against a ceiling of 40 and overran nothing, because
   * the number shown and the number bounded were never the same quantity.
   */
  assistantMessages: 0,
  sdkLoopIterations: null,
  sessionId: null,
  permissionDenials: 0,
  modelUsage: {},
  /*
   * What the verification plan actually cost, counted here rather than inferred.
   *
   * Vibe re-derives the same numbers from the event feed, and the two are kept
   * separate on purpose: the feed can lose a poll, and this cannot. Neither is
   * authority over what the run *changed* — that is still established by
   * comparing the workspace against the pinned commit (Rule 77).
   */
  verificationCommands: 0,
  verificationRefusals: 0,
  verificationMs: null,
  /*
   * Every tool call the policy hook saw.
   *
   * The counter that would have caught run #5 in one glance: a run with
   * thirty tool calls and zero decisions has a policy that is not running,
   * which reads identically to a policy that had nothing to refuse.
   */
  policyDecisions: 0,
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
      /*
       * allowedTools is deliberately NOT set.
       *
       * Its own type documentation says these tools are "auto-allowed without
       * prompting for permission" and "will execute automatically without
       * asking the user for approval" — which means canUseTool is never
       * consulted for anything named in it. Passing the whole tool list made
       * every Bash command auto-allowed, so the verification plan was inert:
       * run #5 ran a targeted test that the plan permitted and the harness
       * never saw the decision, recording zero verification commands.
       *
       * That is the same defect shape as the gateway check-run ceiling this
       * sprint was written to replace — a limit enforced on a path nothing
       * calls. Availability is bounded by tools; permission is answered by
       * canUseTool, in one place, for every call.
       */
      mcpServers: {},
      strictMcpConfig: true,
      settingSources: [],
      permissionMode: "default",
      allowDangerouslySkipPermissions: false,
      /*
       * Two questions, in order: is the tool available at all, and — for Bash —
       * is this command inside the verification plan?
       *
       * The second is why the signature takes a second parameter. The SDK hands
       * the tool's arguments to the permission callback, so input.command is the
       * exact string the shell would receive, before it runs. That is the only
       * point in the whole system where a full build can be stopped: the harness
       * runs the agent's tools inside this VM and never calls back to Vibe's
       * gateway, so a server-side ceiling has nothing to intercept.
       *
       * A refusal is never silent. The agent is told, in Vibe's words, that the
       * check is outside this task's plan and that Vibe validates the prepared
       * change independently afterwards — so the useful next move is to finish,
       * not to find another way to run it.
       */
      /*
       * The policy decision point, and the reason it is a hook.
       *
       * PreToolUse fires for every tool call, whatever the permission mode.
       * canUseTool does not: permissionMode "default" is documented as
       * "prompts for dangerous operations", so a read or a search can be
       * auto-approved without the callback ever running — and allowedTools
       * skipped it for everything, which is how run #5 executed a command the
       * plan governed while recording zero decisions.
       *
       * Two lessons, both encoded here: put the decision where it is always
       * reached, and count it where it is made.
       */
      hooks: {
        PreToolUse: [
          {
            hooks: [
              async (event) => {
                verification.decisions += 1;

                const refusal = decide(event.tool_name, event.tool_input);
                if (!refusal) return { continue: true };

                verification.refusals += 1;
                emit({ t: "refused", check: refusal.check, reason: refusal.reason });

                return {
                  continue: true,
                  hookSpecificOutput: {
                    hookEventName: "PreToolUse",
                    permissionDecision: "deny",
                    permissionDecisionReason: messageFor(refusal.reason),
                  },
                };
              },
            ],
          },
        ],
      },
      /*
       * The tool-name backstop, kept.
       *
       * The hook governs *what a permitted tool may do*; this governs *which
       * tools exist at all*. Two questions, two answers, and the second one
       * must not depend on a hook being registered.
       */
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
      result.assistantMessages += 1;
      emit({ t: "turn", n: result.assistantMessages });

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
      // The harness's own count, kept beside the message count rather than
      // written over it. Null when the SDK did not report one.
      result.sdkLoopIterations = typeof message.num_turns === "number" ? message.num_turns : null;
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

result.verificationCommands = verification.commands;
result.verificationRefusals = verification.refusals;
result.policyDecisions = verification.decisions;
result.verificationMs = verification.firstAt === null ? null : Date.now() - verification.firstAt;

emit({ t: "finished", subtype: result.subtype, n: result.assistantMessages });

await writeFile(dir + "/result.json", JSON.stringify(result), "utf8");
`;
