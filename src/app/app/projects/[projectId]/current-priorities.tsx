"use client";

import Link from "next/link";
import { LENS_LABELS, MATERIALITY_LABELS } from "@/modules/business-audit/map-view";
import type { BusinessMap } from "@/modules/business-audit/map-view";
import type { BusinessConclusion, BusinessLens } from "@/modules/business-audit/schema";
import { MonoLabel } from "@/components/ui/typography";

/**
 * Current priorities (AUDIT UI-1.2 §5, §6, §11, §30).
 *
 * ## The one job
 *
 * This column answers *what should I care about?* and nothing else. It used to
 * carry full strength paragraphs, full blocker explanations and a repeat of the
 * top blocker under its own heading — four kinds of prose fighting for a narrow
 * measure, which is why the panel read as cramped.
 *
 * So the rule this file exists to enforce is a density one:
 *
 *   right column = scan     ·     detail below the map = understand
 *
 * Each item is rank, area, when it matters, and a headline. The explanation is
 * clamped to two lines as a taste of what is underneath, never as the
 * explanation itself — the whole text lives in the detail panel, which has the
 * width for it.
 *
 * ## Where "Where I'd start" went
 *
 * Into the first item (§11). It was a large card repeating blocker #1 verbatim
 * one screen below blocker #1, which is the clearest case of the same thing
 * said twice on one viewport.
 */

/** The lens a priority selects. First is the audit's own primary. */
function primaryLensOf(blocker: BusinessConclusion): BusinessLens | null {
  return blocker.lenses[0] ?? null;
}

function materialityOf(blocker: BusinessConclusion, map: BusinessMap): string | null {
  const values = blocker.lenses
    .map((lens) => map.nodes.find((node) => node.lens === lens)?.materiality)
    .filter((value): value is NonNullable<typeof value> => value !== undefined);

  if (values.includes("now")) return MATERIALITY_LABELS.now;
  if (values.includes("soon")) return MATERIALITY_LABELS.soon;
  return null;
}

export function CurrentPriorities({
  blockers,
  map,
  selected,
  onSelect,
  movesHref,
  hasMoves,
}: {
  blockers: BusinessConclusion[];
  map: BusinessMap;
  selected: BusinessLens | null;
  onSelect: (lens: BusinessLens) => void;
  movesHref: string;
  hasMoves: boolean;
}) {
  if (blockers.length === 0) {
    return (
      <section className="flex flex-col gap-3" data-testid="current-priorities">
        <MonoLabel as="h3" className="text-fg-secondary">
          Current priorities
        </MonoLabel>
        {/* §15 — no filler. Zero blockers is a real and good result. */}
        <p className="text-fg-prose text-sm leading-relaxed">
          Vibe didn&rsquo;t find anything it would put ahead of everything else right now.
        </p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3" data-testid="current-priorities">
      <MonoLabel as="h3" className="text-fg-secondary">
        Current priorities
      </MonoLabel>

      <ol className="flex flex-col gap-2.5">
        {blockers.map((blocker, index) => {
          const lens = primaryLensOf(blocker);
          const isPrimary = index === 0;
          const isSelected = lens !== null && lens === selected;
          const materiality = materialityOf(blocker, map);

          return (
            <li key={blocker.headline}>
              {/*
                A button, not a card with a link in it. Selecting a priority and
                selecting its node on the map are the same action against the
                same state (§32), so this has to be the same kind of control.
              */}
              <button
                type="button"
                onClick={() => lens && onSelect(lens)}
                aria-pressed={isSelected}
                data-primary={isPrimary ? "true" : undefined}
                className={`rounded-panel flex w-full flex-col items-start gap-2 border p-4 text-left transition-colors ${
                  isPrimary
                    ? "border-mint/45 bg-mint/[0.05] hover:border-mint/70"
                    : "border-line-2 bg-surface-1 hover:border-line-4"
                } ${isSelected ? "ring-mint/25 ring-2" : ""}`}
              >
                <span className="flex w-full items-center gap-2">
                  <span
                    className={`flex size-5 shrink-0 items-center justify-center rounded-full font-mono text-[0.625rem] ${
                      isPrimary ? "bg-mint text-mint-ink" : "bg-surface-4 text-fg-secondary"
                    }`}
                  >
                    {index + 1}
                  </span>
                  <span className="text-fg-meta min-w-0 flex-1 truncate font-mono text-[0.625rem] tracking-[0.08em] uppercase">
                    {blocker.lenses.map((entry) => LENS_LABELS[entry]).join(" · ")}
                  </span>
                  {materiality && (
                    <span
                      className={`shrink-0 font-mono text-[0.625rem] tracking-[0.08em] uppercase ${
                        isPrimary ? "text-mint" : "text-fg-meta"
                      }`}
                    >
                      {materiality}
                    </span>
                  )}
                </span>

                <span
                  className={`font-semibold ${
                    isPrimary ? "text-fg text-[0.9375rem]" : "text-fg-body text-sm"
                  }`}
                >
                  {blocker.headline}
                </span>

                {/*
                  A taste, not the explanation. Two lines here and the whole
                  text below the map, which is the width it was written for.
                */}
                <span className="text-fg-muted line-clamp-2 text-[0.8125rem] leading-relaxed">
                  {blocker.explanation}
                </span>

                {isPrimary && (
                  <span className="text-mint mt-0.5 font-mono text-[0.625rem] tracking-[0.08em] uppercase">
                    Start here
                  </span>
                )}
              </button>

              {/*
                Outside the button, because a link inside a button is neither.
                Only on the primary, and only when there is something behind it
                (§12) — a CTA into an empty screen is a promise the audit did
                not keep.
              */}
              {isPrimary && (
                <div className="mt-2 pl-2">
                  {hasMoves ? (
                    <Link
                      href={movesHref}
                      className="text-mint hover:text-mint-hover rounded-sm text-sm underline underline-offset-4"
                    >
                      See what Vibe would do
                    </Link>
                  ) : (
                    // The honest sentence is shorter than the excuse would be.
                    <p className="text-fg-meta text-[0.8125rem] leading-relaxed">
                      Vibe hasn&rsquo;t worked out the next moves for this project yet.
                    </p>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
