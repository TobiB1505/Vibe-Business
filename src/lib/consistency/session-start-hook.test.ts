import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The session-start hook reports migration drift, in both directions.
 *
 * ## Why a shell script has a test
 *
 * Because the first version of it reported **nothing at all, cheerfully**. It
 * split `supabase migration list` on `|` and read the wrong two fields — the
 * table is `Local | Remote | Time`, and the parse was one column across — so
 * every row fell through and the hook printed "Local files and the remote
 * database agree" over a database with two migrations this repository does not
 * have.
 *
 * That is the exact failure the hook exists to catch, reproduced inside the
 * hook: a check that silently matches nothing looks identical to a system that
 * is fine. It was found by running it against a hand-written fixture, which is
 * this file.
 *
 * ## How it runs the real thing
 *
 * No mocking of the script. A temporary project directory, a `pnpm` shim on
 * `PATH` that prints a fixed `migration list` table, and the hook executed the
 * way a session executes it. What is asserted is what an operator would read.
 */

const HOOK = join(process.cwd(), ".claude/hooks/session-start.sh");

/** The shape `supabase migration list` prints: three columns, header, rule. */
const TABLE = `
   Local          | Remote         | Time (UTC)
  ----------------|----------------|---------------------
   20260809210125 | 20260809210125 | 2026-08-09 21:01:25
                  | 20260906210832 | 2026-09-06 21:08:32
                  | 20260907115045 | 2026-09-07 11:50:45
   20260907210000 |                | 2026-09-07 21:00:00
`;

function runHook(options: { table?: string; token?: string; url?: string } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "vibe-hook-"));
  const bin = join(dir, "bin");
  mkdirSync(bin, { recursive: true });
  // Present, so the hook does not try to link. Linking is the one step this
  // test cannot exercise without a real project.
  mkdirSync(join(dir, "supabase", ".temp"), { recursive: true });
  writeFileSync(join(dir, "supabase", ".temp", "project-ref"), "dcbwlctscooefwnivxzv\n");

  const shim = join(bin, "pnpm");
  writeFileSync(
    shim,
    `#!/bin/bash\nif [ "$1" = "db:status" ]; then cat <<'TABLE'\n${options.table ?? TABLE}\nTABLE\nfi\nexit 0\n`,
  );
  chmodSync(shim, 0o755);

  return execFileSync("bash", [HOOK], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      CLAUDE_PROJECT_DIR: dir,
      SUPABASE_ACCESS_TOKEN: options.token ?? "test-token",
      NEXT_PUBLIC_SUPABASE_URL: options.url ?? "https://dcbwlctscooefwnivxzv.supabase.co",
    },
  });
}

describe("the session-start drift report", () => {
  it("names the migrations applied remotely that this repository does not carry", () => {
    const output = runHook();

    expect(output).toContain("APPLIED REMOTELY, NOT IN THIS REPOSITORY");
    expect(output).toContain("20260906210832");
    expect(output).toContain("20260907115045");
  });

  it("names the migration files that have not been applied", () => {
    const output = runHook();

    expect(output).toContain("IN THIS REPOSITORY, NOT YET APPLIED");
    expect(output).toContain("20260907210000");
  });

  it("does not report a version that exists on both sides", () => {
    // The one row that is fine. A report that listed it would drown the two
    // that are not.
    const output = runHook();
    const listed = output.split("Migration drift")[1] ?? "";
    expect(listed).not.toContain("20260809210125");
  });

  it("says both sides agree when they do", () => {
    const output = runHook({
      table: `
   Local          | Remote         | Time (UTC)
  ----------------|----------------|---------------------
   20260809210125 | 20260809210125 | 2026-08-09 21:01:25
`,
    });

    expect(output).toContain("Local files and the remote database agree");
    expect(output).not.toContain("APPLIED REMOTELY");
  });

  it("degrades quietly, and says why, with no token", () => {
    // A session that cannot reach the database is an ordinary session. The hook
    // must never be the reason one fails to start.
    const output = runHook({ token: "" });

    expect(output).toContain("SUPABASE_ACCESS_TOKEN is not set");
    expect(output).not.toContain("APPLIED REMOTELY");
  });

  it("refuses to guess a project ref it cannot derive (rule 32)", () => {
    const output = runHook({ url: "https://example.com" });

    expect(output).toContain("Not guessing one");
  });
});
