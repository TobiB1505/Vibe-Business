"use client";

import Link from "next/link";
import { useState } from "react";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "motion/react";
import { formatTimestamp } from "@/lib/utils/format-datetime";
import { cn } from "@/lib/utils/cn";
import type { BusinessLens } from "@/modules/business-audit/schema";
import { movesContextHref } from "@/modules/opportunities/lineage";
import { EFFORT_LABELS, IMPACT_LABELS } from "@/modules/opportunities/schema";
import type {
  BusinessBrainNode,
  BusinessBrainPriority,
  BusinessBrainView,
} from "@/modules/projects/business-brain-view";
import { BusinessMap } from "./business-map";

const PANEL_TRANSITION = { type: "spring" as const, stiffness: 220, damping: 26 };

function ArrowIcon({ direction = "right" }: { direction?: "right" | "up" | "down" }) {
  const glyph = direction === "up" ? "↑" : direction === "down" ? "↓" : "→";
  return <span aria-hidden="true">{glyph}</span>;
}

function actionHref(
  priority: Pick<BusinessBrainPriority, "key" | "moveCount">,
  movesHref: string,
): string {
  return priority.moveCount > 0 ? movesContextHref(movesHref, priority.key) : movesHref;
}

function actionLabel(moveCount: number, hasMoves: boolean): string {
  if (moveCount > 0) return moveCount === 1 ? "View next move" : `View ${moveCount} next moves`;
  return hasMoves ? "View action plan" : "Find next moves";
}

function PriorityCard({
  priority,
  movesHref,
  hasMoves,
  onExplore,
}: {
  priority: BusinessBrainPriority;
  movesHref: string;
  hasMoves: boolean;
  onExplore: (lens: BusinessLens) => void;
}) {
  const critical = priority.tone === "critical";
  const lens = priority.lensIds[0] ?? null;

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-[1.15rem] border p-5",
        critical
          ? "border-coral/70 bg-[radial-gradient(circle_at_100%_0%,rgb(255_122_92/0.13),transparent_42%),linear-gradient(145deg,rgb(255_122_92/0.055),rgb(255_255_255/0.018))]"
          : "border-mint/55 bg-[radial-gradient(circle_at_100%_0%,rgb(0_229_160/0.12),transparent_42%),linear-gradient(145deg,rgb(0_229_160/0.05),rgb(255_255_255/0.018))]",
      )}
      data-testid="primary-priority"
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute -top-10 -right-8 flex size-28 items-center justify-center rounded-full border text-4xl",
          critical ? "border-coral/15 text-coral/60" : "border-mint/15 text-mint/60",
        )}
      >
        {critical ? "!" : "↗"}
      </span>
      <div className="relative flex flex-col gap-4 pr-12">
        <span className={cn("text-xs font-semibold", critical ? "text-coral" : "text-mint")}>
          #1 Priority
        </span>
        <div className="flex flex-col gap-2">
          <h3 className="text-fg text-[1.15rem] leading-snug font-semibold tracking-[-0.025em]">
            {priority.headline}
          </h3>
          <p className="text-fg-muted text-sm leading-relaxed">{priority.explanation}</p>
        </div>
        {priority.move && (
          <div className="flex flex-wrap gap-2">
            <span className="bg-mint/10 text-mint rounded-full px-2.5 py-1 text-[0.7rem] font-medium">
              {IMPACT_LABELS[priority.move.impact]}
            </span>
            <span className="bg-amber/10 text-amber rounded-full px-2.5 py-1 text-[0.7rem] font-medium">
              {EFFORT_LABELS[priority.move.effort]}
            </span>
          </div>
        )}
        {lens && (
          <button
            type="button"
            onClick={() => onExplore(lens)}
            className="text-fg-secondary hover:text-fg w-fit rounded-sm text-xs underline decoration-line-strong underline-offset-4 transition-interactive"
          >
            Explore this area
          </button>
        )}
      </div>
      <Link
        href={actionHref(priority, movesHref)}
        className="bg-surface-4 border-line-strong text-fg hover:border-mint/45 mt-5 flex min-h-11 items-center justify-between rounded-xl border px-4 text-sm font-semibold transition-interactive"
      >
        {actionLabel(priority.moveCount, hasMoves)}
        <ArrowIcon />
      </Link>
    </div>
  );
}

