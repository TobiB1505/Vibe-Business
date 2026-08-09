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
  it("returns the connected GitHub repository ids", async () => {
    const select = vi.fn().mockResolvedValue({
      data: [{ github_repository_id: 1 }, { github_repository_id: 2 }],
      error: null,
    });
    const client = { from: vi.fn(() => ({ select })) } as unknown as SupabaseClient;

    expect(await listConnectedRepositoryIds(client)).toEqual([1, 2]);
  });

  it("returns an empty list when nothing is connected", async () => {
    const select = vi.fn().mockResolvedValue({ data: null, error: null });
    const client = { from: vi.fn(() => ({ select })) } as unknown as SupabaseClient;

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
