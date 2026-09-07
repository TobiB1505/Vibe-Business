import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A table this product reads is a table this product writes.
 *
 * ## The defect this closes, found on the console's first look at production
 *
 * The internal console's Agent panel read `agent_tool_events`. That table has
 * **zero rows and no writer**: it belongs to the tool-gateway topology
 * [ADR 0027](../../../docs/decisions/0027-coding-agent-provider-and-tool-gateway.md) described, and
 * [ADR 0029](../../../docs/decisions/0029-agent-runtime-placement-and-credential-broker.md) moved the harness inside the sandbox before anything
 * ever wrote one. Every query succeeded. Every count was zero. The panel
 * rendered "0 tool calls" under a heading about what the agent did, and there
 * was nothing to see because there was nothing to write it.
 *
 * That is the worst shape a defect can take here: **a well-formed wrong
 * answer.** No error, no empty state, no failing test — a number that reads
 * like an observation and is an artefact of reading the wrong place. The same
 * shape as `read-bounds.test.ts`'s truncating read, and closed the same way.
 *
 * ## The rule
 *
 * Every table named in a `.from("…")` anywhere in `src/` must be written
 * somewhere Vibe controls: a `.insert`/`.update`/`.upsert`/`.delete` in `src/`,
 * or an `insert into` / `update … set` inside a database function in
 * `supabase/migrations/`. The migration half matters — several tables here are
 * written only by `SECURITY DEFINER` functions, and a rule that looked at
 * TypeScript alone would report a dozen tables that are written perfectly well.
 *
 * ## Why an allowlist with arguments rather than a rule with exceptions
 *
 * Because "this table is read and never written" is sometimes correct, and the
 * reason is never derivable from the code — it is always a decision somebody
 * made. So it is written down, the same as `read-bounds.test.ts` and
 * `service-boundary.test.ts` do. One entry today, and it is the honest kind: a
 * writer that was deliberately deleted, whose rows still have to be readable.
 */

const SRC = join(process.cwd(), "src");
const MIGRATIONS = join(process.cwd(), "supabase", "migrations");

const PERMITTED: readonly { table: string; why: string }[] = [
  {
    table: "review_browser_usage",
    why:
      "Its writer was deleted on purpose. ADR 0075 removed the visual review capture path once " +
      "the last artifact passed retention; the rows it already produced stay readable, because " +
      "`credits/reconciliation.ts` still has to explain historical provider spend. A table that " +
      "keeps its rows and loses its writer is a decision, not drift.",
  },
];

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, found);
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    // A test's fixture writes are not the product's writes, and a probe is not
    // a code path a customer reaches.
    if (/\.(test|probe|concurrency)\.tsx?$/.test(entry)) continue;
    found.push(full);
  }
  return found;
}

const READ = /\.from\("([a-z_0-9]+)"\)/g;
const WRITE = /\.from\("([a-z_0-9]+)"\)\s*\.\s*(?:insert|update|upsert|delete)/g;
const SQL_CREATE = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_0-9]+)/gi;
const SQL_INSERT = /insert\s+into\s+(?:public\.)?([a-z_0-9]+)/gi;
const SQL_UPDATE = /update\s+(?:public\.)?([a-z_0-9]+)\s+set/gi;

function matches(pattern: RegExp, body: string): string[] {
  return [...body.matchAll(pattern)].map((match) => match[1]!);
}

const readers = new Map<string, Set<string>>();
const writtenInSrc = new Set<string>();

for (const path of sourceFiles(SRC)) {
  const body = readFileSync(path, "utf8");
  const file = relative(process.cwd(), path);

  for (const table of matches(READ, body)) {
    const seen = readers.get(table) ?? new Set<string>();
    seen.add(file);
    readers.set(table, seen);
  }
  for (const table of matches(WRITE, body)) writtenInSrc.add(table);
}

const migrationSql = readdirSync(MIGRATIONS)
  .filter((entry) => entry.endsWith(".sql"))
  .map((entry) => readFileSync(join(MIGRATIONS, entry), "utf8"))
  .join("\n");

const createdInSql = new Set(matches(SQL_CREATE, migrationSql));

const writtenInSql = new Set([
  ...matches(SQL_INSERT, migrationSql),
  ...matches(SQL_UPDATE, migrationSql),
]);

const orphans = [...readers.entries()]
  .filter(([table]) => !writtenInSrc.has(table) && !writtenInSql.has(table))
  .filter(([table]) => !PERMITTED.some((entry) => entry.table === table))
  .map(([table, files]) => `${table}: read by ${[...files].sort().join(", ")}, written by nothing`);

/**
 * The other half of the same boundary: a table read must exist.
 *
 * Cheaper than the rule above and catches a coarser mistake — a renamed table,
 * a typo in a string literal, a read added against a table whose migration was
 * never committed. `supabase/migrations/` is the schema's source of truth
 * (rule 34), so a `.from("…")` naming something no migration creates is a read
 * that can only fail in production.
 *
 * It cannot see the *other* direction of drift, and that is worth stating: a
 * table applied to the remote database with no file in this repository is
 * invisible from here, because nothing in CI can reach that database. That one
 * is `pnpm db:status`'s job, and it has to actually be run.
 */
describe("a table this product reads exists in the schema it ships", () => {
  it("finds no read against a table no migration creates", () => {
    const unknown = [...readers.entries()]
      .filter(([table]) => !createdInSql.has(table))
      .map(([table, files]) => `${table}: read by ${[...files].sort().join(", ")}, created by no migration`);

    expect(unknown).toEqual([]);
  });

  it("sees the tables the migrations create", () => {
    expect(createdInSql.size).toBeGreaterThan(40);
  });
});

describe("a table this product reads is a table this product writes", () => {
  it("sees enough of the schema for the rule to mean anything", () => {
    // A walk that silently returned nothing would make every assertion below
    // pass while checking nothing — the failure mode this repository has hit
    // in four action-allowlist tests before.
    expect(readers.size).toBeGreaterThan(30);
    expect(writtenInSrc.size).toBeGreaterThan(30);
    expect(writtenInSql.size).toBeGreaterThan(10);
  });

  it("finds no table that is read and written by nothing", () => {
    expect(orphans).toEqual([]);
  });

  it("counts a table written only by a database function as written", () => {
    // Several tables here are written exclusively by SECURITY DEFINER
    // functions. Missing that would report them as orphans and force a dozen
    // allowlist entries that document nothing.
    expect(writtenInSql.has("billing_credit_ledger")).toBe(true);
  });

  it("states a reason for every table it permits", () => {
    for (const entry of PERMITTED) {
      expect(entry.why.length, entry.table).toBeGreaterThan(80);
      // An entry for a table nothing reads any more is stale, and a stale
      // exception is how an allowlist stops being a review record.
      expect(readers.has(entry.table), `${entry.table} is permitted but no longer read`).toBe(true);
    }
  });
});
