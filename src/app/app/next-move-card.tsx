import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { ArrowRightIcon, InfoIcon, RocketIcon } from "@/components/ui/dashboard-icons";
import { Surface } from "@/components/ui/surface";
import { EFFORT_LABELS, IMPACT_LABELS } from "@/modules/opportunities/schema";
import type { DashboardProject } from "@/modules/projects/dashboard";

/** The one highest-value action for the product leading the dashboard. */
export function NextMoveCard({ project }: { project: DashboardProject }) {
  const planHref = `/app/projects/${project.id}/plan`;
  const move = project.topMove;

  return (
    <Surface level="panel" padding="lg" className="flex flex-col gap-6">
      <div className="flex items-center gap-2">
        <h2 className="text-fg text-sm font-semibold">Next move</h2>
        <span title="The highest-ranked move from the latest business audit">
          <InfoIcon size={16} className="text-fg-meta" />
        </span>
      </div>

      <div className="grid items-center gap-5 md:grid-cols-[4.5rem_minmax(0,1fr)_auto]">
        <div className="bg-mint-tint-soft text-mint flex size-16 items-center justify-center rounded-panel">
          <RocketIcon size={28} />
        </div>

        <div className="flex min-w-0 flex-col gap-2">
          {move ? (
            <>
              <h3 className="text-fg text-lg font-semibold tracking-[-0.02em] text-balance">
                {move.title}
              </h3>
              <p className="text-fg-prose max-w-[54ch] text-sm leading-relaxed">{move.problem}</p>
              <div className="flex flex-wrap gap-2 pt-1">
                <span className="bg-mint-tint text-mint border-mint-line rounded-full border px-3 py-1 text-xs font-semibold">
                  {IMPACT_LABELS[move.impact]} impact
                </span>
                <span className="bg-amber-tint text-amber border-amber-line rounded-full border px-3 py-1 text-xs font-semibold">
                  {EFFORT_LABELS[move.effort]} effort
                </span>
              </div>
            </>
          ) : (
            <>
              <h3 className="text-fg text-lg font-semibold">No move waiting right now</h3>
              <p className="text-fg-muted max-w-[54ch] text-sm leading-relaxed">
                {project.nextMovesCount === null
                  ? "Run the business audit to turn Vibe's findings into a prioritised action plan."
                  : "Vibe looked and didn't find a move worth putting ahead of the others right now."}
              </p>
            </>
          )}
        </div>

        <Link
          href={planHref}
          className={buttonClasses({ variant: "secondary", size: "md" })}
        >
          {move ? "View action plan" : "Open action plan"}
          <ArrowRightIcon size={16} />
        </Link>
      </div>
    </Surface>
  );
}
