import "server-only";

import type { SandboxHandle } from "@/modules/validation/sandbox-port";

/**
 * Writing a Vibe-authored file into a sandbox, without a command line.
 *
 * The content is piped through `base64 -d` on stdin, so it never appears as an
 * argument and there is nothing to quote — the same technique
 * `sandbox-workspace.ts` uses, and for the same reason. The only interpolated
 * value is a path the caller constructs.
 *
 * ## Why this is shared rather than duplicated
 *
 * Because the alternative was writing a second way to get bytes into a sandbox,
 * and the second way is where the mistake happened. The baseline listing was
 * captured with `find … > 'path'` as a shell line, built by joining tokens that
 * `pruneExpression` produces for an *argument array* — so `(` and `)` arrived at
 * `sh -c` unquoted, and the first real run died six seconds in with a shell
 * syntax error reported as `agent_workspace_unavailable`.
 *
 * One writer, already exercised by every agent run that has ever started.
 */
export async function writeSandboxTextFile(
  sandbox: SandboxHandle,
  input: { path: string; content: string },
): Promise<boolean> {
  const encoded = Buffer.from(input.content, "utf8").toString("base64");
  const script = [
    `base64 -d > '${input.path.replace(/'/g, "'\\''")}' <<'VIBE_EOF'`,
    encoded,
    "VIBE_EOF",
  ].join("\n");

  const written = await sandbox.run({
    command: { command: "sh", args: ["-c", script] },
    cwd: ".",
    timeoutMs: 30_000,
  });

  return written.exitCode === 0;
}
