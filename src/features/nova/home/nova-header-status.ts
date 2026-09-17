import { statusForOperationPhase } from "@/components/system/status-vocabulary";
import type { NovaWorkingEntry } from "@/modules/nova/home-view";
import type { StatusTone } from "@/components/ui/status-pill";

/**
 * What the line under her name says.
 *
 * A live *stage* is only honest while the run is live. Every other phase has a
 * word of its own in the status vocabulary, and a settled one has none worth
 * saying — the route is about to re-read, and the moment's own word is what it
 * will say.
 */
export function novaHeaderStatus(
  live: NovaWorkingEntry | null,
  resting: { word: string; tone: StatusTone },
): { word: string; tone: StatusTone } {
  if (live === null) return resting;

  switch (live.phase) {
    case "working":
      return { word: live.stageLabel, tone: "active" };
    /* Settled and idle are the same answer: nothing is running, so the moment
       is the thing to describe. */
    case "settled":
    case "idle":
      return resting;
    default: {
      const status = statusForOperationPhase(live.phase);
      return { word: status.word, tone: status.tone };
    }
  }
}
