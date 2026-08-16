"use client";

import { useState, type ReactNode } from "react";
import { Surface } from "@/components/ui/surface";
import { MonoLabel } from "@/components/ui/typography";
import type { BusinessMap as BusinessMapModel } from "@/modules/business-audit/map-view";
import type { BusinessLens } from "@/modules/business-audit/schema";
import { BusinessMap } from "./business-map";
import { LensDetail } from "./lens-detail";

/**
 * The intelligence panel: the map, and whatever the founder selected in it
 * (AUDIT UI-1 §16, §23).
 *
 * Selection lives here rather than in the page, so the whole audit route stays
 * a server component and only this subtree hydrates. The map is the largest
 * thing on the page and the least stateful; keeping the state at the smallest
 * enclosing boundary is what stops a click on a lens re-rendering the audit.
 *
 * Opening a lens **adds** rather than replaces (§16: "preserve map context").
 * A founder who clicks Audience to find out why it is first should still be
 * looking at the business it sits inside — the map is the argument's context,
 * not a menu you leave.
 */
export function AuditIntelligence({
  map,
  children,
}: {
  map: BusinessMapModel;
  children: ReactNode;
}) {
  const [selected, setSelected] = useState<BusinessLens | null>(null);
  const node = selected ? (map.nodes.find((entry) => entry.lens === selected) ?? null) : null;

  return (
    <div className="flex flex-col gap-6" data-testid="audit-intelligence">
      <Surface
        level="panel"
        padding="none"
        className="relative overflow-hidden p-4 sm:p-5 lg:p-6"
      >
        <span
          aria-hidden="true"
          className="audit-intelligence-glow pointer-events-none absolute inset-0"
        />

        <div className="relative flex flex-col gap-5">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <MonoLabel as="h2" className="text-fg-secondary">
              Business intelligence
            </MonoLabel>
            <span className="text-fg-meta font-mono text-[0.6875rem]">
              closer to centre = sooner
            </span>
          </div>

          <div className="grid min-w-0 gap-7 xl:grid-cols-[minmax(0,1.65fr)_minmax(19rem,1fr)] xl:items-start">
            <section
              className="order-2 flex min-w-0 flex-col gap-3 xl:order-1"
              data-testid="audit-map-panel"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
                <h3 className="text-fg text-lg font-semibold tracking-[-0.025em]">
                  How Vibe sees your business
                </h3>
                <span className="text-fg-meta font-mono text-[0.625rem] md:hidden">
                  ordered by priority
                </span>
              </div>
              <BusinessMap map={map} selected={selected} onSelect={setSelected} />
            </section>

            <aside
              aria-label="What the business map means"
              className="contents xl:order-2 xl:flex xl:min-w-0 xl:flex-col xl:border-l xl:border-line-1 xl:pl-7"
              data-testid="audit-interpretation"
            >
              {children}
            </aside>
          </div>
        </div>
      </Surface>

      {node !== null && (
        <Surface
          level="section"
          padding="lg"
          className="relative max-w-[68rem]"
          data-testid="selected-lens-detail"
        >
          <button
            type="button"
            onClick={() => setSelected(null)}
            className="text-fg-meta hover:text-fg-body absolute top-4 right-4 rounded-full border border-transparent px-3 py-1.5 font-mono text-[0.6875rem] transition-colors hover:border-line-2"
          >
            Close
          </button>
          <LensDetail node={node} map={map} />
        </Surface>
      )}
    </div>
  );
}
