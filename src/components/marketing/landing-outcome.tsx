import { LandingStep } from "@/components/marketing/landing-step";
import { Reveal } from "@/components/marketing/reveal";
import { STATUS_GLYPHS } from "@/components/ui/status-pill";
import { MonoLabel } from "@/components/ui/typography";
import { cn } from "@/lib/utils/cn";
import { MEASUREMENT_LADDER_LABELS } from "@/modules/business-measurement/messages";
import {
  outcomeCheckLabel,
  outcomeProfileScopeNote,
} from "@/modules/outcome-verification/messages";

/**
 * The outcome, drawn as a ladder (UI-34).
 *
 * ## The sixth shape, and the argument it carries
 *
 * Two tiles, a staircase, a narrowing, a passage, a thread — and now a
 * **ladder**, because this block is about three claims of decreasing certainty
 * and increasing importance. The product's own outcome card holds exactly that
 * distinction as data rather than as prose:
 *
 * ```
 * Merged              delivery — the default branch moved
 * Production outcome  verified / partial / not observed
 * Business impact     not measured
 * ```
 *
 * Every surface in the product that shows a green tick after a merge repeats
 * it, for one reason: the moment a founder sees that tick is exactly the moment
 * they will assume more happened than did. The marketing page is the surface
 * most tempted to let them.
 *
 * So the third rung is drawn **empty** — dashed, unfilled, carrying a label
 * instead of a result. That is what the product renders when nothing has been
 * connected that could answer it, and a page that filled it in with a plausible
 * number would be advertising a claim the product refuses to make.
 *
 * ## The word that is never rendered
 *
 * `Deployed`. Vibe calls no deployment provider and has no provenance for which
 * build is serving. Observing the expected behaviour is *consistent with* the
 * new build being live; it is not evidence of it, and the block says so on the
 * rung where a reader would otherwise assume it.
 *
 * ## Where the words come from
 *
 * `outcomeCheckLabel` writes the check lines and `MEASUREMENT_LADDER_LABELS`
 * writes the results, both from the product's own tables — the same discipline
 * as `LandingNova`. "`/pricing` answers" is what the product says because
 * "works", "is live" and "updated" are three things that check cannot tell
 * anybody, and a landing page must not be the place where a softer word gets
 * tried out.
 *
 * ## Where it came from
 *
 * `LandingFlow`'s *Measure* tab, moved rather than copied — the fourth step to
 * leave the tab bar, after *Understand*, *Prioritize* and *Execute*.
 */

/**
 * Three routes from one outcome profile, one of them not observed.
 *
 * All three are `public_route_serves_page`, because a real outcome card comes
 * from one profile: the checks a change is verified against are the ones that
 * profile defines, and mixing an SEO check into a set of route checks would be
 * a card the product cannot produce.
 *
 * The unobserved line is not decoration. A card that showed only its passing
 * lines would turn a partial outcome into a verified one by omission, which is
 * the exact misreading the product's outcome work was built around — and on a
 * marketing page the temptation to show three ticks is at its strongest.
 */
const CHECKS: { target: string; seen: boolean }[] = [
  { target: "/pricing", seen: true },
  { target: "/pricing/plans", seen: true },
  { target: "/checkout", seen: false },
];

