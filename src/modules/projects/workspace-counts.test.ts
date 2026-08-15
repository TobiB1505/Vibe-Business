import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { getProjectWorkspaceCounts } from "./workspace-counts";

/**
 * Workspace counts (Sprint UI-2.5 Phase B).
 *
 * Two properties matter here and neither is cosmetic:
 *
 * 1. **The counts mean what the routes mean.** A badge that counts something
 *    different from the page behind it is worse than no badge — the user
 *    clicks "3" and finds two.
 * 2. **They stay cheap.** These exist only because UI-2 refused to put an
 *    opportunity read and a prepared read into the shared layout. A count that
 *    quietly started transferring rows would put that cost back on all seven
 *    routes.
 *
 * The double records what was asked for, so both are assertable without a
 * database.
 */

type Call = {
  table: string;
  filters: { column: string; value: unknown }[];
  head: boolean;
  countMode: string | undefined;
  columns: string;
};

function fakeSupabase(handlers: {
  set?: { id: string } | null;
  setError?: boolean;
  opportunityCount?: number | null;
  opportunityError?: boolean;
  preparedCount?: number | null;
  preparedError?: boolean;
}) {
  const calls: Call[] = [];

  function builder(table: string) {
    const call: Call = { table, filters: [], head: false, countMode: undefined, columns: "" };
    calls.push(call);

    function countResult() {
      const isPrepared = table === "prepared_changes";
      const error = isPrepared ? handlers.preparedError : handlers.opportunityError;
      const count = isPrepared ? handlers.preparedCount : handlers.opportunityCount;
      return {
        count: error ? null : (count ?? 0),
        error: error ? { message: "boom" } : null,
      };
    }

    // Thenable, like the real query builder: the chain stays chainable and is
    // only resolved when awaited. An eagerly-resolving `select()` would break
    // `.select(...).eq(...)`, which is how these queries are actually written.
    const api = {
      select(columns: string, options?: { count?: string; head?: boolean }) {
        call.columns = columns;
        call.countMode = options?.count;
        call.head = options?.head ?? false;
        return api;
      },
      eq(column: string, value: unknown) {
        call.filters.push({ column, value });
        return api;
      },
      order() {
        return api;
      },
      limit() {
        return api;
      },
      maybeSingle() {
        return Promise.resolve({
          data: handlers.setError ? null : (handlers.set ?? null),
          error: handlers.setError ? { message: "boom" } : null,
        });
      },
      then(resolve: (value: unknown) => unknown) {
        return Promise.resolve(countResult()).then(resolve);
      },
    };
    return api;
  }

  const client = { from: (table: string) => builder(table) };
  return { client: client as unknown as SupabaseClient, calls };
}

describe("getProjectWorkspaceCounts", () => {
  it("counts prepared changes the way the Prepared route lists them", async () => {
    // `status = 'prepared'` — not every execution job ever run. A discarded
    // change is not something waiting for the user.
    const { client, calls } = fakeSupabase({ set: { id: "set-1" }, preparedCount: 2 });
    const counts = await getProjectWorkspaceCounts(client, "project-1");

    const prepared = calls.find((call) => call.table === "prepared_changes");
    expect(prepared?.filters).toContainEqual({ column: "project_id", value: "project-1" });
    expect(prepared?.filters).toContainEqual({ column: "status", value: "prepared" });
    expect(counts.prepared).toBe(2);
  });

  it("counts opportunities from the latest completed set only", async () => {
    // Regenerating opportunities creates a new set; the old ones are history,
    // not a backlog.
    const { client, calls } = fakeSupabase({ set: { id: "set-1" }, opportunityCount: 3 });
    const counts = await getProjectWorkspaceCounts(client, "project-1");

    const sets = calls.find((call) => call.table === "opportunity_sets");
    expect(sets?.filters).toContainEqual({ column: "status", value: "completed" });

    const opportunities = calls.find((call) => call.table === "business_opportunities");
    expect(opportunities?.filters).toContainEqual({
      column: "opportunity_set_id",
      value: "set-1",
    });
    expect(counts.nextMoves).toBe(3);
  });

  it("transfers no rows — count only", async () => {
    // The whole reason this module exists. A count that started returning rows
    // would put the cost UI-2 removed back onto every route.
    const { client, calls } = fakeSupabase({ set: { id: "set-1" }, opportunityCount: 3 });
    await getProjectWorkspaceCounts(client, "project-1");

    for (const call of calls.filter((candidate) => candidate.table !== "opportunity_sets")) {
      expect(call.head, `${call.table} fetched rows`).toBe(true);
      expect(call.countMode).toBe("exact");
    }
  });

  it("never loads detail, preview, review or impact", async () => {
    const { client, calls } = fakeSupabase({ set: { id: "set-1" }, opportunityCount: 1 });
    await getProjectWorkspaceCounts(client, "project-1");

    const tables = calls.map((call) => call.table);
    for (const forbidden of [
      "validation_runs",
      "preview_sessions",
      "review_artifacts",
      "change_approvals",
      "change_merges",
      "change_outcome_verifications",
      "business_outcome_measurements",
    ]) {
      expect(tables, `read ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("reports zero — not unknown — when a project has never had opportunities", async () => {
    // A real answer. The caller hides a zero badge; it must not be confused
    // with "could not count".
    const { client } = fakeSupabase({ set: null, preparedCount: 0 });
    const counts = await getProjectWorkspaceCounts(client, "project-1");

    expect(counts.nextMoves).toBe(0);
  });

  it("reports null rather than zero when a count fails", async () => {
    // Zero would claim "nothing here". The truth is "could not count", and the
    // navigation must not turn one into the other.
    const { client } = fakeSupabase({ set: { id: "set-1" }, opportunityError: true });
    const counts = await getProjectWorkspaceCounts(client, "project-1");

    expect(counts.nextMoves).toBeNull();
  });

  it("still returns the other count when one of them fails", async () => {
    const { client } = fakeSupabase({ setError: true, preparedCount: 2 });
    const counts = await getProjectWorkspaceCounts(client, "project-1");

    expect(counts.nextMoves).toBeNull();
    expect(counts.prepared).toBe(2);
  });

  it("never throws — a badge is not worth a broken workspace", async () => {
    const exploding = {
      from() {
        throw new Error("connection reset");
      },
    } as unknown as SupabaseClient;

    await expect(getProjectWorkspaceCounts(exploding, "project-1")).resolves.toEqual({
      nextMoves: null,
      prepared: null,
    });
  });
});
