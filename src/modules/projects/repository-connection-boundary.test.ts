import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * VB-001 M5's read boundary, enforced rather than remembered.
 *
 * > A detached repository is one Vibe was told to let go. Nothing may read from
 * > it or write to it.
 *
 * ## Why a grep is the right instrument
 *
 * Before M5 the table held one kind of thing, guaranteed by a unique
 * constraint: the repository a project is connected to. Every reader could say
 * `.eq("project_id", x).maybeSingle()` and be right. After M5 it holds two —
 * the live connection and every detached one — and that same query returns
 * multiple rows.
 *
 * The failure that matters is not the loud one. `maybeSingle()` errors on
 * multiple rows, so a project with detached history fails visibly. The quiet
 * one is a reader that lists across projects, or filters by connection id, and
 * silently includes a repository the founder disconnected: it keeps being
 * scanned, executed against, or written to, and nothing says so.
 *
 * Confining the table to one module makes "live or historical?" unavoidable —
 * there is no way to reach the rows without picking one.
 *
 * ## What a failure here means
 *
 * Not "add the file to the allowlist". It means a new reader is about to decide
 * that question implicitly. Route it through `liveConnections` (almost always
 * right), or through `anyConnections` if it genuinely wants history and can say
 * why.
 */

const SRC = join(process.cwd(), "src");
const TABLE_QUERY = /\.from\(\s*["'`]repository_connections["'`]\s*\)/;

/**
 * Comments are stripped first: the boundary module and several call sites
 * *explain* the table they no longer name directly, and a naive scan would
 * find the phrase in the prose that moved it.
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

/**
 * The boundary itself, and the test doubles that model the table.
 *
 * A fixture may name the table because it is standing in for the database, not
 * reading from it.
 */
const ALLOWED = [
  join("modules", "projects", "repository-connection.ts"),
  join("modules", "projects", "repository-connection-boundary.test.ts"),
];

function isAllowed(file: string): boolean {
  return ALLOWED.includes(file) || /\.(test|probe|canary|concurrency)\.tsx?$/.test(file);
}

describe("repository_connections is read through one boundary", () => {
  it("is queried nowhere else in src", () => {
    const offenders = sourceFiles(SRC)
      .map((file) => relative(SRC, file))
      .filter((file) => !isAllowed(file))
      .filter((file) => TABLE_QUERY.test(code(readFileSync(join(SRC, file), "utf8"))));

    expect(
      offenders,
      "a detached connection is a repository Vibe was told to let go. Read it through " +
        "liveConnections(), or through anyConnections() if you mean history and can say why",
    ).toEqual([]);
  });

  /**
   * The complement. The rule above also passes if the boundary stopped
   * filtering — which would mean every reader silently got history back.
   */
  it("filters detached rows out of the live query", () => {
    const boundary = code(
      readFileSync(join(SRC, "modules", "projects", "repository-connection.ts"), "utf8"),
    );

    const live = boundary.slice(boundary.indexOf("export function liveConnections"));
    expect(live.slice(0, live.indexOf("export function anyConnections"))).toContain(
      'is("detached_at", null)',
    );
  });

  /**
   * The picker is the one reader whose mistake is invisible and permanent: a
   * detached repository counted as connected stays greyed out forever, which
   * turns Disconnect into a one-way door.
   */
  it("counts only live connections as already connected", () => {
    const picker = code(
      readFileSync(join(SRC, "modules", "projects", "connected-repositories.ts"), "utf8"),
    );

    expect(picker).toContain("liveConnections(");
    expect(picker).not.toContain("anyConnections(");
  });
});