export function LandingOutcome() {
  return (
    <LandingStep index="06" id="outcome" labelledBy="outcome-heading" className="py-20 sm:py-28">
      <Reveal from="up">
        <div className="flex flex-col gap-5">
          <MonoLabel className="text-mint">The outcome</MonoLabel>
          <h2
            id="outcome-heading"
            className="text-fg max-w-[24ch] text-[clamp(2rem,3.6vw,3rem)] leading-[1.06] font-bold tracking-[-0.045em] text-balance"
          >
            It merged. That is the smallest of the three things you want to know.
          </h2>
          <p className="text-fg-prose max-w-[58ch] leading-relaxed">
            After a change lands there are three questions, in rising order of what you actually
            care about. Vibe is certain of the first, goes and looks for the second, and refuses the
            third unless you have connected something that can answer it.
          </p>
          <p className="text-fg-muted max-w-[58ch] text-caption leading-relaxed">
            The lines below are example data. The words are not: every check label and every result
            here is written by the product, in the wording it uses on your own screen.
          </p>
        </div>
      </Reveal>

      {/*
        The ladder. Each rung is a bigger claim about the world and a weaker
        piece of evidence, which is why the accent fades and the last one is
        drawn open — a dashed contour is this product's mark for a loop that
        has not closed, in a bubble and here alike.
      */}
      <ol className="mx-auto mt-16 flex w-full max-w-3xl flex-col gap-4 sm:mt-20">
        <Rung
          eyebrow="Read back"
          accent="mint"
          title="Your default branch points at the commit you approved."
          body="Vibe wrote it, then read GitHub again to confirm the branch is where it should be. This is the one of the three it is certain about."
          footnote="It does not say deployed. Vibe calls no deployment provider, and it has no way to know which build is serving your site."
        />

        <Rung
          eyebrow="Observed"
          accent="dim"
          title="The pages the change touched are being served."
          body={outcomeProfileScopeNote("agentic_public_routes_outcome_v1")}
          footnote="Not observed is not a failed deployment: it says the expected behaviour was not visible inside the window, and that Vibe does not know why. A check that did not pass is never left off the list."
        >
          <ul className="mt-1 flex flex-col gap-1.5">
            {CHECKS.map(({ target, seen }) => (
              <li key={target} className="flex items-center gap-2.5">
                <span
                  aria-hidden
                  className={cn(
                    "w-4 shrink-0 text-center font-mono text-caption",
                    seen ? "text-mint" : "text-fg-muted",
                  )}
                >
                  {seen ? STATUS_GLYPHS.confirmed : STATUS_GLYPHS.unseen}
                </span>
                <span className={cn("text-body", seen ? "text-fg-body" : "text-fg-muted")}>
                  {outcomeCheckLabel({ kind: "public_route_serves_page", target })}
                  {!seen && <span className="text-fg-meta"> — not observed</span>}
                </span>
              </li>
            ))}
          </ul>
        </Rung>

        <Rung
          eyebrow="Not measured"
          accent="open"
          title="Whether it changed your business."
          body="This one needs a source you connected. With one, Vibe measures a single metric against its baseline over a window and reports what it found — improved, degraded, no meaningful change, or insufficient data. Without one it says so and stops."
          footnote={`"${MEASUREMENT_LADDER_LABELS.waiting_for_source}" never becomes "no impact". An unmeasured change is unmeasured, and calling that a result would be inventing one.`}
        />
      </ol>

      <Reveal from="up" delay={0.1} className="mt-8">
        <p className="text-fg-muted mx-auto max-w-[56ch] text-center text-caption leading-relaxed">
          Most products stop after the first rung and let the green tick imply the third.
        </p>
      </Reveal>
    </LandingStep>
  );
}

/** One rung: a claim, the evidence behind it, and the limit of that evidence. */
function Rung({
  eyebrow,
  accent,
  title,
  body,
  footnote,
  children,
}: {
  eyebrow: string;
  /** How much evidence stands behind this one, drawn rather than stated twice. */
  accent: "mint" | "dim" | "open";
  title: string;
  body: string;
  footnote: string;
  children?: React.ReactNode;
}) {
  const open = accent === "open";

  return (
    <li>
      <Reveal from="up">
        <div
          className={cn(
            "rounded-card relative flex flex-col gap-3 border p-5 sm:p-6",
            open ? "border-line-3 border-dashed" : "border-line-2 bg-surface-2",
          )}
        >
          {/* The rung itself: an accent down the left edge, fading with the
              evidence. Absent on the open one, which has none. */}
          {!open && (
            <span
              aria-hidden
              className={cn(
                "absolute inset-y-5 left-0 w-0.5 rounded-full",
                accent === "mint" ? "bg-mint" : "bg-mint-dim",
              )}
            />
          )}

          <MonoLabel as="p" className={open ? "text-fg-meta" : "text-mint"}>
            {eyebrow}
          </MonoLabel>
          <p className={cn("text-lead font-semibold", open ? "text-fg-secondary" : "text-fg")}>
            {title}
          </p>
          <p className="text-fg-prose max-w-[62ch] leading-relaxed">{body}</p>
          {children}
          <p className="text-fg-muted max-w-[62ch] text-caption leading-relaxed">{footnote}</p>
        </div>
      </Reveal>
    </li>
  );
}
