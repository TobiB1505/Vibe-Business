import { LandingStep } from "@/components/marketing/landing-step";
import { Reveal } from "@/components/marketing/reveal";
import { MonoLabel } from "@/components/ui/typography";

/**
 * The objections, in the reader's voice (UI-34).
 *
 * ## The ninth shape, which is an inversion
 *
 * Two tiles, a staircase, a narrowing, a passage, a thread, a ladder, a
 * boundary, a price table — and every one of them puts Vibe's claim in the
 * large type and the qualification in the small type. This block does the
 * opposite: the **doubt** is the loud thing and the answer is quiet under it.
 *
 * That inversion is the whole design. A page that has spent eight blocks
 * explaining itself has to prove it can hear the objection before it asks for
 * anything, and the way to prove that is to let the objection be the biggest
 * text on the screen and not soften it on the way in.
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
        The doubt is the large type and the answer is the small type, which is
        the reverse of every other block on this page. A hairline between items
        rather than a card around each: these are five turns of one
        conversation, not five features.
      */}
      <ol className="mx-auto mt-14 flex w-full max-w-3xl flex-col sm:mt-16">
        {OBJECTIONS.map(({ doubt, answer }, index) => (
          <li key={doubt} className="border-line-2 border-b py-8 last:border-b-0 last:pb-0">
            <Reveal from="up" delay={Math.min(index, 3) * 0.05}>
              <div className="flex flex-col gap-4">
                <p
                  data-objection
                  className="text-fg-secondary max-w-[26ch] text-[clamp(1.35rem,2.2vw,1.75rem)] leading-[1.2] font-semibold tracking-[-0.02em] text-balance"
                >
                  &ldquo;{doubt}&rdquo;
                </p>
                <p data-answer className="text-fg-body max-w-[62ch] leading-relaxed">
                  {answer}
                </p>
              </div>
            </Reveal>
          </li>
        ))}
      </ol>
    </LandingStep>
  );
}
