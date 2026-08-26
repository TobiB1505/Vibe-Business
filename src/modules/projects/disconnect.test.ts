import { describe, expect, it, vi } from "vitest";
import { disconnectProject } from "./disconnect";
import type { SupabaseClient } from "@supabase/supabase-js";

function fakeSupabase(result: { data: unknown; error: { message: string } | null }) {
  const rpc = vi.fn().mockResolvedValue(result);
  const from = vi.fn(() => {
    throw new Error("disconnect must not touch a table directly — the RPC is the whole delete");
  });
  return { client: { rpc, from } as unknown as SupabaseClient, rpc };
}

describe("disconnectProject", () => {
  it("succeeds when the function reports the project disconnected", async () => {
    const { client, rpc } = fakeSupabase({ data: "disconnected", error: null });

    const result = await disconnectProject(client, { projectId: "project-1" });

    expect(result).toEqual({ ok: true });
    // No owner argument: a SECURITY DEFINER function reachable over
    // `/rest/v1/rpc/` would treat one as a claim, not a check.
    expect(rpc).toHaveBeenCalledWith("disconnect_project", { p_project_id: "project-1" });
  });

  it("reports not_found when no row matched (wrong owner or nonexistent project)", async () => {
    const { client } = fakeSupabase({ data: "not_found", error: null });

    const result = await disconnectProject(client, { projectId: "project-1" });

    expect(result).toEqual({ ok: false, error: "not_found" });
  });

  /**
   * The project holds an execution spec, so the immutability trigger refused
   * the cascade — the function classifies it instead of raising. It maps to
   * the same closed failure the action already renders: this slice moves the
   * privilege, not the copy.
   */
  it("reports unknown when execution history blocked the cascade", async () => {
    const { client } = fakeSupabase({ data: "blocked_by_execution_history", error: null });

    const result = await disconnectProject(client, { projectId: "project-1" });

    expect(result).toEqual({ ok: false, error: "unknown" });
  });

  it("reports unknown rather than success for a value it does not recognise", async () => {
    const { client } = fakeSupabase({ data: "something_new", error: null });

    const result = await disconnectProject(client, { projectId: "project-1" });

    expect(result).toEqual({ ok: false, error: "unknown" });
  });

  it("reports unknown on a database error", async () => {
    const { client } = fakeSupabase({ data: null, error: { message: "connection reset" } });

    const result = await disconnectProject(client, { projectId: "project-1" });

    expect(result).toEqual({ ok: false, error: "unknown" });
  });

  /**
   * The privilege this slice removes. A fake that throws on `.from()` keeps
   * the module off any direct table write rather than trusting a reviewer to
   * notice one reappearing.
   */
  it("never touches a table directly, so it needs no delete privilege", async () => {
    const { client, rpc } = fakeSupabase({ data: "disconnected", error: null });

    await disconnectProject(client, { projectId: "project-1" });

    expect(rpc).toHaveBeenCalledOnce();
  });

  it("never lets the database message leave the module (VB-003)", async () => {
    // A PostgREST message names the table, constraint or trigger that refused.
    // The caller is a Server Action, so anything returned here is one careless
    // render away from a founder reading the schema.
    const hostile =
      'update or delete on table "projects" violates foreign key constraint ' +
      '"execution_specs_project_id_fkey" — secret';
    const { client } = fakeSupabase({ data: null, error: { message: hostile } });

    const result = await disconnectProject(client, { projectId: "project-1" });

    expect(JSON.stringify(result)).toBe('{"ok":false,"error":"unknown"}');
    expect(JSON.stringify(result)).not.toContain("secret");
  });
});
