"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { MonoLabel } from "@/components/ui/typography";
import type { AuditSynthesis, BusinessLens, BusinessReadinessAudit } from "@/modules/business-audit/schema";
import { buildBusinessBrainView } from "@/modules/projects/business-brain-view";
import { BusinessMap } from "../../projects/[projectId]/business-brain/business-map";
import { revealAuditAndFindFirstMoveAction } from "./actions";

export function OnboardingAuditReveal({
  audit,
  projectId,
}: {
  audit: BusinessReadinessAudit;
  projectId: string;
}) {
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
  const reveal = revealAuditAndFindFirstMoveAction.bind(null, projectId);
  const blocker = synthesis?.blockers[0] ?? null;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-4">
        <MonoLabel>What Vibe thinks</MonoLabel>
        <h1 className="text-fg max-w-[46ch] text-[2rem] leading-[1.16] font-semibold tracking-[-0.04em] text-balance sm:text-[2.75rem]">
          {synthesis?.overall ?? "Your Business Audit is ready."}
        </h1>
        {audit.overall.score !== null && (
          <p className="text-fg-meta font-mono text-xs">{audit.overall.score} / 100 readiness</p>
        )}
      </header>

      {view && (
        <section className="border-line-2 bg-surface-1 overflow-hidden rounded-2xl border p-3 sm:p-5">
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
        <section className="border-mint/30 bg-mint/[0.035] flex max-w-[50rem] flex-col gap-2 rounded-xl border p-5">
          <MonoLabel className="text-mint">What matters first</MonoLabel>
          <h2 className="text-fg text-xl font-semibold">{blocker.headline}</h2>
          <p className="text-fg-prose text-sm leading-relaxed">{blocker.explanation}</p>
        </section>
      )}

      <form action={reveal}>
        <Button type="submit">Show me where to start</Button>
      </form>
    </div>
  );
}
