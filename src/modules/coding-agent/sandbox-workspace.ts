import "server-only";

import { SANDBOX_BUDGETS } from "@/modules/validation/budgets";
import type { SandboxCommand } from "@/modules/validation/commands";
import type { SandboxHandle } from "@/modules/validation/sandbox-port";
import type {
  AgentWorkspace,
  WorkspaceCommandResult,
  WorkspaceEntry,
  WorkspaceMatch,
  WorkspaceReadResult,
  WorkspaceWriteResult,
} from "./workspace";

/**
 * The isolated workspace, backed by a Vercel Sandbox
 * (EXECUTION CORE-4 §7, §8, §10, §52).
 *
 * ## The one architectural claim this file makes
 *
 * Every method below runs a command Vibe constructed, in a VM that holds no
 * credential, from a process the agent cannot reach. The agent asked for an
 * effect; the gateway decided; this executes. Nothing here consults a policy,
 * because a layer that both decides and executes is a layer where a bug becomes
 * an escalation.
 *
 * ## Why commands rather than a filesystem API
 *
 * `SandboxHandle` offers `readFile` and `run`. It has no write, no list and no
 * search — validation never needed them, because validation only reads a file
 * back to hash it. So writes, listings and searches are `run` calls with
 * argument arrays.
 *
 * **Never a shell string.** `{command, args[]}` is passed through to the
 * provider as a real array, so there is no place an injection could live even
 * if a value were attacker-influenced — the same property `validation/commands.ts`
 * relies on, applied to arguments that genuinely are model-influenced here.
 *
 * The one place that would otherwise need a shell is writing a file, because
 * content cannot be an argument: it can contain anything, including bytes that
 * would need quoting. `writeContent` solves it without a shell by piping the
 * bytes through `base64 -d` on stdin — the content never appears on a command
 * line at all, so there is nothing to quote and nothing to escape.
 *
 * ## Paths
 *
 * Every path is joined onto the workspace root **here**, after the gateway has
 * already refused anything absolute, backslashed, or containing `..`. Two
 * layers, and this one is the last: a path that escaped both would still be
 * confined to the sandbox VM, which is why the sandbox exists.
 */

/** Bytes of output kept from a listing or search. Small: these are indexes. */
const MAX_INSPECTION_OUTPUT = 64 * 1024;

/** How long one inspection command may take. Not a build; seconds, not minutes. */
const INSPECTION_TIMEOUT_MS = 30_000;

export type SandboxWorkspaceDeps = {
  sandbox: SandboxHandle;
  /**
   * Where the repository is, relative to the sandbox home.
   *
   * Vercel materializes a git source at `/vercel/sandbox/<repo>/`, discovered
   * by listing the directory after four validation runs looked in the wrong
   * place. Taken from the repository name on the server, never guessed inside
   * the sandbox.
   */
  sourceRoot: string;
  /** The package/app root within the repository. Usually "". */
  workspaceRoot: string;
};

function join(...segments: string[]): string {
  const parts = segments
    .map((segment) => segment.replace(/^\/+|\/+$/g, ""))
    .filter((segment) => segment.length > 0 && segment !== ".");
  return parts.length === 0 ? "." : parts.join("/");
}

