import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { listProjectSwitcherOptions } from "./workspace-context";

function fakeSupabase(input: {
  data?: { id: string; name: string }[];
  error?: boolean;
  throws?: boolean;
}) {
  const filters: { kind: "eq" | "neq"; column: string; value: unknown }[] = [];
  let limit: number | null = null;

  const query = {
    select() {
      return query;
    },
    eq(column: string, value: unknown) {
      filters.push({ kind: "eq", column, value });
      return query;
    },
    neq(column: string, value: unknown) {
      filters.push({ kind: "neq", column, value });
      return query;
    },
    order() {
      return query;
    },
    limit(value: number) {
      limit = value;
      return query;
    },
    then(resolve: (value: unknown) => unknown) {
      return Promise.resolve({
        data: input.error ? null : (input.data ?? []),
        error: input.error ? { message: "boom" } : null,
      }).then(resolve);
    },
  };

  const client = {
    from() {
      if (input.throws) throw new Error("connection reset");
      return query;
    },
  } as unknown as SupabaseClient;

  return { client, filters, getLimit: () => limit };
}

describe("project switcher options", () => {
  it("returns a bounded set of sibling projects for the current owner", async () => {
    const fake = fakeSupabase({
      data: [
        { id: "project-2", name: "Planner Agent" },
        { id: "project-3", name: "Landing Pro" },
      ],
    });

    await expect(
      listProjectSwitcherOptions(fake.client, {
        userId: "user-1",
        currentProjectId: "project-1",
      }),
    ).resolves.toEqual([
      { id: "project-2", name: "Planner Agent" },
      { id: "project-3", name: "Landing Pro" },
    ]);

    expect(fake.filters).toContainEqual({ kind: "eq", column: "user_id", value: "user-1" });
    expect(fake.filters).toContainEqual({
      kind: "neq",
      column: "id",
      value: "project-1",
    });
    expect(fake.getLimit()).toBe(4);
  });

  it("degrades to the current project and products index when the optional read fails", async () => {
    const failed = fakeSupabase({ error: true });
    const exploded = fakeSupabase({ throws: true });

    await expect(
      listProjectSwitcherOptions(failed.client, {
        userId: "user-1",
        currentProjectId: "project-1",
      }),
    ).resolves.toEqual([]);
    await expect(
      listProjectSwitcherOptions(exploded.client, {
        userId: "user-1",
        currentProjectId: "project-1",
      }),
    ).resolves.toEqual([]);
  });
});
