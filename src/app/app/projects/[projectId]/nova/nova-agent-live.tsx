"use client";

import { useState } from "react";
import { useOperationPoll } from "@/lib/client/use-operation-poll";
import { AgentWorking } from "@/components/nova/blocks/agent";
import type { StoredExecutionEvent } from "@/modules/coding-agent/observability/events";
import { getNovaAgentEventsAction } from "./nova-agent-events-action";

/**
 * The agent block, kept current.
 *
 * ## Why this needed a poll of its own
 *
 * The Product Scan block composes a component that already polls, so mounting
 * it in the thread made it live for free. `AgentFileActivity` does not: the
 * Agent route re-renders it from a workspace read, and dropping it into Home
 * unchanged would have drawn the file list from the server render and then
 * held it still — with the pulse on, because `live` is a prop. A picture
 * labelled live is worse than no block.
 *
 * ## What it does not own
 *
 * Deciding that the run has ended. `NovaHeaderLive` polls the operation and
 * refreshes the route the moment its phase leaves `working`, because the run
 * finishing is what makes the *ranking* stale — the change that was building
 * is now waiting for review. Two components refreshing on the same fact would
 * be two answers to a question that has one.
 *
 * So this stops its timer and leaves the last events on screen. The refresh
 * arrives from the header and brings the settled world with it.
 *
 * ## Why the events accumulate here rather than being re-read
 *
 * `listExecutionEvents` takes the sequence already seen, so each poll returns
 * only what is new — the property that keeps a 2.5-second timer from fetching
 * four hundred rows to find one. The server render is the prefix and the polls
 * are the tail; a refresh grows the prefix, and the filter below drops the
 * overlap rather than showing an event twice.
 */
export function NovaAgentLive({
  projectId,
  operationId,
  /** The server render's reading: everything written before this page loaded. */
  initialEvents,
  /** The operations view's own answer to "ask again?". Never chosen here. */
  shouldPoll,
}: {
  projectId: string;
  operationId: string;
  initialEvents: readonly StoredExecutionEvent[];
  shouldPoll: boolean;
}) {
  /*
   * Stored with the run it came from and read back only when they still agree
   * — the same derivation `useOperationPoll` uses for its own reading, and for
   * the same reason: a new run must never inherit the previous one's events,
   * not even for the one render before an effect could have cleared them.
   */
  const [polled, setPolled] = useState<{ key: string; events: StoredExecutionEvent[] }>({
    key: operationId,
    events: [],
  });

  const floor = initialEvents.at(-1)?.sequence ?? 0;
  const tail =
    polled.key === operationId ? polled.events.filter((event) => event.sequence > floor) : [];
  const events = [...initialEvents, ...tail];
  const after = events.at(-1)?.sequence ?? 0;

  const { latest } = useOperationPoll<boolean>({
    key: operationId,
    enabled: shouldPoll,
    intervalMs: POLL_INTERVAL_MS,
    poll: async () => {
      const result = await getNovaAgentEventsAction(projectId, operationId, after);
      if (!result.ok) return { kind: "unavailable" };

      if (result.activity.events.length > 0) {
        setPolled((previous) => ({
          key: operationId,
          events:
            previous.key === operationId
              ? [...previous.events, ...result.activity.events]
              : result.activity.events,
        }));
      }

      return { kind: "value", value: result.activity.done };
    },
    /* The run's own answer, which arrives before the header's refresh does. */
    continueAfter: (done) => !done,
  });

  return <AgentWorking events={events} live={shouldPoll && latest !== true} />;
}

/** The header's cadence, so one screen asks at one rhythm. */
const POLL_INTERVAL_MS = 2_500;
