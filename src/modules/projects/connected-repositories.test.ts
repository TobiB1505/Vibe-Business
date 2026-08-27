import { describe, expect, it, vi } from "vitest";
import {
  hasSelectableRepository,
  listConnectedRepositoryIds,
  markConnectedRepositories,
} from "./connected-repositories";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RepositorySummary } from "@/modules/github/types";

function repo(id: number, fullName: string): RepositorySummary {
  return {
    githubRepositoryId: id,
    owner: fullName.split("/")[0],
    name: fullName.split("/")[1],
    fullName,
    defaultBranch: "main",
    private: false,
    htmlUrl: `https://github.com/${fullName}`,
  };
}

describe("listConnectedRepositoryIds", () => {
  /**
   * The fake models the boundary's shape, including the liveness predicate, so
   * a test can assert that a detached repository is not counted as connected
   * (VB-001 M5) — the mistake that would grey a repository out forever.
   */
  function connectionsReturning(data: unknown) {
    const is = vi.fn().mockResolvedValue({ data, error: null });
    const select = vi.fn(() => ({ is }));
    return { client: { from: vi.fn(() => ({ select })) } as unknown as SupabaseClient, is };
  }

  it("returns the connected GitHub repository ids", async () => {
    const { client } = connectionsReturning([
      { github_repository_id: 1 },
      { github_repository_id: 2 },
    ]);

    expect(await listConnectedRepositoryIds(client)).toEqual([1, 2]);
  });

  it("asks only for live connections, so a detached repository is pickable again", async () => {
    const { client, is } = connectionsReturning([]);

    await listConnectedRepositoryIds(client);

    expect(is).toHaveBeenCalledWith("detached_at", null);
  });

  it("returns an empty list when nothing is connected", async () => {
    const { client } = connectionsReturning(null);

    expect(await listConnectedRepositoryIds(client)).toEqual([]);
  });

  it("throws on query failure rather than reporting nothing connected", async () => {
    const select = vi.fn().mockResolvedValue({ data: null, error: { message: "boom" } });
    const client = { from: vi.fn(() => ({ select })) } as unknown as SupabaseClient;

    await expect(listConnectedRepositoryIds(client)).rejects.toBeTruthy();
  });
});

describe("markConnectedRepositories", () => {
  it("marks repositories that are already connected", () => {
    const result = markConnectedRepositories([repo(1, "octocat/a"), repo(2, "octocat/b")], [2]);

    expect(result[0].alreadyConnected).toBe(false);
    expect(result[1].alreadyConnected).toBe(true);
  });

  it("keeps every repository in the list so the user can see why one is unavailable", () => {
    const result = markConnectedRepositories([repo(1, "octocat/a"), repo(2, "octocat/b")], [1, 2]);
    expect(result).toHaveLength(2);
  });

  it("marks nothing when there are no existing connections", () => {
    const result = markConnectedRepositories([repo(1, "octocat/a")], []);
    expect(result[0].alreadyConnected).toBe(false);
  });
});

describe("hasSelectableRepository", () => {
  it("is true while at least one repository is still connectable", () => {
    expect(hasSelectableRepository(markConnectedRepositories([repo(1, "a/a"), repo(2, "a/b")], [1]))).toBe(true);
  });

  it("is false when every repository is already connected", () => {
    expect(hasSelectableRepository(markConnectedRepositories([repo(1, "a/a")], [1]))).toBe(false);
  });

  it("is false for an empty list", () => {
    expect(hasSelectableRepository([])).toBe(false);
  });
});
