import { describe, expect, it } from "vitest";
import type { ProductOverviewItem } from "@/modules/projects/product-summary";
import {
  filterAndSortProducts,
  productListStatus,
  productNeedsAttention,
} from "./product-list-state";

function product(overrides: Partial<ProductOverviewItem> = {}): ProductOverviewItem {
  return {
    id: "p1",
    name: "Alpha",
    repositoryFullName: "founder/alpha",
    defaultBranch: "main",
    repositoryPrivate: true,
    productProfileId: "profile_1",
    score: 70,
    scoreState: "scored",
    nextMovesCount: 0,
    topMove: null,
    lastAnalysedAt: "2026-08-20T09:00:00Z",
    scoreHistory: [],
    preparedCount: 0,
    failedValidationCount: 0,
    shortDescription: "A product for independent founders.",
    mainPurpose: "Turn product evidence into a growth plan.",
    primaryAudience: "Independent founders",
    founderGoal: "Start monetizing",
    category: "SaaS application",
    ...overrides,
  };
}

describe("the My Products controls", () => {
  it("searches real profile context as well as the name", () => {
    const products = [product(), product({ id: "p2", name: "Beta", primaryAudience: "Agencies" })];
    const result = filterAndSortProducts(products, {
      query: "agencies",
      filter: "all",
      sort: "priority",
    });

    expect(result.map((item) => item.id)).toEqual(["p2"]);
  });

  it("keeps unscored values below real scores", () => {
    const result = filterAndSortProducts(
      [product({ id: "unscored", score: null }), product({ id: "scored", score: 42 })],
      { query: "", filter: "all", sort: "signal" },
    );

    expect(result.map((item) => item.id)).toEqual(["scored", "unscored"]);
  });

  it("derives attention from existing workflow state", () => {
    const blocked = product({ failedValidationCount: 1 });
    const settled = product();

    expect(productListStatus(blocked)).toMatchObject({ label: "Needs attention", tone: "problem" });
    expect(productNeedsAttention(blocked)).toBe(true);
    expect(productNeedsAttention(settled)).toBe(false);
  });

  it("filters setup without calling an unaudited product active", () => {
    const result = filterAndSortProducts(
      [product(), product({ id: "new", score: null, scoreState: "not_audited" })],
      { query: "", filter: "setup", sort: "priority" },
    );

    expect(result.map((item) => item.id)).toEqual(["new"]);
    expect(productListStatus(result[0])).toMatchObject({ label: "Not analysed" });
  });
});
