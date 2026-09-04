"use client";

import { MonoLabel } from "@/components/ui/typography";
import { Surface } from "@/components/ui/surface";
import type { NovaChoiceOption, NovaEntry } from "@/modules/nova/feed";
import { OPERATION_STAGE_LABELS } from "@/modules/operations/view";
import { NovaChoice } from "./nova-choice";
import { NovaMessage } from "./nova-message";

/**
 * Nova, on screen: the entries in the order `buildNovaFeed` put them.
 *
 * ## What it is not
 *
 * Not a chat. There is no input, no history and nothing to scroll back
 * through — the feed is a render of the project's current state, discarded and
 * rebuilt on every read. `audit_events` is the product's record of what
 * happened and stays where it is; a transcript here would be a second one with
 * no update policy.
 *
 * ## The question entry
 *
 * Rendered as its own labelled block rather than by this component, because
 * answering is owned by `FounderInputCard` — the card that already knows the
 * recommendation, the alternatives and the bounded free-text field, and that
 * already writes through the right action. Nova states the question and hands
 * over; the card is mounted by the surface that has the request in hand.
 */
export function NovaFeed({
  entries,
  onSelect,
  hrefFor,
  pending = false,
  renderQuestion,
}: {
  entries: NovaEntry[];
  onSelect: (option: NovaChoiceOption) => void;
  hrefFor: (option: NovaChoiceOption) => string;
  pending?: boolean;
  /** The existing founder-input card, supplied by whoever has the request. */
  renderQuestion?: (
    entry: Extract<NovaEntry, { kind: "nova.founder_question" }>,
  ) => React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-5" data-testid="nova-feed">
      {entries.map((entry) => {
        switch (entry.kind) {
          case "nova.message":
            return <NovaMessage key={entry.id} entry={entry} />;

          case "nova.choice":
            return (
              <NovaChoice
                key={entry.id}
                entry={entry}
                onSelect={onSelect}
                hrefFor={hrefFor}
                pending={pending}
              />
            );

          case "nova.founder_question":
            return (
              <Surface
                key={entry.id}
                level="panel"
                tone="amber"
                padding="lg"
                className="flex flex-col gap-4"
                data-testid="nova-question"
              >
                <p className="text-fg text-ui-lg font-medium">{entry.question}</p>
                {renderQuestion?.(entry)}
              </Surface>
            );

          case "nova.progress":
            /*
             * A named stage and no percentage, as everywhere else in the
             * product — a bar implies a rate nothing here can know. A
             * `needs_user` operation is not rendered here at all: it is
             * waiting, and waiting is not working, so it reaches the feed as a
             * question instead.
             */
            return (
              <Surface
                key={entry.id}
                level="panel"
                padding="lg"
                className="flex items-center gap-3"
                data-testid="nova-progress"
              >
                <span
                  aria-hidden="true"
                  className="border-fg-meta size-3 shrink-0 rounded-full border-[1.5px] border-t-transparent motion-safe:animate-spin"
                />
                <MonoLabel>{OPERATION_STAGE_LABELS[entry.operation.stage]}</MonoLabel>
              </Surface>
            );
        }
      })}
    </div>
  );
}
