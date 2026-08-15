/**
 * Deterministic date, time and number formatting.
 *
 * ## Why this exists
 *
 * Every panel in the project screen used to call `toLocaleString()`. That
 * produces a *different string on the server than in the browser* whenever the
 * two disagree about locale — which they routinely do: the Node process
 * formats as `14.8.2026, 15:34:37` under a German locale while the browser
 * renders `8/14/2026, 3:34:37 PM`.
 *
 * In a Client Component that is a hydration mismatch. React discards the
 * server-rendered subtree and re-renders it on the client, and it logged an
 * uncaught error on the Review panel — inside the merge path, which is the
 * most consequential screen this product has. Sprint 11A already cost four
 * defects of the shape "the domain was right and the screen was not"; a tree
 * React throws away and rebuilds is the same class of problem.
 *
 * ## Why UTC, and why it is written out
 *
 * Determinism needs a fixed locale *and* a fixed zone. Fixing only the locale
 * leaves the browser's zone to differ from the server's, which moves the clock
 * rather than the punctuation.
 *
 * So these render UTC and say so. A timestamp that shows a different time than
 * the one it happened at, without naming the zone, is worse than one that is
 * unambiguous — and these values are machine output (capture times, analysis
 * times, expiries), which this product sets in mono and states plainly rather
 * than dressing up.
 *
 * ## Why the formatting is done by hand
 *
 * `Intl` with an explicit locale and timeZone would be close, but it still
 * depends on the ICU data compiled into each runtime, and the whole point here
 * is that server and client cannot disagree. Arithmetic on the UTC getters
 * cannot drift.
 */

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function parse(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** `14 Aug 2026` — a calendar day, no clock. */
export function formatDate(iso: string | null | undefined): string | null {
  const date = parse(iso);
  if (!date) return null;
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** `14 Aug 2026, 13:34 UTC` — the default for anything that happened at a moment. */
export function formatTimestamp(iso: string | null | undefined): string | null {
  const date = parse(iso);
  if (!date) return null;
  return `${formatDate(iso)}, ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`;
}

/** `13:34 UTC` — when the surrounding text already establishes the day. */
export function formatTime(iso: string | null | undefined): string | null {
  const date = parse(iso);
  if (!date) return null;
  return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`;
}

/**
 * `1,240` / `12.5` — grouped integers, two decimals otherwise.
 *
 * `Number.prototype.toLocaleString()` has the same split-brain problem as the
 * date formatters: `1,240` in one locale and `1.240` in another, which is not
 * a cosmetic difference when the number is a count of anything.
 */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  if (!Number.isInteger(value)) return value.toFixed(2);

  const negative = value < 0;
  const digits = String(Math.abs(value));
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return negative ? `-${grouped}` : grouped;
}
