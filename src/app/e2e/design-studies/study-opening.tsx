"use client";

import { buildNovaFirstRunFeed, buildNovaWorkflowExplanation } from "@/modules/nova/first-run";
import { NOVA_ACTION_META } from "@/modules/nova/actions";
import type { NovaEntry } from "@/modules/nova/feed";
import { NovaArriving as Arriving } from "@/components/nova/nova-arriving";
import { Bubble, Context, Header, Line, Move, Moves } from "./elements";
import { NovaClock as Clock } from "@/components/nova/nova-clock";
import {
  OpeningMark,
  OpeningColumn,
  OpeningStage,
  useOpening,
} from "@/components/nova/nova-opening";
import { NovaPresence } from "@/components/nova/nova-presence";
import { atLeast } from "@/components/nova/nova-opening-beats";
import { speechBubbles } from "@/components/nova/nova-speech";
import type { Study } from "./studies";

/**
 * The opening: the first time a founder ever meets Nova.
 *
 * ## Why every word here comes from the domain
 *
 * `buildNovaFirstRunFeed("introduce")` already holds what Nova says the first
 * time, and `buildNovaWorkflowExplanation()` holds the four sentences behind
 * "Show me how this works". Both are in `modules/nova/first-run.ts`, both are
 * held to the rules every other sentence of hers is held to — no promise, no
 * figure, nothing called safe or live — and both shipped before this study
 * existed.
 *
 * So the study writes no copy. It is a *sequence* over sentences that are
 * already written, which is the only way the opening and the onboarding can
 * stay the same product: change the introduction and this changes with it.
 *
 * ## What the sequence is
 *
 * The mark assembles, alone and at full size. It travels into the status row
 * it will occupy for the rest of the founder's life with the product, and the
 * panel closes around it as it arrives. Her availability line lights — it is
 * *blank* until then, never "Connecting…", because nothing is connecting and
 * a false state animated into a true one is the line the motion rules draw.
 * Then she speaks, through the same `Arriving` the thread uses everywhere
 * else.
 *
 * The shipped screen has moved past this study in one respect worth writing
 * down rather than quietly diverging on: it lands the mark in the *rail* and
 * carries no panel at all, because the onboarding thread it hands over to has
 * none. This file keeps the panel it was drawn with — a study is a record of
 * what was compared, and `NovaOpeningScreen` is what ships.
 *
 * Under `prefers-reduced-motion` none of it happens: `useOpening` returns the
 * last beat on the first frame, and the finished screen is what renders.
 *
 * ## Where this is going
 *
 * Two places, and that is the argument for building it once. It is the first
 * screen of onboarding, and it is the landing page's demonstration of what the
 * product is — the same choreography, because they are the same claim.
 */

const INTRODUCE = buildNovaFirstRunFeed("introduce");

function messagesOf(entries: NovaEntry[]) {
  return entries.filter(
    (entry): entry is Extract<NovaEntry, { kind: "nova.message" }> => entry.kind === "nova.message",
  );
}

