import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * VB-001 M1a's invariant, enforced rather than remembered.
 *
 * > **No Data API role can start a project cascade.**
 *
 * ## Why a grep is the right instrument here
 *
 * `DELETE ON public.projects` is not an ordinary privilege. A
 * referential-integrity cascade runs with the *referencing* table's owner
 * authority — `current_user` inside the cascaded `execution_specs` trigger is
 * `postgres` even when the caller is `service_role` — so revoking `DELETE` on
 * `execution_specs` guards direct deletion of a spec and nothing else. The
 * privilege that actually gates the cascade is the one on the root table, and
 * while a browser-scoped role holds it, M1's lifecycle marker is a forgeable
 * custom GUC standing between a user and their own execution history
 * ([2026-08-26] correction, ADR 0056 §5).
 *
 * Migration B revokes it. This test is the other half: a `.from("projects")
 * .delete()` reintroduced in application code would not fail loudly against
 * the migrated database — it would fail as a `permission denied` inside a
 * result the caller may well map to a generic error, which is exactly how a
 * capability quietly comes back. Someone would then "fix" it with a grant.
 *
 * ## What a failure here means
 *
 * Not "add the file to the allowlist". It means a project deletion is being
 * set up outside the two narrow database functions that own it, and the choice
 * is either to route it through them or to argue for a third — never to
 * re-grant the privilege.
 *
 * The two that own it, both verifying ownership in their own body:
 *
 *   * `disconnect_project(uuid, uuid)`      — temporary; sets no lifecycle
 *                                             marker, so execution history
 *                                             still refuses the cascade.
 *                                             Removed by M5.
 *   * `erase_project_lifecycle(uuid, uuid)` — M1; service-role only.
 */

const SRC = join(process.cwd(), "src");

/** A `.from("projects")` … `.delete()` pair, however the chain is wrapped. */
const PROJECT_DELETE = /\.from\(\s*["'`]projects["'`]\s*\)[\s\S]{0,200}?\.delete\(\s*\)/;

/**
 * Comments are stripped before matching, and that is not cosmetic: the two
 * modules this rule applies to *explain* the delete they no longer perform, so
 * a naive scan would find the phrase in the prose that removed it — the same
 * trap `execution-contract/security.test.ts` documents for `security definer`.
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
 * Test doubles that *assert* the absence of a table write by throwing on
 * `.from()`, and this file, which quotes the pattern it forbids.
 */
const NOT_PRODUCTION_CODE = /\.(test|probe|canary|concurrency)\.tsx?$/;

describe("no application code deletes a project directly", () => {
  it("issues no .from(\"projects\").delete() anywhere in src", () => {
    const offenders = sourceFiles(SRC)
      .filter((file) => !NOT_PRODUCTION_CODE.test(file))
      .filter((file) => PROJECT_DELETE.test(code(readFileSync(file, "utf8"))))
      .map((file) => relative(SRC, file));

    expect(
      offenders,
      "DELETE on public.projects is revoked from every Data API role (VB-001 M1a, Migration B). " +
        "Route the deletion through disconnect_project() or erase_project_lifecycle() — " +
        "never by re-granting the privilege",
    ).toEqual([]);
  });

  /**
   * The complement. The rule above would also pass if both call sites had been
   * deleted outright rather than migrated, which would mean the capability was
   * lost rather than narrowed.
   */
  it("routes both project write paths through their narrow functions", () => {
    const connect = readFileSync(join(SRC, "modules", "projects", "connect.ts"), "utf8");
    const disconnect = readFileSync(join(SRC, "modules", "projects", "disconnect.ts"), "utf8");

    expect(code(connect)).toContain('rpc("create_project_with_repository"');
    expect(code(disconnect)).toContain('rpc("disconnect_project"');
  });
});
