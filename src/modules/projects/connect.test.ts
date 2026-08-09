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

type FakeOptions = {
  projectInsertResult: { data: { id: string } | null; error: { message: string } | null };
  repoInsertResult: { error: { message: string; code?: string } | null };
};

function fakeSupabase({ projectInsertResult, repoInsertResult }: FakeOptions) {
  const deleteEq = vi.fn().mockResolvedValue({ error: null });
  const deleteFn = vi.fn().mockReturnValue({ eq: deleteEq });

  const projectSingle = vi.fn().mockResolvedValue(projectInsertResult);
  const projectSelect = vi.fn().mockReturnValue({ single: projectSingle });
  const projectInsert = vi.fn().mockReturnValue({ select: projectSelect });

  const repoInsert = vi.fn().mockResolvedValue(repoInsertResult);

  const from = vi.fn((table: string) => {
    if (table === "projects") return { insert: projectInsert, delete: deleteFn };
    if (table === "repository_connections") return { insert: repoInsert };
    throw new Error(`unexpected table: ${table}`);
  });

  return { client: { from } as unknown as SupabaseClient, from, projectInsert, repoInsert, deleteFn, deleteEq };
}

describe("createProjectWithRepository", () => {
  it("creates a project and repository connection on success", async () => {
    const { client, projectInsert, repoInsert } = fakeSupabase({
      projectInsertResult: { data: { id: "project-1" }, error: null },
      repoInsertResult: { error: null },
    });

    const result = await createProjectWithRepository(client, {
      userId: "user-1",
      installationRowId: "installation-1",
      repository,
    });

    expect(result).toEqual({ ok: true, projectId: "project-1" });
    expect(projectInsert).toHaveBeenCalledWith({ user_id: "user-1", name: "hello-world" });
    expect(repoInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        project_id: "project-1",
        github_installation_id: "installation-1",
        github_repository_id: 123,
        full_name: "octocat/hello-world",
      }),
    );
  });

  it("reports duplicate_repository and rolls back the project on a unique-constraint violation", async () => {
    const { client, deleteFn, deleteEq } = fakeSupabase({
      projectInsertResult: { data: { id: "project-1" }, error: null },
      repoInsertResult: { error: { message: "duplicate key value violates unique constraint", code: "23505" } },
    });

    const result = await createProjectWithRepository(client, {
      userId: "user-1",
      installationRowId: "installation-1",
      repository,
    });

    expect(result).toEqual({ ok: false, error: "duplicate_repository" });
    expect(deleteFn).toHaveBeenCalled();
    expect(deleteEq).toHaveBeenCalledWith("id", "project-1");
  });

  it("reports unknown for a non-duplicate repository insert failure, and still rolls back", async () => {
    const { client, deleteFn } = fakeSupabase({
      projectInsertResult: { data: { id: "project-1" }, error: null },
      repoInsertResult: { error: { message: "connection reset" } },
    });

    const result = await createProjectWithRepository(client, {
      userId: "user-1",
      installationRowId: "installation-1",
      repository,
    });

    expect(result).toEqual({ ok: false, error: "unknown", message: "connection reset" });
    expect(deleteFn).toHaveBeenCalled();
  });

  it("reports unknown when the initial project insert fails, without attempting the repository insert", async () => {
    const { client, repoInsert } = fakeSupabase({
      projectInsertResult: { data: null, error: { message: "insert failed" } },
      repoInsertResult: { error: null },
    });

    const result = await createProjectWithRepository(client, {
      userId: "user-1",
      installationRowId: "installation-1",
      repository,
    });

    expect(result).toEqual({ ok: false, error: "unknown", message: "insert failed" });
    expect(repoInsert).not.toHaveBeenCalled();
  });
});
