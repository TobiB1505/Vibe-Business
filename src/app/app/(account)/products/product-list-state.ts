import type { StatusTone } from "@/components/ui/status-pill";
import { productDisplayName } from "@/modules/projects/display-name";
import type { ProductOverviewItem } from "@/modules/projects/product-summary";

export type ProductFilter = "all" | "attention" | "analysed" | "setup";
export type ProductSort = "priority" | "recent" | "signal" | "name";

export type ProductListStatus = {
  label: string;
  tone: StatusTone;
  /** Lower means more urgent. Used only for presentation ordering. */
  priority: number;
};

export function productListStatus(product: ProductOverviewItem): ProductListStatus {
  if (product.failedValidationCount > 0) {
    return { label: "Needs attention", tone: "problem", priority: 0 };
  }
  if (product.preparedCount > 0) {
    return { label: "Review ready", tone: "waiting", priority: 1 };
  }
  if (product.nextMovesCount !== null && product.nextMovesCount > 0) {
    return { label: "Moves ready", tone: "active", priority: 2 };
  }
  if (product.repositoryFullName === null) {
    return { label: "Setup", tone: "neutral", priority: 3 };
  }
  if (product.scoreState === "not_audited") {
    return { label: "Not analysed", tone: "neutral", priority: 4 };
  }
  if (product.scoreState === "insufficient_coverage") {
    return { label: "Limited signal", tone: "waiting", priority: 5 };
  }
  return { label: "Up to date", tone: "success", priority: 6 };
}

export function productNeedsAttention(product: ProductOverviewItem): boolean {
  return productListStatus(product).priority <= 4;
}

function productIsSetup(product: ProductOverviewItem): boolean {
  return product.repositoryFullName === null || product.scoreState === "not_audited";
}

function searchableText(product: ProductOverviewItem): string {
  return [
    product.name,
    // The name on the card. Searching for what you can read is the whole
    // point of a search box.
    product.productName,
    product.repositoryFullName,
    product.shortDescription,
    product.mainPurpose,
    product.primaryAudience,
    product.founderGoal,
    product.category,
    product.topMove?.title,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLocaleLowerCase("en");
}

export function filterAndSortProducts(
  products: ProductOverviewItem[],
  options: { query: string; filter: ProductFilter; sort: ProductSort },
): ProductOverviewItem[] {
  const query = options.query.trim().toLocaleLowerCase("en");

  return products
    .filter((product) => query === "" || searchableText(product).includes(query))
    .filter((product) => {
      if (options.filter === "attention") return productNeedsAttention(product);
      if (options.filter === "analysed") return product.scoreState !== "not_audited";
      if (options.filter === "setup") return productIsSetup(product);
      return true;
    })
    .sort((a, b) => {
      if (options.sort === "name") {
        return productDisplayName(a).localeCompare(productDisplayName(b));
      }
      if (options.sort === "signal") {
        return (b.score ?? Number.NEGATIVE_INFINITY) - (a.score ?? Number.NEGATIVE_INFINITY);
      }
      if (options.sort === "recent") {
        return (
          (Date.parse(b.lastAnalysedAt ?? "") || 0) - (Date.parse(a.lastAnalysedAt ?? "") || 0)
        );
      }

      const priority = productListStatus(a).priority - productListStatus(b).priority;
      return priority !== 0 ? priority : productDisplayName(a).localeCompare(productDisplayName(b));
    });
}
