import { Reveal } from "@/components/marketing/reveal";
import { SourceCoverageList } from "@/components/system/source-coverage";
import { MonoLabel } from "@/components/ui/typography";
import { EXAMPLE_SOURCES } from "@/components/marketing/landing-sources";

/**
 * The second block: what Vibe reads, and what it admits it could not (UI-34).
 *
 * ## Where this came from
 *
 * `LandingFlow`'s first tab. The flow section is six tabs inside a page whose
 * whole shape is a scroll, and a tab bar asks the reader to stop and choose
 * while the page is trying to carry them forward. So the six are being taken
 * apart one at a time and given the room a block has; this is the first of
 * them, moved rather than copied — the tab is gone from `LandingFlow`, which
 * is what stops the page saying the same thing twice in two rhythms.
 *
 * ## Why the object leads and the argument follows
 *
 * The block before this one is type: a statement with hairlines and no
 * container anywhere. This one is an object, and it goes on the left, which is
 * where that block put the reader's unanswered questions. The page hands over
 * the material first and explains it second — the reverse of the block above,
 * because the subject has reversed too. That is the whole argument for the
 * direction, and it is the only kind this page accepts: alternating sides
 * because alternating looks lively is what the motion skill calls the failure
 * mode.
 *
 * ## The fourth row is the point
 *
 * Three of the four sources here are `ready`, `partial` and `none` — Vibe read
 * the code, half-read the live product and has not seen past the sign-in at
 * all. A marketing page would ordinarily show four greens. This one shows the
 * real component in the real states, because `SourceCoverage` states *why* it
 * stopped short in the module that owns the vocabulary, and a landing page
 * that hid that would be making a promise the first scan breaks.
 *
 * The data is example data and the section says so. What is not example is the
 * behaviour.
 */
export function LandingScan() {
  return (
    <section id="scan" aria-labelledby="scan-heading" className="scroll-mt-24 py-20 sm:py-28">
      <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] lg:items-center lg:gap-20">
        <Reveal from="left">
          <SourceCoverageList sources={EXAMPLE_SOURCES} />
        </Reveal>

        {/*
          The argument comes first on a phone, where the grid is one column and
          "left" and "right" have collapsed into "above" and "below". Without
          this the reader meets four evidence cards before anything has said
          what they are evidence of.
        */}
        <Reveal from="right" delay={0.08} className="max-lg:order-first">
          <div className="flex flex-col gap-6">
            <MonoLabel className="text-mint">Step one · Scan</MonoLabel>
            <h2
              id="scan-heading"
              className="text-fg text-[clamp(2rem,3.6vw,3rem)] leading-[1.06] font-bold tracking-[-0.045em] text-balance"
            >
              It reads what you built, not what you say you built.
            </h2>
            <p className="text-fg-prose max-w-[46ch] leading-relaxed">
              Your repository, your live product, and your own words about the business — which
              outrank anything Vibe derived on its own. Nothing here is a form you fill in.
            </p>
            <p className="text-fg-secondary max-w-[46ch] leading-relaxed">
              And it tells you where it could not look. A page that builds itself in the
              visitor&apos;s browser is an empty shell to a scan, and everything behind your sign-in
              is invisible until you say otherwise. Vibe says so instead of scoring you on it.
            </p>
            <p className="text-fg-muted text-caption">
              Example data. The states are the real ones.
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
