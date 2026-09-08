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
  OpeningPanel,
  OpeningStage,
  OpeningStroke,
} from "@/components/nova/nova-opening";
import { atLeast } from "@/components/nova/nova-opening-beats";
import { useOpening } from "@/components/nova/nova-opening";
import { speechBubbles } from "@/components/nova/nova-speech";
import { NovaAside, NovaHappened, NovaLine, NovaThreadHeader } from "@/components/nova/nova-thread";
import { novaPresenceState } from "@/components/system/status-vocabulary";
import { NOVA_ACTION_META } from "@/modules/nova/actions";
import { buildNovaFirstRunFeed } from "@/modules/nova/first-run";
import type { ActivityEntry } from "@/modules/audit-log/view";
import { formatElapsedShort } from "@/lib/utils/format-datetime";
import { MonoLabel } from "@/components/ui/typography";
import { markNovaIntroducedAction } from "@/app/app/onboarding/[projectId]/actions";

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
  /**
   * What has already happened, for the rail she lands in.
   *
   * Usually empty on this screen: a project that has not met Nova has barely a
   * log. Passing it anyway is what lets the rail be a place rather than an
   * outline — and `NovaHappened` draws nothing when there is nothing.
   */
  activity = [],
  /** Replaying for review, so nothing is recorded when it ends. */
  replay = false,
}: {
  projectId: string;
  productName: string;
  connected: boolean;
  activity?: readonly ActivityEntry[];
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

  const settled = atLeast(beat, "settling");
  const online = atLeast(beat, "online");
  const speaking = atLeast(beat, "speaking");

  /* One instant for every relative time in the column, so two rows written a
     minute apart cannot read out of order. */
  const now = new Date();

  return (
    <div className="flex min-h-[70vh] flex-col justify-center gap-6">
      {/*
        Siblings rather than one replacing the other, so the mark's two homes
        are both in the same layout tree and Motion can carry it between them.
        The stage closes as the room opens, which is what lifts the room up the
        page rather than leaving it below an empty screen.
      */}
      <OpeningStage show={!settled}>
        <OpeningMark place="hero" />
      </OpeningStage>

      {settled && (
        <div className="flex flex-col gap-6">
          {atLeast(beat, "header") && (
            <OpeningFade arrive={staged}>
              <NovaThreadHeader
                availability={{ state: "online" }}
                subject={productName}
                connected={connected}
                /* Her line arrives a beat after the row it sits in. */
                availabilityPending={!online}
                mark={<NovaPresence state={mark} size="md" seed={projectId} />}
                now={<NovaClock />}
              />
            </OpeningFade>
          )}

          <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)] lg:items-start">
            {/*
              The corner she lands in, before it is a rail.

              The border is the real one and arrives with the stroke that draws
              it, so there is never a frame with two lines or none. Until the
              stroke runs there is no frame at all — which is the point: she
              lands in an empty corner.
            */}
            <div
              className={`rounded-panel transition-interactive relative flex flex-col items-center gap-4 p-5 max-lg:order-2 ${
                atLeast(beat, "rail_content")
                  ? "border-line-2 bg-surface-1 border"
                  : "border border-transparent"
              }`}
            >
              {atLeast(beat, "rail_drawing") && <OpeningStroke drawn={staged} />}

              <OpeningMark place="rail" />

              {atLeast(beat, "rail_content") && activity.length > 0 && (
                <OpeningFade arrive={staged} className="w-full">
                  <div className="border-line-1 flex flex-col gap-1.5 border-t pt-4">
                    <MonoLabel>Earlier</MonoLabel>
                    <div className="flex flex-col">
                      {activity.map((entry) => (
                        <NovaHappened
                          key={entry.id}
                          title={entry.title}
                          at={formatElapsedShort(entry.at, now)}
                          tone={entry.tone}
                          facts={entry.facts}
                        />
                      ))}
                    </div>
                  </div>
                </OpeningFade>
              )}
            </div>

            {atLeast(beat, "panel") && (
              <OpeningPanel
                show
                arrive={staged}
                className="border-line-2 bg-surface-1 rounded-panel flex min-w-0 flex-col p-5 max-lg:order-1 max-sm:p-4"
              >
                {speaking && (
                  <NovaArriving
                    items={BUBBLES.map((bubble, position) => ({
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
              </OpeningPanel>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
