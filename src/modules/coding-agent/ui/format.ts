/**
 * Turning measurements into something readable, in one place.
 *
 * Separated from the components because every one of these has an "unknown"
 * case and every one of them must render it the same way. A dash is not a zero:
 * a sandbox cost that was never reported and a sandbox cost of nothing look
 * identical if each component invents its own fallback, and the whole point of
 * the economics panel is that a reader can tell them apart.
 */

/** The one placeholder for a value that does not exist. Never "0", never "—". */
export const UNKNOWN = "not reported";

export function formatDuration(ms: number | null | undefined): string | null {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return null;

  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (minutes < 60) return `${minutes}m ${String(remainder).padStart(2, "0")}s`;

  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

export function formatTokens(value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  if (value < 1000) return String(value);
  if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}k`;
  return `${(value / 1_000_000).toFixed(2)}M`;
}

export function formatBytes(value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Money, at the precision the number actually has.
 *
 * Four decimal places, because a single sampling call costs a fraction of a
 * cent and rounding to two would render most of this product's real costs as
 * `$0.00`.
 */
export function formatUsd(value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return `$${value.toFixed(4)}`;
}

export function formatPercent(ratio: number | null | undefined): string | null {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return null;
  return `${(ratio * 100).toFixed(1)}%`;
}

/** `HH:MM:SS`, in the reader's own timezone. The feed is read at a glance. */
export function formatClock(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? "--:--:--"
    : date.toLocaleTimeString(undefined, { hour12: false });
}
