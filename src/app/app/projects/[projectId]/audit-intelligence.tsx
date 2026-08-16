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
  score,
  children,
}: {
  map: BusinessMapModel;
  /** Shown in the map's centre, where it reads as one reading among nine. */
  score: number | null;
  children: ReactNode;
}) {
  /*
   * Opens on the lens the audit itself ranked first, falling back to whatever
   * it marked `now`.
   *
   * Not decoration for an empty column. Left closed, the space beside the map
   * is blank on arrival and the nodes read as labels rather than as something
   * you can ask a question of. Opening the top-priority lens fills it with the
   * one area the audit says matters most — which is the node a founder would
   * click first anyway — and demonstrates the interaction without a tooltip.
   */
  const defaultLens =
    map.nodes.find((entry) => entry.blockerRank === 1)?.lens ??
    map.nodes.find((entry) => entry.ring === "now")?.lens ??
    null;

  const [selected, setSelected] = useState<BusinessLens | null>(defaultLens);
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
              <BusinessMap map={map} score={score} selected={selected} onSelect={setSelected} />

              {/*
                Directly under the map, in the same column.
                A detail panel in the *other* column makes the eye cross the
                page to read the answer to a click it made here, which is what
                turns a map into decoration. It also fills the column: the map
                is shorter than the conclusions beside it, and this is the
                content that genuinely belongs in the difference.
              */}
              {node !== null && (
                <div
                  className="border-line-1 relative mt-2 border-t pt-5"
                  data-testid="selected-lens-detail"
                >
                  <button
                    type="button"
                    onClick={() => setSelected(null)}
                    className="text-fg-meta hover:text-fg-body hover:border-line-2 absolute top-4 right-0 rounded-full border border-transparent px-3 py-1.5 font-mono text-[0.6875rem] transition-colors"
                  >
                    Close
                  </button>
                  <LensDetail node={node} map={map} />
                </div>
              )}
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

    </div>
  );
}