export function StudyOpening({ study }: { study: Study }) {
  const { beat, staged } = useOpening();
  const panel =
    study.skin === "glass"
      ? "study-glass rounded-panel"
      : "rounded-panel border border-line-2 bg-surface-1";

  const bubbles = speechBubbles(messagesOf(INTRODUCE));
  const speaking = atLeast(beat, "speaking");

  return (
    /*
      Centred for the whole sequence, so the panel arrives where the mark was
      rather than somewhere below it. A screen that put the assembly at the top
      of a tall empty page made the mark look like a favicon.
    */
    <div className="mx-auto flex min-h-[80vh] w-full max-w-2xl flex-col justify-center gap-6 px-6 py-10 max-sm:px-4">
      {/*
        Siblings rather than one replacing the other, so the mark's two homes
        are both inside the same layout tree and Motion can carry it between
        them. The stage closes as the panel opens, which is what lifts the
        panel up the page rather than leaving it below an empty screen.
      */}
      <OpeningStage show={!atLeast(beat, "settling")}>
        <OpeningMark place="hero" />
      </OpeningStage>

      <OpeningColumn
        show={atLeast(beat, "settling")}
        arrive={staged}
        className={`flex flex-col ${panel}`}
      >
        <Header
          availability={{ state: "online" }}
          subject="Vibe Business"
          connected={false}
          availabilityPending={!atLeast(beat, "online")}
          mark={atLeast(beat, "header") ? <NovaPresence state="idle" size="md" /> : null}
          now={<Clock />}
        />

        <div className="flex flex-col gap-2.5 p-5 max-sm:p-4">
          {speaking && (
            <Arriving
              items={bubbles.map((bubble, position) => ({
                key: bubble.key,
                /* One beat for the turn, not one per line — she is introducing
                   herself, not sending four separate messages. */
                beat: position === 0,
                node: (
                  <Bubble aside={bubble.aside} tail={bubble.tail}>
                    {bubble.paragraphs.map((text) =>
                      bubble.aside ? (
                        <Context key={text}>{text}</Context>
                      ) : (
                        <Line key={text}>{text}</Line>
                      ),
                    )}
                  </Bubble>
                ),
              }))}
            >
              {/*
                The control the domain already offers at this position, by its
                catalogued label. A second verb written here would be a button
                that says one thing and records another.
              */}
              <div className="flex max-w-[22rem] flex-col gap-2.5 pt-2">
                <Move label={NOVA_ACTION_META["nova.continue_introduction"].label} />
              </div>
            </Arriving>
          )}
        </div>
      </OpeningColumn>
    </div>
  );
}

/**
 * The second turn, held beside the first rather than after it.
 *
 * The opening ends on "Continue", and what follows is the offer to be walked
 * through the loop — a real position (`explain_workflow`), with two controls
 * and its own four sentences. It is drawn here so the two turns can be read
 * together: the introduction is a claim about what Nova is, and this is the
 * only thing she asks before the product starts.
 */
export function StudyOpeningWalkthrough({ study }: { study: Study }) {
  const panel =
    study.skin === "glass"
      ? "study-glass rounded-panel"
      : "rounded-panel border border-line-2 bg-surface-1";

  const offer = speechBubbles(messagesOf(buildNovaFirstRunFeed("explain_workflow")));
  const steps = speechBubbles(messagesOf(buildNovaWorkflowExplanation()));

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-6 py-10 max-sm:px-4">
      <section className="flex flex-col gap-3">
        <p className="text-label font-mono tracking-[0.16em] text-fg-meta uppercase">
          The one thing she asks first
        </p>
        <div className={`flex flex-col gap-2.5 p-5 max-sm:p-4 ${panel}`}>
          {offer.map((bubble) => (
            <Bubble key={bubble.key} aside={bubble.aside} tail={bubble.tail}>
              {bubble.paragraphs.map((text) => (
                <Line key={text}>{text}</Line>
              ))}
            </Bubble>
          ))}
          <Moves
            moves={(["nova.explain_workflow", "nova.skip_workflow"] as const).map((actionId) => ({
              label: NOVA_ACTION_META[actionId].label,
            }))}
          />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <p className="text-label font-mono tracking-[0.16em] text-fg-meta uppercase">
          And what it shows
        </p>
        <div className={`flex flex-col gap-2.5 p-5 max-sm:p-4 ${panel}`}>
          {steps.map((bubble) => (
            <Bubble key={bubble.key} aside={bubble.aside} tail={bubble.tail}>
              {bubble.paragraphs.map((text) =>
                bubble.aside ? (
                  <Context key={text}>{text}</Context>
                ) : (
                  <Line key={text}>{text}</Line>
                ),
              )}
            </Bubble>
          ))}
        </div>
      </section>
    </div>
  );
}