function RecentChanges({ view }: { view: BusinessBrainView }) {
  const change = view.recentChanges[0] ?? null;

  return (
    <section className="business-brain-side-card flex flex-col gap-4 p-5" data-testid="recent-changes">
      <h3 className="text-fg text-sm font-semibold">Recent changes</h3>
      {change ? (
        <div className="flex items-start gap-3">
          <span
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-lg text-lg",
              change.direction === "up"
                ? "bg-mint/10 text-mint"
                : change.direction === "down"
                  ? "bg-coral/10 text-coral"
                  : "bg-surface-4 text-fg-muted",
            )}
          >
            <ArrowIcon direction={change.direction === "same" ? "right" : change.direction} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-fg-body text-sm font-medium">
              Business Health {change.direction === "up" ? "increased" : change.direction === "down" ? "decreased" : "held steady"}
            </p>
            <p className="text-fg-muted mt-1 text-xs leading-relaxed">
              {change.delta > 0 ? "+" : ""}{change.delta} points under the same scoring contract · {formatTimestamp(change.recordedAt) ?? change.recordedAt}
            </p>
          </div>
        </div>
      ) : (
        <div className="border-line-1 flex flex-col gap-1.5 border-t pt-4">
          <p className="text-fg-body text-sm font-medium">No comparable history yet</p>
          <p className="text-fg-muted text-xs leading-relaxed">
            {view.recentChangesUnavailableReason === "not_comparable"
              ? "The scoring contract changed, so Vibe will not present the difference as business progress."
              : view.recentChangesUnavailableReason === "unscored"
                ? "At least one recent scan could not be scored from the available evidence."
                : "Business Health changes will appear after another comparable scan."}
          </p>
        </div>
      )}
    </section>
  );
}

function ScoringContext({ view }: { view: BusinessBrainView }) {
  return (
    <section className="business-brain-side-card flex gap-4 p-5">
      <span aria-hidden="true" className="border-mint/20 bg-mint/5 text-mint flex size-11 shrink-0 items-center justify-center rounded-full border text-xl">
        ◉
      </span>
      <div className="flex min-w-0 flex-col gap-2">
        <h3 className="text-fg text-sm font-semibold">How Vibe sees your business</h3>
        <p className="text-fg-muted text-xs leading-relaxed">
          {view.overall.summary ?? "Vibe combines the assessable evidence into one connected business view."}
        </p>
        <p className="text-fg-meta text-xs">
          {view.overall.assessedDimensions} of {view.overall.totalDimensions} scored areas · {view.signalCount} signals · {view.sourceCount} {view.sourceCount === 1 ? "source" : "sources"}
        </p>
      </div>
    </section>
  );
}

function DefaultPanel({
  view,
  movesHref,
  hasMoves,
  onExplore,
  entranceDelay,
}: {
  view: BusinessBrainView;
  movesHref: string;
  hasMoves: boolean;
  onExplore: (lens: BusinessLens) => void;
  entranceDelay: number;
}) {
  return (
    <motion.div
      key="default"
      className="flex flex-col gap-4"
      initial={{ opacity: 0, x: 18 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -12 }}
      transition={{ ...PANEL_TRANSITION, delay: entranceDelay }}
    >
      <section className="business-brain-side-card flex flex-col gap-4 p-4 sm:p-5">
        <h2 className="text-fg text-base font-semibold tracking-[-0.02em]">What matters now</h2>
        {view.primaryPriority ? (
          <>
            <PriorityCard
              priority={view.primaryPriority}
              movesHref={movesHref}
              hasMoves={hasMoves}
              onExplore={onExplore}
            />
            {view.additionalPriorityCount > 0 && (
              <Link
                href={movesHref}
                className="text-mint hover:text-mint-hover flex w-fit items-center gap-2 rounded-sm text-sm transition-interactive"
              >
                See {view.additionalPriorityCount} more {view.additionalPriorityCount === 1 ? "priority" : "priorities"}
                <ArrowIcon />
              </Link>
            )}
          </>
        ) : (
          <p className="text-fg-muted text-sm leading-relaxed">
            Vibe did not find one real blocker it would place ahead of everything else.
          </p>
        )}
      </section>
      <RecentChanges view={view} />
      <ScoringContext view={view} />
    </motion.div>
  );
}

