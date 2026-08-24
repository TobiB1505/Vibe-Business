"use client";

import { useState } from "react";
import { Surface } from "@/components/ui/surface";
import { MonoLabel } from "@/components/ui/typography";
import type { BusinessMap as BusinessMapModel } from "@/modules/business-audit/map-view";
import type { BusinessConclusion, BusinessLens } from "@/modules/business-audit/schema";
import { BusinessMap } from "./business-map";
import { CurrentPriorities } from "./current-priorities";
import { LensDetail } from "../lens-detail";
import { SelectedProblem } from "../selected-problem";

/**
 * The intelligence panel (AUDIT UI-1.2 §24).
 *
 * Three areas, three jobs, and the rule is that none of them says what another
 * one says:
 *
 *   the map            how Vibe sees the business
 *   current priorities what matters
 *   the detail below   why
 *
 * ## One selection, two ways to reach it
 *
 * A lens node and a priority card are the same action against the same state
 * (§32). Both live inside this one client component for that reason — a second
 * local selection somewhere else would let the map and the list disagree about
 * what is open.
 *
 * ## Why the detail sits below the panel rather than inside a column
 *
 * Width. The detail carries a business assessment, related context, what only
 * the founder can answer and the evidence behind all of it; in a column it
 * became a stack of narrow paragraphs. Full width lets the assessment and its
 * context sit side by side, which is the hierarchy §16 asks for.
 */
export function AuditIntelligence({
  map,
  score,
  blockers,
  movesHref,
  hasMoves,
  movesByConclusion,
}: {
  map: BusinessMapModel;
  /** Shown in the map's centre, where it reads as one reading among nine. */
  score: number | null;
  blockers: BusinessConclusion[];
  movesHref: string;
  hasMoves: boolean;
  /** Moves addressing each conclusion of this audit (UI-S2 §8). */
  movesByConclusion: Record<string, number>;
}) {
  /*
   * Opens on the lens the audit itself ranked first, falling back to whatever
   * it marked `now`.
   *
   * Left closed, the space below the map is blank on arrival and the nodes read
   * as labels rather than as something you can ask a question of. Opening the
   * top-priority lens fills it with the one area the audit says matters most —
   * the node a founder would click first anyway.
   */
  const defaultLens =
    map.nodes.find((entry) => entry.blockerRank === 1)?.lens ??
    map.nodes.find((entry) => entry.ring === "now")?.lens ??
    null;

  const [selected, setSelected] = useState<BusinessLens | null>(defaultLens);
  const node = selected ? (map.nodes.find((entry) => entry.lens === selected) ?? null) : null;

  /*
   * The problem the selected area belongs to, if it belongs to one.
   *
   * A priority and a lens node select the same state, so the detail has to
   * answer both questions from one selection: *what is this area* and *why is
   * it on the list*. The index is the audit's own ordering — nothing here
   * re-sorts (§14).
   */
  const blockerIndex = node
    ? blockers.findIndex((blocker) => blocker.lenses.includes(node.lens))
    : -1;
  const blocker = blockerIndex === -1 ? null : blockers[blockerIndex];

  return (
    <div className="flex flex-col gap-5" data-testid="audit-intelligence">
      <Surface
        level="card"
        padding="none"
        className="business-brain-stage relative overflow-hidden p-4 sm:p-5 lg:p-6"
      >
        <span
          aria-hidden="true"
          className="audit-intelligence-glow pointer-events-none absolute inset-0"
        />

        <div className="relative flex flex-col gap-5">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div className="flex flex-col gap-1.5">
              <MonoLabel as="h2" className="text-mint">
                Your Business Brain
              </MonoLabel>
              <p className="text-fg-muted text-xs">Select any area to see what Vibe found.</p>
            </div>
            <span className="text-fg-meta font-mono text-meta">
              closer to centre = sooner
            </span>
          </div>

          {/*
            §25 — the right column has to hold a rank, an area, a materiality
            and a headline without awkward wrapping, so it gets a real minimum
            rather than whatever is left over. §26: the map may stay taller;
            padding the shorter column with filler would undo this sprint.
          */}
          <div className="grid min-w-0 gap-7 xl:grid-cols-[minmax(0,1.82fr)_minmax(20rem,.78fr)] xl:items-start">
            <section
              className="order-2 flex min-w-0 flex-col gap-3 xl:order-1"
              data-testid="audit-map-panel"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
                <h3 className="text-fg text-lg font-semibold tracking-[-0.025em]">
                  One business. Nine connected areas.
                </h3>
                <span className="text-fg-meta font-mono text-[0.625rem] md:hidden">
                  ordered by priority
                </span>
              </div>
              <BusinessMap map={map} score={score} selected={selected} onSelect={setSelected} />
            </section>

            <aside
              aria-label="What matters most right now"
              className="order-1 min-w-0 xl:order-2 xl:border-l xl:border-line-1 xl:pl-7"
              data-testid="audit-interpretation"
            >
              <CurrentPriorities
                blockers={blockers}
                map={map}
                selected={selected}
                onSelect={setSelected}
                movesHref={movesHref}
                hasMoves={hasMoves}
                movesByConclusion={movesByConclusion}
              />
            </aside>
          </div>
        </div>
      </Surface>

      {node !== null && (
        <Surface
          level="section"
          padding="lg"
          className="relative"
          data-testid="selected-lens-detail"
        >
          <button
            type="button"
            onClick={() => setSelected(null)}
            className="text-fg-meta hover:text-fg-body hover:border-line-2 absolute top-4 right-4 rounded-full border border-transparent px-3 py-1.5 font-mono text-meta transition-interactive"
          >
            Close
          </button>
          <div className="flex flex-col gap-6">
            <LensDetail node={node} map={map} />
            {blocker && <SelectedProblem blocker={blocker} rank={blockerIndex + 1} />}
          </div>
        </Surface>
      )}
    </div>
  );
}
