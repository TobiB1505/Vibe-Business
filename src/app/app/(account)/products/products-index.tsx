"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import {
  AlertIcon,
  PlusIcon,
  ProductsIcon,
  SearchIcon,
  TrendIcon,
} from "@/components/ui/dashboard-icons";
import { Surface } from "@/components/ui/surface";
import { SectionHeader } from "@/components/ui/typography";
import { SegmentedControl, SortSelect } from "@/components/ui/list-controls";
import { Figure } from "@/components/ui/figure";
import { cn } from "@/lib/utils/cn";
import type { ProductOverviewItem } from "@/modules/projects/product-summary";
import { ProductListCard } from "./product-list-card";
import {
  filterAndSortProducts,
  productNeedsAttention,
  type ProductFilter,
  type ProductSort,
} from "./product-list-state";

function SummaryMetric({
  icon,
  value,
  label,
  tone = "mint",
}: {
  icon: ReactNode;
  value: string | number;
  label: string;
  tone?: "mint" | "amber";
}) {
  return (
    <Surface level="panel" padding="sm" className="flex min-h-24 items-center gap-3.5">
      <span
        className={cn(
          "rounded-nav flex size-9 shrink-0 items-center justify-center",
          tone === "mint" ? "bg-mint-tint-soft text-mint" : "bg-amber-tint-soft text-amber",
        )}
      >
        {icon}
      </span>
      <Figure value={value} tier="sm" label={label} />
    </Surface>
  );
}

export function ProductsIndex({ products }: { products: ProductOverviewItem[] }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ProductFilter>("all");
  const [sort, setSort] = useState<ProductSort>("priority");

  const visible = useMemo(
    () => filterAndSortProducts(products, { query, filter, sort }),
    [filter, products, query, sort],
  );
  const analysed = products.filter((product) => product.scoreState !== "not_audited").length;
  const attention = products.filter(productNeedsAttention).length;

  return (
    <div className="flex flex-col gap-7" data-testid="products-index">
      <SectionHeader
        level={1}
        title="My Products"
        description="All products you're building and growing."
        actions={
          /* `items-stretch` rather than `items-center`: the three controls
             have different intrinsic heights — an input, a pill of pills and a
             select — and a toolbar where they disagree by two pixels reads as
             a misalignment nobody can name. The tallest sets the row. */
          <div className="flex w-full flex-wrap gap-2 sm:w-auto">
            <label className="border-line-2 bg-surface-2 focus-within:border-mint-line rounded-nav flex min-w-0 flex-1 basis-full items-center gap-2.5 border px-3.5 py-2.5 sm:w-64 sm:flex-none sm:basis-auto">
              <SearchIcon size={16} className="text-fg-meta shrink-0" />
              <span className="sr-only">Search products</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search products…"
                className="text-fg-body placeholder:text-fg-meta min-w-0 flex-1 bg-transparent text-body outline-none"
              />
            </label>

            <SegmentedControl
              label="Filter products"
              value={filter}
              onChange={setFilter}
              options={[
                { value: "all", label: "All" },
                { value: "attention", label: "Attention" },
                { value: "analysed", label: "Analysed" },
                { value: "setup", label: "Setup" },
              ]}
            />

            <SortSelect
              label="Sort products"
              value={sort}
              onChange={setSort}
              options={[
                { value: "priority", label: "Priority" },
                { value: "recent", label: "Recent" },
                { value: "signal", label: "Signal" },
                { value: "name", label: "Name" },
              ]}
            />
          </div>
        }
      />

      <section aria-label="Product summary" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryMetric icon={<ProductsIcon size={18} />} value={products.length} label="Products" />
        <SummaryMetric
          icon={<TrendIcon size={18} />}
          value={`${analysed}/${products.length}`}
          label="Analysed products"
        />
        <SummaryMetric
          icon={<AlertIcon size={18} />}
          value={attention}
          label="Need attention"
          tone="amber"
        />
        <Link
          href="/app/connect/github"
          className={cn(
            "border-mint-line bg-mint-tint-soft rounded-panel flex min-h-24 items-center gap-3.5 border p-4",
            "text-mint transition-interactive hover:bg-mint-tint hover:border-mint",
          )}
        >
          <span className="bg-mint-tint rounded-nav flex size-9 shrink-0 items-center justify-center">
            <PlusIcon size={18} />
          </span>
          <span className="flex flex-col">
            <strong className="text-body font-semibold">Connect product</strong>
            <span className="text-mint-dim text-caption">Add from GitHub</span>
          </span>
        </Link>
      </section>

      {visible.length > 0 ? (
        <ul className="flex flex-col gap-4" aria-live="polite">
          {visible.map((product) => (
            <ProductListCard key={product.id} product={product} />
          ))}
        </ul>
      ) : (
        <Surface
          level="panel"
          padding="lg"
          className="flex min-h-52 flex-col items-center justify-center text-center"
        >
          <SearchIcon size={24} className="text-fg-meta" />
          <h2 className="text-fg mt-4 text-title font-semibold">No matching products</h2>
          <p className="text-fg-muted mt-2 max-w-md text-body">
            Try another search or reset the filter to see every connected product.
          </p>
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setFilter("all");
            }}
            className="text-mint hover:text-mint-hover mt-5 rounded-sm text-body font-semibold transition-interactive"
          >
            Clear search and filters
          </button>
        </Surface>
      )}
    </div>
  );
}
