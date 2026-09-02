import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startCluster, type Cluster } from "./harness";

/**
 * The retention sweep, against a real PostgreSQL (ADR 0069).
 *
 * ## Why this file exists, and what it would have caught
 *
 * The sweep was verified once, by hand, against a throwaway cluster — and that
 * verification stripped the one line that mattered. `create extension pg_cron`
 * cannot run on a bare cluster, so the first version of the migration broke
 * **every** test in this directory at startup, and it merged, because
 * `pnpm db:test` runs in no CI workflow. A check performed once by a person is
 * not a check.
 *
 * ## What cannot be read out of the migration text
 *
 * `sweep.test.ts` already pins the periods, the allowlist, the privileges and
 * the schedule as text, and that is the right instrument for "does the file say
 * what the constants say". None of it can answer whether the statements *work*:
 *
 * - that the delete predicate selects by age at the boundary rather than near it
 * - that a second run deletes nothing, so a daily job is idempotent
 * - that re-applying the migration converges to one job rather than two
 * - that no Data API role can call a function whose whole purpose is deletion
 *
 * The last is the one worth having, and it is deliberately a check of the
 * *effective* privilege rather than of the `revoke` statements. Two mechanisms
 * deny it — this migration's own revokes and the `alter default privileges` in
 * `20260823220000` — and a test tied to either would pass while the other was
 * doing the work. Measured: deleting one revoke line changes nothing here,
 * because the default privileges already cover it. What must never change is
 * the answer, since `service_role` is held by every durable operation and a
 * grant would put bulk deletion of an account's history one RPC call away.
 *
 * ## What this still cannot prove
 *
 * That `pg_cron` fires. The extension is not installable here, so the schedule
 * is skipped by the migration's own guard and this file asserts the *function*.
 * Whether Supabase's scheduler runs it is a property of that platform, and the
 * first firing is the only evidence for it.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The five tables the sweep may touch. Four expire at ninety days, one at eighteen months. */
const NINETY_DAY = [
  "agent_execution_events",
  "agent_activity_events",
  "agent_tool_events",
  "product_scan_events",
] as const;

const SWEPT = [...NINETY_DAY, "audit_events"] as const;

/**
 * Four ages that straddle both boundaries, written to every table at once.
 *
 * Each is a *pair* around one period — 89/91 days and 17/19 months — because a
 * single old row only proves deletion happens, while the pair proves the
 * predicate cuts where it claims to. An off-by-one keeps or removes both.
 */
const AGES = ["89 days", "91 days", "17 months", "19 months"] as const;

let db: Cluster;

beforeAll(() => {
  db = startCluster(REPO_ROOT);
  db.sql(readFileSync(join(REPO_ROOT, "supabase", "tests", "fixture.sql"), "utf8"));
}, 300_000);

afterAll(() => db?.stop());

function count(table: string): number {
  return Number(db.sql(`select count(*) from public.${table};`));
}

describe("the migration applies without the platform extension", () => {
  it("creates the function even though pg_cron is not installable here", () => {
    // The guard's whole purpose. If this regresses, every file in this
    // directory fails at startCluster and this assertion never runs — which is
    // itself the signal.
    expect(db.sql(`select to_regproc('public.retention_sweep')::text;`)).toBe("retention_sweep");
  });

  it("skips the schedule rather than failing", () => {
    expect(db.sql(`select count(*) from pg_extension where extname = 'pg_cron';`)).toBe("0");
  });
});

/**
 * One row per swept table at a given age, with every NOT NULL column and every
 * CHECK satisfied. `sequence` is passed in because three of these tables carry
 * a unique index on (run, sequence), so the pair of rows a boundary test needs
 * cannot share one.
 */
