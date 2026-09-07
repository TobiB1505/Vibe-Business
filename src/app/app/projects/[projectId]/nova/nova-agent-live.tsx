"use client";

import { useState } from "react";
import { useOperationPoll } from "@/lib/client/use-operation-poll";
import { AgentWorking } from "@/components/nova/blocks/agent";
import { NovaDissolving } from "@/components/nova/nova-dissolving";
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
 * ## The stages above the list, and why they are only ever this tab's
 *
 * `stage` is a column the executor overwrites, and nothing writes down what it
 * held before. So the sequence `NovaDissolving` shows is not a record being
 * replayed — it is what this component watched happen, and a founder who
 * arrives mid-run sees one line rather than an invented history. That is the
 * distinction the block is built around: the stages dissolve because they were
 * never written down, and the file list under them does not because it was.
 *
 * The label costs nothing extra. The action has to read the operation anyway
 * to know whether the run is still going, and the stage is on the same row.
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
  /**
   * What the run was doing when the page rendered.
   *
   * One line, not a history: the server has no more than this, because the
   * column it comes from is overwritten. Everything above it is what this
   * component watches happen.
   */
  initialStage,
  /** The operations view's own answer to "ask again?". Never chosen here. */
  shouldPoll,
}: {
  projectId: string;
  operationId: string;
  initialEvents: readonly StoredExecutionEvent[];
  initialStage: string;
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

  /*
   * Newest first, and appended only when the label actually changes — a poll
   * that answered the same stage four times would otherwise stack four copies
   * of one line, and `NovaDissolving` keys on the label.
   */
  const [stages, setStages] = useState<{ key: string; seen: string[] }>({
    key: operationId,
    seen: [initialStage],
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

      setStages((previous) => {
        const seen = previous.key === operationId ? previous.seen : [initialStage];
        if (seen[0] === result.activity.stage)
          return previous.key === operationId ? previous : { key: operationId, seen };
        return { key: operationId, seen: [result.activity.stage, ...seen] };
      });

      return { kind: "value", value: result.activity.done };
    },
    /* The run's own answer, which arrives before the header's refresh does. */
    continueAfter: (done) => !done,
  });

  const live = shouldPoll && latest !== true;
  const seen = stages.key === operationId ? stages.seen : [initialStage];

  return (
    <div className="flex flex-col gap-5">
      {/*
        The two kinds of record, in the order the block argues for: what she is
        doing, which is a snapshot, above what the run wrote, which is not.
        The stages stop dissolving when the run stops — a settled run has a
        last stage, not a current one.
      */}
      <NovaDissolving stages={live ? seen : seen.slice(0, 1)} />
      <AgentWorking events={events} live={live} />
    </div>
  );
}

/** The header's cadence, so one screen asks at one rhythm. */
const POLL_INTERVAL_MS = 2_500;
