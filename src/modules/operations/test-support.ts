import type { SupabaseClient } from "@supabase/supabase-js";
import type { OperationExecutor, StartOperationInput, StartOperationResult } from "./executor";

/**
 * Test doubles for durable execution (Sprint 7 §29).
 *
 * Two things are modelled honestly rather than approximately, because the
 * sprint's cost guarantees rest on them:
 *
 *  - the **partial unique indexes** from the migration, evaluated only over
 *    rows matching the index predicate, so a "one active operation" test fails
 *    for the same reason production would;
 *  - the **executor**, which counts starts. "Exactly one workflow" is the
 *    property under test, and a double that cannot count cannot prove it.
 *
 * Nothing here touches a network, a workflow platform, or a provider.
 */

export type Row = Record<string, unknown>;
type QueryError = { code?: string; message: string } | null;

const POSTGRES_UNIQUE_VIOLATION = "23505";
const ACTIVE_OPERATION_STATUSES = ["queued", "running"];
const IN_FLIGHT_AUDIT_STATUSES = ["pending", "analyzing"];

type Filter =
  | { kind: "eq"; column: string; value: unknown }
  | { kind: "in"; column: string; values: unknown[] }
  | { kind: "is"; column: string; value: null };

function matches(row: Row, filters: Filter[]): boolean {
  return filters.every((filter) => {
    if (filter.kind === "eq") return row[filter.column] === filter.value;
    if (filter.kind === "in") return filter.values.includes(row[filter.column]);
    return row[filter.column] === null || row[filter.column] === undefined;
  });
}

export class FakeDatabase {
  private readonly tables = new Map<string, Row[]>();

  /** Set to make the next write to a table fail, for persistence-failure tests. */
  failNextWriteWith: { table: string; code?: string; message: string } | null = null;

  rows(table: string): Row[] {
    let rows = this.tables.get(table);
    if (!rows) {
      rows = [];
      this.tables.set(table, rows);
    }
    return rows;
  }

  seed(table: string, row: Row): Row {
    const stored = { id: row.id ?? `${table}_${this.rows(table).length + 1}`, ...row };
    this.rows(table).push(stored);
    return stored;
  }

  /** The migration's partial unique indexes, as Postgres would apply them. */
  checkConstraints(table: string, candidate: Row, excludeId?: unknown): QueryError {
    const others = this.rows(table).filter((row) => row.id !== excludeId);

    if (table === "operation_runs" && ACTIVE_OPERATION_STATUSES.includes(String(candidate.status))) {
      const clash = others.some(
        (row) =>
          row.project_id === candidate.project_id &&
          row.operation_type === candidate.operation_type &&
          row.input_identity === candidate.input_identity &&
          ACTIVE_OPERATION_STATUSES.includes(String(row.status)),
      );
      if (clash) return { code: POSTGRES_UNIQUE_VIOLATION, message: "one active operation per identity" };
    }

    if (table === "business_readiness_audits" && IN_FLIGHT_AUDIT_STATUSES.includes(String(candidate.status))) {
      const clash = others.some(
        (row) =>
          row.project_id === candidate.project_id &&
          row.input_hash === candidate.input_hash &&
          IN_FLIGHT_AUDIT_STATUSES.includes(String(row.status)),
      );
      if (clash) return { code: POSTGRES_UNIQUE_VIOLATION, message: "one in-flight audit per input" };
    }

    // The ledger's idempotency guarantee: one usage event per job.
    if (table === "ai_usage_events" && candidate.job_id != null) {
      const clash = others.some((row) => row.job_id === candidate.job_id);
      if (clash) return { code: POSTGRES_UNIQUE_VIOLATION, message: "usage already recorded for job" };
    }

    return null;
  }
}

class FakeQuery implements PromiseLike<{ data: unknown; error: QueryError }> {
  private filters: Filter[] = [];
  private orderColumn: string | null = null;
  private orderAscending = true;
  private limitCount: number | null = null;

  constructor(
    private readonly db: FakeDatabase,
    private readonly table: string,
    private readonly mode: "select" | "insert" | "update",
    private readonly payload?: Row,
  ) {}

