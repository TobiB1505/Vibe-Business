"use client";

import { useTransition } from "react";
import { NovaArriving } from "@/components/nova/nova-arriving";
import { NovaBubble } from "@/components/nova/nova-bubble";
import { NovaClock } from "@/components/nova/nova-clock";
import { NovaMoveButton } from "@/components/nova/nova-move";
import {
  OpeningMark,
  OpeningPanel,
  OpeningStage,
  useOpening,
} from "@/components/nova/nova-opening";
import { atLeast } from "@/components/nova/nova-opening-beats";
import { speechBubbles } from "@/components/nova/nova-speech";
import { NovaAside, NovaLine, NovaThreadHeader } from "@/components/nova/nova-thread";
import { NOVA_ACTION_META } from "@/modules/nova/actions";
import { buildNovaFirstRunFeed } from "@/modules/nova/first-run";
import { markNovaIntroducedAction } from "@/app/app/onboarding/[projectId]/actions";

/**
 * The first time a founder opens this project.
 *
 * ## What it is
 *
 * The opening, in the product rather than in the lab. The mark assembles alone
 * at full size, travels into the row it occupies from then on while the panel
 * closes around it, and only then does Nova speak. `/e2e/study-opening` draws
 * the same components — there is one choreography, not a demo and a build.
 *
 * "The same components" was a claim rather than a fact for a while. This
 * screen wrote its own `<header>` with a hardcoded "Online" beside a mark,
 * mapped every sentence to a bubble of its own, and put all of them on screen
 * at once. Three divergences from the study it was supposed to be, each small
 * and each the kind that makes a lab stop being an answer to anything.
 *
 * ## The three that were fixed
 *
 * **The header.** `NovaThreadHeader` is the one Home mounts, and its
 * `connecting` prop exists for exactly this screen — the only place in the
 * product where the answer is genuinely not known yet, and where coral
 * "Disconnected" for that second would alarm a founder about nothing. A second
 * header meant that prop had a docblock about a screen that did not use it.
 *
 * **The grouping.** `speechBubbles` decides when a run of sentences is several
 * bubbles and when it is one. The introduction is four paragraphs, so it is
 * one bubble with line breaks — the way a long message actually arrives —
 * rather than four heavy blocks stacked with gutters claiming to be four
 * separate utterances.
 *
 * **The arrival.** `NovaArriving` stages them, with the composing beat before
 * the turn. This is the one screen in the product where staging is
 * unambiguously right: the messages are genuinely arriving, for the first and
 * only time, and there is nothing on screen for a founder to have already
 * read. Under `prefers-reduced-motion` none of it happens and the complete
 * thread is what renders — which is also what the server emits.
 *
 * ## Where the words come from
 *
 * `buildNovaFirstRunFeed("introduce")`, which is the same table the onboarding
 * route renders and is held to the rules every sentence of hers is held to: no
 * promise, no figure, nothing called safe or live. Nothing is written here.
 *
 * ## Why it can only happen once
 *
 * `nova_introduced_at`. Home reads it, this writes it through the action the
 * catalog already binds to `nova.continue_introduction`, and a founder who has
 * met Nova never meets her again. The column is the onboarding row's, which is
 * the right place for it: it records a fact about a person's first contact
 * with a project, not a state the project is in.
 */
const INTRODUCE = buildNovaFirstRunFeed("introduce");

const BUBBLES = speechBubbles(
  INTRODUCE.filter(
    (entry): entry is Extract<typeof entry, { kind: "nova.message" }> =>
      entry.kind === "nova.message",
  ),
);

export function NovaOpeningScreen({
  projectId,
  productName,
  /** Whether the repository behind the product is reachable. */
  connected,
  /** Replaying for review, so nothing is recorded when it ends. */
  replay = false,
}: {
  projectId: string;
  productName: string;
  connected: boolean;
  replay?: boolean;
}) {
  const { beat, staged } = useOpening();
  const [pending, startTransition] = useTransition();
  const speaking = atLeast(beat, "speaking");

  return (
    <div className="flex min-h-[70vh] flex-col justify-center gap-6">
      {/*
        Siblings rather than one replacing the other, so the mark's two homes
        are both in the same layout tree and Motion can carry it between them.
        The stage closes as the panel opens, which is what lifts the panel up
        the page rather than leaving it below an empty screen.
      */}
      <OpeningStage show={!atLeast(beat, "settling")}>
        <OpeningMark place="hero" />
      </OpeningStage>

      <OpeningPanel
        show={atLeast(beat, "settling")}
        arrive={staged}
        className="border-line-2 bg-surface-1 rounded-panel flex flex-col"
      >
        <NovaThreadHeader
          availability={{ state: "online" }}
          subject={productName}
          connected={connected}
          connecting={!speaking}
          /*
            Null until the mark has somewhere to land. `OpeningMark` carries a
            `layoutId`, and exactly one element with an id may be mounted at a
            time — the header's copy appears in the same commit the stage's
            unmounts, which is what makes it travel rather than duplicate.
          */
          mark={atLeast(beat, "settling") ? <OpeningMark place="header" /> : null}
          now={<NovaClock />}
        />

        <div className="flex flex-col gap-2.5 p-5 max-sm:p-4">
          {speaking && (
            <NovaArriving
              items={BUBBLES.map((bubble, position) => ({
                key: bubble.key,
                /* One beat for the turn, not one per line — she is introducing
                   herself, not sending four separate messages. */
                beat: position === 0,
                node: (
                  <NovaBubble aside={bubble.aside} tail={bubble.tail}>
                    {bubble.paragraphs.map((text) =>
                      bubble.aside ? (
                        <NovaAside key={text}>{text}</NovaAside>
                      ) : (
                        <NovaLine key={text}>{text}</NovaLine>
                      ),
                    )}
                  </NovaBubble>
                ),
              }))}
            >
              {/*
                Outside the bubble, as every control is, and after the last
                word — `NovaArriving` holds it until the thread settles, the
                way a person finishes speaking before asking.
              */}
              <div className="flex max-w-[22rem] flex-col gap-2.5 pt-2">
                <NovaMoveButton
                  label={NOVA_ACTION_META["nova.continue_introduction"].label}
                  busy={pending}
                  disabled={pending}
                  onClick={() => {
                    if (replay) return;
                    startTransition(async () => {
                      await markNovaIntroducedAction(projectId);
                    });
                  }}
                />
                {replay && (
                  <p className="text-fg-meta text-caption">
                    Replaying the opening. Nothing is recorded, and reloading without{" "}
                    <code>?opening</code> returns to your project.
                  </p>
                )}
              </div>
            </NovaArriving>
          )}
        </div>
      </OpeningPanel>
    </div>
  );
}
