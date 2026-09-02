"use client";

import Link from "next/link";
import { type KeyboardEvent, useId, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
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
import { BusinessLensIcon, BusinessMap } from "./business-map";

const DETAIL_TABS = ["overview", "evidence", "signals", "history"] as const;
type DetailTab = (typeof DETAIL_TABS)[number];

function ArrowIcon({ direction = "right" }: { direction?: "right" | "up" | "down" }) {
  const glyph = direction === "up" ? "↑" : direction === "down" ? "↓" : "→";
  return <span aria-hidden="true">{glyph}</span>;
}

function BrainIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M9.5 4.5A3.5 3.5 0 0 0 6 8v1a3 3 0 0 0-1 5.8V16a3.5 3.5 0 0 0 4.5 3.3V4.5ZM14.5 4.5A3.5 3.5 0 0 1 18 8v1a3 3 0 0 1 1 5.8V16a3.5 3.5 0 0 1-4.5 3.3V4.5ZM9.5 9H7.7M14.5 9h1.8M9.5 14H7M14.5 14H17" />
    </svg>
  );
}

function DetailInsightIcon({ kind }: { kind: "found" | "matter" | "connected" | "move" }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-12 shrink-0 items-center justify-center rounded-full border",
        kind === "found" || kind === "move"
          ? "border-coral/25 bg-coral/[0.08] text-coral"
          : kind === "matter"
            ? "border-amber/25 bg-amber/[0.08] text-amber"
            : "border-mint/25 bg-mint/[0.08] text-mint",
      )}
    >
      {kind === "found" && (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="size-6">
          <circle cx="10.5" cy="10.5" r="5.5" />
          <path d="m15 15 4.5 4.5" />
          <path d="M8.5 10.5h4" />
        </svg>
      )}
      {kind === "matter" && (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="size-6">
          <path d="M9 18h6M10 21h4" />
          <path d="M8.2 14.4A6.2 6.2 0 1 1 15.8 14.4C14.7 15.2 14.2 16 14 17h-4c-.2-1-.7-1.8-1.8-2.6Z" />
          <path d="M12 2V1M4.9 4.9l-.8-.8M19.1 4.9l.8-.8" />
        </svg>
      )}
      {kind === "connected" && (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="size-6">
          <circle cx="6" cy="12" r="2.5" />
          <circle cx="18" cy="6" r="2.5" />
          <circle cx="18" cy="18" r="2.5" />
          <path d="m8.3 10.8 7.4-3.6M8.3 13.2l7.4 3.6" />
        </svg>
      )}
      {kind === "move" && (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="size-6">
          <path d="M5 21V4M5 5h10l-1.8 3L15 11H5" />
        </svg>
      )}
    </span>
  );
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
    // Overview and focus deliberately share one grid template. Animating the
    // columns made the old and new panels occupy the same pixels during the
    // first selection and left the overview collapsed after closing focus.
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
          "absolute -top-7 -right-5 flex size-28 items-center justify-center rounded-full border",
          critical ? "border-coral/15 text-coral/60" : "border-mint/15 text-mint/60",
        )}
      >
        {lens ? <BusinessLensIcon lens={lens} className="size-11" /> : <span className="text-4xl">!</span>}
      </span>
      <div className="relative flex flex-col gap-4 pr-12">
        <span className={cn("text-xs font-semibold", critical ? "text-coral" : "text-mint")}>
          #1 Priority
        </span>
        <div className="flex flex-col gap-2">
          <h3 className="text-fg text-[1.15rem] leading-snug font-semibold tracking-[-0.025em]">
            {priority.headline}
          </h3>
          <p className="text-fg-muted line-clamp-3 text-sm leading-relaxed">
            {priority.whyItMatters ?? priority.explanation}
          </p>
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
      <span aria-hidden="true" className="border-mint/20 bg-mint/5 text-mint flex size-11 shrink-0 items-center justify-center rounded-full border">
        <BrainIcon className="size-6" />
      </span>
      <div className="flex min-w-0 flex-col gap-2">
        <h3 className="text-fg text-sm font-semibold">How we score your business</h3>
        <p className="text-fg-muted text-xs leading-relaxed">
          Vibe evaluates evidence from your codebase, website, product signals and your own inputs. Missing or inconclusive evidence stays unscored.
        </p>
        <p className="text-fg-meta text-xs">
          {view.overall.scoredLenses} of {view.overall.eligibleLenses} scored areas · {view.signalCount} signals · {view.sourceCount} {view.sourceCount === 1 ? "source" : "sources"}
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
  reducedMotion,
}: {
  view: BusinessBrainView;
  movesHref: string;
  hasMoves: boolean;
  onExplore: (lens: BusinessLens) => void;
  reducedMotion: boolean;
}) {
  return (
    <motion.div
      key="default"
      className="flex min-w-0 flex-col gap-4"
      initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reducedMotion ? 0.08 : 0.16, ease: "easeOut" }}
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
  const reducedMotion = Boolean(useReducedMotion());
  const [activeTab, setActiveTab] = useState<DetailTab>("overview");
  const tabRefs = useRef<Partial<Record<DetailTab, HTMLButtonElement | null>>>({});
  const tabId = useId().replace(/:/g, "");
  const relationships = view.relationships.filter(
    (relationship) => relationship.from === node.id || relationship.to === node.id,
  );
  const evidence = [...node.evidence];
  for (const item of node.problem?.evidence ?? []) {
    if (!evidence.some((existing) => existing.id === item.id)) evidence.push(item);
  }
  const sourceSignals = Array.from(
    evidence.reduce((counts, item) => {
      counts.set(item.source, (counts.get(item.source) ?? 0) + 1);
      return counts;
    }, new Map<string, number>()),
  );
  const stateLabel =
    node.health === "weak"
      ? "Needs attention"
      : node.health === "strong"
        ? "Strong"
        : node.health === "adequate"
          ? "Adequate"
          : "Not assessed";

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, current: DetailTab) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = DETAIL_TABS.indexOf(current);
    const next =
      event.key === "Home"
        ? DETAIL_TABS[0]
        : event.key === "End"
          ? DETAIL_TABS.at(-1)!
          : DETAIL_TABS[
              (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + DETAIL_TABS.length) %
                DETAIL_TABS.length
            ];
    setActiveTab(next);
    tabRefs.current[next]?.focus();
  }

  return (
    <motion.section
      key={node.id}
      className="business-brain-focus-panel flex min-w-0 flex-col overflow-hidden"
      initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reducedMotion ? 0.08 : 0.16, ease: "easeOut" }}
      data-testid="selected-lens-detail"
    >
      <div className="flex items-start justify-between gap-4 px-5 pt-5 sm:px-6 sm:pt-6">
        <div className="min-w-0">
          <span className={cn("text-[0.7rem] font-semibold tracking-[0.12em] uppercase", node.health === "weak" ? "text-coral" : "text-mint")}>
            Selected dimension
          </span>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h2 className="text-fg text-2xl leading-tight font-semibold tracking-[-0.035em]">
              {node.label}
            </h2>
            <span className={cn("rounded-full border px-3 py-1 text-xs font-medium", node.health === "weak" ? "border-coral/25 bg-coral/[0.08] text-coral" : node.health === "strong" ? "border-mint/25 bg-mint/[0.08] text-mint" : "border-amber/25 bg-amber/[0.08] text-amber")}>
              {stateLabel}
            </span>
          </div>
        </div>
        <button type="button" onClick={onClose} aria-label="Back to Business Health overview" className="border-line-2 text-fg-muted hover:border-line-strong hover:text-fg flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-full border text-lg transition-interactive focus-visible:ring-2 focus-visible:ring-mint">
          ×
        </button>
      </div>

      <div role="tablist" aria-label={`${node.label} details`} className="border-line-1 mt-5 flex gap-1 overflow-x-auto border-b px-4 sm:px-5">
        {DETAIL_TABS.map((tab) => {
          const selected = activeTab === tab;
          const label = tab === "evidence" ? `Evidence (${evidence.length})` : `${tab[0].toUpperCase()}${tab.slice(1)}`;
          return (
            <button
              key={tab}
              ref={(element) => { tabRefs.current[tab] = element; }}
              type="button"
              role="tab"
              id={`${tabId}-${tab}-tab`}
              aria-controls={`${tabId}-${tab}-panel`}
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActiveTab(tab)}
              onKeyDown={(event) => onTabKeyDown(event, tab)}
              className={cn(
                "relative min-h-11 shrink-0 cursor-pointer px-3 text-sm transition-interactive focus-visible:ring-2 focus-visible:ring-mint",
                selected ? (node.health === "weak" ? "text-coral" : "text-mint") : "text-fg-muted hover:text-fg",
              )}
            >
              {label}
              {selected && <motion.span layoutId={`${tabId}-active-tab`} className={cn("absolute inset-x-2 -bottom-px h-0.5", node.health === "weak" ? "bg-coral" : "bg-mint")} />}
            </button>
          );
        })}
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={activeTab}
          role="tabpanel"
          id={`${tabId}-${activeTab}-panel`}
          aria-labelledby={`${tabId}-${activeTab}-tab`}
          className="flex flex-1 flex-col gap-4 p-4 sm:p-5"
          initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -5 }}
          transition={{ duration: reducedMotion ? 0.08 : 0.2 }}
        >
          {activeTab === "overview" && (
            <>
              <div className="business-brain-insight-card flex gap-3 p-4">
                <DetailInsightIcon kind="found" />
                <div className="min-w-0">
                  <h3 className="text-fg text-sm font-semibold">What we found</h3>
                  <p className="text-fg-secondary mt-1.5 text-sm leading-relaxed">
                    {node.problem?.explanation ?? node.summary ?? "The available evidence did not support a concise diagnosis for this area."}
                  </p>
                </div>
              </div>

              <div className="business-brain-insight-card flex gap-3 p-4">
                <DetailInsightIcon kind="matter" />
                <div className="min-w-0">
                  <h3 className="text-fg text-sm font-semibold">Why it matters</h3>
                  <p className="text-fg-secondary mt-1.5 text-sm leading-relaxed">
                    {node.problem?.whyItMatters ?? "This audit did not record a separate impact explanation for this area."}
                  </p>
                </div>
              </div>

              <div className="business-brain-insight-card flex gap-3 p-4">
                <DetailInsightIcon kind="connected" />
                <div className="min-w-0 flex-1">
                  <h3 className="text-fg text-sm font-semibold">Connected areas</h3>
                  <p className="text-fg-muted mt-1 text-xs">Areas joined by the same audit conclusion.</p>
                  {relationships.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {relationships.map((relationship) => {
                        const otherId = relationship.from === node.id ? relationship.to : relationship.from;
                        const other = view.nodes.find((candidate) => candidate.id === otherId);
                        if (!other) return null;
                        return (
                          <button type="button" key={relationship.id} onClick={() => onSelect(other.id)} aria-label={`Explore connected area ${other.label}`} className="border-mint/20 bg-mint/[0.045] text-fg-secondary hover:border-mint/50 hover:text-mint min-h-9 cursor-pointer rounded-full border px-3 text-xs transition-interactive focus-visible:ring-2 focus-visible:ring-mint">
                            {other.label}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-fg-muted mt-3 text-sm">No evidence-grounded relationship was recorded for this area.</p>
                  )}
                </div>
              </div>

              <div className={cn("relative mt-1 overflow-hidden rounded-2xl border p-4", node.health === "weak" ? "border-coral/60 bg-[radial-gradient(circle_at_100%_0%,rgb(255_122_92/0.12),transparent_44%),rgb(255_122_92/0.035)]" : "border-mint/40 bg-mint/[0.035]")}>
                <div className="flex items-start gap-3">
                  <DetailInsightIcon kind="move" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-fg text-sm font-semibold">What to do next</h3>
                      {node.problem && <span className="text-coral text-[0.65rem] font-semibold tracking-[0.08em] uppercase">#{node.problem.rank} priority</span>}
                    </div>
                    <p className="text-fg mt-2 text-lg font-semibold tracking-[-0.02em]">
                      {node.problem?.move?.title ?? node.problem?.headline ?? "No next move is linked yet"}
                    </p>
                    {node.problem?.move && (
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                        <span className="text-fg-secondary">{IMPACT_LABELS[node.problem.move.impact]}</span>
                        <span aria-hidden="true" className="text-fg-disabled">•</span>
                        <span className="text-amber">{EFFORT_LABELS[node.problem.move.effort]}</span>
                      </div>
                    )}
                  </div>
                </div>
                <Link href={node.problem && node.problem.moveCount > 0 ? movesContextHref(movesHref, node.problem.key) : movesHref} className={cn("mt-4 flex min-h-11 items-center justify-center gap-3 rounded-xl px-4 text-sm font-semibold transition-interactive focus-visible:ring-2 focus-visible:ring-mint", node.health === "weak" ? "bg-coral text-[#170805] hover:bg-[#ff8e73]" : "bg-mint text-mint-ink hover:bg-mint-hover")}>
                  {node.problem ? actionLabel(node.problem.moveCount, hasMoves) : "View action plan"}
                  <ArrowIcon />
                </Link>
              </div>

              {node.missingContext.length > 0 && (
                <details className="group border-line-1 border-t pt-4">
                  <summary className="text-fg-secondary hover:text-fg flex min-h-10 cursor-pointer list-none items-center justify-between gap-3 rounded-sm text-sm focus-visible:ring-2 focus-visible:ring-mint">
                    <span>Learn more about this dimension</span>
                    <span aria-hidden="true" className="transition-transform group-open:rotate-180">⌄</span>
                  </summary>
                  <div className="border-amber/20 bg-amber/[0.035] mt-3 rounded-xl border p-4">
                    <h3 className="text-amber text-xs font-medium">Only you can answer</h3>
                    <ul className="text-fg-muted mt-2 flex list-disc flex-col gap-1.5 pl-4 text-sm">
                      {node.missingContext.map((item) => <li key={item}>{item}</li>)}
                    </ul>
                  </div>
                </details>
              )}
            </>
          )}

          {activeTab === "evidence" && (
            evidence.length > 0 ? (
              <ul className="flex flex-col gap-3">
                {evidence.map((item, index) => (
                  <motion.li key={item.id} className="business-brain-insight-card flex gap-3 p-4" initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: reducedMotion ? 0 : index * 0.035 }}>
                    <span className="border-line-2 bg-surface-4 text-fg-meta flex size-8 shrink-0 items-center justify-center rounded-lg text-xs tabular-nums">{index + 1}</span>
                    <div className="min-w-0">
                      <p className="text-fg-secondary text-sm leading-relaxed">{item.detail}</p>
                      <p className="text-fg-meta mt-1 text-xs">{item.source}</p>
                    </div>
                  </motion.li>
                ))}
              </ul>
            ) : (
              <HonestTabEmpty title="No assessable evidence" body="Vibe did not record evidence that can support a scored conclusion for this area." />
            )
          )}

          {activeTab === "signals" && (
            sourceSignals.length > 0 ? (
              <div className="flex flex-col gap-3">
                <p className="text-fg-muted text-sm leading-relaxed">Signals are grouped by their recorded source. Counts describe evidence coverage, not business performance.</p>
                {sourceSignals.map(([source, count]) => (
                  <div key={source} className="business-brain-insight-card flex items-center justify-between gap-4 p-4">
                    <span className="text-fg-secondary text-sm">{source}</span>
                    <span className="text-mint text-sm font-semibold tabular-nums">{count}</span>
                  </div>
                ))}
              </div>
            ) : (
              <HonestTabEmpty title="No signals available" body="This area has no evidence-grounded signals in the current audit." />
            )
          )}

          {activeTab === "history" && (
            <HonestTabEmpty title="No comparable history for this area yet" body="Vibe currently tracks comparable history for overall Business Health, not for each business area on its own. A future scan under the same scoring contract is needed before a trend can be shown here." />
          )}
        </motion.div>
      </AnimatePresence>

      <div className="border-line-1 border-t px-4 pb-4 sm:px-5 sm:pb-5">
        <SelectedScoringDisclosure node={node} />
      </div>
    </motion.section>
  );
}

