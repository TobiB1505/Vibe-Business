import { StatusDot, statusToneText } from "@/components/ui/status-pill";
import { statusForOperationPhase } from "@/components/system/status-vocabulary";
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
 * The dot pulses only while genuinely working, and only for motion-safe
 * readers — a strip that kept pulsing over a paused run would be the animated
 * form of a status line narrating work nobody is doing.
 */
export function WorkingStrip({ working }: { working: NovaWorkingEntry | null }) {
  // Nothing running is not an empty state — it is the absence of a fact, and
  // the strip simply is not there. An "idle" row would be furniture.
  if (working === null || working.phase === "idle" || working.phase === "settled") return null;

  const status = statusForOperationPhase(working.phase);
  const live = working.phase === "working";

  return (
    <div
      role="status"
      className={cn(
        "border-line-2 bg-surface-2 rounded-panel flex flex-wrap items-center gap-x-3 gap-y-1.5",
        "px-4 py-3",
      )}
    >
      <span className="flex items-center gap-2.5">
        <StatusDot tone={status.tone} className={live ? "motion-safe:animate-pulse" : undefined} />
        <span className={cn("text-ui font-semibold", statusToneText(status.tone))}>
          {status.word}
        </span>
      </span>
      <span className="text-fg-prose min-w-0 text-sm">{working.stageLabel}</span>
      {working.phase === "stalled" && (
        <span className="text-fg-muted text-ui">
          It has been running far longer than it should.
        </span>
      )}
    </div>
  );
}
