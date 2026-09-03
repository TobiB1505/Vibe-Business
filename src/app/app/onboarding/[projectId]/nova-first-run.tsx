"use client";

import { useState, useTransition } from "react";
import { NovaFeed } from "@/components/nova/nova-feed";
import { buildNovaWorkflowExplanation } from "@/modules/nova/first-run";
import type { NovaChoiceOption, NovaEntry } from "@/modules/nova/feed";
import { markNovaIntroducedAction, setNovaWorkflowStatusAction } from "./actions";

/**
 * Nova's first two screens, and the three presses that leave them.
 *
 * ## Why the walkthrough is client state
 *
 * "Show me how this works" has to show something before the page moves on. The
 * write it makes lands the founder in `handoff`, so by the next render there is
 * no position left that would render the explanation — it is what the founder
 * is looking at *now*, not a state the project is in. Deriving it would have
 * meant a third status value for a screen that exists for as long as somebody
 * is reading it.
 *
 * The write still happens, immediately and once. If they close the tab
 * mid-sentence the column says `explained`, which is true: they were shown it.
 *
 * ## Why the actions are called here rather than by the feed
 *
 * `NovaFeed` renders entries and knows nothing about arguments. These three
 * controls take a project id and, for two of them, which answer was given —
 * so this is the component that has both, and the feed stays a renderer.
 */
export function NovaFirstRun({ projectId, entries }: { projectId: string; entries: NovaEntry[] }) {
  const [pending, startTransition] = useTransition();
  const [walkthrough, setWalkthrough] = useState<NovaEntry[] | null>(null);

  function select(option: NovaChoiceOption) {
    if (option.actionId === "nova.explain_workflow") setWalkthrough(buildNovaWorkflowExplanation());

    startTransition(async () => {
      if (option.actionId === "nova.continue_introduction") {
        await markNovaIntroducedAction(projectId);
        return;
      }
      if (option.actionId === "nova.explain_workflow") {
        await setNovaWorkflowStatusAction(projectId, "explained");
        return;
      }
      if (option.actionId === "nova.skip_workflow") {
        await setNovaWorkflowStatusAction(projectId, "skipped");
      }
    });
  }

  return (
    <section className="flex max-w-[44rem] flex-col gap-6 py-8">
      <NovaFeed
        entries={walkthrough ?? entries}
        pending={pending}
        onSelect={select}
        /*
         * None of the first run's controls is an address, so this is never
         * called. It throws rather than returning "#", because a dead link a
         * founder can click is worse than an error a developer can read.
         */
        hrefFor={(option) => {
          throw new Error(`Nova's first run has no address for ${option.actionId}`);
        }}
      />
    </section>
  );
}
