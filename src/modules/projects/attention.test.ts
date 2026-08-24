import { describe, expect, it } from "vitest";
import {
  PROJECT_SECTIONS,
  PROJECT_SUBSECTIONS,
} from "@/components/layout/project-shell";
import {
  ATTENTION_DISPLAY_LIMIT,
  buildAttentionItems,
  orderProjectsByAttention,
} from "./attention";
import type { DashboardProject } from "./dashboard";

function project(overrides: Partial<DashboardProject> = {}): DashboardProject {
  return {
    id: "p1",
    name: "alpha",
    repositoryFullName: "owner/alpha",
    defaultBranch: "main",
    score: 40,
    scoreState: "scored",
    nextMovesCount: 0,
    topMove: null,
    lastAnalysedAt: null,
  scoreHistory: [],
    preparedCount: 0,
    failedValidationCount: 0,
    ...overrides,
  };
}

describe("attention items come only from real state", () => {
  it("produces nothing for a project with nothing to do", () => {
    // The most important case. A quiet project must produce a quiet dashboard,
    // not a manufactured suggestion.
    expect(buildAttentionItems([project()])).toEqual([]);
  });

  it("produces nothing at all for no projects", () => {
    expect(buildAttentionItems([])).toEqual([]);
  });

  it("never invents a move count from a project that has no opportunity set", () => {
    // `null` means "never generated", which is different from zero and must
    // not become "0 moves are waiting".
    expect(buildAttentionItems([project({ nextMovesCount: null })])).toEqual([]);
  });
});

describe("priority ordering", () => {
  it("puts a blocked project above one merely waiting on a decision", () => {
    const items = buildAttentionItems([
      project({ id: "p1", name: "zulu", preparedCount: 1 }),
      project({ id: "p2", name: "alpha", preparedCount: 1, failedValidationCount: 1 }),
    ]);

    expect(items[0]?.tier).toBe("blocked");
    expect(items[0]?.projectId).toBe("p2");
  });

  it("orders blocked, decision, ready, setup", () => {
    const items = buildAttentionItems([
      project({ id: "a", name: "a", repositoryFullName: null }),
      project({ id: "b", name: "b", nextMovesCount: 2 }),
      project({ id: "c", name: "c", preparedCount: 1 }),
      project({ id: "d", name: "d", preparedCount: 1, failedValidationCount: 1 }),
    ]);

    expect(items.map((item) => item.tier)).toEqual(["blocked", "decision", "ready", "setup"]);
  });

  it("is stable — the same input always yields the same order", () => {
    // Without a tiebreaker the list reshuffles between renders, which makes a
    // dashboard feel broken even when every item is correct.
    const projects = [
      project({ id: "p1", name: "beta", nextMovesCount: 1 }),
      project({ id: "p2", name: "alpha", nextMovesCount: 1 }),
    ];

    const first = buildAttentionItems(projects).map((item) => item.id);
    const second = buildAttentionItems([...projects].reverse()).map((item) => item.id);

    expect(first).toEqual(second);
    expect(first[0]).toContain("p2");
  });
});

describe("one project can need attention more than once", () => {
  it("reports a failed validation and waiting moves separately", () => {
    const items = buildAttentionItems([
      project({ preparedCount: 1, failedValidationCount: 1, nextMovesCount: 3 }),
    ]);

    expect(items.map((item) => item.kind)).toEqual(["validation_failed", "moves_waiting"]);
  });

  it("does not count a failed change as also waiting for review", () => {
    // One prepared change producing both "failed" and "waiting for you" would
    // have the dashboard contradict itself about the same object.
    const items = buildAttentionItems([
      project({ preparedCount: 1, failedValidationCount: 1 }),
    ]);

    expect(items.map((item) => item.kind)).toEqual(["validation_failed"]);
  });

  it("separates failed from waiting when a project has both", () => {
    const items = buildAttentionItems([
      project({ preparedCount: 3, failedValidationCount: 1 }),
    ]);

    expect(items.find((item) => item.kind === "prepared_waiting")?.title).toContain("2");
  });
});

describe("setup states", () => {
  it("asks for a repository rather than an audit when none is connected", () => {
    // Telling someone to run an audit they cannot run is a dead end — the same
    // failure mode Deep Scan was reported for twice.
    const items = buildAttentionItems([
      project({ repositoryFullName: null, scoreState: "not_audited" }),
    ]);

    expect(items.map((item) => item.kind)).toEqual(["no_repository"]);
  });

  it("asks for an audit when a repository exists but nothing was analysed", () => {
    const items = buildAttentionItems([project({ scoreState: "not_audited" })]);
    expect(items.map((item) => item.kind)).toEqual(["never_audited"]);
  });

  it("does not ask for an audit that ran but could not be scored", () => {
    // `insufficient_coverage` means Vibe looked and could not say. Re-running
    // it is not obviously the answer, so the dashboard does not demand it.
    const items = buildAttentionItems([project({ scoreState: "insufficient_coverage" })]);
    expect(items).toEqual([]);
  });
});

