import { LandingStep } from "@/components/marketing/landing-step";
import { Reveal } from "@/components/marketing/reveal";
import { ChevronDownIcon } from "@/components/ui/icons.generated";
import { MonoLabel } from "@/components/ui/typography";

/**
 * The objections, in the reader's voice (UI-34).
 *
 * ## The ninth shape: the reader's words are the surface
 *
 * Two tiles, a staircase, a narrowing, a passage, a thread, a ladder, a
 * boundary, a price table — and this one is a **list of questions in somebody
 * else's voice**, each opening onto an answer.
 *
 * A first version set the doubts in display type with the answers permanently
 * under them, on the argument that a page which has spent eight blocks
 * explaining itself should let the objection be the loudest thing on screen.
 * The founder asked for an FAQ, and an FAQ is the better form of the same
 * argument: five sentences a reader can scan for *theirs*, and only that one
 * has to be opened. Nothing is hidden — every answer is in the document and in
 * the page's text — it is ordered behind the question it answers.
 *
 * ## Why `<details>` and not a client component
 *
 * The same reason `Disclosure` gives: it is keyboard operable, exposes
 * `aria-expanded` to assistive technology, survives with JavaScript disabled,
 * and needs no hydration. A hand-rolled accordion would be a client component
 * on a server-rendered page, reproducing behaviour the platform already has —
 * and one more place to get the ARIA wrong. `Disclosure` itself is not reused
 * here because its trigger is a ghost pill sized to its label; an FAQ row is
 * the full width of the list, and the whole row is the control.
 *
 * ## The rule the copy is held to
 *
 * Every answer names something the product does, not something it aspires to
 * — and the first one admits Vibe is wrong sometimes, which is the sentence a
 * marketing rewrite deletes first and the reason the rest is believable.
 *
 * The quotes are objections, not testimonials. Nobody is credited with them,
 * because nobody said them: they are the doubts this product actually meets,
 * written plainly. A page that put a name and a face beside a sentence
 * somebody did not say would be the fabricated record `DESIGN.md` forbids, and
 * the same rule that keeps invented metrics off this page keeps invented
 * people off it.
 */

const OBJECTIONS: { doubt: string; answer: string }[] = [
  {
    doubt: "It is going to be wrong about my business.",
    answer:
      "Sometimes it will. What it will not do is hide which part was a reading, which was a judgement, and which was never looked at — and an area it cannot assess stays unscored rather than scored zero. Every sentence opens onto the evidence under it, so you can disagree with something specific.",
  },
  {
    doubt: "I am not letting an AI near the repository I ship from.",
    answer:
      "It never goes near it. Work happens on a branch of its own, inside a machine of its own that holds no credential of yours. Your default branch moves only when you approve one exact commit — by fast-forward to that commit, or not at all.",
  },
  {
    doubt: "My product is too early for any of this.",
    answer:
      "Then the Product Scan costs nothing, and it will tell you what Vibe can already see in what you built. Where there is not enough to judge something, it says so instead of producing a number.",
  },
  {
    doubt: "I do not want another dashboard to check.",
    answer:
      "You do not get one. Your project opens on the one thing that needs you next, in a sentence. On a day when nothing does, it says nothing needs you — which is the part a product with a dashboard to fill can never say.",
  },
  {
    doubt: "Setting this up will eat an afternoon.",
    answer:
      "Connect a GitHub repository. That is the setup; everything after it is Vibe reading your product, and you watch it happen rather than filling in a form about it.",
  },
];

export function LandingObjections() {
  return (
    <LandingStep
      index="09"
      id="objections"
      labelledBy="objections-heading"
      className="py-20 sm:py-28"
    >
      <Reveal from="up">
        <div className="flex flex-col gap-5">
          <MonoLabel className="text-mint">Objections</MonoLabel>
          <h2
            id="objections-heading"
            className="text-fg max-w-[20ch] text-[clamp(2rem,3.6vw,3rem)] leading-[1.06] font-bold tracking-[-0.045em] text-balance"
          >
            What you are actually thinking.
          </h2>
          <p className="text-fg-prose max-w-[58ch] leading-relaxed">
            Nobody hands over the repository their company runs on because a page said to. So here
            are the objections worth having, and what the product does about each one.
          </p>
        </div>
      </Reveal>

      {/*
        One row per question, and the row is the control. A hairline between
        them rather than a card around each: these are five turns of one
        conversation, not five features.
      */}
      <ol className="mx-auto mt-14 flex w-full max-w-3xl flex-col sm:mt-16">
        {OBJECTIONS.map(({ doubt, answer }, index) => (
          <li key={doubt} className="border-line-2 border-b last:border-b-0">
            <Reveal from="up" delay={Math.min(index, 3) * 0.05}>
              <details className="group">
                <summary
                  className={[
                    "rounded-inline flex w-full cursor-pointer list-none items-center justify-between gap-6 py-6",
                    "focus-visible:ring-mint focus-visible:ring-2 focus-visible:outline-none",
                    // Safari and Chrome each add their own marker; the chevron
                    // below is the only one this list draws.
                    "[&::-webkit-details-marker]:hidden",
                  ].join(" ")}
                >
                  <span
                    data-objection
                    className="text-fg text-lead font-semibold tracking-[-0.01em] text-balance"
                  >
                    &ldquo;{doubt}&rdquo;
                  </span>
                  <ChevronDownIcon
                    size={16}
                    className="text-fg-muted shrink-0 transition-transform duration-150 group-open:rotate-180"
                  />
                </summary>
                <p data-answer className="text-fg-body max-w-[62ch] pb-6 leading-relaxed">
                  {answer}
                </p>
              </details>
            </Reveal>
          </li>
        ))}
      </ol>
    </LandingStep>
  );
}
