import { describe, expect, it } from "vitest";
import { mapProjectListItem } from "./queries";

describe("mapProjectListItem", () => {
  it("includes repository info when a connection exists", () => {
    const result = mapProjectListItem(
      { id: "project-1", name: "hello-world" },
      { project_id: "project-1", full_name: "octocat/hello-world", default_branch: "main" },
    );
    expect(result).toEqual({
      id: "project-1",
      name: "hello-world",
      repository: { fullName: "octocat/hello-world", defaultBranch: "main" },
    });
  });

  it("returns null repository when no connection exists", () => {
    const result = mapProjectListItem({ id: "project-1", name: "hello-world" }, undefined);
    expect(result.repository).toBeNull();
  });
});
