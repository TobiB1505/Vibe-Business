import { describe, expect, it } from "vitest";
import { listRepositoriesFromClient, normalizeRepository, type RepositoriesLister } from "./repositories";

const rawRepo = {
  id: 123,
  name: "hello-world",
  full_name: "octocat/hello-world",
  owner: { login: "octocat" },
  default_branch: "main",
  private: false,
  html_url: "https://github.com/octocat/hello-world",
};

function fakeClient(repositories: unknown[]): RepositoriesLister {
  return {
    rest: {
      apps: {
        listReposAccessibleToInstallation: async () => ({
          data: { repositories: repositories as never },
        }),
      },
    },
  };
}

describe("normalizeRepository", () => {
  it("maps GitHub's raw shape to the domain DTO", () => {
    expect(normalizeRepository(rawRepo)).toEqual({
      githubRepositoryId: 123,
      owner: "octocat",
      name: "hello-world",
      fullName: "octocat/hello-world",
      defaultBranch: "main",
      private: false,
      htmlUrl: "https://github.com/octocat/hello-world",
    });
  });

  it("falls back to main when default_branch is absent", () => {
    const { default_branch, ...withoutDefaultBranch } = rawRepo;
    void default_branch;
    expect(normalizeRepository(withoutDefaultBranch as typeof rawRepo).defaultBranch).toBe("main");
  });
});

describe("listRepositoriesFromClient", () => {
  it("normalizes every repository in the response", async () => {
    const result = await listRepositoriesFromClient(fakeClient([rawRepo, { ...rawRepo, id: 456, name: "second" }]));
    expect(result).toHaveLength(2);
    expect(result[0].githubRepositoryId).toBe(123);
    expect(result[1].githubRepositoryId).toBe(456);
  });

  it("returns an empty list when the installation has no accessible repositories", async () => {
    expect(await listRepositoriesFromClient(fakeClient([]))).toEqual([]);
  });
});
