import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AUDIT_TRAIL_RETENTION_MONTHS,
  NEVER_SWEPT_BY_AGE,
  OPERATIONAL_EVENT_RETENTION_DAYS,
  RETENTION_SWEEP_JOB_NAME,
  RETENTION_SWEEP_SCHEDULE,
  SWEPT_TABLES,
} from "./periods";

/**
 * The retention periods exist twice, and this is what stops them diverging.
 *
 * ADR 0068 §7 puts the periods in code and nowhere else. The sweep runs as a
 * `pg_cron` job inside Postgres (ADR 0069), and SQL cannot import TypeScript —
 * so the migration carries a second copy of every interval, and nothing except
 * this file forces the two to agree.
 *
 * The instrument is the one Sprint 0118 built for the agent poll interval and
 * the cost divisor derived from it: read both files as text. Importing the SQL
 * is not possible, and parsing it properly would be a second implementation of
 * the thing under test.
 *
 * ## The second half is the more important one
 *
 * A wrong period deletes rows early. **A wrong table deletes rows that
 * authorize things.** `operation_runs` is the parent of six `on delete cascade`
 * edges, so an age sweep of it would take the `prepared_changes`,
 * `review_artifacts` and `validation_runs` a human approval binds to under rule
 * 67 — and ADR 0068 §5 as originally worded asked for exactly that. Two more of
 * its "operational" tables turned out to be billing sources.
 *
 * The sweep is an allowlist, so none of those is reachable today. This asserts
 * that a future widening cannot make one reachable without a test going red.
 */

const MIGRATION = join(process.cwd(), "supabase/migrations/20260902103614_retention_sweep.sql");

function migration(): string {
  return readFileSync(MIGRATION, "utf8");
}

/**
 * The function body only — everything between `as $$` and the closing `$$;`.
 *
 * The prose above it names `operation_runs`, `sandbox_usage_events` and the
 * billing graph on purpose, to say why they are excluded. Searching the whole
 * file for a forbidden table would therefore fail on the comment that exists to
 * prevent the mistake, so the assertions below read the body and the docblock
 * assertions read the file.
 */
function sweepBody(): string {
  const source = migration();
  const start = source.indexOf("as $$");
  const end = source.indexOf("$$;", start);
  expect(start, "the sweep function's body delimiters").toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("the SQL periods are the TypeScript periods (ADR 0068 §7)", () => {
  it.each(SWEPT_TABLES)("deletes from $table older than $interval", ({ table, interval }) => {
    // The whole statement, not the table and the interval separately: the two
    // appearing anywhere in the body would pass while pairing them wrongly.
    expect(sweepBody()).toContain(
      `delete from public.${table} where created_at < now() - interval '${interval}'`,
    );
  });

  it("states each period exactly once, so a table cannot be swept twice", () => {
    const body = sweepBody();
    for (const { table } of SWEPT_TABLES) {
      expect(body.match(new RegExp(`delete from public\\.${table}\\b`, "g"))).toHaveLength(1);
    }
  });

  it("sweeps nothing the constants do not name", () => {
    const swept = [...sweepBody().matchAll(/delete from public\.(\w+)/g)].map((m) => m[1]);
    expect(swept.sort()).toEqual(SWEPT_TABLES.map((t) => t.table).sort());
  });

  it("sweeps agent_execution_events at the period the economy horizon assumes", () => {
    // `metric-availability.ts` sets its harness-evidence horizon from
    // OPERATIONAL_EVENT_RETENTION_DAYS. If this table were ever swept on a
    // different cadence, that horizon would silently describe the wrong date.
    const agentEvents = SWEPT_TABLES.find((t) => t.table === "agent_execution_events");
    expect(agentEvents?.interval).toBe(`${OPERATIONAL_EVENT_RETENTION_DAYS} days`);
  });

  it("uses the two periods the class table decided, and no third one", () => {
    const intervals = new Set(SWEPT_TABLES.map((t) => t.interval));
    expect(intervals).toEqual(
      new Set([`${OPERATIONAL_EVENT_RETENTION_DAYS} days`, `${AUDIT_TRAIL_RETENTION_MONTHS} months`]),
    );
  });

  it("measures age by created_at everywhere", () => {
    // occurred_at and started_at are supplied by the writer and say when the
    // event happened; created_at says how long Vibe has held the row, which is
    // the question a retention period asks.
    expect(sweepBody()).not.toMatch(/where\s+(occurred_at|started_at)\s*</);
  });
});

describe("the sweep cannot reach what must not be swept (ADR 0069 §5)", () => {
  it.each(NEVER_SWEPT_BY_AGE)("never deletes from $table", ({ table }) => {
    expect(sweepBody()).not.toContain(`delete from public.${table}`);
  });

  it("names no table outside the allowlist at all", () => {
    const forbidden = new Set<string>(NEVER_SWEPT_BY_AGE.map((t) => t.table));
    const allowed = new Set<string>(SWEPT_TABLES.map((t) => t.table));
    for (const [, table] of sweepBody().matchAll(/public\.(\w+)/g)) {
      if (table === "retention_sweep") continue;
      expect(allowed.has(table), `${table} appears in the sweep body`).toBe(true);
      expect(forbidden.has(table)).toBe(false);
    }
  });

  it("issues no statement that could follow a cascade or a join", () => {
    const body = sweepBody();
    expect(body).not.toMatch(/\busing\b/i);
    expect(body).not.toMatch(/\bjoin\b/i);
    expect(body).not.toMatch(/\btruncate\b/i);
    // A subquery in the predicate would make the deleted set depend on another
    // table, which is how a leaf delete stops being one.
    expect(body).not.toMatch(/where[^;]*\bselect\b/i);
  });
});

describe("the schedule is stated by the repository, not the dashboard (ADR 0069 §2)", () => {
  it("schedules the job the constants name, on the cadence they give", () => {
    expect(migration()).toContain(
      `select cron.schedule('${RETENTION_SWEEP_JOB_NAME}', '${RETENTION_SWEEP_SCHEDULE}', 'select public.retention_sweep()')`,
    );
  });

  it("unschedules before scheduling, so re-applying converges to one job", () => {
    const source = migration();
    const unschedule = source.indexOf(`cron.unschedule('${RETENTION_SWEEP_JOB_NAME}')`);
    const schedule = source.indexOf(`cron.schedule('${RETENTION_SWEEP_JOB_NAME}'`);
    expect(unschedule).toBeGreaterThan(-1);
    expect(unschedule).toBeLessThan(schedule);
  });

  it("runs off the hour", () => {
    // Not cosmetic: every other scheduled thing in the world runs at :00.
    expect(RETENTION_SWEEP_SCHEDULE.split(" ")[0]).not.toBe("0");
  });
});

describe("only cron can call it (ADR 0069 §4, rule 11)", () => {
  it("is security invoker", () => {
    expect(migration()).toContain("security invoker");
    expect(migration()).not.toContain("security definer");
  });

  it("revokes execute from every Data API role and from public", () => {
    for (const role of ["public", "anon", "authenticated", "service_role"]) {
      expect(migration()).toContain(
        `revoke all on function public.retention_sweep() from ${role};`,
      );
    }
  });

  it("pins its search_path, so an unqualified name cannot be resolved elsewhere", () => {
    expect(migration()).toContain("set search_path = ''");
  });
});
