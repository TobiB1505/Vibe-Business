"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { PlusIcon } from "@/components/ui/dashboard-icons";
import { Surface } from "@/components/ui/surface";
import { SectionHeader } from "@/components/ui/typography";
import { SearchField, SegmentedControl, SortSelect } from "@/components/ui/list-controls";
import { EmptyState } from "@/components/ui/states";
import { Button, buttonClasses } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import type { ProductOverviewItem } from "@/modules/projects/product-summary";
import { ProductListRow } from "./product-list-row";
import { filterAndSortProducts, type ProductFilter, type ProductSort } from "./product-list-state";

export function ProductsIndex({ products }: { products: ProductOverviewItem[] }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ProductFilter>("all");
  const [sort, setSort] = useState<ProductSort>("priority");

  const visible = useMemo(
    () => filterAndSortProducts(products, { query, filter, sort }),
    [filter, products, query, sort],
  );
  return (
    <div className="flex flex-col gap-7" data-testid="products-index">
      <SectionHeader
        level={1}
        title="My Products"
        description="All products you're building and growing."
        /*
          The header carries the page's one action, and nothing else.

          `Connect product` used to be the fourth tile in a row of three
          statistics — the same size and the same shape as "3 Products", so the
          only thing a founder could *do* here wore the costume of something to
          read. It also drew its own border, fill and hover, after 0185 folded
          every pressable control into `Button`.

          The list's own controls moved out of this slot and above the list,
          where they belong: `SectionHeader` gives `actions` `sm:shrink-0`, so
          four controls in it overflowed the page at 1024 and 768 rather than
          wrapping. Measured, before this split.
        */
        actions={
          <Link
            href="/app/connect/github"
            className={cn(buttonClasses({ variant: "primary" }), "shrink-0")}
          >
            <PlusIcon size={16} />
            Connect product
          </Link>
        }
      />

      {/*
        The list's controls, above the list.

        Three controls with three intrinsic heights — an input, a pill of pills
        and a select — and a toolbar where they disagree by two pixels reads as
        a misalignment nobody can name, so `items-center` settles it.
      */}
      <div className="flex flex-wrap items-center gap-2">
        <SearchField
          label="Search products"
          value={query}
          onChange={setQuery}
          onClear={() => setQuery("")}
          clearLabel="Clear product search"
          placeholder="Search products…"
          className="flex-1 basis-full sm:w-64 sm:flex-none sm:basis-auto"
        />

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

      {visible.length > 0 ? (
        /*
          One surface, and the products are rows inside it.

          Three cards rendered at three different heights — 252, 194 and 231 at
          1280 — because each card carried a grid of profile facts that
          collapses when Vibe has not read a product yet. A list whose rows
          change height with how much is known about each item is a list that
          cannot be scanned, and what a product *does* is a thing to read
          inside the product rather than on the way to it.
        */
        <Surface level="card" padding="none" className="overflow-hidden">
          <ul aria-live="polite">
            {visible.map((product, index) => (
              <ProductListRow key={product.id} product={product} divided={index > 0} />
            ))}
          </ul>
        </Surface>
      ) : (
        <EmptyState
          as="h2"
          title="No matching products"
          description="Try another search or reset the filter to see every connected product."
          action={
            <Button
              variant="ghost"
              onClick={() => {
                setQuery("");
                setFilter("all");
              }}
            >
              Clear search and filters
            </Button>
          }
        />
      )}
    </div>
  );
}
