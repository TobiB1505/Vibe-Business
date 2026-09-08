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
 * `13:34:37` — a live feed's left gutter, where seconds are the point.
 *
 * No zone suffix, unlike the others: this renders once per row against a
 * column of identical timestamps, where what a reader takes from it is the
 * gap between two lines rather than the absolute moment. The zone is named
 * once by whatever heading the feed sits under.
 */
export function formatClockTime(iso: string | null | undefined): string | null {
  const date = parse(iso);
  if (!date) return null;
  return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

/**
 * `13:34` — the reader's own wall clock, and the only local time in this file.
 *
 * ## Why an exception exists at all
 *
 * Everything else here renders UTC because it is *machine output about a
 * moment that happened*, and a capture time that moves with the reader's zone
 * is a capture time that lies. A header clock is the opposite claim: it says
 * **what time it is where you are**, which is the one value that would be
 * wrong in UTC. `formatTime` would render 16:34 to somebody whose own clock
 * says 18:34, beside relative labels — "32m ago", "while you were away" —
 * that are anchored to their clock and not to ours.
 *
 * ## Why it is still safe
 *
 * The two hazards this file exists to prevent are hydration mismatch and ICU
 * drift, and neither can reach here. There is no `Intl`: the arithmetic is on
 * `Date`'s local getters, so every runtime produces the same string for the
 * same zone. And it must be called only after mount, from a client component
 * that renders nothing on the server — there is no server output for a client
 * render to disagree with.
 *
 * Twenty-four hours, unlike a locale formatter, because the alternative is
 * `Intl` and this file's whole argument is that `Intl` is where runtimes
 * diverge. It also matches every other time this product prints.
 */
export function formatLocalClock(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * `32m` / `2h` / `3d` — how long ago, in one unit.
 *
 * ## Why `now` is an argument
 *
 * Because a function that read the clock itself would be untestable and,
 * worse, would be a different value on the server and on the client for the
 * same render. `now` is passed by the caller, which forces whoever renders it
 * to have decided where the value comes from.
 *
 * ## Where this may be used, and where it may not
 *
 * Server components only, and the reason is the same hydration hazard the rest
 * of this file exists for: a relative label rendered on the server and
 * recomputed during hydration disagrees with itself the moment a minute
 * passes. In a server component the string is produced once and never
 * recomputed, so there is nothing to disagree with.
 *
 * ## Why one unit and no "ago"
 *
 * It sits in a column of timestamps beside the rows it belongs to, where the
 * word would be four characters of the same noise on every line. And a single
 * unit is what a founder reads at a glance — "1h 12m" is a duration, and this
 * is a position in the past.
 */
export function formatElapsedShort(iso: string, now: Date = new Date()): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";

  const minutes = Math.max(0, Math.round((now.getTime() - then) / 60_000));
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;

  return `${Math.round(hours / 24)}d`;
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
