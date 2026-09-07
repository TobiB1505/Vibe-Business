import { describe, expect, it } from "vitest";
import { buildDesk, entryRank } from "./desk";
import type { DashboardProject } from "@/modules/projects/dashboard";

/**
 * The ordering is the screen.
 *
 * The dashboard is one ranked list, so what is worth asserting is a property of
 * the list rather than of any pixel: a blocked decision is never below a calm
 * product, a product raising two decisions appears twice, and a product with
 * nothing waiting is present rather than absent.
 */

function project(overrides: Partial<DashboardProject> & { id: string }): DashboardProject {
  return {
    name: overrides.id,
    repositoryFullName: `founder/${overrides.id}`,
    defaultBranch: "main",
    productName: null,
    logoUrl: null,
    score: 60,
    scoreState: "scored",
    nextMovesCount: 0,
    topMove: null,
    lastAnalysedAt: "2026-08-22T09:00:00.000Z",
    scoreHistory: [],
    preparedCount: 0,
    failedValidationCount: 0,
    ...overrides,
  };
}

describe("the desk is the ranking", () => {
  it("puts a blocked decision above everything, including a calmer product", () => {
    const desk = buildDesk([
      project({ id: "calm", score: 90 }),
      project({ id: "broken", score: 20, preparedCount: 1, failedValidationCount: 1 }),
    ]);

    expect(desk[0].kind).toBe("item");
    expect(desk[0].project.id).toBe("broken");
    // And a settled product can never outrank an item, whatever its score.
    expect(entryRank(desk[0])).toBeLessThan(entryRank(desk[desk.length - 1]));
  });

  it("shows a product twice when it raises two decisions", () => {
    // `attention.ts`: "a project with a failed validation and waiting moves
    // genuinely needs attention twice, and hiding one behind the other would
    // mean the user never sees it." A card has one action; a list does not.
    const desk = buildDesk([
      project({
        id: "busy",
        preparedCount: 1,
        failedValidationCount: 1,
        nextMovesCount: 3,
      }),
    ]);

    const forBusy = desk.filter((entry) => entry.project.id === "busy");
    expect(forBusy).toHaveLength(2);
    expect(forBusy.map((entry) => entry.kind === "item" && entry.item.kind)).toEqual([
      "validation_failed",
      "moves_waiting",
    ]);
  });

  it("keeps a product with nothing waiting on the desk, last and settled", () => {
    // Absent would read as deleted. "Nothing waiting" is a real answer and the
    // founder needs to see it.
    const desk = buildDesk([
      project({ id: "calm" }),
      project({ id: "waiting", nextMovesCount: 2 }),
    ]);

    expect(desk.map((entry) => entry.kind)).toEqual(["item", "settled"]);
    expect(desk[1].project.id).toBe("calm");
    expect(desk[1].item).toBeNull();
  });

  it("orders settled products by score, not by name", () => {
    // The list above is ordered by urgency. A calm tail ordered alphabetically
    // would read as a second, unrelated ordering in the same column.
    const desk = buildDesk([project({ id: "aaa", score: 40 }), project({ id: "zzz", score: 90 })]);

    expect(desk.map((entry) => entry.project.id)).toEqual(["zzz", "aaa"]);
  });

  it("gives every entry an id that survives a re-render", () => {
    const desk = buildDesk([project({ id: "one", nextMovesCount: 1 }), project({ id: "two" })]);

    expect(new Set(desk.map((entry) => entry.id)).size).toBe(desk.length);
    expect(desk.every((entry) => entry.id.startsWith(entry.project.id))).toBe(true);
  });

  it("is empty for an account with no products, rather than a placeholder row", () => {
    expect(buildDesk([])).toEqual([]);
  });
});
