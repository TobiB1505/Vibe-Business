"use client";

import { useState, useTransition } from "react";
import { NovaArriving } from "@/components/nova/nova-arriving";
import { NovaBubble } from "@/components/nova/nova-bubble";
import { NovaMoveButton } from "@/components/nova/nova-move";
import { speechBubbles } from "@/components/nova/nova-speech";
import { NovaLine } from "@/components/nova/nova-thread";
import { buildNovaWorkflowExplanation } from "@/modules/nova/first-run";
import type { NovaEntry } from "@/modules/nova/feed";
import { markNovaIntroducedAction, setNovaWorkflowStatusAction } from "./actions";

/**
 * The one thing Nova asks before setup starts.
 *
 * ## Where this sits
 *
 * After the introduction and before `connect_source`. She has said who she is;
 * this offers to walk through how a change actually gets from an idea to a
 * default branch — which is what somebody wants *before* handing over a
 * repository, not after. `deriveNovaFirstRun` used to gate both behind the
 * connect step and no longer does; its docblock carries that argument.
 *
 * ## Why it is not the opening screen
 *
 * Because the room is already built. `NovaOpeningScreen` runs the choreography
 * — the mark assembles, travels into the status row, the panel closes around
 * it — and that happens once, at the introduction. By the time this renders,
 * the header and the rail are on screen and Nova is simply speaking in them.
 * Running the assembly twice would say the environment was built twice.
 *
 * ## Why the walkthrough is local state
 *
 * Pressing "Show me how this works" writes `explained` and shows four
 * sentences. The write is durable and immediate; the sentences are the same
 * four the domain holds, and they arrive in the thread rather than replacing
 * the screen — a founder who asked to be shown something should not lose what
 * they were reading.
 *
 * The write still happens once, and a founder who closes the tab mid-sentence
 * leaves a column saying `explained`, which is true: they were shown it.
 */
export function NovaFirstRun({
  projectId,
  entries,
  /**
   * Drawn for review, so pressing records nothing.
   *
   * The same affordance `NovaOpeningScreen` carries, for the same reason: this
   * screen is reachable exactly once per project and only by a founder who has
   * just met Nova, so the lab is the only place it can be looked at — and a
   * fixture that fired a server action without a session would redirect the
   * reviewer to sign-in mid-screenshot.
   */
  replay = false,
}: {
  projectId: string;
  entries: NovaEntry[];
  replay?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [walkthrough, setWalkthrough] = useState<NovaEntry[] | null>(null);

  const shown = walkthrough ?? entries;
  const bubbles = speechBubbles(
    shown.filter(
      (entry): entry is Extract<NovaEntry, { kind: "nova.message" }> =>
        entry.kind === "nova.message",
    ),
  );

  /*
   * The controls the domain offers at this position, by the labels the catalog
   * holds. A verb written here would be a button that says one thing and
   * records another.
   */
  const options = shown.flatMap((entry) => (entry.kind === "nova.choice" ? entry.options : []));

  function choose(actionId: string) {
    if (actionId === "nova.explain_workflow") setWalkthrough(buildNovaWorkflowExplanation());
    if (replay) return;

    startTransition(async () => {
      if (actionId === "nova.continue_introduction") {
        await markNovaIntroducedAction(projectId);
        return;
      }
      if (actionId === "nova.explain_workflow") {
        await setNovaWorkflowStatusAction(projectId, "explained");
        return;
      }
      if (actionId === "nova.skip_workflow") {
        await setNovaWorkflowStatusAction(projectId, "skipped");
      }
    });
  }

  return (
    <section className="flex max-w-[44rem] flex-col gap-2.5" aria-label="Before we start">
      <NovaArriving
        items={bubbles.map((bubble, position) => ({
          key: bubble.key,
          /* One beat for the turn, not one per line. She is explaining one
             thing, not sending four separate messages. */
          beat: position === 0,
          node: (
            <NovaBubble tail={bubble.tail}>
              {bubble.paragraphs.map((text) => (
                <NovaLine key={text}>{text}</NovaLine>
              ))}
            </NovaBubble>
          ),
        }))}
      >
        {options.length > 0 && (
          <div className="flex max-w-[24rem] flex-col gap-2.5 pt-1">
            {options.map((option) => (
              <NovaMoveButton
                key={option.actionId}
                label={option.label}
                busy={pending}
                disabled={pending}
                onClick={() => choose(option.actionId)}
              />
            ))}
          </div>
        )}
      </NovaArriving>
    </section>
  );
}
