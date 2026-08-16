"use client";

import { describeEvidenceId } from "@/modules/business-audit/evidence-labels";
import {
  HEALTH_LABELS,
  LENS_LABELS,
  MATERIALITY_LABELS,
  evidenceSource,
  evidenceSources,
  type BusinessMap,
  type LensNode,
} from "@/modules/business-audit/map-view";
import { BUSINESS_LENSES } from "@/modules/business-audit/schema";
import { MonoLabel } from "@/components/ui/typography";
import { HealthBar } from "./business-map";

/**
 * One lens, opened (AUDIT UI-1 §23).
 *
 * Direction 1b's detail panel is the moment the map stops being a picture and
 * starts being an argument: the area, how it looks, when it matters, what Vibe
 * concluded, what else it is tangled up with, and the evidence underneath —
 * in that order, which is the same *answer first, evidence second, tech last*
 * the rest of the audit obeys.
 *
 * ## What is not here
 *
 * 1b labels the connections "what this lens holds up". That is directional, and
 * the audit contract has no directional dependency — it records which lenses a
 * root problem spans, not which one blocks which. So this says the true thing
 * instead: these areas were judged as one problem, and here is that problem's
 * name. The distinction matters because "holds up" is a causal claim, and Vibe
 * would be making it up.
 */

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <MonoLabel>{label}</MonoLabel>
      <div className="text-fg-body flex items-center gap-2 text-sm">{children}</div>
    </div>
  );
}

export function LensDetail({ node, map }: { node: LensNode; map: BusinessMap }) {
  const index = BUSINESS_LENSES.indexOf(node.lens) + 1;

  const connections = map.connections.filter(
    (edge) => edge.from === node.lens || edge.to === node.lens,
  );
  const sources = evidenceSources(node.evidenceIds);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <MonoLabel>
          Lens {index} / {BUSINESS_LENSES.length}
        </MonoLabel>
        <h3 className="text-fg text-xl font-semibold">{node.label}</h3>
      </header>

      <div className="border-line-1 flex flex-wrap gap-8 border-y py-4">
        <Meta label="Health">
          <HealthBar health={node.health} />
          {HEALTH_LABELS[node.health]}
        </Meta>
        <Meta label="Priority">
          <span className={node.ring === "now" ? "text-mint" : undefined}>
            {MATERIALITY_LABELS[node.materiality]}
          </span>
        </Meta>
        {node.blockerRank !== null && (
          <Meta label="In your top three">#{node.blockerRank}</Meta>
        )}
      </div>

      {node.summary && (
        <p className="text-fg-prose max-w-[62ch] text-[0.9375rem] leading-relaxed">
          {node.summary}
        </p>
      )}

      {/*
        Deliberately not "what this lens holds up". The audit says these areas
        are one problem; it does not say which way the arrow points, and a
        confident arrow would be Vibe inventing causality (§15, §25).
      */}
      {connections.length > 0 && (
        <section className="flex flex-col gap-2">
          <MonoLabel as="h4">Judged together with</MonoLabel>
          <ul className="flex flex-col gap-2">
            {connections.map((edge) => {
              const other = edge.from === node.lens ? edge.to : edge.from;
              return (
                <li key={`${edge.from}-${edge.to}`} className="flex flex-col gap-0.5">
                  <span className="text-fg-body text-sm">{LENS_LABELS[other]}</span>
                  <span className="text-fg-muted text-xs">{edge.reason}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {node.missingContext.length > 0 && (
        <section className="border-line-1 flex flex-col gap-2 border-t pt-4">
          <MonoLabel as="h4">Only you can answer</MonoLabel>
          <ul className="flex flex-col gap-1">
            {node.missingContext.map((item) => (
              <li key={item} className="text-fg-secondary text-sm">
                {item}
              </li>
            ))}
          </ul>
        </section>
      )}

      {node.evidenceIds.length > 0 && (
        <details className="group">
          <summary className="text-fg-muted hover:text-fg-body marker:content-none flex cursor-pointer items-center gap-2 text-sm">
            <span className="text-fg-meta transition-transform group-open:rotate-90">›</span>
            Why Vibe thinks this
            <span className="text-fg-meta font-mono text-[0.6875rem]">
              {node.evidenceIds.length} signals · {sources.length}{" "}
              {sources.length === 1 ? "source" : "sources"}
            </span>
          </summary>

          <ul className="mt-3 flex flex-col gap-2 pl-5">
            {node.evidenceIds.map((id) => (
              <li key={id} className="flex flex-col gap-0.5">
                <span className="text-fg-secondary text-sm">{describeEvidenceId(id).detail}</span>
                {evidenceSource(id) && (
                  <span className="text-fg-meta font-mono text-[0.6875rem]">
                    {evidenceSource(id)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
