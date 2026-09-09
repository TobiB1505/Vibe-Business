import { Reveal } from "@/components/marketing/reveal";
import { MonoLabel } from "@/components/ui/typography";
import { LENS_LABELS } from "@/modules/business-audit/map-view";
import { BUSINESS_LENSES, type BusinessLens } from "@/modules/business-audit/schema";

/**
 * The first block under the hero: the gap the product exists in (UI-34).
 *
 * ## Why the page needed one
 *
 * The landing page went from a claim straight to a preview of the Business
 * Brain — *here is the thing* before *here is why you would want a thing*. Every
 * block below it was a feature, at the same rhythm, and a visitor who had not
 * yet agreed there was a problem met nine of them in a row.
 *
 * So this block agrees with the visitor before it sells them anything. It makes
 * one argument: building is the part that got fast, and none of what decides
 * whether the thing becomes a business got faster with it.
 *
 * ## The questions are the product's own areas, asked as questions
 *
 * They come from `BUSINESS_LENSES` rather than a list typed here, for the same
 * reason `LandingBusinessBrain` reads them: a marketing page that names its own
 * categories drifts from the product the first time the product changes, and
 * nobody notices because both sides look plausible. Five of the nine, in the
 * order the audit holds them, phrased as the question a founder actually has.
 *
 * A question is not a claim. Nothing here says Vibe answers all nine well, or
 * how — the blocks below it do that, and this one is allowed to be the part
 * where the reader nods.
 *
 * ## Shape
 *
 * Not cards. Every other block on this page is an object with a border, and
 * this one is a statement with a list of hairlines under it, so the page has
 * somewhere quiet before the Business Brain arrives. The heading comes in from
 * the left and the questions from the right, one after another — the two halves
 * of the block arriving as two halves, which is the one thing that motion is
 * saying here.
 */

/** The five the questions are written for, in the audit's own order. */
const ASKED: Partial<Record<BusinessLens, string>> = {
  offer: "Does the page say what this is, in words somebody outside your head would use?",
  audience: "Who is it for — and does anything on the site say so?",
  acquisition: "How would somebody who needs this ever find it?",
  conversion: "They arrived. What happened between landing and signing up?",
  measurement: "Is anything recording whether that worked?",
};

export function LandingProblem() {
  const questions = BUSINESS_LENSES.filter((lens) => ASKED[lens]).map((lens) => ({
    lens,
    label: LENS_LABELS[lens],
    question: ASKED[lens] as string,
  }));

  return (
    /*
      No number and no rail. The walk starts at the Product Scan; this block is
      the reason there is a walk, and putting "00" on it would count the
      question as one of the modules.
    */
    <section
      id="gap"
      aria-labelledby="gap-heading"
      className="scroll-mt-24 py-20 sm:py-28 lg:py-32"
    >
      <div className="grid gap-12 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1fr)] lg:gap-20">
        <Reveal from="left">
          <div className="flex flex-col gap-6 lg:sticky lg:top-28">
            <MonoLabel className="text-fg-meta">The gap</MonoLabel>
            <h2
              id="gap-heading"
              className="text-fg text-[clamp(2rem,3.6vw,3rem)] leading-[1.06] font-bold tracking-[-0.045em] text-balance"
            >
              Building got fast. <span className="text-fg-muted">Everything after it did not.</span>
            </h2>
            <p className="text-fg-prose max-w-[46ch] leading-relaxed">
              You can put a working product on the internet in a weekend now. What still takes
              months is finding out why nobody is paying for it — and the answers are not in the
              code you just wrote.
            </p>
          </div>
        </Reveal>

        {/*
          The hairline belongs to the list item and the reveal sits inside it:
          `Reveal` renders a div, and a div is not allowed to be the child of a
          list. Keeping the border out here also means the rules are drawn at
          first paint while the text is still arriving, so the block has its
          full height from the start and nothing below it moves.
        */}
        <ol className="flex flex-col">
          {questions.map(({ lens, label, question }, index) => (
            <li key={lens} className="border-line-2 border-b last:border-b-0">
              {/*
                A stagger inside one block, which is what `Reveal`'s `delay` is
                for. Capped at four steps so the last line of a five-item list
                is not still arriving after the reader got there.
              */}
              <Reveal from="right" delay={Math.min(index, 3) * 0.08}>
                <div className="flex flex-col gap-2 py-6 sm:flex-row sm:items-baseline sm:gap-8">
                  <MonoLabel as="span" className="text-fg-meta shrink-0 sm:w-[10rem]">
                    {label}
                  </MonoLabel>
                  <p className="text-fg-body text-lead leading-relaxed">{question}</p>
                </div>
              </Reveal>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