describe("every item can be acted on", () => {
  it("points at a route that exists in the workspace", () => {
    const items = buildAttentionItems([
      project({ id: "p1", preparedCount: 1, failedValidationCount: 1 }),
      project({ id: "p2", name: "b", nextMovesCount: 1 }),
      project({ id: "p3", name: "c", scoreState: "not_audited" }),
      project({ id: "p4", name: "d", repositoryFullName: null }),
    ]);

    /*
     * Taken from the workspace's own table rather than written out here.
     * `attention.ts` is a domain module and deliberately builds its hrefs
     * itself rather than importing from `components/` — so this is the only
     * thing standing between it and a segment rename, and a hand-copied list
     * would have been renamed in exactly the same way it was written: not at
     * all. CORE-5 renamed every one of these.
     */
    const allowed = new Set<string>([
      ...PROJECT_SECTIONS.map((section) => section.segment),
      ...PROJECT_SUBSECTIONS.map((section) => section.segment),
    ]);
    for (const item of items) {
      const match = item.action.href.match(/^\/app\/projects\/([^/]+)(?:\/(.+))?$/);
      expect(match, `${item.kind} has a malformed href: ${item.action.href}`).not.toBeNull();
      expect(match?.[1]).toBe(item.projectId);
      expect(allowed.has(match?.[2] ?? ""), `${item.kind} → ${match?.[2]}`).toBe(true);
    }
  });

  it("gives every item exactly one action and a non-empty label", () => {
    const items = buildAttentionItems([
      project({ preparedCount: 2, nextMovesCount: 3, scoreState: "scored" }),
    ]);

    for (const item of items) {
      expect(item.action.label.trim().length).toBeGreaterThan(0);
      expect(item.title.trim().length).toBeGreaterThan(0);
      expect(item.detail.trim().length).toBeGreaterThan(0);
    }
  });

  it("gives every item a unique, stable id", () => {
    const items = buildAttentionItems([
      project({ id: "p1", preparedCount: 1, nextMovesCount: 1 }),
      project({ id: "p2", name: "b", preparedCount: 1, nextMovesCount: 1 }),
    ]);

    const ids = items.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("the dashboard stays a dashboard", () => {
  it("has a display limit small enough not to become a report", () => {
    expect(ATTENTION_DISPLAY_LIMIT).toBeLessThanOrEqual(5);
  });

  it("still returns everything, so the caller can say how many more there are", () => {
    // The cap is a rendering decision. Truncating here would make "and 6 more"
    // impossible to state honestly.
    const projects = Array.from({ length: 6 }, (_, index) =>
      project({ id: `p${index}`, name: `project-${index}`, nextMovesCount: 1 }),
    );

    expect(buildAttentionItems(projects)).toHaveLength(6);
  });
});

describe("copy makes no promises", () => {
  it("never claims an outcome, a result or a deployment", () => {
    const items = buildAttentionItems([
      project({ preparedCount: 2, failedValidationCount: 1, nextMovesCount: 3 }),
      project({ id: "p2", name: "b", repositoryFullName: null }),
      project({ id: "p3", name: "c", scoreState: "not_audited" }),
    ]);

    const copy = items.map((item) => `${item.title} ${item.detail} ${item.action.label}`).join(" ");
    for (const forbidden of ["deploy", "publish", "ship", "live", "revenue", "guarantee", "will increase"]) {
      expect(copy.toLowerCase(), `copy contains "${forbidden}"`).not.toContain(forbidden);
    }
  });
});

describe("the product grid inherits the attention ordering", () => {
  /**
   * The account dashboard has no attention list any more — the information was
   * per-product and already in each card's action. This ordering is the one
   * thing the list contributed that a card cannot, so it has to survive the
   * removal rather than quietly go with it.
   */
  it("puts the most urgent product first", () => {
    const ordered = orderProjectsByAttention([
      project({ id: "settled", name: "settled", nextMovesCount: 0 }),
      project({ id: "setup", name: "setup", repositoryFullName: null }),
      project({ id: "blocked", name: "blocked", preparedCount: 1, failedValidationCount: 1 }),
      project({ id: "ready", name: "ready", nextMovesCount: 2 }),
    ]);

    expect(ordered.map((entry) => entry.id)).toEqual(["blocked", "ready", "setup", "settled"]);
  });

  it("sorts a product with nothing pending last, not first", () => {
    // Nothing pending is not a problem, and it is not what the screen is for.
    const ordered = orderProjectsByAttention([
      project({ id: "quiet", name: "aaa", nextMovesCount: 0 }),
      project({ id: "busy", name: "zzz", nextMovesCount: 1 }),
    ]);

    expect(ordered[0]?.id).toBe("busy");
  });

  it("is stable within a tier, so a reload never reshuffles the grid", () => {
    const input = [
      project({ id: "b", name: "beta", nextMovesCount: 1 }),
      project({ id: "a", name: "alpha", nextMovesCount: 1 }),
    ];

    expect(orderProjectsByAttention(input).map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(orderProjectsByAttention(input).map((entry) => entry.id)).toEqual(["a", "b"]);
  });

  it("returns every product it was given, and mutates nothing", () => {
    const input = [project({ id: "a", name: "a" }), project({ id: "b", name: "b", nextMovesCount: 3 })];
    const before = input.map((entry) => entry.id);

    expect(orderProjectsByAttention(input)).toHaveLength(2);
    expect(input.map((entry) => entry.id)).toEqual(before);
  });
});
