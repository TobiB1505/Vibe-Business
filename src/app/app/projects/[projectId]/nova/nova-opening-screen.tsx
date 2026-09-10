"use client";

import { useTransition } from "react";
import { NovaArriving } from "@/components/nova/nova-arriving";
import { NovaBubble } from "@/components/nova/nova-bubble";
import { NovaClock } from "@/components/nova/nova-clock";
import { NovaMoveButton } from "@/components/nova/nova-move";
import { NovaPresence } from "@/components/nova/nova-presence";
import {
  OpeningFade,
  OpeningMark,
  OpeningColumn,
  OpeningStage,
  OpeningStroke,
} from "@/components/nova/nova-opening";
import { atLeast } from "@/components/nova/nova-opening-beats";
import { useOpening } from "@/components/nova/nova-opening";
import { speechBubbles } from "@/components/nova/nova-speech";
import { NovaAside, NovaLine, NovaThreadHeader } from "@/components/nova/nova-thread";
import { NovaRail } from "./nova-rail";
import { NOVA_THREAD_SURFACE, NovaRoom } from "@/components/nova/nova-room";
import { novaPresenceState } from "@/components/system/status-vocabulary";
import { NOVA_ACTION_META } from "@/modules/nova/actions";
import { buildNovaFirstRunFeed } from "@/modules/nova/first-run";
import type { ActivityEntry } from "@/modules/audit-log/view";
import type { OnboardingStep } from "@/modules/onboarding/state";
import {
  introduceWithNameAction,
  markNovaIntroducedAction,
} from "@/app/app/onboarding/[projectId]/actions";
import { Field, Input } from "@/components/ui/field";
import { MAX_FOUNDER_NAME_LENGTH } from "@/modules/auth/founder-name";

/**
 * The first time a founder opens this project, and the room being built.
 *
 * ## What the sequence is, and why it is not decoration
 *
 * The mark assembles alone at full size. It travels to a corner — an empty
 * one — and the rail's frame is *drawn* around it. What has already happened
 * arrives inside, forward out of nothing. The status row fades in above,
 * carrying her name before it carries her presence. The panel rises under it.
 * Her line lights, she composes, and she speaks.
 *
 * Every beat is a thing appearing that was not there, in the order it comes to
 * exist. That is the claim: Nova is not being introduced *over* an environment,
 * she is assembling the one the rest of setup happens in — which is why this
 * comes before the first setup step, and why the room it builds has to be the
 * room that is still there on the next render.
 *
 * ## The two states, and the one that is never animated
 *
 * **Hers.** The status row arrives before her availability line does, and the
 * line arrives blank — no dot, no word — until the beat that lights it. That
 * is the whole of "she comes online": a true sentence appearing where there
 * was nothing, rather than a false one resolving into a true one.
 *
 * This is the correction to what this screen did first. It animated the
 * *project* from "Connecting…" to "Disconnected" on the same beat, through a
 * `connecting` prop written for the second before a repository read returns.
 * There is no such second here — `connected` is read on the server and arrives
 * with the first frame — so the pulse was a connection attempt that never
 * happened. Motion may never say something the product has not observed, and
 * that is the form the rule takes when it is broken: not a lie in a sentence,
 * a lie in a transition.
 *
 * **The project's.** During setup it has no repository, so "Disconnected" is
 * true from the moment the row exists and it is written that way — a fact
 * rather than a placeholder, and one that becomes "Connected" on its own the
 * moment a repository is.
 *
 * ## Under `prefers-reduced-motion`
 *
 * None of it happens. `useOpening` returns the last beat on the first frame
 * and every element renders in its finished state — which is also what the
 * server emits, so the markup a reader without JavaScript keeps is the whole
 * room rather than an empty stage.
 */
/**
 * Her opening turn, built per render because the first sentence has a name in
 * it. A module-level constant would have greeted every founder as the first
 * one this process happened to serve.
 */
function introductionBubbles(name: string | null, askForName: boolean) {
  return speechBubbles(
    buildNovaFirstRunFeed("introduce", name, askForName).filter(
      (entry): entry is Extract<typeof entry, { kind: "nova.message" }> =>
        entry.kind === "nova.message",
    ),
  );
}

