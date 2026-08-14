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
const POSTGRES_CHECK_VIOLATION = "23514";
const ACTIVE_OPERATION_STATUSES = ["queued", "running"];
const IN_FLIGHT_AUDIT_STATUSES = ["pending", "analyzing"];
const ACTIVE_VALIDATION_STATUSES = ["queued", "running"];
const ACTIVE_PREVIEW_STATUSES = ["starting", "running"];

type Filter =
  | { kind: "eq"; column: string; value: unknown }
  | { kind: "in"; column: string; values: unknown[] }
  | { kind: "is"; column: string; value: null }
  | { kind: "not_is"; column: string; value: null }
  | { kind: "gt"; column: string; value: unknown };

function matches(row: Row, filters: Filter[]): boolean {
  return filters.every((filter) => {
    if (filter.kind === "eq") return row[filter.column] === filter.value;
    if (filter.kind === "in") return filter.values.includes(row[filter.column]);
    if (filter.kind === "is") return row[filter.column] === null || row[filter.column] === undefined;
    if (filter.kind === "not_is") return row[filter.column] !== null && row[filter.column] !== undefined;
    return String(row[filter.column] ?? "") > String(filter.value);
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

    // validation_runs_single_active_idx (Sprint 10A §21, narrowed after the
    // first 10B dogfood). Only in-flight rows conflict: a historical pass with
    // no usable artifact must not prevent an explicit re-validation. Modelled
    // so a double click still loses its second insert exactly as in Postgres.
    if (table === "validation_runs" && ACTIVE_VALIDATION_STATUSES.includes(String(candidate.status))) {
      const clash = others.some(
        (row) =>
          row.project_id === candidate.project_id &&
          row.validation_identity === candidate.validation_identity &&
          ACTIVE_VALIDATION_STATUSES.includes(String(row.status)),
      );
      if (clash) return { code: POSTGRES_UNIQUE_VIOLATION, message: "one live validation per identity" };
    }

    // validation_runs_artifact_only_when_passed.
    //
    // A CHECK rather than an index, and modelled here because the fake's
    // silence on CHECK constraints cost four dogfood rounds. The artifact was
    // being written one step before the verdict, while the row was still
    // `running`. Postgres refused it, the step failed, the retry found a
    // sandbox the successful snapshot had already stopped, and the run reported
    // `sandbox_lost` — with a 1.14 GB snapshot orphaned in provider storage and
    // every test green.
    //
    // The in-memory database will never evaluate constraints in general, but a
    // rule this load-bearing is worth stating twice.
    if (table === "validation_runs" && candidate.artifact_snapshot_id != null) {
      if (candidate.status !== "passed") {
        return {
          code: POSTGRES_CHECK_VIOLATION,
          message: "validation_runs_artifact_only_when_passed",
        };
      }
      if (candidate.artifact_expires_at == null) {
        return { code: POSTGRES_CHECK_VIOLATION, message: "validation_runs_artifact_has_expiry" };
      }
    }

    // preview_sessions_single_active_idx (Sprint 10B-2 §32). One live preview
    // per identity, so a double click loses its second insert here exactly as
    // it would in Postgres — otherwise the test would "prove" idempotency the
    // database provides.
    if (table === "preview_sessions" && ACTIVE_PREVIEW_STATUSES.includes(String(candidate.status))) {
      const clash = others.some(
        (row) =>
          row.project_id === candidate.project_id &&
          row.preview_identity === candidate.preview_identity &&
          ACTIVE_PREVIEW_STATUSES.includes(String(row.status)),
      );
      if (clash) return { code: POSTGRES_UNIQUE_VIOLATION, message: "one live preview per identity" };
    }

    // sandbox_usage_events_preview_unique_idx (§27). One ledger row per preview
    // session: a retried terminal step must not double-count a sandbox that
    // only ran once.
    if (table === "sandbox_usage_events" && candidate.preview_session_id != null) {
      const clash = others.some((row) => row.preview_session_id === candidate.preview_session_id);
      if (clash) return { code: POSTGRES_UNIQUE_VIOLATION, message: "usage already recorded for preview" };
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

    // Unique ranks within an opportunity set (Sprint 8 §29).
    if (table === "business_opportunities") {
      const clash = others.some(
        (row) =>
          row.opportunity_set_id === candidate.opportunity_set_id && row.rank === candidate.rank,
      );
      if (clash) return { code: POSTGRES_UNIQUE_VIOLATION, message: "duplicate rank in set" };
    }

    // At most one in-flight opportunity set per project + input.
    if (table === "opportunity_sets" && IN_FLIGHT_AUDIT_STATUSES.includes(String(candidate.status))) {
      const clash = others.some(
        (row) =>
          row.project_id === candidate.project_id &&
          row.input_hash === candidate.input_hash &&
          IN_FLIGHT_AUDIT_STATUSES.includes(String(row.status)),
      );
      if (clash) return { code: POSTGRES_UNIQUE_VIOLATION, message: "one in-flight set per input" };
    }

    // At most one live-or-successful preparation per execution identity.
    if (table === "prepared_changes" && ["preparing", "prepared"].includes(String(candidate.status))) {
      const clash = others.some(
        (row) =>
          row.project_id === candidate.project_id &&
          row.execution_identity === candidate.execution_identity &&
          ["preparing", "prepared"].includes(String(row.status)),
      );
      if (clash) return { code: POSTGRES_UNIQUE_VIOLATION, message: "one active preparation per identity" };
    }

    // change_approvals_active_identity_idx (Sprint 11B §12). At most one
    // *active* approval per exact artifact, so a double click loses its second
    // insert here exactly as it would in Postgres. Without this the idempotency
    // test would be proving the application's pre-check rather than the
    // guarantee the database actually provides.
    if (table === "change_approvals" && candidate.status === "approved") {
      const clash = others.some(
        (row) =>
          row.project_id === candidate.project_id &&
          row.approval_identity === candidate.approval_identity &&
          row.status === "approved",
      );
      if (clash) {
        return { code: POSTGRES_UNIQUE_VIOLATION, message: "one active approval per identity" };
      }
    }

    // The approval table's CHECK constraints, modelled for the same reason the
    // validation artifact ones are: a rule that exists only in SQL is a rule
    // every in-memory test is blind to, and this one governs whether a
    // withdrawn approval can still read as standing authority.
    if (table === "change_approvals") {
      if (candidate.status === "revoked" && candidate.revoked_at == null) {
        return {
          code: POSTGRES_CHECK_VIOLATION,
          message: "change_approvals_revoked_has_timestamp",
        };
      }
      if (
        candidate.status === "invalidated" &&
        (candidate.invalidated_at == null || candidate.invalidation_reason == null)
      ) {
        return {
          code: POSTGRES_CHECK_VIOLATION,
          message: "change_approvals_invalidated_has_reason",
        };
      }
      if (
        candidate.status === "approved" &&
        (candidate.revoked_at != null || candidate.invalidated_at != null)
      ) {
        return {
          code: POSTGRES_CHECK_VIOLATION,
          message: "change_approvals_active_is_not_terminated",
        };
      }
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
    private readonly payload?: Row | Row[],
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
  not(column: string, operator: "is", value: null): this {
    if (operator !== "is") throw new Error(`unsupported fake query operator: not ${operator}`);
    this.filters.push({ kind: "not_is", column, value });
    return this;
  }
  gt(column: string, value: unknown): this {
    this.filters.push({ kind: "gt", column, value });
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

      // Supabase accepts a single row or an array; the opportunity store
      // inserts a whole set at once, so the double has to as well.
      const payloads = Array.isArray(this.payload) ? this.payload : [this.payload ?? {}];
      const inserted: Row[] = [];

      for (const payload of payloads) {
        const row: Row = { id: `${this.table}_${this.db.rows(this.table).length + 1}`, ...payload };
        row.created_at ??= new Date().toISOString();
        row.updated_at ??= new Date().toISOString();

        // `approved_at timestamptz not null default now()`. The application
        // deliberately does not send this column — a database default is what
        // makes it impossible for the app to backdate an approval — so without
        // the default modelled here the fake would report `undefined` for a
        // value Postgres always fills.
        if (this.table === "change_approvals") row.approved_at ??= row.created_at;

        const violation = this.db.checkConstraints(this.table, row);
        if (violation) return { data: null, error: violation };

        this.db.rows(this.table).push(row);
        inserted.push(row);
      }

      return { data: Array.isArray(this.payload) ? inserted : inserted[0], error: null };
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
        insert: (payload: Row | Row[]) => new FakeQuery(db, table, "insert", payload),
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
