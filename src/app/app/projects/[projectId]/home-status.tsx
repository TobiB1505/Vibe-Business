import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { StatusDot } from "@/components/ui/status-pill";
import { VibeCard } from "@/components/ui/surface";
import { MonoLabel } from "@/components/ui/typography";
import { IMPACT_LABELS } from "@/modules/opportunities/schema";
import type { HomeView } from "@/modules/projects/command-center";

/**
 * The one thing Home is for (CORE-5).
 *
 * A founder opening their project should learn four things before scrolling:
 * what Vibe thinks their product is, how the business is doing, the most
 * important thing in the way, and what to do about it. This card is those four
 * things and nothing else.
 *
 * ## Why it is the page's only card
 *
 * Surface level 3 is "one primary object per view" (`surface.tsx`), and this is
 * it. Everything below on Home is a level-2 panel, so the hierarchy says which
 * thing the screen is about rather than leaving a reader to work it out from
 * four equally weighted boxes — which is what Overview did.
 *
 * ## What it may not print
 *
 * A number the domain did not produce. Every branch below comes from
 * `HomeView`, whose whole purpose is that "no score" and "a score of zero" are
 * different values in the type system, so neither this file nor a future edit
 * to it can quietly turn one into the other.
 *
 * ## The controls
 *
 * The brief for this screen asked for "Review action" and "Let agent build".
 * The first is here. The second is deliberately not: nothing on the Agent page
 * starts a build, because preparing a change is an explicit, priced, confirmed
 * action that lives on the Action Plan beside the Move it belongs to. A button
 * promising a build that does not happen where it lands is the kind of promise
 * this product does not make. What replaces it is a link to what the agent has
 * already prepared, shown only when there is something there.
 */
export function HomeStatus({
  view,
  planHref,
  agentHref,
  productHref,
  healthHref,
}: {
  view: HomeView;
  planHref: string;
  agentHref: string;
  productHref: string;
  healthHref: string;
}) {
  const { identity, health, finding, nextMove } = view;

  return (
    <VibeCard padding="lg" className="flex flex-col gap-7">
      <div className="flex flex-col gap-2">
        <MonoLabel>My product</MonoLabel>
        {identity.productName ? (
          <h3 className="text-fg text-headline leading-tight font-bold tracking-[-0.02em]">
            {identity.productName}
          </h3>
        ) : (
          <h3 className="text-fg text-title font-bold">
            Vibe hasn&apos;t worked out what you built yet.
          </h3>
        )}
        {identity.purpose ? (
          <p className="text-fg-prose max-w-[62ch] text-sm leading-relaxed">{identity.purpose}</p>
        ) : (
          <p className="text-fg-muted max-w-[62ch] text-sm">
            It reads your code and visits your product, then tells you in one paragraph what it
            thinks you built.{" "}
            <Link
              href={productHref}
              className="text-fg-body hover:text-fg rounded-sm underline underline-offset-4 transition-interactive"
            >
              Start there
            </Link>
            .
          </p>
        )}
      </div>

      <div className="border-line-2 flex flex-col gap-7 border-t pt-6">
        <section className="flex flex-col gap-2">
          <MonoLabel>Where the business stands</MonoLabel>
          {health.kind === "scored" && (
            <p className="text-fg text-title font-bold">
              <span className="font-mono tabular-nums">{health.score}</span>
              <span className="text-fg-muted font-mono text-sm"> / 100</span>
            </p>
          )}
          {/*
            An audit that ran and could not say. Deliberately not a zero and
            deliberately not the same sentence as "never analyzed" — this one
            is about the evidence, and it carries the audit's own reason.
          */}
          {health.kind === "unscored" && (
            <>
              <p className="text-fg-body text-sm font-medium">Not enough to score yet</p>
              {health.reason && <p className="text-fg-muted max-w-[62ch] text-sm">{health.reason}</p>}
            </>
          )}
          {health.kind === "not_analyzed" && (
            <p className="text-fg-muted max-w-[62ch] text-sm">
              Vibe hasn&apos;t judged this as a business yet.{" "}
              <Link
                href={healthHref}
                className="text-fg-body hover:text-fg rounded-sm underline underline-offset-4 transition-interactive"
              >
                Business Health
              </Link>{" "}
              is where that starts.
            </p>
          )}
          {health.kind !== "not_analyzed" && health.conclusion && (
            <p className="text-fg-prose max-w-[62ch] text-sm leading-relaxed">
              {health.conclusion}
            </p>
          )}
        </section>

        {finding && (
          <section className="flex flex-col gap-2">
            <MonoLabel>Current focus</MonoLabel>
            <p className="text-fg-body text-sm leading-relaxed font-medium">{finding.headline}</p>
            {finding.whyItMatters && (
              <p className="text-fg-muted max-w-[62ch] text-sm leading-relaxed">
                {finding.whyItMatters}
              </p>
            )}
          </section>
        )}

        <section className="flex flex-col gap-3">
          <MonoLabel>Recommended next move</MonoLabel>

          {nextMove.kind === "move" && (
            <>
              <div className="flex flex-wrap items-center gap-2.5">
                <StatusDot tone="active" />
                <p className="text-fg text-base leading-snug font-semibold">{nextMove.title}</p>
              </div>
              <p className="text-fg-prose max-w-[62ch] text-sm leading-relaxed">
                {nextMove.problem}
              </p>
              {/* The engine's own rating, named rather than re-derived here. */}
              <p className="text-fg-meta font-mono text-meta">{IMPACT_LABELS[nextMove.impact]}</p>
            </>
          )}

          {nextMove.kind === "none_found" && (
            <p className="text-fg-muted max-w-[62ch] text-sm">
              Vibe looked and didn&apos;t find a move worth putting ahead of the others right now.
            </p>
          )}

          {nextMove.kind === "not_identified" && (
            <p className="text-fg-muted max-w-[62ch] text-sm">
              Vibe hasn&apos;t worked out what to do next yet. That comes from the business audit.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Link href={planHref} className={buttonClasses({ variant: "primary", size: "sm" })}>
              {nextMove.kind === "move" ? "Review this move" : "Open Action Plan"}
            </Link>
            {/*
              Only when there is something to see. A control that leads to an
              empty page is worse than no control, and "the agent has nothing
              prepared" is already said by the count in the navigation.
            */}
            {view.preparedCount > 0 && (
              <Link href={agentHref} className={buttonClasses({ variant: "secondary", size: "sm" })}>
                See what Vibe prepared
              </Link>
            )}
          </div>
        </section>
      </div>
    </VibeCard>
  );
}