  eq(column: string, value: unknown): this {
    this.filters.push({ kind: "eq", column, value });
    return this;
  }
  in(column: string, values: unknown[]): this {
    this.filters.push({ kind: "in", column, values });
    return this;
  }
  is(column: string, value: null): this {
    this.filters.push({ kind: "is", column, value });
    return this;
  }
  order(column: string, options?: { ascending?: boolean }): this {
    this.orderColumn = column;
    this.orderAscending = options?.ascending ?? true;
    return this;
  }
  limit(count: number): this {
    this.limitCount = count;
    return this;
  }
  select(): this {
    return this;
  }

  private failure(): QueryError {
    const pending = this.db.failNextWriteWith;
    if (pending && pending.table === this.table) {
      this.db.failNextWriteWith = null;
      return { code: pending.code, message: pending.message };
    }
    return null;
  }

  private resolveRows(): Row[] {
    let rows = this.db.rows(this.table).filter((row) => matches(row, this.filters));

    if (this.orderColumn) {
      const column = this.orderColumn;
      rows = [...rows].sort((a, b) => {
        const left = String(a[column] ?? "");
        const right = String(b[column] ?? "");
        return this.orderAscending ? left.localeCompare(right) : right.localeCompare(left);
      });
    }

    if (this.limitCount !== null) rows = rows.slice(0, this.limitCount);
    return rows;
  }

  private run(): { data: unknown; error: QueryError } {
    if (this.mode === "insert") {
      const failure = this.failure();
      if (failure) return { data: null, error: failure };

      const row: Row = { id: `${this.table}_${this.db.rows(this.table).length + 1}`, ...this.payload };
      row.created_at ??= new Date().toISOString();
      row.updated_at ??= new Date().toISOString();

      const violation = this.db.checkConstraints(this.table, row);
      if (violation) return { data: null, error: violation };

      this.db.rows(this.table).push(row);
      return { data: row, error: null };
    }

    if (this.mode === "update") {
      const failure = this.failure();
      if (failure) return { data: null, error: failure };

      const targets = this.db.rows(this.table).filter((row) => matches(row, this.filters));
      for (const target of targets) {
        const candidate = { ...target, ...this.payload, updated_at: new Date().toISOString() };
        const violation = this.db.checkConstraints(this.table, candidate, target.id);
        if (violation) return { data: null, error: violation };
        Object.assign(target, candidate);
      }
      return { data: targets, error: null };
    }

    return { data: this.resolveRows(), error: null };
  }

  async maybeSingle(): Promise<{ data: Row | null; error: QueryError }> {
    const { data, error } = this.run();
    if (error) return { data: null, error };
    const rows = data as Row[];
    return { data: rows.length > 0 ? rows[0] : null, error: null };
  }

  async single(): Promise<{ data: Row; error: QueryError }> {
    const { data, error } = this.run();
    if (error) return { data: null as unknown as Row, error };
    const row = Array.isArray(data) ? (data as Row[])[0] : (data as Row);
    return row
      ? { data: row, error: null }
      : { data: null as unknown as Row, error: { message: "no rows returned" } };
  }

  then<TResult1 = { data: unknown; error: QueryError }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: QueryError }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected);
  }
}

export function fakeSupabase(db: FakeDatabase): SupabaseClient {
  return {
    from(table: string) {
      return {
        select: () => new FakeQuery(db, table, "select"),
        insert: (payload: Row) => new FakeQuery(db, table, "insert", payload),
        update: (payload: Row) => new FakeQuery(db, table, "update", payload),
      };
    },
  } as unknown as SupabaseClient;
}

/** Counts starts, because "exactly one workflow" is the property under test. */
export class FakeExecutor implements OperationExecutor {
  readonly name = "fake_executor";
  readonly starts: StartOperationInput[] = [];

  constructor(private readonly behaviour: { fail?: boolean } = {}) {}

  async start(input: StartOperationInput): Promise<StartOperationResult> {
    this.starts.push(input);
    if (this.behaviour.fail) return { ok: false, error: "execution_start_failed" };
    return { ok: true, runId: `run_${this.starts.length}` };
  }
}
