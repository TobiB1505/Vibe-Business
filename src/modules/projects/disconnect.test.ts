import { describe, expect, it, vi } from "vitest";
import { disconnectProject } from "./disconnect";
import type { SupabaseClient } from "@supabase/supabase-js";

function fakeSupabase(selectResult: { data: unknown[] | null; error: { message: string } | null }) {
  const select = vi.fn().mockResolvedValue(selectResult);
  const eqUser = vi.fn().mockReturnValue({ select });
  const eqId = vi.fn().mockReturnValue({ eq: eqUser });
  const deleteFn = vi.fn().mockReturnValue({ eq: eqId });
  const from = vi.fn().mockReturnValue({ delete: deleteFn });
  return { client: { from } as unknown as SupabaseClient, from, deleteFn, eqId, eqUser };
}

describe("disconnectProject", () => {
  it("succeeds when a matching row was deleted", async () => {
    const { client, eqId, eqUser } = fakeSupabase({ data: [{ id: "project-1" }], error: null });

    const result = await disconnectProject(client, { projectId: "project-1", userId: "user-1" });

    expect(result).toEqual({ ok: true });
    expect(eqId).toHaveBeenCalledWith("id", "project-1");
    expect(eqUser).toHaveBeenCalledWith("user_id", "user-1");
  });

  it("reports not_found when no row matched (wrong owner or nonexistent project)", async () => {
    const { client } = fakeSupabase({ data: [], error: null });

    const result = await disconnectProject(client, { projectId: "project-1", userId: "user-1" });

    expect(result).toEqual({ ok: false, error: "not_found" });
  });

  it("reports unknown on a database error", async () => {
    const { client } = fakeSupabase({ data: null, error: { message: "connection reset" } });

    const result = await disconnectProject(client, { projectId: "project-1", userId: "user-1" });

    expect(result).toEqual({ ok: false, error: "unknown", message: "connection reset" });
  });
});
