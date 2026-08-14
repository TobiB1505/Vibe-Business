import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Reading CHECK constraints out of the migration history (Sprint 9, 10B, 11A).
 *
 * ## Why this exists
 *
 * A TypeScript union and a SQL CHECK express the same rule in two places that
 * nothing forces to agree, and the in-memory test database does not evaluate
 * constraints — so no behavioural test can see them drift. This project has now
 * been bitten twice: a capability bump that would have failed every INSERT
 * while 1376 tests stayed green, and an `operation_type` that did not permit
 * `change_preview` on the live database.
 *
 * ## Why it is table-aware
 *
 * The first version of this helper took the last `check (<column> in (...))`
 * anywhere in the migration history. That worked until a second table used the
 * same column name: adding `review_browser_usage.status` silently redirected
 * the *preview session* status assertion at the wrong constraint, and the test
 * failed with a set it had never been written about.
 *
 * A column name is not a unique key across a schema. The table is part of the
 * question, so it is part of the lookup.
 */

const MIGRATIONS_DIR = join(process.cwd(), "supabase/migrations");

/**
 * Every migration, oldest first, with SQL comments stripped.
 *
 * Comments go first and that is not cosmetic: this project's constraints carry
 * explanatory comments containing parentheses — "(§7)", "(Sprint 10B-2 §23)" —
 * and a naive `[^)]*` scan truncates the value list at the first one. An
 * earlier draft reported four permitted stages out of twenty-five.
 */
export function migrationSql(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => readFileSync(join(MIGRATIONS_DIR, name), "utf8").replace(/--[^\n]*/g, ""));
}

/** The body of `create table public.<table> ( … );`, or null. */
function createTableBody(sql: string, table: string): string | null {
  const start = sql.search(new RegExp(`create\\s+table\\s+(?:public\\.)?${table}\\s*\\(`, "i"));
  if (start === -1) return null;

  // Terminated by the statement's own `);` at the start of a line, which is how
  // every table in this schema is written. Brace counting would be more general
  // and less readable, and there is nothing here it would buy.
  const end = sql.indexOf("\n);", start);
  return end === -1 ? sql.slice(start) : sql.slice(start, end);
}

/**
 * Values permitted by the newest `check (<column> in (...))` for one table.
 *
 * Looks in two places, because this schema uses both forms: inline in the
 * table definition, and `alter table … add constraint … check (…)` when a
 * later migration widens an existing enum. The last definition wins, exactly as
 * it does in Postgres — constraints are dropped and re-added, so an earlier,
 * narrower list is history.
 *
 * Anchored on `check` specifically, so a partial index predicate — `where
 * status in ('capturing', 'ready')` — is never mistaken for the constraint.
 * That predicate is a deliberate *subset*, and reading it as the constraint
 * would quietly weaken every assertion into a tautology.
 */
export function checkedValues(table: string, column: string): string[] {
  const pattern = new RegExp(`check\\s*\\(\\s*${column} in \\(([^)]*)\\)`, "gi");
  let allowed: string[] | null = null;

  for (const sql of migrationSql()) {
    // `alter table public.<table> … check (<column> in (…))`, which may span
    // statements, so each alter block is isolated before matching.
    const alters = [
      ...sql.matchAll(
        new RegExp(`alter\\s+table\\s+(?:public\\.)?${table}\\b([\\s\\S]*?);`, "gi"),
      ),
    ];
    for (const alter of alters) {
      const match = [...alter[1].matchAll(pattern)].at(-1);
      if (match) allowed = [...match[1].matchAll(/'([^']+)'/g)].map((value) => value[1]);
    }

    const body = createTableBody(sql, table);
    if (body) {
      const match = [...body.matchAll(pattern)].at(-1);
      if (match) allowed = [...match[1].matchAll(/'([^']+)'/g)].map((value) => value[1]);
    }
  }

  if (allowed === null) {
    throw new Error(`no ${table}.${column} CHECK constraint found in migrations`);
  }
  return allowed;
}
