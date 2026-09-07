import { NovaPresence, type NovaPresenceState } from "@/components/nova/nova-presence";
import { MonoLabel } from "@/components/ui/typography";

/**
 * Introducing Nova, on the page where a visitor meets her first.
 *
 * ## Why she belongs on a marketing page at all
 *
 * She is the product's Home and its named presence, and the landing page did
 * not mention her once — its own eyebrow said "AI business co-founder" and
 * never named the co-founder. A visitor met the protagonist after signing up.
 *
 * The landing page is a signature surface (DESIGN.md), and this is the part of
 * it that carries identity rather than argument: the same avatar, at the same
 * geometry, that the founder will see every day inside the product. The Nova a
 * visitor meets and the Nova they sign in to are one thing, because it is one
 * component.
 *
 * ## Why the four states are a legend and not a demonstration
 *
 * Nothing is running here. There is no project, no repository, no operation —
 * so an aperture that turned on this page would be exactly the "activity while
 * a process is in fact waiting" DESIGN.md forbids at any level of polish.
 *
 * The row is labelled as what it is: a key to a mark, in the same register as
 * a legend beside a chart. Each state is shown at rest, and the sentence
 * beside it says when the founder will see it. `working` is the one that
 * turns inside the product; here it is drawn still, and the copy carries the
 * motion instead of the mark doing so falsely.
 *
 * The one exception is the introduction itself — `introduce` assembles the
 * mark once on mount. That is an entrance, not a state: it says "this is
 * Nova", which is true on arrival and claims nothing about a run.
 */

const STATES: { state: NovaPresenceState; label: string; meaning: string }[] = [
  {
    state: "idle",
    label: "Resting",
    meaning: "Nothing needs you, and Nova says so rather than inventing work.",
  },
  {
    state: "listening",
    label: "Listening",
    meaning: "A question is waiting for you — Nova will not spend anything until you answer.",
  },
  {
    state: "working",
    label: "Working",
    meaning: "A run Vibe is actually watching. The mark turns only while that is true.",
  },
  {
    state: "settled",
    label: "Settled",
    meaning: "The work finished. A failed run lands here too, so nothing about it celebrates.",
  },
];

export function LandingNova() {
  return (
    <section
      id="nova"
      aria-labelledby="nova-heading"
      className="scroll-mt-24 py-20 sm:py-28"
      data-testid="landing-nova"
    >
      <div className="border-line-2 bg-surface-2 rounded-card relative overflow-hidden border">
        {/*
          Contained atmosphere behind the introduction, and nowhere else on the
          page. It marks this as the identity moment rather than decorating the
          section — the same treatment the avatar carries at rest.
        */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-40 left-1/2 -z-10 size-[46rem] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgb(0_229_160/0.09),transparent_64%)] blur-3xl"
        />

        <div className="flex flex-col items-center gap-8 px-6 py-16 text-center sm:px-12 sm:py-20">
          {/*
            The entrance the component was built for and had never been used
            on: the blades seat themselves, the iris opens, the light curve
            draws last. An instrument coming together and then focusing.
          */}
          <NovaPresence state="listening" seed="vibe" size="hero" introduce />

          <div className="flex flex-col items-center gap-4">
            <MonoLabel>Meet Nova</MonoLabel>
            <h2
              id="nova-heading"
              className="text-fg max-w-[18ch] text-[clamp(2rem,4vw,3.25rem)] leading-[1.06] font-bold tracking-[-0.045em] text-balance"
            >
              Your co-founder has a name.
            </h2>
            <p className="text-fg-prose max-w-[58ch] text-lead leading-relaxed">
              Nova reads your product, judges the business behind it, and puts the one thing that
              matters next in front of you. She is the first thing you see when you sign in — an
              aperture around a light curve, because her whole job is to look at what you built and
              measure what happened.
            </p>
          </div>
        </div>

        <div className="border-line-2 border-t px-6 py-10 sm:px-12">
          <MonoLabel as="h3" className="mb-6 block">
            What her mark tells you
          </MonoLabel>
          <ul className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
            {STATES.map((entry) => (
              <li key={entry.state} className="flex flex-col items-start gap-3">
                {/*
                  `lg`, not `md`: the four states differ by how far the iris
                  stands open — 26 units against 35 at the extremes — and at
                  44px that difference is invisible, which makes a legend of
                  four identical marks. Every one is drawn at rest, including
                  `working`: this is a key to a mark, not a screenshot of a run.
                */}
                <NovaPresence state={entry.state} seed="vibe" size="lg" still />
                <div className="flex flex-col gap-1.5">
                  <span className="text-fg text-ui font-semibold">{entry.label}</span>
                  <span className="text-fg-muted text-body leading-relaxed">{entry.meaning}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