function insertAged(
  ids: { projectId: string; userId: string; runId: string; operationId: string },
  age: string,
  sequence: number,
): void {
  const { projectId, userId, runId, operationId } = ids;
  const at = `now() - interval '${age}'`;

  db.sql(`
    insert into public.agent_execution_events
      (agent_execution_run_id, project_id, user_id, sequence, type, phase, audience, occurred_at, summary, created_at)
    values ('${runId}', '${projectId}', '${userId}', ${sequence}, 'agent_started', 'working', 'internal', ${at}, 'probe', ${at});

    insert into public.agent_activity_events
      (agent_execution_run_id, project_id, sequence, event, occurred_at, created_at)
    values ('${runId}', '${projectId}', ${sequence}, 'editing_files', ${at}, ${at});

    insert into public.agent_tool_events
      (agent_execution_run_id, project_id, sequence, tool, decision, started_at, duration_ms, created_at)
    values ('${runId}', '${projectId}', ${sequence}, 'Read', 'allowed', ${at}, 1, ${at});

    insert into public.product_scan_events
      (operation_run_id, project_id, user_id, sequence, event_key, type, phase, source, title, created_at)
    values ('${operationId}', '${projectId}', '${userId}', ${sequence}, 'probe${sequence}', 'scan_started', 'code', 'system', 'probe', ${at});

    insert into public.audit_events (user_id, project_id, event_type, created_at)
    values ('${userId}', '${projectId}', 'retention.probe', ${at});
  `);
}

function fixture(label: string): {
  projectId: string;
  userId: string;
  runId: string;
  operationId: string;
} {
  const [userId, projectId] = db
    .sql(`select user_id, project_id from public.build_lifecycle_fixture('${label}');`)
    .split("|");
  const runId = db.sql(
    `select id from public.agent_execution_runs where project_id = '${projectId}' limit 1;`,
  );
  const operationId = db.sql(
    `select id from public.operation_runs where project_id = '${projectId}' limit 1;`,
  );
  return { projectId, userId, runId, operationId };
}

describe("the sweep deletes by age, at the boundary", () => {
  it("removes what is past the period and keeps what is inside it", () => {
    const ids = fixture("sweep1");
    AGES.forEach((age, index) => insertAged(ids, age, index + 1));

    const before = Object.fromEntries(SWEPT.map((table) => [table, count(table)]));

    const report = db.sql(
      `select swept_table || '=' || rows_deleted from public.retention_sweep() order by 1;`,
    );
    for (const table of SWEPT) expect(report, `${table} is reported`).toContain(table);

    // Ninety days: 91 days, 17 months and 19 months are all past it; only the
    // 89-day row survives.
    for (const table of NINETY_DAY) {
      expect(count(table), table).toBe(before[table] - 3);
    }

    // Eighteen months: only the 19-month row is past it. This is the assertion
    // that would fail if both tables shared one period.
    expect(count("audit_events"), "audit_events").toBe(before["audit_events"] - 1);
  });

  it("is idempotent: a second run the same day deletes nothing", () => {
    const second = db.sql(`select rows_deleted from public.retention_sweep();`).split("\n");
    for (const rows of second) expect(rows).toBe("0");
  });
});

describe("the sweep cannot reach what must not be swept", () => {
  it("leaves operation_runs and the artifacts an approval binds to alone", () => {
    // The failure this is really about: operation_runs cascades into
    // prepared_changes, review_artifacts and validation_runs, so an age sweep
    // of it would delete what a human approval was bound to (rule 67). The
    // fixture builds all of them, aged well past every period.
    const [, projectId] = db
      .sql(`select user_id, project_id from public.build_lifecycle_fixture('sweep2');`)
      .split("|");

    db.sql(`
      update public.operation_runs set created_at = now() - interval '5 years' where project_id = '${projectId}';
    `);

    const guarded = ["operation_runs", "prepared_changes", "validation_runs", "billing_credit_ledger"];
    const before = Object.fromEntries(guarded.map((t) => [t, count(t)]));

    db.sql(`select public.retention_sweep();`);

    for (const table of guarded) {
      expect(count(table), `${table} was touched by the sweep`).toBe(before[table]);
    }
  });
});

describe("only a privileged caller can run it", () => {
  it.each(["anon", "authenticated", "service_role"])("refuses %s", (role) => {
    // service_role is the one that matters: every durable operation holds it,
    // and a revoke that silently did not apply would make bulk deletion of an
    // account's history one RPC call away.
    // Inside a transaction, because `set local` outside one is a no-op that
    // leaves the superuser in place — a version of this test without `begin`
    // passed while proving nothing.
    expect(() =>
      db.sql(`begin; set local role ${role}; select public.retention_sweep(); rollback;`),
    ).toThrow(/permission denied/i);
  });
});
