import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * VB-024 — the project impact list stops walking its changes one at a time.
 *
 * Each iteration can reach GitHub through `getMergeCard`, so a project with
 * ten prepared changes paid ten sequential round trips before the page could
 * render.
 *
 * Two things have to hold at once, and they pull against each other: the work
 * must overlap, and it must not overlap without limit. A plain
 * `Promise.all(prepared.map(…))` gets the first and loses the second — one
 * GitHub call per prepared change, all at once, is how a busy project trips a
 * secondary rate limit.
 */

const getMergeCardMock = vi.fn();
const listPreparedChangesMock = vi.fn();

vi.mock("@/modules/merge/service", () => ({
  getMergeCard: (...args: unknown[]) => getMergeCardMock(...args),
  resolveMergeTarget: async () => ({ owner: "o" }),
}));
vi.mock("@/modules/merge/view", () => ({
  buildMergeCard: () => ({ state: "blocked", mergedAt: null }),
}));
vi.mock("@/modules/merge/messages", () => ({ mergeFailureMessage: () => "unavailable" }));
vi.mock("@/modules/merge/github/adapter", () => ({ createGithubMergePort: () => ({}) }));
vi.mock("@/modules/execution/store", () => ({
  listPreparedChangesForProject: (...args: unknown[]) => listPreparedChangesMock(...args),
}));
vi.mock("@/modules/outcome-verification/service", () => ({
  getOutcomeCard: async () => ({ state: "unavailable" }),
}));
vi.mock("@/modules/business-measurement/service", () => ({
  getBusinessImpactCard: async () => ({ state: "unavailable" }),
}));
vi.mock("@/modules/business-measurement/source", () => ({
  NoConnectedMetricSources: class {},
}));

const { getProjectImpact } = await import("./project-impact");

beforeEach(() => {
  vi.clearAllMocks();
});

function changes(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `change_${i}`,
    branchName: `b${i}`,
    commitSha: "a".repeat(40),
    baseBranch: "main",
  }));
}

describe("the merge cards", () => {
  it("overlap instead of running one after another", async () => {
    listPreparedChangesMock.mockResolvedValue(changes(6));

    let inFlight = 0;
    let peak = 0;
    getMergeCardMock.mockImplementation(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return { state: "blocked", mergedAt: null };
    });

    await getProjectImpact({} as never, {
      projectId: "project_1",
      userId: "user_1",
      repositoryConnected: true,
    });

    expect(peak).toBeGreaterThan(1);
  });

  /**
   * The half a naive `Promise.all` loses. Twenty prepared changes must not
   * become twenty simultaneous GitHub calls.
   */
  it("never exceeds the concurrency ceiling", async () => {
    listPreparedChangesMock.mockResolvedValue(changes(20));

    let inFlight = 0;
    let peak = 0;
    getMergeCardMock.mockImplementation(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 2));
      inFlight -= 1;
      return { state: "blocked", mergedAt: null };
    });

    await getProjectImpact({} as never, {
      projectId: "project_1",
      userId: "user_1",
      repositoryConnected: true,
    });

    expect(peak).toBeLessThanOrEqual(6);
    expect(getMergeCardMock).toHaveBeenCalledTimes(20);
  });
});

describe("the list the founder reads", () => {
  /**
   * Order follows the prepared changes, not completion order. A card moving
   * because one GitHub call was slow would be a different defect than the one
   * being fixed, and it is exactly what overlapping work invites.
   */
  it("keeps input order even when later work finishes first", async () => {
    listPreparedChangesMock.mockResolvedValue(changes(4));

    getMergeCardMock.mockImplementation(async (_supabase, _port, params) => {
      const index = Number((params as { preparedChangeId: string }).preparedChangeId.split("_")[1]);
      // Earlier changes resolve last.
      await new Promise((resolve) => setTimeout(resolve, (4 - index) * 5));
      return { state: "merged", mergedAt: "2026-08-27T00:00:00.000Z" };
    });

    const impact = await getProjectImpact({} as never, {
      projectId: "project_1",
      userId: "user_1",
      repositoryConnected: true,
    });

    expect(impact.entries.map((entry) => entry.preparedChangeId)).toEqual([
      "change_0",
      "change_1",
      "change_2",
      "change_3",
    ]);
  });

  it("still counts the unmerged ones it skipped", async () => {
    listPreparedChangesMock.mockResolvedValue(changes(5));
    getMergeCardMock.mockImplementation(async (_s, _p, params) => {
      const index = Number((params as { preparedChangeId: string }).preparedChangeId.split("_")[1]);
      return index < 2
        ? { state: "merged", mergedAt: "2026-08-27T00:00:00.000Z" }
        : { state: "blocked", mergedAt: null };
    });

    const impact = await getProjectImpact({} as never, {
      projectId: "project_1",
      userId: "user_1",
      repositoryConnected: true,
    });

    expect(impact.entries).toHaveLength(2);
    expect(impact.unmergedCount).toBe(3);
  });
});
