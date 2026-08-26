import { describe, expect, it, vi } from "vitest";
import { createProjectWithRepository } from "./connect";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RepositorySummary } from "@/modules/github/types";

const repository: RepositorySummary = {
  githubRepositoryId: 123,
  owner: "octocat",
  name: "hello-world",
  fullName: "octocat/hello-world",
  defaultBranch: "main",
  private: false,
  htmlUrl: "https://github.com/octocat/hello-world",
};

type RpcResult = {
  data: { project_id: string | null; failure: string | null } | null;
  error: { message: string } | null;
};

function fakeSupabase(result: RpcResult) {
  const single = vi.fn().mockResolvedValue(result);
  const rpc = vi.fn().mockReturnValue({ single });
  const from = vi.fn(() => {
    throw new Error("connect must not touch a table directly — the RPC is the whole write");
  });
  return { client: { rpc, from } as unknown as SupabaseClient, rpc, single };
}

describe("createProjectWithRepository", () => {
  it("returns the project the transaction created", async () => {
    const { client, rpc } = fakeSupabase({
      data: { project_id: "project-1", failure: null },
      error: null,
    });

    const result = await createProjectWithRepository(client, {
      installationRowId: "installation-1",
      repository,
    });

    expect(result).toEqual({ ok: true, projectId: "project-1" });
    expect(rpc).toHaveBeenCalledWith("create_project_with_repository", {
      p_project_name: "hello-world",
      p_installation_row_id: "installation-1",
      p_github_repository_id: 123,
      p_owner: "octocat",
      p_repository_name: "hello-world",
      p_full_name: "octocat/hello-world",
      p_default_branch: "main",
      p_private: false,
      p_html_url: "https://github.com/octocat/hello-world",
    });
  });

  it("reports duplicate_repository from the classification the function made", async () => {
    const { client } = fakeSupabase({
      data: { project_id: null, failure: "duplicate_repository" },
      error: null,
    });

    const result = await createProjectWithRepository(client, {
      installationRowId: "installation-1",
      repository,
    });

    expect(result).toEqual({ ok: false, error: "duplicate_repository" });
  });

  it("reports unknown when the call itself fails", async () => {
    const { client } = fakeSupabase({ data: null, error: { message: "connection reset" } });

    const result = await createProjectWithRepository(client, {
      installationRowId: "installation-1",
      repository,
    });

    expect(result).toEqual({ ok: false, error: "unknown" });
  });

  it("reports unknown rather than claiming success when no project id came back", async () => {
    const { client } = fakeSupabase({ data: { project_id: null, failure: null }, error: null });

    const result = await createProjectWithRepository(client, {
      installationRowId: "installation-1",
      repository,
    });

    expect(result).toEqual({ ok: false, error: "unknown" });
  });

  /**
   * The privilege this slice exists to remove. The rollback is now the
   * function's transaction, so nothing here may reach for a table — a fake
   * that throws on `.from()` is how that stays true rather than being
   * remembered.
   */
  it("never touches a table directly, so it needs no delete privilege", async () => {
    const { client, rpc } = fakeSupabase({
      data: { project_id: "project-1", failure: null },
      error: null,
    });

    await createProjectWithRepository(client, { installationRowId: "installation-1", repository });

    expect(rpc).toHaveBeenCalledOnce();
  });

  it("never lets a database message leave the module", async () => {
    const hostile =
      'duplicate key value violates unique constraint ' +
      '"repository_connections_github_repository_id_key" — secret';
    const { client } = fakeSupabase({ data: null, error: { message: hostile } });

    const result = await createProjectWithRepository(client, {
      installationRowId: "installation-1",
      repository,
    });

    expect(JSON.stringify(result)).toBe('{"ok":false,"error":"unknown"}');
    expect(JSON.stringify(result)).not.toContain("secret");
  });
});
