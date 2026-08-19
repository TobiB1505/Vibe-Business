import { describe, expect, it } from "vitest";
import { AGENT_RUNTIME_PROGRAM } from "./program";
import { AGENT_RUNTIME_TOOLS } from "./protocol";

/**
 * The program that runs inside the agent sandbox, asserted rather than read.
 *
 * It cannot be executed here — it needs a 325 MB native binary, a real
 * repository and a gateway — so what is testable is its *shape*. Each of these
 * is a property that, if it silently changed, would not fail any other test in
 * this repository until a customer's run had already gone wrong.
 */

describe("the program contains no interpolation point", () => {
  /**
   * The whole reason the request arrives as JSON. If a task description, a
   * repository path or a model's output could reach program text, the sandbox
   * boundary would be protecting a program the customer helped write.
   */
  it("has no template substitution and no backtick", () => {
    expect(AGENT_RUNTIME_PROGRAM).not.toContain("${");
    expect(AGENT_RUNTIME_PROGRAM).not.toContain("`");
  });

  it("reads everything it needs from request.json", () => {
    expect(AGENT_RUNTIME_PROGRAM).toContain('readFile(dir + "/request.json", "utf8")');
  });

  /**
   * The other half of "it is a template literal": escapes.
   *
   * A backslash sequence written once instead of twice does not fail to
   * compile — it *succeeds*, and the template literal quietly turns it into the
   * character it names. `\b` inside a regex became a literal backspace and
   * shipped a program whose regular expression no longer parsed, which nothing
   * in this suite noticed because every assertion was about substrings.
   *
   * A control character is the fingerprint of that mistake, whatever escape
   * produced it, so this covers the whole class rather than the one instance.
   */
  it("carries no control character an eaten escape would have left behind", () => {
    const control = AGENT_RUNTIME_PROGRAM.match(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/);
    expect(control).toBeNull();
  });
});

describe("the verification plan is enforced, not described", () => {
  /**
   * The only place a shell command can be refused.
   *
   * The harness runs the agent's own tools inside the VM and never calls back
   * to Vibe's gateway, so a server-side check-run ceiling has nothing to
   * intercept — run #4 recorded `check_runs: 0` while running three of them.
   * `canUseTool` receives the tool's arguments, which makes `input.command` the
   * one thing in the system that exists before the command does.
   */
  it("inspects the command, not only the tool name", () => {
    expect(AGENT_RUNTIME_PROGRAM).toContain("canUseTool: async (name, input)");
    expect(AGENT_RUNTIME_PROGRAM).toContain('name === "Bash"');
    expect(AGENT_RUNTIME_PROGRAM).toContain("decide(input.command)");
  });

  /** PART G: never a silent block. The agent is told, and so is the timeline. */
  it("reports a refusal to the agent and to the feed", () => {
    expect(AGENT_RUNTIME_PROGRAM).toContain("policy.messages[refusal.reason]");
    expect(AGENT_RUNTIME_PROGRAM).toContain('emit({ t: "refused"');
  });

  /**
   * One source of truth for what a command *is*.
   *
   * Both the category table and the targeted-test pattern arrive with the
   * policy. A copy of either written into this program would be a second answer
   * to the same question, and the two would drift the first time one was
   * edited.
   */
  it("classifies commands from the shipped rules rather than its own", () => {
    expect(AGENT_RUNTIME_PROGRAM).toContain("new RegExp(rule.pattern)");
    expect(AGENT_RUNTIME_PROGRAM).toContain("new RegExp(policy.targetedTestPattern)");
    expect(AGENT_RUNTIME_PROGRAM).not.toContain("vitest|jest");
  });

  /**
   * A missing policy permits everything.
   *
   * The direction of failure matters more than the failure. A version skew that
   * left an old request without a policy must produce the behaviour Vibe had
   * before plans existed — not an agent that cannot check its own work at all.
   */
  it("permits every command when no policy was supplied", () => {
    expect(AGENT_RUNTIME_PROGRAM).toContain("const policy = request.verification || null");
    expect(AGENT_RUNTIME_PROGRAM).toContain("if (!policy) return null");
  });
});

describe("the options that are not the SDK's defaults", () => {
  /** The Claude Code preset would add WebFetch and WebSearch (Rule 41). */
  it("names its tools rather than taking the preset", () => {
    expect(AGENT_RUNTIME_PROGRAM).toContain("tools: request.tools");
    expect(AGENT_RUNTIME_PROGRAM).not.toContain("preset");
  });

  it.each([
    ["settingSources: []", "a repository CLAUDE.md is data, never configuration"],
    ["persistSession: false", "no transcript of reasoning or source on disk"],
    ["mcpServers: {}", "no tool arrives from a .mcp.json in the customer's tree"],
    ["strictMcpConfig: true", "and none from anywhere else either"],
    ["allowDangerouslySkipPermissions: false", "the permission layer stays on"],
  ])("sets %s — %s", (option) => {
    expect(AGENT_RUNTIME_PROGRAM).toContain(option);
  });

  /**
   * A sandbox has no terminal. A harness that decided to prompt would hang
   * until the wall clock expired, so every decision has to be answerable
   * without a person.
   */
  it("answers permission requests deterministically", () => {
    expect(AGENT_RUNTIME_PROGRAM).toContain("canUseTool");
    expect(AGENT_RUNTIME_PROGRAM).toContain("allowed.has(name)");
    expect(AGENT_RUNTIME_PROGRAM).toContain('behavior: "deny"');
  });
});

describe("what it reports", () => {
  it("emits progress as it goes, so a run that dies is still measurable", () => {
    expect(AGENT_RUNTIME_PROGRAM).toContain('emit({ t: "started" })');
    expect(AGENT_RUNTIME_PROGRAM).toContain('emit({ t: "turn"');
  });

  /**
   * Rule 77. There is no field for the agent's account of its own work, and
   * this is the assertion that keeps it that way — a future edit that added
   * one would have to delete a test that says why it must not.
   */
  it.each(["summary", "finalMessage", "reasoning", "thinking", "message.result"])(
    "never reads %s off the result message",
    (field) => {
      expect(AGENT_RUNTIME_PROGRAM).not.toContain(field);
    },
  );

  it("carries only a bounded error string out of the sandbox", () => {
    expect(AGENT_RUNTIME_PROGRAM).toContain("slice(0, 400)");
  });
});

describe("the tool set", () => {
  it("is local only", () => {
    for (const forbidden of ["WebFetch", "WebSearch", "Task", "NotebookEdit"]) {
      expect(AGENT_RUNTIME_TOOLS).not.toContain(forbidden);
    }
  });

  it("includes the file and shell tools the sandbox exists to make safe", () => {
    expect([...AGENT_RUNTIME_TOOLS].sort()).toEqual(
      ["Bash", "Edit", "Glob", "Grep", "Read", "Write"].sort(),
    );
  });
});
