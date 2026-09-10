"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import { useOperationPoll } from "@/lib/client/use-operation-poll";
import { getOperationStatusAction } from "../run-audit-action";
import { novaWorkingEntry } from "@/modules/nova/home-view";
import type { NovaWorkingEntry } from "@/modules/nova/home-view";
import { operationPollPhase, type OperationView } from "@/modules/operations/view";
import { NovaThreadHeader } from "@/components/nova/nova-thread";
import { NovaPresence } from "@/components/nova/nova-presence";
import { novaPresenceState } from "@/components/system/status-vocabulary";
import type { NovaFocusTier } from "@/modules/nova/focus";
import type { StatusTone } from "@/components/ui/status-pill";

/**
 * The status row, kept current.
 *
 * ## What this replaced, and why the polling had to move rather than go
 *
 * A working strip below the thread: a panel that appeared while a run was
 * live, said which stage it was at, and disappeared when it settled. Home has
 * one column now and the strip was the second thing in it — a box saying what
 * Nova was doing, under Nova saying it.
 *
 * So the stage moved into the line under her name, where a chat puts it. But
 * `NovaWorkingEntry` carries `shouldPoll` for a reason: without a poll the
 * line says the same stage until somebody reloads by hand, which is the exact
 * defect the strip was built to close. The polling therefore moved with the
 * sentence rather than going with the panel.
 *
 * ## Why the poll ends in a refresh rather than in a state update
 *
 * Because the stage is not the only thing that changes when a run ends. The
 * run finishing is exactly what makes the *ranking* stale — the change that
 * was building is now waiting for review, the audit that was running now has a
 * score — and `deriveNovaFocus` is the only thing allowed to decide that.
 * Patching the line in place would leave a settled operation described by a
 * header sitting above a thread describing the world before it.
 *
 * So the two readings do different jobs: while the run is live the polled
 * stage keeps the header honest without touching the server render, and the
 * moment the phase leaves `working` the whole route re-reads.
 * `getOperationStatusAction` already revalidates on a terminal status, so the
 * refresh lands on fresh data rather than racing it.
 *
 * ## Why the client boundary is here
 *
 * At the leaf, so Home's tree stays a server render. `NovaThreadHeader` has no
 * hooks of its own, which is what lets a client wrapper mount the same header
 * the opening screen mounts directly.
 */
export function NovaHeaderLive({
  projectId,
  /** The server render's reading. Null when nothing is running. */
  working,
  /** What the line says when nothing is running: the moment's own word. */
  resting,
  /**
   * The leading moment's tier, for the mark.
   *
   * Passed rather than a finished mark, and that is the fix it exists for: a
   * mark built on the server reads the phase of the *server* render, so the
   * word under it — which comes from the poll — could say a run had finished
   * while the frame was still turning. Both halves read the same phase now.
   */
  tier,
  /** The project, so one product always draws the same mark. */
  seed,
  subject,
  connected,
  now,
}: {
  projectId: string;
  working: NovaWorkingEntry | null;
  resting: { word: string; tone: StatusTone };
  tier: NovaFocusTier;
  seed: string;
  subject: string;
  connected: boolean;
  now?: ReactNode;
}) {
  const router = useRouter();
  const refreshed = useRef(false);

  const { latest } = useOperationPoll<OperationView>({
    key: working?.operationId ?? null,
    // `shouldPoll` is the operations view's own answer to "ask again?", and it
    // is already false for a stalled run — a run presumed lost is not worth
    // pressing the database about every two seconds.
    enabled: working !== null && working.shouldPoll,
    intervalMs: POLL_INTERVAL_MS,
    poll: async () => {
      const operationId = working?.operationId;
      if (!operationId) return { kind: "unavailable" };

      const result = await getOperationStatusAction(projectId, operationId);
      return result.ok ? { kind: "value", value: result.operation } : { kind: "unavailable" };
    },
    continueAfter: (next) => operationPollPhase(next) === "working",
  });

  /*
   * The type comes from the server's reading, not from the poll: the poll
   * returns the operation row, and a row does not say which kind of run it is.
   * `working` is the same operation — the poll is keyed by its id — so reusing
   * its type is a fact rather than an assumption.
   */
  const polled = latest && working ? novaWorkingEntry({ type: working.type, view: latest }) : null;
  const settled = polled !== null && polled.phase !== "working";

  useEffect(() => {
    // Once. `router.refresh()` re-renders this component, and a refresh that
    // re-armed itself on its own result would be a loop rather than a reading.
    if (!settled || refreshed.current) return;
    refreshed.current = true;
    router.refresh();
  }, [settled, router]);

  /*
   * The server render wins until a poll has actually answered. It is the newer
   * reading of the two at first paint, and preferring the polled value before
   * one exists would blank the line for one frame on every mount.
   */
  const live = polled ?? working;

  return (
    <NovaThreadHeader
      availability={{ state: "online" }}
      /*
       * A running stage is what she is doing; anything else is what the moment
       * is. Both come from tables the domain owns — `OPERATION_STAGE_LABELS`
       * and `statusForCandidate` — so neither is a sentence written here.
       */
      status={live ? { word: live.stageLabel, tone: "active" } : resting}
      subject={subject}
      connected={connected}
      /*
       * Derived here from the same reading the word uses. `novaPresenceState`
       * is still the only function that decides which state the mark stands
       * in — this passes it a live phase instead of a stale one.
       */
      mark={
        <NovaPresence
          state={novaPresenceState({ tier, phase: live?.phase ?? "idle" })}
          seed={seed}
        />
      }
      now={now}
    />
  );
}

/**
 * Matched to the other panels in this route rather than chosen fresh. Nothing
 * about Home's operations finishes faster than anyone else's.
 */
const POLL_INTERVAL_MS = 2_500;
