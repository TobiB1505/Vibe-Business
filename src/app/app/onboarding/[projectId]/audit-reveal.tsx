"use client";

import { useState } from "react";
import { MonoLabel } from "@/components/ui/typography";
import type {
  AuditSynthesis,
  BusinessLens,
  BusinessReadinessAudit,
} from "@/modules/business-audit/schema";
import { buildBusinessBrainView } from "@/modules/projects/business-brain-view";
import { BusinessMap } from "../../projects/[projectId]/business-brain/business-map";

/**
 * What the audit found, as the body of a render block.
 *
 * ## Why it carries no control any more
 *
 * Because the control is a Move, and a Move belongs outside the thing it acts
 * on. *Show me where to start* was a `Button` at the foot of this component,
 * inside Nova's block, which put the one decision on the screen a level deeper
 * than every other decision in the product. The page renders it in
 * `NovaOnboardingThread`'s `control` slot now, bound to the same action.
 */
export function OnboardingAuditReveal({ audit }: { audit: BusinessReadinessAudit }) {
  const synthesis: AuditSynthesis | null = audit.synthesis ?? null;
  const view = buildBusinessBrainView({
    audit,
    lastScanAt: audit.generatedAt,
    auditReadings: [],
    movesByConclusion: {},
  });
  const [selected, setSelected] = useState<BusinessLens | null>(
    synthesis?.blockers[0]?.lenses[0] ?? null,
  );
  const [hovered, setHovered] = useState<BusinessLens | null>(null);
  const blocker = synthesis?.blockers[0] ?? null;

  return (
    <div className="flex flex-col gap-6">
      {/*
        The audit's own conclusion, as a sentence rather than as a poster.

        It was a display heading at 2.75rem under a `MonoLabel` reading "What
        Vibe thinks" — inside a render block already labelled *Business audit*,
        under a bubble where Nova has just said she found something. Three
        titles for one thing, and the biggest type on the screen given to the
        one of them nobody wrote for this position.

        The sentence is real and stays. `synthesis.overall` is the audit's
        reading, not Nova's line about it, so losing it would lose the only
        specific claim in the block.
      */}
      <div className="flex flex-col gap-1.5">
        <p className="text-fg max-w-[52ch] text-ui leading-relaxed font-semibold">
          {synthesis?.overall ?? "Your Business Audit is ready."}
        </p>
        {audit.overall.score !== null && (
          <p className="text-fg-meta font-mono text-caption">{audit.overall.score} / 100 readiness</p>
        )}
      </div>

      {/*
        Fill and no line, the thread's own answer to a surface inside a
        surface: the map needs a ground to sit on and the block already drew
        the border.
      */}
      {view && (
        <section className="bg-surface-1 overflow-hidden rounded-card p-3 sm:p-5">
          <BusinessMap
            view={view}
            selected={selected}
            hovered={hovered}
            onSelect={setSelected}
            onHover={setHovered}
          />
        </section>
      )}

      {blocker && (
        <section className="border-mint/30 bg-mint/[0.035] flex max-w-[50rem] flex-col gap-2 rounded-field border p-5">
          <MonoLabel className="text-mint">What matters first</MonoLabel>
          <h2 className="text-fg text-moment font-semibold">{blocker.headline}</h2>
          <p className="text-fg-prose text-body leading-relaxed">{blocker.explanation}</p>
        </section>
      )}
    </div>
  );
}
