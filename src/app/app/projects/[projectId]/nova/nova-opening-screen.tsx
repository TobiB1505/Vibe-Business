"use client";

import { useTransition } from "react";
import { NovaBubble } from "@/components/nova/nova-bubble";
import {
  OpeningMark,
  OpeningPanel,
  OpeningStage,
  useOpening,
} from "@/components/nova/nova-opening";
import { atLeast } from "@/components/nova/nova-opening-beats";
import { Button } from "@/components/ui/button";
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

const LINES = INTRODUCE.filter(
  (entry): entry is Extract<typeof entry, { kind: "nova.message" }> =>
    entry.kind === "nova.message",
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
        <header className="border-line-1 flex items-center gap-3.5 border-b px-4 py-3">
          {atLeast(beat, "settling") ? <OpeningMark place="header" /> : null}
          <div className="min-w-0 flex-1">
            <p className="text-fg text-ui truncate font-semibold">Nova</p>
            <p className="text-fg-meta text-caption flex items-center gap-1.5 truncate">
              <span aria-hidden className="bg-mint size-1.5 shrink-0 rounded-full" />
              Online
            </p>
          </div>
          <div className="flex min-w-0 shrink-0 items-center gap-2.5 max-sm:hidden">
            <span className="text-fg-secondary text-caption truncate">{productName}</span>
            <span aria-hidden className="bg-line-3 h-3 w-px shrink-0" />
            {/*
              The one screen where a connection is genuinely unknown rather
              than false. Coral "Disconnected" for that second would alarm a
              founder about nothing.
            */}
            <span className="text-fg-meta text-caption flex shrink-0 items-center gap-1.5">
              <span
                aria-hidden
                className={`size-1.5 shrink-0 rounded-full ${
                  !speaking ? "bg-fg-muted" : connected ? "bg-mint" : "bg-coral"
                }`}
              />
              {!speaking ? "Connecting…" : connected ? "Connected" : "Disconnected"}
            </span>
          </div>
        </header>

        <div className="flex flex-col gap-2.5 p-5 max-sm:p-4">
          {speaking && (
            <>
              {LINES.map((line, index) => (
                <NovaBubble key={line.id} tail={index === 0} index={index}>
                  <p className="text-fg-body text-sm leading-relaxed">{line.text}</p>
                </NovaBubble>
              ))}

              {/*
                Outside the bubble, as every control is. A bubble shows that
                Nova is saying something; a control is something the founder
                does, and one object cannot be both.
              */}
              <div className="flex max-w-[22rem] flex-col gap-2.5 pt-2">
                <Button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    if (replay) return;
                    startTransition(async () => {
                      await markNovaIntroducedAction(projectId);
                    });
                  }}
                >
                  {NOVA_ACTION_META["nova.continue_introduction"].label}
                </Button>
                {replay && (
                  <p className="text-fg-meta text-caption">
                    Replaying the opening. Nothing is recorded, and reloading without{" "}
                    <code>?opening</code> returns to your project.
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      </OpeningPanel>
    </div>
  );
}
