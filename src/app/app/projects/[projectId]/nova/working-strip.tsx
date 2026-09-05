import { statusToneText } from "@/components/ui/status-pill";
import { statusForOperationPhase } from "@/components/system/status-vocabulary";
import { NovaPresence, type NovaPresenceState } from "@/components/nova/nova-presence";
import { cn } from "@/lib/utils/cn";
import type { NovaWorkingEntry } from "@/modules/nova/home-view";

/**
 * What Vibe is doing right now (UI Sourcing Spec C3).
 *
 * ## One line, and three states it must keep apart
 *
 * **Working** — Vibe is doing something. **Waiting for you** — Vibe is blocked
 * on the founder, which is not activity and must never be drawn as it. And
 * **Stalled** — the run has been going far longer than the work can take, so
 * it is presumed lost. All three come from `operationPollPhase`, which decided
 * them; this strip renders the word the shared vocabulary gives and nothing
 * else.
 *
 * ## Why there is no bar
 *
 * There is no honest fraction behind a durable operation. The stage name is
 * the progress: "Reading your repository" says more than 40% ever could, and
 * it is a fact the executor actually wrote rather than a number invented to
 * fill a track.
 *
 * Nova's mark turns only while genuinely working — a strip that kept moving
 * over a paused run would be the animated form of a status line narrating work
 * nobody is doing.
 */
export function WorkingStrip({
  working,
  presence,
  seed,
}: {
  working: NovaWorkingEntry | null;
  /** Derived by `novaPresenceState`, never chosen here. */
  presence: NovaPresenceState;
  seed: string;
}) {
  // Nothing running is not an empty state — it is the absence of a fact, and
  // the strip simply is not there. An "idle" row would be furniture.
  if (working === null || working.phase === "idle" || working.phase === "settled") return null;

  const status = statusForOperationPhase(working.phase);

  /*
   * Both tables were written to the person being waited on, so both say
   * "Waiting for you" — and the strip read "Waiting for you · Waiting for
   * you". Neither table is wrong on its own; what is wrong is printing the
   * same sentence twice, so the stage yields to the status word it duplicates.
   */
  const stage = working.stageLabel === status.word ? null : working.stageLabel;

  return (
    <div
      role="status"
      className={cn(
        "border-line-2 bg-surface-2 rounded-panel flex flex-wrap items-center gap-x-3 gap-y-1.5",
        "px-4 py-3",
      )}
    >
      {/*
        The mark rather than a dot. It says the same thing more precisely —
        the frame turns only while an operation is genuinely running, and
        stands still and open while the work is with the founder — and it is
        the same instrument the Focus Card carries, at a size that cannot
        compete with it. The word beside it still carries the state, so
        nothing here depends on the mark being seen.
      */}
      <span className="flex items-center gap-2.5">
        <NovaPresence state={presence} seed={seed} size="sm" />
        <span className={cn("text-ui font-semibold", statusToneText(status.tone))}>
          {status.word}
        </span>
      </span>
      {stage && <span className="text-fg-prose min-w-0 text-sm">{stage}</span>}
      {working.phase === "stalled" && (
        <span className="text-fg-muted text-ui">
          It has been running far longer than it should.
        </span>
      )}
    </div>
  );
}
