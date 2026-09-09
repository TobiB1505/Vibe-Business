import { NovaBubble } from "@/components/nova/nova-bubble";
import { NovaLine } from "@/components/nova/nova-thread";
import { LandingStep } from "@/components/marketing/landing-step";
import { NovaEntrance } from "@/components/marketing/nova-entrance";
import { Reveal } from "@/components/marketing/reveal";
import { statusForCandidate } from "@/components/system/status-vocabulary";
import { MonoLabel } from "@/components/ui/typography";
import { novaCandidateMessage } from "@/modules/nova/feed";
import type { FocusCandidateKind } from "@/modules/nova/focus";

/**
 * Nova, met as a thread (UI-34).
 *
 * ## The fifth shape
 *
 * Two tiles, a staircase, a narrowing, a passage — and now a **thread**,
 * because this block is the one that is not about mechanism. The four before
 * it explain what Vibe does; this one is who says it, and a conversation is
 * the only shape on the page that reads as somebody talking rather than as a
 * diagram of something.
 *
 * ## Every word here is hers, and none of it was written on this page
 *
 * `novaCandidateMessage` is the product's accessor over the one table where
 * Nova's sentences live, and it is deliberately built so a caller gets one
 * sentence for one candidate and cannot iterate, reorder or add to it. So the
 * page chooses *which* five moments to show and the product supplies every
 * word of all five — which means a change to her voice changes this page, and
 * a sentence invented for marketing is not expressible here.
 *
 * The register each bubble carries comes from `statusForCandidate` for the
 * same reason: the tone, the dashed contour of an open loop and the status
 * word are the product's reading of what kind of moment this is, not a choice
 * about what looks good beside a paragraph.
 *
 * ## Why these five, in this order
 *
 * The order is the page's — a narrative rather than a ranking, and
 * `deriveNovaFocus` is the only thing that ranks anything. It runs from *your
 * turn* to *nothing needs you*, and three of the five are sentences most
 * products would never put on a marketing page: a check that did not pass, a
 * reading that has gone stale, and an empty day admitted as an empty day.
 * They are the argument. A co-founder who only ever reports good news is one
 * you cannot use to make a decision.
 *
 * ## No key beside her
 *
 * An earlier version of this block ended with the four states of the mark and
 * a sentence each — resting, listening, working, settled. It is good material
 * and it is the wrong page for it: a legend explains a notation to somebody who
 * is already reading one, and a visitor who has never seen Nova has no notation
 * in front of them yet. It also made the block end on a reference table rather
 * than on the sentence it exists for, which is *Nothing needs you right now*.
 *
 * ## The mark
 *
 * The same component the founder will see every day, at the same geometry.
 * The Nova a visitor meets and the Nova they sign in to are one thing, because
 * it is one component — and her introduction is held until this block is
 * actually reached, which is what `NovaEntrance` exists for.
 */

/** Five moments, and what each one shows about how she works. */
const MOMENTS: { kind: FocusCandidateKind; note: string }[] = [
  {
    kind: "review_change",
    note: "Your turn. Nova will not press it for you.",
  },
  {
    kind: "agent_question",
    note: "She stops rather than guessing — and nothing is spent while she waits for you.",
  },
  {
    kind: "validation_failed",
    note: "Bad news arrives in the same voice as good news, and never dressed as a success.",
  },
  {
    kind: "repository_read_outdated",
    note: "She says when what she is showing you rests on a reading that has gone stale.",
  },
  {
    kind: "nothing_to_do",
    note: "And when there is nothing, she says so. A product that always has something for you is a product inventing work.",
  },
];

export function LandingNova() {
  return (
    <LandingStep index="05" id="nova" labelledBy="nova-heading" className="py-20 sm:py-28">
      <div data-testid="landing-nova" className="flex flex-col">
        <Reveal from="up">
          <div className="flex flex-col gap-5">
            <MonoLabel className="text-mint">Nova</MonoLabel>
            <h2
              id="nova-heading"
              className="text-fg max-w-[20ch] text-[clamp(2rem,3.6vw,3rem)] leading-[1.06] font-bold tracking-[-0.045em] text-balance"
            >
              Your co-founder has a name.
            </h2>
            <p className="text-fg-prose max-w-[58ch] leading-relaxed">
              Nova is what your project opens on: not a wall of numbers, but the one thing that
              needs you now, said in a sentence. Below are five things she actually says — and three
              of them are the kind most products would never put on a marketing page.
            </p>
          </div>
        </Reveal>

        <div className="mt-14 grid gap-10 sm:mt-16 lg:grid-cols-[10rem_minmax(0,1fr)] lg:gap-14">
          {/*
            The speaker, beside what she says and staying there while it is
            read. She is one object on this page rather than one per bubble:
            an avatar repeated down a thread is a chat interface, and this is
            an introduction.
          */}
          <Reveal from="left" className="lg:sticky lg:top-28 lg:self-start">
            <div className="flex flex-col items-center gap-4 lg:items-start">
              <NovaEntrance />
              <div className="flex flex-col gap-1 text-center lg:text-left">
                <span className="text-fg text-title font-semibold">Nova</span>
                <span className="text-fg-muted text-caption leading-relaxed">
                  An aperture around a light curve — her job is to look at what you built and
                  measure what happened.
                </span>
              </div>
            </div>
          </Reveal>

          {/*
            The thread. An `ol` because these are five moments in an order, and
            the note beside each is the page speaking about the sentence rather
            than Nova saying more — which is why it sits outside the bubble.
            Nothing executable goes in one, on this page or in the product.
          */}
          <ol className="flex flex-col gap-8">
            {MOMENTS.map(({ kind, note }, index) => {
              const status = statusForCandidate(kind);

              return (
                <li key={kind}>
                  <Reveal from="up" delay={Math.min(index, 3) * 0.06}>
                    {/*
                      The note sits in a gutter sized to the bubble rather than
                      to the page. Given the whole remaining width, the thread
                      column stretched to the measure and left the annotations
                      three to four hundred pixels away from the sentences they
                      annotate — a margin note that has to be searched for is a
                      second column, not a note. 23rem is the widest bubble
                      measured at 1440, so the gutter starts where the longest
                      sentence ends.
                    */}
                    <div className="flex flex-col gap-3 lg:grid lg:grid-cols-[minmax(0,23rem)_minmax(0,14rem)] lg:items-start lg:gap-8">
                      <NovaBubble
                        tone={status.tone}
                        open={status.open}
                        eyebrow={status.word}
                        index={index}
                      >
                        <NovaLine>{novaCandidateMessage(kind)}</NovaLine>
                      </NovaBubble>
                      <p className="text-fg-muted text-caption leading-relaxed lg:pt-1">{note}</p>
                    </div>
                  </Reveal>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </LandingStep>
  );
}
