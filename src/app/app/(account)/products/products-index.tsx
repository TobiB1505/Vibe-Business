"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import {
  AlertIcon,
  FilterIcon,
  PlusIcon,
  ProductsIcon,
  SearchIcon,
  TrendIcon,
} from "@/components/ui/dashboard-icons";
import { Surface } from "@/components/ui/surface";
import { SectionHeader } from "@/components/ui/typography";
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
      <span className="flex min-w-0 flex-col">
        <strong className="text-fg text-lg font-bold tabular-nums">{value}</strong>
        <span className="text-fg-meta text-xs">{label}</span>
      </span>
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
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <label className="border-line-2 bg-surface-2 focus-within:border-mint-line rounded-nav flex min-w-0 flex-1 items-center gap-2.5 border px-3.5 py-2.5 sm:w-64 sm:flex-none">
              <SearchIcon size={16} className="text-fg-meta shrink-0" />
              <span className="sr-only">Search products</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search products…"
                className="text-fg-body placeholder:text-fg-meta min-w-0 flex-1 bg-transparent text-sm outline-none"
              />
            </label>

            <label className="border-line-2 bg-surface-2 rounded-nav text-fg-muted flex items-center gap-2 border px-3 py-2.5 text-sm">
              <FilterIcon size={15} className="shrink-0" />
              <span className="sr-only">Filter products</span>
              <select
                value={filter}
                onChange={(event) => setFilter(event.target.value as ProductFilter)}
                className="text-fg-body bg-transparent text-sm font-medium outline-none"
                aria-label="Filter products"
              >
                <option value="all">All</option>
                <option value="attention">Need attention</option>
                <option value="analysed">Analysed</option>
                <option value="setup">Setup</option>
              </select>
            </label>

            <label className="border-line-2 bg-surface-2 rounded-nav text-fg-muted flex items-center gap-2 border px-3 py-2.5 text-sm">
              <span className="text-fg-meta text-xs font-medium">Sort:</span>
              <select
                value={sort}
                onChange={(event) => setSort(event.target.value as ProductSort)}
                className="text-fg-body bg-transparent text-sm font-semibold outline-none"
                aria-label="Sort products"
              >
                <option value="priority">Priority</option>
                <option value="recent">Recent</option>
                <option value="signal">Signal</option>
                <option value="name">Name</option>
              </select>
            </label>
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
            <strong className="text-sm font-semibold">Connect product</strong>
            <span className="text-mint-dim text-xs">Add from GitHub</span>
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
          <h2 className="text-fg mt-4 text-base font-semibold">No matching products</h2>
          <p className="text-fg-muted mt-2 max-w-md text-sm">
            Try another search or reset the filter to see every connected product.
          </p>
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setFilter("all");
            }}
            className="text-mint hover:text-mint-hover mt-5 rounded-sm text-sm font-semibold transition-interactive"
          >
            Clear search and filters
          </button>
        </Surface>
      )}
    </div>
  );
}