function SelectedPanel({
  node,
  view,
  movesHref,
  hasMoves,
  onClose,
  onSelect,
}: {
  node: BusinessBrainNode;
  view: BusinessBrainView;
  movesHref: string;
  hasMoves: boolean;
  onClose: () => void;
  onSelect: (lens: BusinessLens) => void;
}) {
  const relationships = view.relationships.filter(
    (relationship) => relationship.from === node.id || relationship.to === node.id,
  );
  const evidence = [...node.evidence];
  for (const item of node.problem?.evidence ?? []) {
    if (!evidence.some((existing) => existing.id === item.id)) evidence.push(item);
  }
  const sourceCount = new Set(evidence.map((item) => item.source)).size;

  return (
    <motion.section
      key={node.id}
      layout
      className="business-brain-side-card flex min-h-[34rem] flex-col p-5 sm:p-6"
      initial={{ opacity: 0, x: 22, scale: 0.985 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: -14, scale: 0.99 }}
      transition={PANEL_TRANSITION}
      data-testid="selected-lens-detail"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <span className="text-mint text-xs font-semibold">Selected business area</span>
          <h2 className="text-fg text-2xl leading-tight font-semibold tracking-[-0.035em]">
            {node.label}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close selected business area"
          className="border-line-2 text-fg-muted hover:border-line-strong hover:text-fg flex size-9 items-center justify-center rounded-full border text-lg transition-interactive"
        >
          ×
        </button>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <span className={cn("rounded-full px-3 py-1.5 text-xs font-medium", node.health === "weak" ? "bg-coral/10 text-coral" : node.health === "strong" ? "bg-mint/10 text-mint" : "bg-amber/10 text-amber")}>
          {node.healthLabel}
        </span>
        <span className="bg-surface-4 text-fg-secondary rounded-full px-3 py-1.5 text-xs">
          {node.priorityLabel}
        </span>
        <span className="bg-surface-4 text-fg-muted rounded-full px-3 py-1.5 text-xs">
          No individual score
        </span>
      </div>

      {node.summary && (
        <p className="text-fg-prose mt-6 text-[0.96rem] leading-relaxed">{node.summary}</p>
      )}

      {node.problem && (
        <motion.div
          className="border-line-1 mt-6 flex flex-col gap-3 border-t pt-6"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, delay: 0.08 }}
        >
          <span className="text-fg-muted text-xs font-medium">What matters here</span>
          <h3 className="text-fg text-lg leading-snug font-semibold tracking-[-0.02em]">
            {node.problem.headline}
          </h3>
          <p className="text-fg-muted text-sm leading-relaxed">{node.problem.explanation}</p>
          {node.problem.whyItMatters && (
            <div className="border-line-1 mt-1 border-l-2 pl-3">
              <p className="text-fg-secondary text-sm leading-relaxed">{node.problem.whyItMatters}</p>
            </div>
          )}
        </motion.div>
      )}

      {relationships.length > 0 && (
        <motion.div
          className="mt-6 flex flex-col gap-3"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, delay: 0.14 }}
        >
          <h3 className="text-fg-muted text-xs font-medium">Connected areas</h3>
          <div className="flex flex-wrap gap-2">
            {relationships.map((relationship) => {
              const otherId = relationship.from === node.id ? relationship.to : relationship.from;
              const other = view.nodes.find((candidate) => candidate.id === otherId);
              if (!other) return null;
              return (
                <button
                  type="button"
                  key={relationship.id}
                  onClick={() => onSelect(other.id)}
                  title={relationship.reason}
                  className="border-mint/20 bg-mint/[0.045] text-mint hover:border-mint/50 rounded-full border px-3 py-1.5 text-xs transition-interactive"
                >
                  {other.label}
                </button>
              );
            })}
          </div>
          <p className="text-fg-meta text-xs">These areas were judged together in the same audit conclusion.</p>
        </motion.div>
      )}

      {node.problem?.move && (
        <motion.div
          className="border-mint/20 bg-mint/[0.04] mt-6 rounded-xl border p-4"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, delay: 0.18 }}
        >
          <h3 className="text-fg-muted text-xs font-medium">What Vibe recommends</h3>
          <p className="text-fg mt-2 text-sm font-semibold">{node.problem.move.title}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="bg-mint/10 text-mint rounded-full px-2.5 py-1 text-[0.7rem] font-medium">
              {IMPACT_LABELS[node.problem.move.impact]}
            </span>
            <span className="bg-amber/10 text-amber rounded-full px-2.5 py-1 text-[0.7rem] font-medium">
              {EFFORT_LABELS[node.problem.move.effort]}
            </span>
          </div>
        </motion.div>
      )}

      {node.missingContext.length > 0 && (
        <div className="border-amber/20 bg-amber/[0.04] mt-6 rounded-xl border p-4">
          <h3 className="text-amber text-xs font-medium">Only you can answer</h3>
          <ul className="text-fg-muted mt-2 flex list-disc flex-col gap-1.5 pl-4 text-sm">
            {node.missingContext.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
      )}

      {evidence.length > 0 && (
        <details className="group border-line-1 mt-6 border-t pt-5">
          <summary className="text-fg-secondary hover:text-fg flex cursor-pointer list-none items-center justify-between gap-3 text-sm">
            <span>Evidence &amp; reasoning</span>
            <span className="text-fg-meta text-xs">{evidence.length} signals · {sourceCount} {sourceCount === 1 ? "source" : "sources"}</span>
          </summary>
          <ul className="mt-4 flex flex-col gap-3">
            {evidence.map((item) => (
              <li key={item.id} className="flex flex-col gap-0.5">
                <span className="text-fg-secondary text-sm">{item.detail}</span>
                <span className="text-fg-meta text-xs">{item.source}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="mt-auto pt-7">
        {node.problem ? (
          <Link
            href={node.problem.moveCount > 0 ? movesContextHref(movesHref, node.problem.key) : movesHref}
            className="bg-mint text-mint-ink hover:bg-mint-hover flex min-h-11 items-center justify-between rounded-xl px-4 text-sm font-semibold transition-interactive"
          >
            {actionLabel(node.problem.moveCount, hasMoves)}
            <ArrowIcon />
          </Link>
        ) : (
          <Link
            href={movesHref}
            className="border-line-strong text-fg hover:border-mint/45 flex min-h-11 items-center justify-between rounded-xl border px-4 text-sm font-semibold transition-interactive"
          >
            View action plan
            <ArrowIcon />
          </Link>
        )}
      </div>
    </motion.section>
  );
}

export function AuditIntelligence({
  view,
  movesHref,
  hasMoves,
}: {
  view: BusinessBrainView;
  movesHref: string;
  hasMoves: boolean;
}) {
  const reducedMotion = Boolean(useReducedMotion());
  const [selected, setSelected] = useState<BusinessLens | null>(null);
  const [hovered, setHovered] = useState<BusinessLens | null>(null);
  const [hasInteracted, setHasInteracted] = useState(false);
  const node = selected ? (view.nodes.find((candidate) => candidate.id === selected) ?? null) : null;

  function select(lens: BusinessLens) {
    setHasInteracted(true);
    setSelected((current) => (current === lens ? null : lens));
  }

  return (
    <LayoutGroup>
      <motion.div
        className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.62fr)_minmax(21rem,0.72fr)] xl:items-start"
        data-testid="audit-intelligence"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: reducedMotion ? 0.08 : 0.2 }}
      >
        <motion.section
          layout
          className="business-brain-stage relative min-w-0 overflow-hidden rounded-[1.25rem] border border-line-2 p-4 sm:p-6"
          data-testid="audit-map-panel"
        >
          <span aria-hidden="true" className="business-brain-grid pointer-events-none absolute inset-0" />
          <header className="relative z-10 flex flex-wrap items-start justify-between gap-4">
            <div className="flex flex-col gap-1.5">
              <h2 className="text-fg text-xl font-semibold tracking-[-0.03em]">Your Business Brain</h2>
              <p className="text-fg-muted text-sm">Select any area to explore how the pieces connect.</p>
            </div>
            <div className="text-fg-meta flex flex-col items-end gap-1 text-xs">
              <span>{view.nodes.length} business areas</span>
              {view.lastScanAt && <span>Last scan {formatTimestamp(view.lastScanAt) ?? view.lastScanAt}</span>}
            </div>
          </header>

          <div className="relative z-10 mt-3">
            <BusinessMap
              view={view}
              selected={selected}
              hovered={hovered}
              onSelect={select}
              onHover={setHovered}
            />
          </div>

          <footer className="border-line-1 relative z-10 mt-2 flex flex-wrap items-center justify-between gap-4 border-t pt-4">
            <ul className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs" aria-label="Business health legend">
              <li className="text-mint flex items-center gap-2"><span className="bg-mint size-2 rounded-full shadow-[0_0_10px_rgb(0_229_160/0.8)]" />Strong</li>
              <li className="text-amber flex items-center gap-2"><span className="bg-amber size-2 rounded-full" />Adequate</li>
              <li className="text-coral flex items-center gap-2"><span className="bg-coral size-2 rounded-full" />Weak</li>
              <li className="text-fg-muted flex items-center gap-2"><span className="bg-fg-disabled size-2 rounded-full" />Unknown</li>
            </ul>
            <p className="text-fg-meta text-xs">Unknown is never scored as zero.</p>
          </footer>
        </motion.section>

        <aside aria-live="polite" aria-label={node ? `${node.label} details` : "What matters now"}>
          <AnimatePresence mode="wait" initial>
            {node ? (
              <SelectedPanel
                node={node}
                view={view}
                movesHref={movesHref}
                hasMoves={hasMoves}
                onClose={() => setSelected(null)}
                onSelect={select}
              />
            ) : (
              <DefaultPanel
                view={view}
                movesHref={movesHref}
                hasMoves={hasMoves}
                onExplore={select}
                entranceDelay={hasInteracted || reducedMotion ? 0 : 0.92}
              />
            )}
          </AnimatePresence>
        </aside>
      </motion.div>
    </LayoutGroup>
  );
}
