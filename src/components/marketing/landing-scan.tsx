import { Reveal } from "@/components/marketing/reveal";
import {
  LANDING_SCAN_EVENTS,
  LANDING_SCAN_OPERATION,
  LANDING_SCAN_PRESENTATION,
} from "@/components/marketing/landing-scan-example";
import { EXAMPLE_SOURCES } from "@/components/marketing/landing-sources";
import { ProductScanExperience } from "@/components/product-scan/product-scan-experience";
import { SourceCoverageStrip } from "@/components/system/source-coverage";
import { CheckIcon } from "@/components/ui/dashboard-icons";
import { MonoLabel } from "@/components/ui/typography";

/**
 * The Product Scan, explained (UI-34).
 *
 * ## Two tiles, and which one is the subject
 *
 * The right tile is. This is a landing page and its job is to **explain the
 * modules** — a visitor who has never used Vibe cannot infer what a Product
 * Scan is from a picture of one, however good the picture. So the words lead
 * and the picture supports them.
 *
 * The previous version had this the other way round: the whole scanner at full
 * width, 1,825 pixels of it, with the explanation above. It showed the module
 * beautifully and never said what the module was for.
 *
 * ## The preview is the real surface, shrunk
 *
 * `ProductScanExperience` on `variant="showcase"`, rendered at a desktop
 * measure inside a fixed box and scaled down to the tile — not a screenshot, and not a
 * marketing redraw of the constellation. A change to the scanner changes what
 * this preview shows, which is the whole reason for mounting the component
 * rather than illustrating it.
 *
 * It is cropped at the bottom, deliberately. A fragment reads as a window into
 * something larger; a complete miniature reads as a diagram of it. The fade is
 * a mask on the wrapper rather than an overlay, so nothing is painted over the
 * page's own ground.
 *
 * `aria-hidden`, and that is not a shortcut: at this scale the type is a
 * texture rather than something to read, and every fact in it is stated in
 * words in the tile beside it. A screen reader meeting the shrunk copy would
 * meet the same six facets twice, once illegibly.
 *
 * ## What the honest line is doing here
 *
 * `SourceCoverageStrip` names the four sources and marks the two Vibe fell
 * short on. It belongs in this block rather than a later one because *what a
 * scan can and cannot reach* is part of explaining the module, not a caveat
 * bolted to the end of the page.
 */

/** What the module produces, in the product's own vocabulary. */
const READS = [
  "Your repository — what it builds, and what it depends on",
  "Your live product — the pages a visitor can reach",
  "Your own words, which outrank anything Vibe derived",
];

export function LandingScan() {
  return (
    <section id="scan" aria-labelledby="scan-heading" className="scroll-mt-24 py-20 sm:py-28">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1fr)] lg:items-center lg:gap-16">
        <Reveal from="left" className="min-w-0">
          {/*
            A window, not a diagram. The inner div is the real component at its
            own width; the outer one is the hole it is seen through, and the
            mask is what makes the crop read as deliberate.
          */}
          <div
            aria-hidden
            className="landing-scan-preview rounded-stage border-line-2 relative overflow-hidden border p-3"
          >
            <div className="landing-scan-preview-crop pointer-events-none select-none">
              <div>
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
            </div>
          </div>
        </Reveal>

        <Reveal from="right" delay={0.08} className="max-lg:order-first">
          <div className="flex flex-col gap-6">
            <MonoLabel className="text-mint">Module one · Product Scan</MonoLabel>
            <h2
              id="scan-heading"
              className="text-fg text-[clamp(2rem,3.6vw,3rem)] leading-[1.06] font-bold tracking-[-0.045em] text-balance"
            >
              It works out what you built, before it says anything about it.
            </h2>
            <p className="text-fg-prose max-w-[48ch] leading-relaxed">
              The Product Scan reads your code and your live product in one pass and comes back with
              a picture of the product: what kind of thing it is, what it can do, who it appears to
              be for, and how it charges. Assembled from evidence, not from a form you fill in.
            </p>

            <ul className="flex flex-col gap-2.5">
              {READS.map((line) => (
                <li key={line} className="text-fg-body flex items-start gap-3 text-body">
                  <CheckIcon size={16} className="text-mint mt-0.5 shrink-0" />
                  {line}
                </li>
              ))}
            </ul>

            <div className="border-line-2 flex flex-col gap-2 border-t pt-5">
              <SourceCoverageStrip sources={EXAMPLE_SOURCES} />
              <p className="text-fg-muted max-w-[52ch] text-caption leading-relaxed">
                And it says where it could not look. A page that builds itself in the visitor&apos;s
                browser is an empty shell to a scan, and everything behind your sign-in stays
                invisible until you say otherwise.
              </p>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
