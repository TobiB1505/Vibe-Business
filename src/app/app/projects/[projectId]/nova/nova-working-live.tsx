"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { useOperationPoll } from "@/lib/client/use-operation-poll";
import { getOperationStatusAction } from "../run-audit-action";
import { novaWorkingEntry } from "@/modules/nova/home-view";
import type { NovaWorkingEntry } from "@/modules/nova/home-view";
import { operationPollPhase, type OperationView } from "@/modules/operations/view";
import type { NovaPresenceState } from "@/components/nova/nova-presence";
import { WorkingStrip } from "./working-strip";

/**
 * The working strip, kept current (audit finding 2).
 *
 * ## The defect this closes
 *
 * `NovaWorkingEntry` has carried `shouldPoll` since the slice shipped, and
 * nothing on Home ever read it. Seventeen sibling panels in this same route
 * tree poll; the one screen whose whole question is *what is happening right
 * now* did not. A founder pressed a control on the Focus Card, watched the
 * strip appear, and then watched it say the same stage until they reloaded the
 * page by hand.
 *
 * ## Why the poll ends in a refresh rather than in a state update
 *
 * Because the strip is not the only thing that changes when a run ends. The
 * run finishing is exactly what makes the *ranking* stale — the change that
 * was building is now waiting for review, the audit that was running now has a
 * score — and `deriveNovaFocus` is the only thing allowed to decide that.
 * Patching the strip in place would leave a settled operation sitting beneath
 * a Focus Card describing the world before it.
 *
 * So the two readings do different jobs: while the run is live the polled
 * stage keeps the strip honest without touching the server render, and the
 * moment the phase leaves `working` the whole route re-reads.
 * `getOperationStatusAction` already revalidates on a terminal status, so the
 * refresh lands on fresh data rather than racing it.
 *
 * ## Why it is a wrapper and not a rewrite
 *
 * `WorkingStrip` stays a pure presentation component with the same props. The
 * client boundary is this file, at the leaf, so Home's tree stays a server
 * render — the rule `ui-design-system` states and a page-level `"use client"`
 * would quietly break.
 */
export function NovaWorkingLive({
  projectId,
  working,
  presence,
  seed,
}: {
  projectId: string;
  /** The server render's reading. Null when nothing is running. */
  working: NovaWorkingEntry | null;
  presence: NovaPresenceState;
  seed: string;
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

  const polled = novaWorkingEntry(latest ?? null);
  const settled = polled !== null && polled.phase !== "working";

  useEffect(() => {
    // Once. `router.refresh()` re-renders this component, and a refresh that
    // re-armed itself on its own result would be a loop rather than a reading.
    if (!settled || refreshed.current) return;
    refreshed.current = true;
    router.refresh();
  }, [settled, router]);

  /*
   * The server render wins until a poll has actually answered. It is the
   * newer reading of the two at first paint, and preferring the polled value
   * before one exists would blank the strip for one frame on every mount.
   */
  return <WorkingStrip working={polled ?? working} presence={presence} seed={seed} />;
}

/**
 * Matched to the other panels in this route rather than chosen fresh. Nothing
 * about Home's operations finishes faster than anyone else's.
 */
const POLL_INTERVAL_MS = 2_500;