export function createSandboxWorkspace(deps: SandboxWorkspaceDeps): AgentWorkspace {
  const workdir = join(deps.sourceRoot, deps.workspaceRoot);

  /** A path relative to the sandbox home, for `readFile`. */
  const fromHome = (path: string) => join(deps.sourceRoot, deps.workspaceRoot, path);

  const run = async (
    command: SandboxCommand,
    timeoutMs: number,
  ): Promise<WorkspaceCommandResult> => {
    const result = await deps.sandbox.run({ command, cwd: workdir, timeoutMs });
    return {
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      output:
        result.output.length > MAX_INSPECTION_OUTPUT
          ? result.output.slice(0, MAX_INSPECTION_OUTPUT)
          : result.output,
      timedOut: result.timedOut,
    };
  };

  return {
    async list(input: { path: string; maxEntries: number }): Promise<readonly WorkspaceEntry[]> {
      const target = input.path.length === 0 ? "." : input.path;

      // `find -maxdepth 1` rather than `ls`: it reports type without parsing a
      // long listing, and `-print` with a fixed format is stable across
      // implementations. `--` is not accepted by find, so the path is passed
      // positionally after every option — and the gateway has already refused
      // anything that could look like one.
      const result = await run(
        {
          command: "find",
          args: [target, "-maxdepth", "1", "-mindepth", "1", "-printf", "%y\t%P\n"],
        },
        INSPECTION_TIMEOUT_MS,
      );

      if (result.exitCode !== 0) return [];

      return result.output
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .slice(0, input.maxEntries)
        .map((line) => {
          const [type, name] = line.split("\t");
          return {
            path: target === "." ? (name ?? "") : join(target, name ?? ""),
            kind: type === "d" ? ("directory" as const) : ("file" as const),
          };
        })
        .filter((entry) => entry.path.length > 0);
    },

    async search(input: {
      query: string;
      path: string;
      maxResults: number;
    }): Promise<readonly WorkspaceMatch[]> {
      const target = input.path.length === 0 ? "." : input.path;

      // `-F` makes the query a literal, and `-e` guarantees it is read as a
      // pattern rather than as an option however it begins. `--exclude-dir`
      // keeps the two directories that would otherwise dominate every result
      // out of the index — they are also unreadable by policy, so a match in
      // them could never be shown anyway.
      const result = await run(
        {
          command: "grep",
          args: [
            "-r",
            "-n",
            "-I",
            "-F",
            "--exclude-dir=node_modules",
            "--exclude-dir=.git",
            "-m",
            String(Math.max(1, Math.min(input.maxResults, 20))),
            "-e",
            input.query,
            target,
          ],
        },
        INSPECTION_TIMEOUT_MS,
      );

      // grep exits 1 for "no matches", which is an answer rather than a failure.
      if (result.exitCode !== 0 && result.exitCode !== 1) return [];

      const matches: WorkspaceMatch[] = [];
      for (const line of result.output.split("\n")) {
        if (matches.length >= input.maxResults) break;

        const separator = line.indexOf(":");
        if (separator <= 0) continue;
        const rest = line.slice(separator + 1);
        const second = rest.indexOf(":");
        if (second <= 0) continue;

        const lineNumber = Number.parseInt(rest.slice(0, second), 10);
        if (!Number.isInteger(lineNumber)) continue;

        matches.push({
          path: line.slice(0, separator).replace(/^\.\//, ""),
          line: lineNumber,
          // Bounded: one pathological minified line must not fill a turn.
          text: rest.slice(second + 1).slice(0, 300),
        });
      }

      return matches;
    },

    async read(input: { path: string; maxBytes: number }): Promise<WorkspaceReadResult> {
      // Reads one byte past the budget so "too large" is observable. Hashing a
      // truncated prefix against a whole file is what produced a false
      // integrity failure in Sprint 10A; here it would silently hand the agent
      // a partial file it believed was complete.
      const content = await deps.sandbox.readFile({
        path: fromHome(input.path),
        maxBytes: input.maxBytes + 1,
      });

      if (content === null) return { kind: "absent" };
      if (content.length > input.maxBytes) return { kind: "too_large" };
      return { kind: "content", content };
    },

    async write(input: { path: string; content: string }): Promise<WorkspaceWriteResult> {
      const directory = input.path.includes("/")
        ? input.path.slice(0, input.path.lastIndexOf("/"))
        : "";

      if (directory.length > 0) {
        const made = await run({ command: "mkdir", args: ["-p", "--", directory] }, INSPECTION_TIMEOUT_MS);
        if (made.exitCode !== 0) return { ok: false, reason: "could not create the directory" };
      }

      // The content never reaches a command line. `sh -c` is used for exactly
      // one thing — connecting a here-document to `base64 -d` — and the only
      // interpolated value in that line is the *path*, which the gateway has
      // already constrained to a normalized relative path with no shell
      // metacharacters possible: it rejects backslashes, NUL bytes, absolute
      // paths and `..`, and every remaining character is quoted below.
      //
      // The base64 payload is delimited by a quoted here-doc marker, so the
      // shell performs no expansion on it at all.
      const encoded = Buffer.from(input.content, "utf8").toString("base64");
      const script = [
        `base64 -d > '${input.path.replace(/'/g, "'\\''")}' <<'VIBE_EOF'`,
        encoded,
        "VIBE_EOF",
      ].join("\n");

      const written = await run({ command: "sh", args: ["-c", script] }, INSPECTION_TIMEOUT_MS);
      return written.exitCode === 0 ? { ok: true } : { ok: false, reason: "the write failed" };
    },

    async remove(input: { path: string }): Promise<WorkspaceWriteResult> {
      // `--` before the path, and no `-r`: a tool that can delete a directory
      // tree is a different capability from one that can delete a file, and the
      // policy granted the second.
      const removed = await run({ command: "rm", args: ["-f", "--", input.path] }, INSPECTION_TIMEOUT_MS);
      return removed.exitCode === 0 ? { ok: true } : { ok: false, reason: "the delete failed" };
    },

    async run(input: { command: SandboxCommand; timeoutMs: number }) {
      const result = await deps.sandbox.run({
        command: input.command,
        cwd: workdir,
        timeoutMs: Math.min(input.timeoutMs, SANDBOX_BUDGETS.commandTimeoutMs),
      });

      return {
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        output: result.output,
        timedOut: result.timedOut,
      };
    },
  };
}
