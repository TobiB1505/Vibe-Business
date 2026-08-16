"use client";

import { useState } from "react";
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
export function AuditIntelligence({ map }: { map: BusinessMapModel }) {
  const [selected, setSelected] = useState<BusinessLens | null>(null);
  const node = selected ? (map.nodes.find((entry) => entry.lens === selected) ?? null) : null;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <MonoLabel as="h2">How Vibe sees your business</MonoLabel>
        <span className="text-fg-meta font-mono text-[0.6875rem]">
          {map.assessedCount} lenses · {map.signalCount} signals
        </span>
      </div>

      <BusinessMap map={map} selected={selected} onSelect={setSelected} />

      {node !== null && (
        <Surface level="panel" padding="lg" className="relative">
          <button
            type="button"
            onClick={() => setSelected(null)}
            className="text-fg-meta hover:text-fg-body absolute top-4 right-4 rounded-sm px-2 py-1 font-mono text-[0.6875rem]"
          >
            Close
          </button>
          <LensDetail node={node} map={map} />
        </Surface>
      )}
    </div>
  );
}
