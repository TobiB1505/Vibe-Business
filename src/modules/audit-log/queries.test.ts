import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { DEFAULT_ACTIVITY_LIMIT, listAuditEventsForProject } from "./queries";

/**
 * The Activity read path (Sprint UI-2 Phase A).
 *
 * The property under test is **scoping**, and it is a security property rather
 * than a display one: `audit_events` is user-scoped with no `project_id`
 * column, so a project's feed is derived from `metadata->>projectId`. If that
 * filter is dropped or written wrongly, one project's page shows another
 * project's history — to the same user, but still a leak across a boundary the
 * product draws.
 *
 * The double records the filters the query builder was given and applies them
 * itself, so a missing `.eq()` fails here instead of in production. RLS is the
 * real defence; this asserts the second layer actually exists.
 */

type Row = {
  id: string;
  user_id: string;
  event_type: string;
  created_at: string;
  metadata: Record<string, unknown>;
};

type Filter = { column: string; value: unknown };

function fakeSupabase(rows: Row[]) {
  const seen = { table: "", filters: [] as Filter[], order: [] as string[], range: [0, 0] };

  const builder = {
    select() {
      return builder;
    },
    eq(column: string, value: unknown) {
      seen.filters.push({ column, value });
      return builder;
    },
    order(column: string, options: { ascending: boolean }) {
      seen.order.push(`${column}:${options.ascending ? "asc" : "desc"}`);
      return builder;
    },
    range(from: number, to: number) {
      seen.range = [from, to];

      // Apply what the caller actually asked for, rather than trusting it.
      const filtered = rows.filter((row) =>
        seen.filters.every((filter) => {
          if (filter.column === "user_id") return row.user_id === filter.value;
          if (filter.column === "metadata->>projectId") {
            return row.metadata.projectId === filter.value;
          }
          return true;
        }),
      );

      const sorted = [...filtered].sort((a, b) =>
        a.created_at === b.created_at
          ? b.id.localeCompare(a.id)
          : b.created_at.localeCompare(a.created_at),
      );

      return Promise.resolve({ data: sorted.slice(from, to + 1), error: null });
    },
  };

  const client = { from(table: string) { seen.table = table; return builder; } };
  return { client: client as unknown as SupabaseClient, seen };
}

function row(overrides: Partial<Row> & Pick<Row, "id">): Row {
  return {
    user_id: "user-1",
    event_type: "change_merge.verified",
    created_at: "2026-08-14T13:00:00.000Z",
    metadata: { projectId: "project-1" },
    ...overrides,
  };
}

describe("listAuditEventsForProject", () => {
  it("filters by both the caller's user and the requested project", async () => {
    const { client, seen } = fakeSupabase([]);
    await listAuditEventsForProject(client, { projectId: "project-1", userId: "user-1" });

    expect(seen.table).toBe("audit_events");
    expect(seen.filters).toContainEqual({ column: "user_id", value: "user-1" });
    expect(seen.filters).toContainEqual({
      column: "metadata->>projectId",
      value: "project-1",
    });
  });

  it("never returns another project's events", async () => {
    const { client } = fakeSupabase([
      row({ id: "mine", metadata: { projectId: "project-1" } }),
      row({ id: "theirs", metadata: { projectId: "project-2" } }),
    ]);

    const result = await listAuditEventsForProject(client, {
      projectId: "project-1",
      userId: "user-1",
    });

    expect(result.events.map((event) => event.id)).toEqual(["mine"]);
  });

  it("never returns another user's events, even for the same project", async () => {
    // RLS would already refuse this. The explicit filter is what makes the
    // guarantee survive a policy being changed underneath this code.
    const { client } = fakeSupabase([
      row({ id: "mine", user_id: "user-1" }),
      row({ id: "someone-else", user_id: "user-2" }),
    ]);

    const result = await listAuditEventsForProject(client, {
      projectId: "project-1",
      userId: "user-1",
    });

    expect(result.events.map((event) => event.id)).toEqual(["mine"]);
  });

  it("returns newest first", async () => {
    const { client } = fakeSupabase([
      row({ id: "older", created_at: "2026-08-10T09:00:00.000Z" }),
      row({ id: "newer", created_at: "2026-08-14T09:00:00.000Z" }),
    ]);

    const result = await listAuditEventsForProject(client, {
      projectId: "project-1",
      userId: "user-1",
    });

    expect(result.events.map((event) => event.id)).toEqual(["newer", "older"]);
  });

  it("breaks timestamp ties deterministically", async () => {
    // Several events are written inside one statement and share a timestamp.
    // Without the id tiebreaker their order is arbitrary, and a paged read can
    // skip or repeat one — the classic feed bug.
    const { client, seen } = fakeSupabase([
      row({ id: "aaa", created_at: "2026-08-14T09:00:00.000Z" }),
      row({ id: "bbb", created_at: "2026-08-14T09:00:00.000Z" }),
    ]);

    const first = await listAuditEventsForProject(client, {
      projectId: "project-1",
      userId: "user-1",
    });
    const second = await listAuditEventsForProject(client, {
      projectId: "project-1",
      userId: "user-1",
    });

    expect(seen.order).toContain("created_at:desc");
    expect(seen.order).toContain("id:desc");
    expect(first.events.map((e) => e.id)).toEqual(second.events.map((e) => e.id));
  });

  it("reports more without a second query, and does not return the probe row", async () => {
    const rows = Array.from({ length: 5 }, (_, index) =>
      row({ id: `e${index}`, created_at: `2026-08-1${index}T09:00:00.000Z` }),
    );
    const { client } = fakeSupabase(rows);

    const result = await listAuditEventsForProject(client, {
      projectId: "project-1",
      userId: "user-1",
      limit: 2,
    });

    expect(result.events).toHaveLength(2);
    expect(result.hasMore).toBe(true);
  });

  it("says there is no more when the page is not full", async () => {
    const { client } = fakeSupabase([row({ id: "only" })]);
    const result = await listAuditEventsForProject(client, {
      projectId: "project-1",
      userId: "user-1",
      limit: 10,
    });

    expect(result.events).toHaveLength(1);
    expect(result.hasMore).toBe(false);
  });

  it("caps an oversized limit rather than letting a caller scan the log", async () => {
    const { client, seen } = fakeSupabase([]);
    await listAuditEventsForProject(client, {
      projectId: "project-1",
      userId: "user-1",
      limit: 100_000,
    });

    expect(seen.range[1] - seen.range[0]).toBeLessThanOrEqual(200);
  });

  it("refuses a negative offset or limit instead of producing a bad range", async () => {
    const { client, seen } = fakeSupabase([]);
    await listAuditEventsForProject(client, {
      projectId: "project-1",
      userId: "user-1",
      limit: -5,
      offset: -10,
    });

    expect(seen.range[0]).toBe(0);
    expect(seen.range[1]).toBeGreaterThanOrEqual(seen.range[0]);
  });

  it("defaults to a bounded page", async () => {
    const { client, seen } = fakeSupabase([]);
    await listAuditEventsForProject(client, { projectId: "project-1", userId: "user-1" });
    expect(seen.range[1] - seen.range[0]).toBe(DEFAULT_ACTIVITY_LIMIT);
  });

  it("returns an empty feed rather than throwing when nothing was recorded", async () => {
    const { client } = fakeSupabase([]);
    const result = await listAuditEventsForProject(client, {
      projectId: "project-1",
      userId: "user-1",
    });

    expect(result.events).toEqual([]);
    expect(result.hasMore).toBe(false);
  });
});
