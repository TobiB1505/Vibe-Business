import { describe, expect, it } from "vitest";
import {
  classifyProbeFailure,
  listRepositoriesFromClient,
  normalizeRepository,
  type RepositoriesLister,
} from "./repositories";

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

describe("what a failed probe means (VB-041)", () => {
  /**
   * Three answers rather than two, and the third is the point. The probe used
   * to return a boolean, and its own comment complained about what that cost:
   * a misconfigured App key and a genuinely uninstalled App produced the same
   * `false`, so nothing could act on the difference — and they call for
   * opposite responses.
   *
   * `revoked` is a fact about the customer's account that Vibe records and
   * tells them about. `unavailable` is a fact about this moment, and recording
   * it as revocation would tell a customer their connection was removed when
   * it was not.
   */
  it("reads a 404 as the customer having removed the App", () => {
    expect(classifyProbeFailure({ status: 404 })).toBe("revoked");
  });

  it.each([401, 403, 500, 502, 0])("reads %s as our problem, not theirs", (status) => {
    expect(classifyProbeFailure({ status })).toBe("unavailable");
  });

  it("reads a failure with no status at all as unavailable", () => {
    expect(classifyProbeFailure(new Error("socket hang up"))).toBe("unavailable");
  });
});
