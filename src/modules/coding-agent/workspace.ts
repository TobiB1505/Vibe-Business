import type { SandboxCommand } from "@/modules/validation/commands";

/**
 * The isolated workspace an agent acts on (EXECUTION CORE-4 §7, §8, §52).
 *
 * ## What this interface is, and what it deliberately is not
 *
 * It is the *whole* set of effects an agent can have on the world. Not the
 * subset we expose today — the whole set. There is no escape hatch, no generic
 * `exec`, no `fetch`, no git operation and no way to name a machine. An effect
 * that is not a method here cannot be requested, which is what makes §11's
 * "default deny must be real" a fact about the type rather than a check
 * somebody has to remember.
 *
 * It is **not** a sandbox abstraction. `validation/sandbox-port.ts` already
 * owns that, and this sits on top of it: a `SandboxHandle` can run any command
 * Vibe constructs, expose ports and snapshot a filesystem, and an agent must be
 * able to do none of those things. Narrowing happens here rather than by
 * convention at the call site.
 *
 * ## Why the same three-value read result as validation
 *
 * `absent` and `too_large` are different answers and collapsing them costs
 * real runs — Sprint 10A records a lockfile silently recorded as *unverified*
 * because a truncated prefix was hashed against a whole file. An agent needs
 * the same distinction for a different reason: "this file does not exist" is
 * information it should act on, and "this file is bigger than your budget" is
 * information it should route around, and a single `null` teaches it to
 * conclude the wrong one.
 *
 * ## Where the trust boundary sits
 *
 * ```
 * Vibe process        the agent provider, the gateway, this interface   TRUSTED
 * ───────────────────────────────────────────────────────────────────────────
 * Sandbox VM          the customer's source, its dependencies, its build UNTRUSTED
 * ```
 *
 * Every implementation of this interface must keep that line: no credential
 * crosses it, and nothing crossing back is treated as an instruction (§51).
 */

export type WorkspaceReadResult =
  | { kind: "content"; content: string }
  | { kind: "absent" }
  | { kind: "too_large" };

export type WorkspaceWriteResult = { ok: true } | { ok: false; reason: string };

/** One entry from a bounded directory listing. Never a full recursive walk. */
export type WorkspaceEntry = {
  /** Repository-relative. */
  path: string;
  kind: "file" | "directory";
};

/** One match from a bounded content search. */
export type WorkspaceMatch = {
  path: string;
  /** 1-based. */
  line: number;
  /** The matching line, bounded and never re-executed. */
  text: string;
};

export type WorkspaceCommandResult = {
  exitCode: number;
  durationMs: number;
  /** Combined output. Sanitized and bounded by the caller before storage (§24). */
  output: string;
  timedOut: boolean;
};

export interface AgentWorkspace {
  /**
   * Lists one directory, bounded.
   *
   * One directory rather than a tree, because a recursive listing of an
   * unfamiliar repository is exactly the unbounded crawl Rule 27 forbids — and
   * because an agent that has to walk deliberately produces a `filesRead`
   * count that means something.
   */
  list(input: { path: string; maxEntries: number }): Promise<readonly WorkspaceEntry[]>;

  /** Bounded content search. The query is a literal, never a shell fragment. */
  search(input: {
    query: string;
    /** Restricts the search to a subtree. Repository-relative. */
    path: string;
    maxResults: number;
  }): Promise<readonly WorkspaceMatch[]>;

  read(input: { path: string; maxBytes: number }): Promise<WorkspaceReadResult>;

  write(input: { path: string; content: string }): Promise<WorkspaceWriteResult>;

  remove(input: { path: string }): Promise<WorkspaceWriteResult>;

  /**
   * Runs one **Vibe-constructed** command.
   *
   * The type says so: `SandboxCommand` is `{command, args[]}`, never a string,
   * so there is no interpolation point even in principle. The gateway is the
   * only caller and it builds the command from a check *name* the agent chose
   * out of a closed set (`AGENT_CHECK_NAMES`).
   */
  run(input: { command: SandboxCommand; timeoutMs: number }): Promise<WorkspaceCommandResult>;
}
