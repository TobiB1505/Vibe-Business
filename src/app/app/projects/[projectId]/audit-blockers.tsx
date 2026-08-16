import { LENS_LABELS, MATERIALITY_LABELS } from "@/modules/business-audit/map-view";
import type { BusinessMap } from "@/modules/business-audit/map-view";
import type { BusinessConclusion } from "@/modules/business-audit/schema";
import { MonoLabel } from "@/components/ui/typography";
import { ReasoningTrail } from "./reasoning-trail";

/**
 * What's holding you back (AUDIT UI-1 §20, §21, §26).
 *
 * The most important text on the page after the conclusion itself, and the
 * place the reading rule is enforced hardest:
 *
 *   the business problem      ← always visible
 *   → how Vibe reached it     ← one click
 *   → the raw evidence        ← inside that
 *
 * Each blocker is a `<details>` rather than a card that expands with state,
 * so it works before hydration, survives a reload with the browser's own
 * behaviour, and is operable by keyboard without any of it being written here.
 *
 * ## Rank is the audit's, not the list's
 *
 * The number beside a blocker is its position in the audit's own ordering,
 * which the model chose by materiality. Nothing here re-sorts them — a UI that
 * quietly reordered by severity would undo the sprint that made ordering mean
 * something.
 */

function priorityOf(conclusion: BusinessConclusion, map: BusinessMap): string | null {
  const materialities = conclusion.lenses
    .map((lens) => map.nodes.find((node) => node.lens === lens)?.materiality)
    .filter((value): value is NonNullable<typeof value> => value !== undefined);

  if (materialities.includes("now")) return MATERIALITY_LABELS.now;
  if (materialities.includes("soon")) return MATERIALITY_LABELS.soon;
  return null;
}

export function AuditBlockers({
  blockers,
  map,
}: {
  blockers: BusinessConclusion[];
  map: BusinessMap;
}) {
  if (blockers.length === 0) {
    return (
      <section className="flex flex-col gap-2">
        <MonoLabel>What&rsquo;s holding you back</MonoLabel>
        {/*
          §48: no empty "top 3" scaffolding. Zero blockers is a real and good
          result, and rendering three placeholders would invent problems to
          fill a layout.
        */}
        <p className="text-fg-prose max-w-[62ch] text-[0.9375rem]">
          Vibe didn&rsquo;t find anything it would put ahead of everything else right now. The
          areas below are all in the map, with what each one still needs.
        </p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3">
      <MonoLabel>What&rsquo;s holding you back</MonoLabel>

      <ul className="flex flex-col gap-2">
        {blockers.map((blocker, index) => {
          const priority = priorityOf(blocker, map);

          return (
            <li key={blocker.headline}>
              <details className="rounded-panel border-line-2 bg-surface-1 group border">
                <summary className="marker:content-none flex cursor-pointer items-start gap-4 p-5">
                  <span className="bg-surface-4 text-fg-secondary mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full font-mono text-[0.6875rem]">
                    {index + 1}
                  </span>

                  <span className="flex min-w-0 flex-1 flex-col gap-2">
                    <span className="text-fg-meta flex flex-wrap items-center gap-2 font-mono text-[0.625rem] tracking-[0.08em] uppercase">
                      {blocker.lenses.map((lens) => (
                        <span key={lens}>{LENS_LABELS[lens]}</span>
                      ))}
                      {priority && <span className="text-mint">{priority}</span>}
                    </span>

                    <span className="text-fg max-w-[54ch] text-base font-semibold">
                      {blocker.headline}
                    </span>

                    <span className="text-fg-prose max-w-[62ch] text-sm">
                      {blocker.explanation}
                    </span>
                  </span>

                  <span className="text-fg-meta mt-0.5 shrink-0 font-mono text-[0.6875rem] transition-transform group-open:rotate-90">
                    ›
                  </span>
                </summary>

                <div className="border-line-1 mx-5 mb-5 border-t pt-5">
                  <ReasoningTrail conclusion={blocker} />
                </div>
              </details>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
