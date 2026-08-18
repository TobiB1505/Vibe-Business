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
