import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface";
import { MonoLabel } from "@/components/ui/typography";
import { EFFORT_LABELS, IMPACT_LABELS } from "@/modules/opportunities/schema";
import type { DashboardProject } from "@/modules/projects/dashboard";

/**
 * The one thing to do next (CORE-6).
 *
 * ## Whose move it is
 *
 * The hero product's — named on the panel beside this card, not repeated here.
 * The reference was drawn with three products and an unattributed "Next move",
 * which is ambiguous the moment a founder has more than one; naming the
 * product once, on the panel that owns both halves, answers it without saying
 * it twice.
 *
 * ## Why chips are allowed here and nowhere else on this screen
 *
 * Because there is exactly one of this card. Impact and effort are the
 * engine's own ratings and they are what makes "next" a decision rather than a
 * list position. Repeated on every product card they would be nine chips in
 * one band, which is the density this sprint exists to remove — so the product
 * cards get the title as a sentence and nothing else.
 *
 * Confidence is deliberately absent even here. Three ratings of equal weight
 * is a table; two is a judgement. `/plan` shows all three, with room to
 * explain them.
 *
 * ## What is not built
 *
 * The reference's "43% of users drop off". There is no analytics source in
 * this product, and there is no honest way to render that number. The Move's
 * own `problem` sentence goes in its place — the model's validated statement
 * of the same thing, without a measurement nobody took.
 */
export function NextMoveCard({ project }: { project: DashboardProject }) {
  const planHref = `/app/projects/${project.id}/plan`;
  const move = project.topMove;

  return (
    <Surface level="panel" padding="lg" className="flex h-full flex-col gap-4">
      <MonoLabel>Next move</MonoLabel>

      {move ? (
        <>
          <h3 className="text-fg text-title leading-snug font-semibold text-balance">
            {move.title}
          </h3>
          <p className="text-fg-prose max-w-[52ch] text-sm leading-relaxed">{move.problem}</p>
          {/* The engine's own ratings, named rather than re-derived here. */}
          <p className="text-fg-meta font-mono text-meta">
            {IMPACT_LABELS[move.impact]} · {EFFORT_LABELS[move.effort]}
          </p>
        </>
      ) : (
        <p className="text-fg-muted max-w-[52ch] text-sm leading-relaxed">
          {project.nextMovesCount === null
            ? "Vibe hasn't worked out what to do next yet. That comes from the business audit."
            : "Vibe looked and didn't find a move worth putting ahead of the others right now."}
        </p>
      )}

      <div className="mt-auto pt-1">
        <Link href={planHref} className={buttonClasses({ variant: "primary", size: "sm" })}>
          {move ? "Review this move" : "Open Action Plan"}
        </Link>
      </div>
    </Surface>
  );
}
