import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import { MonoLabel } from "./typography";

/**
 * A labelled value: mono caption above, value below.
 *
 * `mono` decides which typeface the value takes, and that is a semantic
 * choice rather than a stylistic one — a timestamp, a SHA, a branch name or a
 * count is machine output and belongs in JetBrains Mono; a sentence about the
 * state ("Needs business context") is prose and does not.
 *
 * An absent value renders an em dash. It never renders as an empty slot,
 * because an empty slot reads as a rendering failure, and it never invents a
 * placeholder number.
 */
export function Metric({
  label,
  value,
  mono = false,
  className,
}: {
  label: ReactNode;
  value: ReactNode | null | undefined;
  mono?: boolean;
  className?: string;
}) {
  const missing = value === null || value === undefined || value === "";

  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <MonoLabel className="tracking-[0.14em]">{label}</MonoLabel>
      <span
        className={cn(
          "truncate text-sm",
          mono && "font-mono text-ui",
          missing ? "text-fg-muted" : "text-fg-body",
        )}
      >
        {missing ? "—" : value}
      </span>
    </div>
  );
}
