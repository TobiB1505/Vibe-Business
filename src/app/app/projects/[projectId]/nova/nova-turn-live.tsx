"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useOperationPoll } from "@/lib/client/use-operation-poll";
import { OPERATION_STAGE_LABELS } from "@/modules/operations/view";
import { operationPollPhase, type OperationView } from "@/modules/operations/view";
import { NovaBubble } from "@/components/nova/nova-bubble";
import { NovaAside } from "@/components/nova/nova-thread";
import { NovaThinking } from "@/components/nova/nova-thinking";
import type { OperationStage } from "@/modules/operations/schema";
import { getOperationStatusAction } from "../run-audit-action";

/**
 * What the founder reads while a turn is being answered.
 *
 * ## A stage, never a fraction
 *
 * `OPERATION_STAGE_LABELS` is the product's own sentence for each stage, and
 * the three this operation writes are three things that actually happen. There
 * is no percentage and no step counter, because a turn does not know how many
 * tools it will call before it calls them — a bar would be a number nobody
 * observed, which `DESIGN.md` treats as an invariant rather than a preference.
 *
 * ## Polled, not pushed
 *
 * The same hook and the same Server Action the rest of the product polls with:
 * one read in flight, no polling in a hidden tab, backoff on failure. A push
 * channel would be a second liveness mechanism beside this one, which rule 24
 * makes an ADR rather than a detail of a component.
 *
 * ## It refreshes the page once, when the turn settles
 *
 * The reply is server-rendered from rows, so the last thing this component does
 * is ask for the page again. Once, guarded by a ref: a refresh re-renders this
 * component, and one that re-armed on its own result would be a loop.
 */
const POLL_INTERVAL_MS = 2_500;

export function NovaTurnLive({
  projectId,
  working,
}: {
  projectId: string;
  working: OperationView;
}) {
  const router = useRouter();
  const refreshed = useRef(false);

  const { latest } = useOperationPoll<OperationView>({
    key: working.operationId,
    enabled: working.shouldPoll,
    intervalMs: POLL_INTERVAL_MS,
    poll: async () => {
      const result = await getOperationStatusAction(projectId, working.operationId);
      return result.ok ? { kind: "value", value: result.operation } : { kind: "unavailable" };
    },
    continueAfter: (next) => operationPollPhase(next) === "working",
  });

  const live = latest ?? working;
  const phase = operationPollPhase(live);
  const settled = phase !== "working" && phase !== "stalled";

  useEffect(() => {
    if (!settled || refreshed.current) return;
    refreshed.current = true;
    router.refresh();
  }, [settled, router]);

  /*
   * A turn nothing is carrying any more, and the founder is still looking at
   * their own question.
   *
   * The browser suite found this: with only a `working` branch, a stalled turn
   * rendered *nothing at all* — the question sat in the thread with empty space
   * under it, which is the same blank-turn failure ADR 0109 records as the
   * worst outcome of the seam pilot, arriving through the surface instead of
   * through the loop. The sweep will settle the operation and the reply will
   * appear; until then the thread says so rather than saying nothing.
   */
  if (phase === "stalled") {
    return (
      <NovaBubble tone="waiting" eyebrow="Stopped">
        <NovaAside>
          This one stopped before I could answer it. Nothing about your project changed, and
          asking again usually works.
        </NovaAside>
      </NovaBubble>
    );
  }

  if (settled) {
    // The reply is on its way in from the server. Saying nothing here is
    // better than saying "done" a moment before the words arrive.
    return null;
  }

  /*
   * The stages already passed, as finished steps, with the current one
   * shimmering in the header.
   *
   * Every one of these is a stage the workflow actually wrote to the operation
   * row, so the list is observation rather than a script — a turn that never
   * reached `consulting_evidence` never shows it. The individual tool calls
   * are not here because the poll reads the operation and an operation row
   * does not carry them; they arrive with the reply, when the turn's own trace
   * is read back. A live list that guessed at them would be inventing work.
   */
  const passed = LIVE_STAGES.slice(0, LIVE_STAGES.indexOf(live.stage)).map((stage) => ({
    label: OPERATION_STAGE_LABELS[stage],
    state: "done" as const,
  }));

  return (
    <NovaThinking steps={passed} live liveLabel={OPERATION_STAGE_LABELS[live.stage]} />
  );
}

/**
 * The three stages a turn passes through, in order.
 *
 * Listed here rather than derived, because "which stages come before this one"
 * is a fact about `agentTurnWorkflow`'s shape and nothing in the operations
 * view knows it. A stage outside this list — a turn that never left
 * `preparing` — yields an empty list and a header, which is the honest answer.
 */
const LIVE_STAGES: readonly OperationStage[] = [
  "understanding_request",
  "consulting_evidence",
  "composing_reply",
];
