import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import { scoreDisplay, type ScoreTone } from "./score-display";

/**
 * A scored row: label, meter, optional confidence, value.
 *
 * The behaviour that matters is in `score-display.ts` — an unscorable row keeps
 * an empty track and says `n/a`, never `0`. Read that file before changing
 * anything here.
 */

const FILL_CLASSES: Record<ScoreTone, string> = {
  strong: "from-mint-dim to-mint bg-gradient-to-r",
  partial: "from-amber-deep to-amber bg-gradient-to-r",
  weak: "bg-coral",
  unscored: "",
};

const VALUE_CLASSES: Record<ScoreTone, string> = {
  strong: "text-mint",
  partial: "text-amber",
  weak: "text-coral",
  unscored: "text-fg-meta",
};

export function ScoreMeter({
  label,
  value,
  max = 100,
  /** Short evidence-confidence word from the domain, e.g. `high` / `none`. */
  confidence,
  unscoredText,
  className,
}: {
  label: ReactNode;
  value: number | null | undefined;
  max?: number;
  confidence?: string | null;
  unscoredText?: string;
  className?: string;
}) {
  const display = scoreDisplay(value, { max, unscoredText });

  return (
    <div
      className={cn(
        // The label sits above the bar rather than in a fixed column beside
        // it. UI-3.5 replaced the dimension names ("Monetization") with the
        // questions they answer ("Can you make money from it?"), and every one
        // of them was being truncated at the old 8rem — 260px of text in a
        // 128px column. A question that cannot be read is worse than the
        // category name it replaced.
        "grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2",
        "sm:grid-cols-[1fr_auto_5rem_2.5rem]",
        className,
      )}
    >
      <span
        className={cn(
          "text-sm font-semibold text-balance",
          display.unscored ? "text-fg-secondary" : "text-fg",
        )}
      >
        {label}
      </span>

      {/* `role="img"` with a label rather than a progressbar: this is a static
          summary of a stored score, not a live-updating progress indicator, and
          the accessible name has to be able to say "not measurable". */}
      <div
        role="img"
        aria-label={`${typeof label === "string" ? label : "Score"}: ${display.text}`}
        className="bg-line-track order-last col-span-2 h-[7px] w-full overflow-hidden rounded-full sm:order-none sm:col-span-4 sm:w-full"
      >
        {!display.unscored && (
          <div
            className={cn("h-full rounded-full", FILL_CLASSES[display.tone])}
            style={{ width: `${display.fillPercent}%` }}
          />
        )}
      </div>

      <span className="text-fg-meta hidden font-mono text-[0.6875rem] sm:block">
        {confidence ?? ""}
      </span>

      <span
        className={cn(
          "text-right font-mono tabular-nums",
          display.unscored ? "text-xs" : "text-[0.9375rem]",
          VALUE_CLASSES[display.tone],
        )}
      >
        {display.text}
      </span>
    </div>
  );
}