function HonestTabEmpty({ title, body }: { title: string; body: string }) {
  return (
    <div className="business-brain-insight-card flex min-h-48 flex-col items-center justify-center p-6 text-center">
      <span aria-hidden="true" className="border-line-2 bg-surface-4 text-fg-muted flex size-11 items-center justify-center rounded-full border">—</span>
      <h3 className="text-fg mt-4 text-base font-semibold">{title}</h3>
      <p className="text-fg-muted mt-2 max-w-[42ch] text-sm leading-relaxed">{body}</p>
    </div>
  );
}

function SelectedScoringDisclosure({ node }: { node: BusinessBrainNode }) {
  const evidence = [...node.evidence];
  for (const item of node.problem?.evidence ?? []) {
    if (!evidence.some((existing) => existing.id === item.id)) evidence.push(item);
  }
  const sourceCount = new Set(evidence.map((item) => item.source)).size;
  const score = node.score;
  const scoreTone =
    node.health === "weak"
      ? "text-coral"
      : node.health === "adequate"
        ? "text-amber"
        : "text-mint";

  return (
    <details
      className="group mt-4 rounded-xl border border-line-1 bg-surface-2/45"
      data-testid="selected-scoring-context"
    >
      <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 py-3 focus-visible:ring-2 focus-visible:ring-mint">
        <span
          aria-hidden="true"
          className="border-mint/20 bg-mint/[0.06] text-mint flex size-9 shrink-0 items-center justify-center rounded-full border"
        >
          <BrainIcon className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="text-fg block text-sm font-semibold">How we scored this</span>
          <span className="text-fg-meta mt-0.5 block text-xs">
            {evidence.length} signals · {sourceCount} {sourceCount === 1 ? "source" : "sources"} · current lens score {score ?? "—"}
          </span>
        </span>
        <span aria-hidden="true" className="text-fg-muted transition-transform group-open:rotate-180">⌄</span>
      </summary>

      <aside
        aria-label={`How ${node.label} was scored`}
        className="border-line-1 grid gap-4 border-t px-4 py-4 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]"
      >
        <dl className="grid grid-cols-3 gap-2">
          <div className="border-line-1 bg-surface-3 rounded-lg border p-3">
            <dt className="text-fg-meta text-[0.68rem]">Signals</dt>
            <dd className="text-fg mt-1 text-lg font-semibold tabular-nums">{evidence.length}</dd>
          </div>
          <div className="border-line-1 bg-surface-3 rounded-lg border p-3">
            <dt className="text-fg-meta text-[0.68rem]">Sources</dt>
            <dd className="text-fg mt-1 text-lg font-semibold tabular-nums">{sourceCount}</dd>
          </div>
          <div className="border-line-1 bg-surface-3 rounded-lg border p-3">
            <dt className="text-fg-meta text-[0.68rem]">Score</dt>
            <dd className={cn("mt-1 text-lg font-semibold tabular-nums", scoreTone)}>{score ?? "—"}</dd>
          </div>
        </dl>
        <div className="flex min-w-0 flex-col justify-center gap-2">
          <p className="text-fg-secondary text-xs leading-relaxed">
            This lens reading comes from the current audit and remains separate from the overall Business Health score.
          </p>
          <p className="text-fg-muted text-xs leading-relaxed">
            Missing or inconclusive evidence remains unscored and never becomes zero. No comparable history exists for this area yet.
          </p>
        </div>
      </aside>
    </details>
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
  const node = selected ? (view.nodes.find((candidate) => candidate.id === selected) ?? null) : null;

  function select(lens: BusinessLens) {
    setSelected((current) => (current === lens ? null : lens));
  }

  return (
    <div
      className="grid min-w-0 gap-5 min-[1420px]:grid-cols-[minmax(0,1.35fr)_minmax(28rem,0.85fr)] min-[1680px]:grid-cols-[minmax(0,1.45fr)_minmax(31rem,0.8fr)] min-[1420px]:items-start"
      data-testid="audit-intelligence"
      data-view={node ? "selected" : "overview"}
    >
      <section
        className="business-brain-stage relative min-w-0 overflow-hidden rounded-[1.25rem] border border-line-2 p-4 sm:p-6"
        data-testid="audit-map-panel"
      >
          <span aria-hidden="true" className="business-brain-grid pointer-events-none absolute inset-0" />
          <header className="relative z-10 flex min-h-[3.75rem] flex-wrap items-start justify-between gap-4">
            {node ? (
              <div className="flex flex-col gap-2">
                <h2 className="sr-only">Your Business Brain — {node.label}</h2>
                <button type="button" onClick={() => setSelected(null)} className="border-line-2 bg-surface-2 text-fg-secondary hover:border-mint/35 hover:text-fg flex min-h-10 w-fit cursor-pointer items-center gap-2 rounded-xl border px-3.5 text-sm font-medium transition-interactive focus-visible:ring-2 focus-visible:ring-mint">
                  <span aria-hidden="true">←</span>
                  Back to overview
                </button>
                <p className="text-fg-muted text-xs">Exploring {node.label} and its evidence-grounded connections.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <h2 className="text-fg text-xl font-semibold tracking-[-0.03em]">Your Business Brain</h2>
                <p className="text-fg-muted text-sm">Select any area to explore how the pieces connect.</p>
              </div>
            )}
            {!node && (
              <div className="text-fg-meta flex flex-col items-end gap-1 text-xs">
                <span>{view.nodes.length} business areas</span>
                {view.lastScanAt && <span>Last scan {formatTimestamp(view.lastScanAt) ?? view.lastScanAt}</span>}
              </div>
            )}
          </header>

          <div className="relative z-10 mt-3">
            <BusinessMap
              view={view}
              selected={selected}
              onSelect={select}
            />
          </div>

          <footer className="border-line-1 relative z-10 mt-2 flex flex-wrap items-center justify-between gap-4 border-t pt-4">
            <ul className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs" aria-label="Business health legend">
              <li className="text-mint flex items-center gap-2"><span className="bg-mint size-2 rounded-full shadow-[0_0_10px_rgb(0_229_160/0.8)]" /><span>Strong <span className="text-fg-meta">70–100</span></span></li>
              <li className="text-amber flex items-center gap-2"><span className="bg-amber size-2 rounded-full" /><span>Adequate <span className="text-fg-meta">50–69</span></span></li>
              <li className="text-coral flex items-center gap-2"><span className="bg-coral size-2 rounded-full" /><span>Weak <span className="text-fg-meta">0–49</span></span></li>
              <li className="text-fg-muted flex items-center gap-2"><span className="bg-fg-disabled size-2 rounded-full" />Not scored —</li>
            </ul>
            <p className="text-fg-meta text-xs">Missing evidence is never scored as zero.</p>
          </footer>
      </section>

      <aside
        className="grid min-w-0"
        aria-live="polite"
        aria-label={node ? `${node.label} details` : "What matters now"}
        data-testid={node ? undefined : "current-priorities"}
      >
        {node ? (
          <SelectedPanel
            key={node.id}
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
            reducedMotion={reducedMotion}
          />
        )}
      </aside>
    </div>
  );
}
