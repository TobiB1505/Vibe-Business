import { Reveal } from "@/components/marketing/reveal";
import {
  LANDING_SCAN_EVENTS,
  LANDING_SCAN_OPERATION,
  LANDING_SCAN_PRESENTATION,
} from "@/components/marketing/landing-scan-example";
import { EXAMPLE_SOURCES } from "@/components/marketing/landing-sources";
import { ProductScanExperience } from "@/components/product-scan/product-scan-experience";
import { SourceCoverageStrip } from "@/components/system/source-coverage";
import { MonoLabel } from "@/components/ui/typography";

/**
 * The second block: the Product Scan, finished (UI-34).
 *
 * ## What this shows and why it is that
 *
 * The first version of this block was the source-coverage list — four rows
 * saying what Vibe had read and what it had not. True, and the least
 * impressive true thing available: it is a page about *reading* rather than
 * about *understanding*, and the reader has no reason yet to care which files
 * were opened.
 *
 * The Product Scan is the moment worth showing. A constellation with the
 * product at its centre and six facets around it — product type, capabilities,
 * live product, audience, billing, brand — each one a thing Vibe worked out
 * from the code and the site rather than a field somebody filled in. The claim
 * the block is making is *it recognised what you built*, and this is the only
 * surface in the product that shows that happening.
 *
 * ## It is the real component
 *
 * `ProductScanExperience`, the same one the workspace and Nova's thread mount.
 * Not a marketing copy of it. It gets a fourth variant, `showcase`, because a
 * *settled* scan is exactly what the other three collapse — rightly, for a
 * founder who has already seen theirs — and because the refresh those three
 * fire on a completed operation has nothing to fetch here and no session to
 * fetch it with. `DESIGN.md`'s truthfulness
 * rules apply to this page exactly as they do to a dashboard, so the advantage
 * has to come from the opposite direction to a mockup: this is honest here
 * because it is honest everywhere, and a change to the scanner changes what
 * the landing page shows.
 *
 * The operation is a **completed** one, which is what makes the scan settled
 * rather than empty: the component builds its picture from
 * `{ operation, events, presentation }` together, so a null operation renders
 * six facets all saying "Detecting…" over a constellation with nothing in it.
 * Completed also means `operationPollPhase` is not `working`, so nothing polls,
 * and `canStart={false}` means nothing can be started — the same reasoning that
 * took the remedy buttons off the source rows. There is no project here.
 *
 * ## The honesty did not get dropped, it moved
 *
 * `SourceCoverageStrip` sits under the constellation: one line naming the four
 * sources with a tick or a dash, so *Vibe half-read your site and has not seen
 * past your sign-in* is still on the page. It is a line rather than four cards
 * because the subject of this block is the picture coming out; the caveat
 * belongs beside it, not instead of it.
 */
export function LandingScan() {
  return (
    <section id="scan" aria-labelledby="scan-heading" className="scroll-mt-24 py-20 sm:py-28">
      <div className="flex flex-col gap-10 lg:gap-14">
        <Reveal from="left">
          <div className="flex flex-col gap-5">
            <MonoLabel className="text-mint">Step one · Product Scan</MonoLabel>
            <h2
              id="scan-heading"
              className="text-fg max-w-[22ch] text-[clamp(2rem,3.6vw,3rem)] leading-[1.06] font-bold tracking-[-0.045em] text-balance"
            >
              Before it advises you, it works out what you built.
            </h2>
            <p className="text-fg-prose max-w-[62ch] leading-relaxed">
              Your repository and your live product, read in one pass. What it comes back with is a
              picture of the product — what kind of thing it is, what it can do, who it appears to
              be for, how it charges — assembled from evidence rather than from a form you filled
              in.
            </p>
          </div>
        </Reveal>

        {/*
          The scan gets the width. It is the widest thing on the page after the
          hero, and the reason is the same: this is the block's subject rather
          than an illustration beside one.
        */}
        <Reveal from="up" delay={0.06}>
          <div className="landing-scan-stage rounded-stage border border-line-2 p-4 sm:p-6">
            <ProductScanExperience
              projectId="landing-example"
              productName={LANDING_SCAN_PRESENTATION.name}
              initialOperation={LANDING_SCAN_OPERATION}
              initialEvents={LANDING_SCAN_EVENTS}
              initialPresentation={LANDING_SCAN_PRESENTATION}
              hasProfile
              canStart={false}
              variant="showcase"
            />
          </div>
        </Reveal>

        <Reveal from="right" delay={0.06}>
          <div className="flex flex-col gap-3">
            <SourceCoverageStrip sources={EXAMPLE_SOURCES} />
            <p className="text-fg-muted max-w-[70ch] text-caption leading-relaxed">
              An example scan, of Vibe Business itself. Every line of it is true of the product
              serving this page — and the strip above is the other half: a page that builds itself
              in the visitor&apos;s browser is an empty shell to a scan, and everything behind your
              sign-in stays invisible until you say otherwise.
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
