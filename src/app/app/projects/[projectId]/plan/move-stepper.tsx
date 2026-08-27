"use client";

import { useEffect, useRef } from "react";
import { useReducedMotion } from "motion/react";
import { ArrowLeftIcon, ArrowRightIcon } from "@/components/ui/dashboard-icons";
import { cn } from "@/lib/utils/cn";
import type { BusinessOpportunity } from "@/modules/opportunities/schema";
import { MOVE_BAND_LABELS, moveBand } from "@/modules/opportunities/view";

/**
 * The Action Plan's priority navigator.
 *
 * This is a tab interface over persisted Move order, not a completion meter.
 * Earlier circles therefore stay visible without ticks: being ranked before
 * the active Move does not mean the work is complete. Arrow buttons, arrow
 * keys and direct selection are the non-drag equivalents for the card swipe.
 */
export function MoveStepper({
  opportunities,
  activeIndex,
  onSelect,
}: {
  opportunities: BusinessOpportunity[];
  activeIndex: number;
  onSelect: (index: number) => void;
}) {
  const reduceMotion = useReducedMotion();
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const activeOpportunity = opportunities[activeIndex] ?? null;

  useEffect(() => {
    buttons.current[activeIndex]?.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "nearest",
      inline: "center",
    });
  }, [activeIndex, reduceMotion]);

  function selectAndFocus(index: number) {
    const bounded = Math.max(0, Math.min(index, opportunities.length - 1));
    onSelect(bounded);
    buttons.current[bounded]?.focus();
  }

  return (
    <section
      aria-label="Move priority"
      className="border-line-2 bg-surface-1 rounded-panel flex items-center gap-2 border px-2 py-3 sm:gap-4 sm:px-4"
      data-testid="move-stepper"
    >
      <button
        type="button"
        onClick={() => selectAndFocus(activeIndex - 1)}
        disabled={activeIndex <= 0}
        aria-label="Previous move"
        className="text-fg-secondary hover:bg-surface-hover hover:text-fg focus-visible:ring-mint flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-nav transition-interactive focus-visible:ring-2 focus-visible:outline-none disabled:pointer-events-none disabled:text-fg-disabled"
      >
        <ArrowLeftIcon size={17} />
      </button>

      <div className="min-w-0 flex-1 overflow-x-auto overscroll-x-contain py-1 scrollbar-stable">
        <ol
          role="tablist"
          aria-label="Prioritized moves"
          className="grid"
          style={{
            gridTemplateColumns: `repeat(${opportunities.length}, minmax(7.5rem, 1fr))`,
            minWidth: `${Math.max(30, opportunities.length * 8)}rem`,
          }}
        >
          {opportunities.map((opportunity, index) => {
            const active = index === activeIndex;
            const previous = index < activeIndex;
            const band = moveBand(opportunity.rank);

            return (
              <li key={opportunity.id} role="presentation" className="relative min-w-0">
                {index < opportunities.length - 1 ? (
                  <span
                    aria-hidden
                    className={cn(
                      "absolute top-5 right-0 left-1/2 h-px",
                      index < activeIndex ? "bg-mint-dim" : "bg-line-3",
                    )}
                  />
                ) : null}
                {index > 0 ? (
                  <span
                    aria-hidden
                    className={cn(
                      "absolute top-5 right-1/2 left-0 h-px",
                      index <= activeIndex ? "bg-mint-dim" : "bg-line-3",
                    )}
                  />
                ) : null}

                <button
                  ref={(element) => {
                    buttons.current[index] = element;
                  }}
                  type="button"
                  role="tab"
                  id={`move-step-${index}`}
                  aria-controls="active-move-panel"
                  aria-selected={active}
                  tabIndex={active ? 0 : -1}
                  onClick={() => onSelect(index)}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowRight") {
                      event.preventDefault();
                      selectAndFocus(index + 1);
                    } else if (event.key === "ArrowLeft") {
                      event.preventDefault();
                      selectAndFocus(index - 1);
                    } else if (event.key === "Home") {
                      event.preventDefault();
                      selectAndFocus(0);
                    } else if (event.key === "End") {
                      event.preventDefault();
                      selectAndFocus(opportunities.length - 1);
                    }
                  }}
                  className="group relative z-10 flex w-full cursor-pointer flex-col items-center gap-2 rounded-nav px-2 text-center focus-visible:ring-2 focus-visible:ring-mint focus-visible:outline-none"
                  data-testid="move-step"
                  data-rank={opportunity.rank}
                >
                  <span
                    className={cn(
                      "flex size-10 items-center justify-center rounded-full border bg-app font-mono text-sm tabular-nums transition-interactive",
                      active && "border-mint bg-mint-tint-soft text-mint shadow-dot-mint",
                      previous && !active && "border-mint-line text-fg-body",
                      !previous && !active && "border-line-3 text-fg-meta group-hover:border-line-strong group-hover:text-fg-secondary",
                    )}
                  >
                    {opportunity.rank}
                  </span>
                  <span
                    className={cn(
                      "font-mono text-meta tracking-[0.14em] uppercase transition-interactive",
                      active ? "text-mint" : previous ? "text-fg-secondary" : "text-fg-meta",
                    )}
                  >
                    {MOVE_BAND_LABELS[band]}
                  </span>
                  <span className={cn("line-clamp-1 max-w-36 text-xs", active ? "text-fg-body" : "text-fg-muted")}>
                    {opportunity.title}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>

      <button
        type="button"
        onClick={() => selectAndFocus(activeIndex + 1)}
        disabled={activeIndex >= opportunities.length - 1}
        aria-label="Next move"
        className="text-fg-secondary hover:bg-surface-hover hover:text-fg focus-visible:ring-mint flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-nav transition-interactive focus-visible:ring-2 focus-visible:outline-none disabled:pointer-events-none disabled:text-fg-disabled"
      >
        <ArrowRightIcon size={17} />
      </button>

      <p className="sr-only" aria-live="polite">
        {activeOpportunity
          ? `Move ${activeOpportunity.rank} selected: ${activeOpportunity.title}`
          : "No move selected"}
      </p>
    </section>
  );
}
