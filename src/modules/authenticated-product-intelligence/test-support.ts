import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  BrowserConnection,
  BrowserLiveView,
  BrowserSessionHandle,
  BrowserSessionProvider,
  ProviderResult,
} from "./provider";

/**
 * In-memory doubles for the Deep Scan store and service (Sprint 5 §33).
 *
 * No test may reach a browser provider, Supabase, or a real browser. The database
 * double is deliberately more than a stub: it models the three partial unique
 * indexes the migration relies on, because those indexes *are* the safety
 * argument for "a double click cannot start two browsers" and "the included
 * scan cannot be consumed twice". A fake that ignored them would let those
 * tests pass while the real guarantee was broken.
 */

type Row = Record<string, unknown>;

const POSTGRES_UNIQUE_VIOLATION = "23505";

const LIVE_STATUSES = ["created", "waiting_for_login", "analyzing"];
const IN_FLIGHT_SNAPSHOT_STATUSES = ["pending", "analyzing"];

type QueryError = { code?: string; message: string } | null;

/** Filters accumulated by the chainable builder before a terminal call. */
type Filter =
  | { kind: "eq"; column: string; value: unknown }
  | { kind: "in"; column: string; values: unknown[] }
  | { kind: "gte"; column: string; value: string }
  | { kind: "is"; column: string; value: null };

function matches(row: Row, filters: Filter[]): boolean {
  return filters.every((filter) => {
    const cell = row[filter.column];
    switch (filter.kind) {
      case "eq":
        return cell === filter.value;
      case "in":
        return filter.values.includes(cell);
      case "gte":
        return typeof cell === "string" && cell >= filter.value;
      case "is":
        return cell === null || cell === undefined;
    }
  });
}

export class FakeDatabase {
  readonly tables = new Map<string, Row[]>();
  /** Set to a code to make the next write fail, for persistence-failure tests. */
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

  /**
   * The partial unique indexes from the migration, evaluated the way Postgres
   * would: only over rows matching the index predicate.
   */
  checkConstraints(table: string, candidate: Row, excludeId?: unknown): QueryError {
    const others = this.rows(table).filter((row) => row.id !== excludeId);

    if (table === "authenticated_browser_sessions") {
      if (LIVE_STATUSES.includes(String(candidate.status))) {
        const clash = others.some(
          (row) => row.project_id === candidate.project_id && LIVE_STATUSES.includes(String(row.status)),
        );
        if (clash) return { code: POSTGRES_UNIQUE_VIOLATION, message: "one live session per project" };
      }
    }

    if (table === "authenticated_product_intelligence_snapshots") {
      if (IN_FLIGHT_SNAPSHOT_STATUSES.includes(String(candidate.status))) {
        const clash = others.some(
          (row) =>
            row.project_id === candidate.project_id &&
            row.analyzer_version === candidate.analyzer_version &&
            IN_FLIGHT_SNAPSHOT_STATUSES.includes(String(row.status)),
        );
        if (clash) return { code: POSTGRES_UNIQUE_VIOLATION, message: "one in-flight snapshot" };
      }

      // The entitlement guarantee: at most one completed included scan.
      if (candidate.status === "completed" && candidate.access_mode === "included_first_scan") {
        const clash = others.some(
          (row) =>
            row.project_id === candidate.project_id &&
            row.status === "completed" &&
            row.access_mode === "included_first_scan",
        );
        if (clash) return { code: POSTGRES_UNIQUE_VIOLATION, message: "included scan already consumed" };
      }
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
  gte(column: string, value: string): this {
    this.filters.push({ kind: "gte", column, value });
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
  /** `select()` after a write returns the written row; columns are irrelevant to the double. */
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

/** A Supabase client double covering exactly the operations the store uses. */
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

// ---------------------------------------------------------------------
// Browser provider double
// ---------------------------------------------------------------------

export type FakeProviderBehaviour = {
  createSession?: ProviderResult<BrowserSessionHandle>;
  getConnection?: ProviderResult<BrowserConnection>;
  getLiveView?: ProviderResult<BrowserLiveView>;
  terminateSession?: ProviderResult<void>;
};

export class FakeBrowserProvider implements BrowserSessionProvider {
  readonly name = "vercel_sandbox_browser";
  readonly calls: { method: string; arg?: string }[] = [];

  constructor(private readonly behaviour: FakeProviderBehaviour = {}) {}

  get created(): number {
    return this.calls.filter((call) => call.method === "createSession").length;
  }
  get terminated(): string[] {
    return this.calls.filter((call) => call.method === "terminateSession").map((call) => call.arg!);
  }

  async createSession(): Promise<ProviderResult<BrowserSessionHandle>> {
    this.calls.push({ method: "createSession" });
    return (
      this.behaviour.createSession ?? {
        ok: true,
        value: {
          providerSessionId: "bb_1",
          connectUrl: "wss://connect.example/?signingKey=SECRET",
          expiresAt: null,
        },
      }
    );
  }

  async getConnection(providerSessionId: string): Promise<ProviderResult<BrowserConnection>> {
    this.calls.push({ method: "getConnection", arg: providerSessionId });
    return (
      this.behaviour.getConnection ?? {
        ok: true,
        value: { connectUrl: "wss://connect.example/?signingKey=SECRET" },
      }
    );
  }

  async getLiveView(providerSessionId: string): Promise<ProviderResult<BrowserLiveView>> {
    this.calls.push({ method: "getLiveView", arg: providerSessionId });
    return this.behaviour.getLiveView ?? { ok: true, value: { url: "https://live.example/view" } };
  }

  async terminateSession(providerSessionId: string): Promise<ProviderResult<void>> {
    this.calls.push({ method: "terminateSession", arg: providerSessionId });
    return this.behaviour.terminateSession ?? { ok: true, value: undefined };
  }
}

/** Seeds a project owned by `userId`, with an optional production URL. */
export function seedProject(
  db: FakeDatabase,
  params: { id?: string; userId: string; productionUrl?: string | null },
): string {
  const row = db.seed("projects", {
    id: params.id ?? "project_1",
    user_id: params.userId,
    production_url: params.productionUrl === undefined ? "https://app.example.com" : params.productionUrl,
  });
  return String(row.id);
}
