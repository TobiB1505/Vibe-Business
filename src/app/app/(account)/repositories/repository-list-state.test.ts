import { describe, expect, it } from "vitest";
import type { ConnectedRepository } from "@/modules/projects/account-repositories";
import {
  filterAndSortRepositories,
  repositoryPage,
  repositoryPageSlice,
} from "./repository-list-state";

const repositories: ConnectedRepository[] = [
  {
    projectId: "2",
    projectName: "Landing Pro",
    owner: "vibe",
    name: "landing-pro",
    fullName: "vibe/landing-pro",
    defaultBranch: "main",
    private: true,
    htmlUrl: "https://github.com/vibe/landing-pro",
    connectedAt: "2026-08-24T10:00:00Z",
  },
  {
    projectId: "1",
    projectName: "Analyzer",
    owner: "vibe",
    name: "analyzer",
    fullName: "vibe/analyzer",
    defaultBranch: "develop",
    private: false,
    htmlUrl: "https://github.com/vibe/analyzer",
    connectedAt: "2026-08-20T10:00:00Z",
  },
];

describe("repository list state", () => {
  it("searches stored repository, product and branch values", () => {
    expect(
      filterAndSortRepositories(repositories, { query: "develop", filter: "all", sort: "recent" }),
    ).toEqual([repositories[1]]);
  });

  it("combines visibility filtering with an explicit sort", () => {
    expect(
      filterAndSortRepositories(repositories, { query: "", filter: "private", sort: "name" }),
    ).toEqual([repositories[0]]);
  });

  it("clamps malformed and out-of-range pages", () => {
    expect(repositoryPage("nope")).toBe(1);
    expect(repositoryPageSlice(repositories, 8)).toMatchObject({ page: 1, pageCount: 1 });
  });
});
