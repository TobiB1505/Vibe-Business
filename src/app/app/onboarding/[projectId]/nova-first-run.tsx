"use client";

import { useState, useTransition } from "react";
import { NovaArriving } from "@/components/nova/nova-arriving";
import { NovaBubble } from "@/components/nova/nova-bubble";
import { NovaMoveButton } from "@/components/nova/nova-move";
import { speechBubbles } from "@/components/nova/nova-speech";
import { NovaLine, NovaRenderBlock } from "@/components/nova/nova-thread";
import { NovaHowItWorks } from "./nova-how-it-works";
import { WORKFLOW_EXAMPLE_ID, buildNovaWorkflowExplanation } from "@/modules/nova/first-run";
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
 * — the mark assembles, travels into the rail, the room is drawn around
 * it — and that happens once, at the introduction. By the time this renders,
 * the header and the rail are on screen and Nova is simply speaking in them.
 * Running the assembly twice would say the environment was built twice.
 *
 * ## Why the walkthrough is local state, and why it no longer writes on open
 *
 * Pressing *Show me how you work* swaps the thread for the walkthrough and
 * writes nothing. The sentences arrive in place rather than replacing the
 * screen — a founder who asked to be shown something should not lose what they
 * were reading — and the press at the *bottom* of it records `explained`.
 *
 * The write used to fire on open, and that was wrong twice over. It recorded
 * somebody as having been shown a thing at the moment they asked to see it;
 * and `setNovaWorkflowStatusAction` revalidates this route, so the position
 * `deriveNovaFirstRun` returns became `handoff` and this component was
 * replaced by the next setup step. Asking to be shown how Vibe works took you
 * straight to the connect-your-repository screen.
 *
 * Now the fact is written where it becomes true, by the person it is about. A
 * founder who closes the tab mid-walkthrough leaves the column `unseen`, and
 * is offered it again — which is what happened.
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
  const messages = shown.filter(
    (entry): entry is Extract<NovaEntry, { kind: "nova.message" }> => entry.kind === "nova.message",
  );

  /*
   * Split at the line that announces the example, and group each half on its
   * own.
   *
   * `speechBubbles` merges a run of same-register lines into one bubble, so
   * grouping the whole walkthrough at once puts the lead and the handover
   * after it into a single bubble — and there is no longer anywhere between
   * them to put the block. Two calls is the honest fix: the split is a real
   * boundary in the thread, not a rendering detail.
   *
   * `lead` is -1 everywhere else, and then `after` is empty and this is one
   * group exactly as it was.
   */
  const lead = messages.findIndex((entry) => entry.id === WORKFLOW_EXAMPLE_ID);
  const before = speechBubbles(lead === -1 ? messages : messages.slice(0, lead + 1));
  const after = lead === -1 ? [] : speechBubbles(messages.slice(lead + 1));

  /*
   * The controls the domain offers at this position, by the labels the catalog
   * holds. A verb written here would be a button that says one thing and
   * records another.
   */
  const options = shown.flatMap((entry) => (entry.kind === "nova.choice" ? entry.options : []));

  function choose(actionId: string) {
    /* Shown, not recorded. The press at the end of it is what records. */
    if (actionId === "nova.explain_workflow") {
      setWalkthrough(buildNovaWorkflowExplanation());
      return;
    }
    if (replay) return;

    startTransition(async () => {
      if (actionId === "nova.continue_introduction") {
        await markNovaIntroducedAction(projectId);
        return;
      }
      if (actionId === "nova.begin_setup") {
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
        items={[
          ...before.map((bubble, position) => ({
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
          })),
          /*
            The example, under the line that announces it. It opens a beat of
            its own, because a thing she *made* is a different kind of arrival
            from a thing she said.
          */
          ...(lead === -1
            ? []
            : [
                {
                  key: "walkthrough:example",
                  beat: true,
                  node: (
                    <NovaRenderBlock label="An example" index={0}>
                      <NovaHowItWorks />
                    </NovaRenderBlock>
                  ),
                },
              ]),
          /* And the handover, which is her speaking again after showing it. */
          ...after.map((bubble) => ({
            key: bubble.key,
            beat: true,
            node: (
              <NovaBubble tail={bubble.tail}>
                {bubble.paragraphs.map((text) => (
                  <NovaLine key={text}>{text}</NovaLine>
                ))}
              </NovaBubble>
            ),
          })),
        ]}
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