export function NovaOpeningScreen({
  projectId,
  productName,
  /** Whether the repository behind the product is reachable. */
  connected,
  /**
   * What to call the founder, or null.
   *
   * The GitHub login they authenticated with, passed down rather than looked
   * up — `identity-view.ts`'s rule is that a name is never invented, and null
   * is an ordinary answer here rather than a missing one.
   */
  greetingName = null,
  /**
   * Whether Nova still has to ask what to call this founder.
   *
   * True exactly when `founder_profiles` holds no row for them. Separate from
   * `greetingName`, because a founder with a GitHub login and no chosen name
   * is greeted by the login *and* asked — a login is a name somebody picked
   * for a code host, not what they are called.
   */
  askForName = false,
  /**
   * What has already happened, for the rail she lands in.
   *
   * Usually empty on this screen: a project that has not met Nova has barely a
   * log. Passing it anyway is what lets the rail be a place rather than an
   * outline — and `NovaHappened` draws nothing when there is nothing.
   */
  activity = [],
  /**
   * Setup's four steps, when this screen is setup's first one.
   *
   * The onboarding route passes them; the project route does not, because a
   * project reaching that path has finished setup and a list of it would be
   * four filled squares about something already behind them.
   */
  setup,
  /** Replaying for review, so nothing is recorded when it ends. */
  replay = false,
}: {
  projectId: string;
  productName: string;
  connected: boolean;
  greetingName?: string | null;
  askForName?: boolean;
  activity?: readonly ActivityEntry[];
  setup?: readonly OnboardingStep[];
  replay?: boolean;
}) {
  const { beat, staged } = useOpening();
  const [pending, startTransition] = useTransition();

  /*
   * Derived, not typed. Nothing is running while she introduces herself — no
   * project, no operation, no ranking — and `novaPresenceState` is the only
   * function allowed to turn that into a state. A literal here would be the
   * one element on the screen that can look like activity asserting its own.
   */
  const mark = novaPresenceState({ tier: "setup", phase: "idle" });

  const bubbles = introductionBubbles(greetingName, askForName);

  const settled = atLeast(beat, "settling");
  const online = atLeast(beat, "online");
  const speaking = atLeast(beat, "speaking");

  return (
    <div className="flex flex-col gap-6">
      {/*
        Siblings rather than one replacing the other, so the mark's two homes
        are both in the same layout tree and Motion can carry it between them.
        The stage closes as the room opens, which is what lifts the room up the
        page rather than leaving it below an empty screen.
      */}
      <OpeningStage show={!settled} height={440}>
        <OpeningMark place="hero" />
      </OpeningStage>

      {settled && (
        <NovaRoom
          /* The floor rides on the column that flies in, not on the wrapper
             that is already there — see `NOVA_THREAD_SURFACE`. */
          surface={false}
          header={
            atLeast(beat, "header") && (
              <OpeningFade arrive={staged}>
                <NovaThreadHeader
                  availability={{ state: "online" }}
                  subject={productName}
                  connected={connected}
                  /* Her line arrives a beat after the row it sits in. */
                  availabilityPending={!online}
                  mark={<NovaPresence state={mark} seed={projectId} />}
                  now={<NovaClock />}
                />
              </OpeningFade>
            )
          }
          rail={
            /*
             * The corner she lands in — and it is the shipped rail, not a
             * drawing of one. The choreography owns three things about it and
             * nothing else: which mark is in it, whether its border is drawn
             * yet, and when its contents arrive.
             */
            <div className="relative">
              {atLeast(beat, "rail_drawing") && <OpeningStroke drawn={staged} />}

              <NovaRail
                presence={mark}
                seed={projectId}
                working={null}
                /*
                 * No to-do list during setup. There is no plan yet, and a
                 * column headed "To do" over nothing is a promise about work
                 * nobody has decided on.
                 */
                checklist={null}
                activity={atLeast(beat, "rail_content") ? activity : []}
                setup={atLeast(beat, "rail_content") ? setup : undefined}
                mark={<OpeningMark place="rail" />}
                /* The stroke is the frame until it finishes drawing it. */
                frame={atLeast(beat, "rail_content")}
                contents={(node) => (
                  <OpeningFade arrive={staged} className="w-full">
                    {node}
                  </OpeningFade>
                )}
              />
            </div>
          }
        >
          {atLeast(beat, "panel") && (
            <OpeningColumn show arrive={staged} className={NOVA_THREAD_SURFACE}>
              {/*
                  The column the next render draws, to the class — the same
                  `section` at the same width, with the same gap, holding the
                  same `NovaArriving`. `NovaFirstRun` is what replaces this the
                  moment she stops speaking, and a founder pressing Continue
                  should see the thread stay exactly where it was rather than
                  a second thread of a different size take its place.

                  So there is no panel around it. The onboarding thread has no
                  box, and a box here would be the one piece of this room that
                  does not survive the handover.
                */}
              <section className="flex max-w-[44rem] flex-col gap-2.5" aria-label="Meeting Nova">
                {speaking && (
                  <NovaArriving
                    items={bubbles.map((bubble, position) => ({
                      key: bubble.key,
                      /* One beat for the turn, not one per line — she is
                         introducing herself, not sending four messages. */
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
                      Outside the bubble, as every control is, and after the
                      last word — `NovaArriving` holds it until the thread
                      settles, the way a person finishes speaking before asking.
                    */}
                    <div className="flex max-w-[24rem] flex-col gap-2.5 pt-1">
                      {askForName ? (
                        /*
                          A form, so Enter submits it — the key a person
                          actually presses after typing their name into a
                          conversation. The control keeps its label: answering
                          the question and getting on with setup are one press,
                          and a separate "Save" would make the name a form to
                          fill in rather than a thing she asked.

                          Leaving it empty is a supported answer and submits
                          the same way. `normalizeFounderName` reads an empty
                          box as null, the row is deleted rather than written
                          blank, and Nova keeps the greeting she already has
                          for a founder she cannot name.
                        */
                        <form
                          className="flex flex-col gap-2.5"
                          onSubmit={(event) => {
                            event.preventDefault();
                            if (replay) return;
                            const typed = new FormData(event.currentTarget).get("displayName");
                            startTransition(async () => {
                              await introduceWithNameAction(
                                projectId,
                                typeof typed === "string" ? typed : null,
                              );
                            });
                          }}
                        >
                          <Field id="nova-founder-name" label="What Nova calls you">
                            <Input
                              id="nova-founder-name"
                              name="displayName"
                              maxLength={MAX_FOUNDER_NAME_LENGTH}
                              autoComplete="given-name"
                              placeholder="Your first name"
                              disabled={pending}
                            />
                          </Field>
                          <NovaMoveButton
                            type="submit"
                            label={NOVA_ACTION_META["nova.continue_introduction"].label}
                            busy={pending}
                            disabled={pending}
                          />
                        </form>
                      ) : (
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
                      )}
                      {replay && (
                        <p className="text-fg-meta text-caption">
                          Replaying the opening. Nothing is recorded, and reloading without{" "}
                          <code>?opening</code> returns to your project.
                        </p>
                      )}
                    </div>
                  </NovaArriving>
                )}
              </section>
            </OpeningColumn>
          )}
        </NovaRoom>
      )}
    </div>
  );
}
