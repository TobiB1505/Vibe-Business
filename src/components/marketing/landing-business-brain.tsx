"use client";

import { useMemo, useState } from "react";
import { BusinessMap } from "@/app/app/projects/[projectId]/business-brain/business-map";
import { BusinessHealthIcon, ArrowRightIcon } from "@/components/ui/dashboard-icons";
import { BUSINESS_LENSES, type BusinessLens } from "@/modules/business-audit/schema";
import { LENS_LABELS } from "@/modules/business-audit/map-view";
import type { BusinessBrainView } from "@/modules/projects/business-brain-view";

const LENS_PROMPTS: Record<BusinessLens, string> = {
  offer: "Why should someone choose this product?",
  audience: "Who cares enough about this problem to act?",
  revenue_economics: "How does the value become sustainable revenue?",
  acquisition: "How do the right people discover it?",
  conversion: "How does interest become value and payment?",
  retention: "Why would someone return and keep paying?",
  measurement: "Can the founder tell what is working?",
  business_readiness: "What still blocks this becoming a credible business?",
  scalability: "What happens to cost and operations as it grows?",
};

const PREVIEW_VIEW: BusinessBrainView = {
  overall: {
    score: null,
    state: "unscored",
    stateLabel: "Connect a product",
    summary: null,
    scoredLenses: 0,
    eligibleLenses: BUSINESS_LENSES.length,
  },
  nodes: BUSINESS_LENSES.map((lens, index) => ({
    id: lens,
    label: LENS_LABELS[lens],
    score: null,
    health: "unclear",
    healthLabel: "Not assessed",
    priority: "unknown",
    priorityLabel: "Not assessed",
    ring: "later",
    angle: (360 / BUSINESS_LENSES.length) * index,
    summary: null,
    blockerRank: null,
    connectedNodeIds: [],
    missingContext: [],
    evidence: [],
    sourceCount: 0,
    problem: null,
  })),
  relationships: [],
  primaryPriority: null,
  priorities: [],
  additionalPriorityCount: 0,
  recentChanges: [],
  recentChangesUnavailableReason: "no_history",
  sourceCount: 0,
  signalCount: 0,
  lastScanAt: null,
  usedSignedInEvidence: false,
};

export function LandingBusinessBrain() {
  const [selected, setSelected] = useState<BusinessLens | null>(null);
  const [hovered, setHovered] = useState<BusinessLens | null>(null);
  const active = hovered ?? selected;
  const activeLabel = active ? LENS_LABELS[active] : "Your business as one system";
  const activePrompt = active
    ? LENS_PROMPTS[active]
    : "Connect a product and Vibe turns repository, live-product and founder signals into one evidence-backed view.";
  const mapView = useMemo(() => PREVIEW_VIEW, []);

  return (
    <div className="business-brain-stage relative overflow-hidden rounded-[1.25rem] border border-line-2 p-3 sm:p-5">
      <span aria-hidden="true" className="business-brain-grid pointer-events-none absolute inset-0" />
      <div className="relative grid min-w-0 gap-4">
        <div className="min-w-0">
          <BusinessMap
            view={mapView}
            selected={selected}
            hovered={hovered}
            onSelect={(lens) => setSelected((current) => (current === lens ? null : lens))}
            onHover={setHovered}
          />
        </div>

        <aside
          className="business-brain-side-card grid gap-4 p-5 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center"
          aria-live="polite"
        >
          <span className="text-mint flex size-10 items-center justify-center rounded-xl border border-mint-line bg-mint-tint">
            <BusinessHealthIcon size={19} />
          </span>
          <div className="flex flex-col gap-2">
            <p className="text-fg font-semibold">{activeLabel}</p>
            <p className="text-fg-secondary text-sm leading-relaxed">{activePrompt}</p>
          </div>
          <p className="text-fg-muted flex items-center gap-2 text-xs sm:max-w-40">
            {active ? "Select again to return to the overview" : "Explore the nine business areas"}
            <ArrowRightIcon size={14} />
          </p>
        </aside>
      </div>

      <p className="text-fg-muted relative mt-3 text-center text-xs leading-relaxed">
        Preview only. Scores and relationships appear only after Vibe has evidence from your own product.
      </p>
    </div>
  );
}
