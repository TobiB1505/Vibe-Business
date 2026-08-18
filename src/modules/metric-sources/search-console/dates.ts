import type { NormalizedDay, WindowCompleteness } from "./schema";

/**
 * Provider date semantics (Sprint 12C §17, §19, §52).
 *
 * ## The fact this module exists for
 *
 * **Search Console dates are Pacific Time, not UTC.** Google's
 * `searchanalytics.query` reference states it outright: `startDate` and
 * `endDate` are `YYYY-MM-DD` "in PT time (UTC - 7:00/8:00)".
 *
 * That is a genuinely dangerous detail, because getting it wrong is invisible.
 * A UTC-derived boundary is off by one day for part of every day, so a 28-day
 * baseline silently becomes 27 days of one property's traffic plus a slice of
 * another day — and every downstream number stays plausible.
 *
 * ## The timezone Vibe computes in
 *
 * Sprint 12B windows carry their own IANA zone and are half-open
 * `[start, end)`. This module converts *those* instants into the calendar days
 * Google will understand, and never consults the host clock: a measurement must
 * not change because Vercel scheduled the function in a different region.
 *
 * `America/Los_Angeles` is used rather than a fixed −8 offset precisely because
 * PT observes daylight saving, and a fixed offset would drift by an hour for
 * two-thirds of the year.
 */

export const SEARCH_CONSOLE_TIMEZONE = "America/Los_Angeles" as const;

/**
 * The calendar day an instant falls on, in a given zone.
 *
 * Uses `Intl` rather than arithmetic on epoch milliseconds. Offset arithmetic
 * is where off-by-one-day bugs are born: it has to encode DST transitions by
 * hand, and it silently inherits the host zone the moment someone reaches for
 * `Date#getDate()`.
 */
export function calendarDayIn(instantIso: string, timeZone: string): string {
  const instant = new Date(instantIso);
  if (Number.isNaN(instant.getTime())) throw new Error(`Not an instant: ${instantIso}`);

  // `en-CA` yields `YYYY-MM-DD`, which is the format Google wants and the
  // format the measurement domain speaks. Chosen for its output shape, not for
  // any locale meaning.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/** The day before a `YYYY-MM-DD`, by calendar arithmetic rather than by clock. */
export function previousDay(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  // Constructed at UTC noon so that adding or subtracting a day can never cross
  // a DST boundary into the previous or next date.
  const anchor = new Date(Date.UTC(year, month - 1, date, 12));
  anchor.setUTCDate(anchor.getUTCDate() - 1);
  return anchor.toISOString().slice(0, 10);
}

export function nextDay(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  const anchor = new Date(Date.UTC(year, month - 1, date, 12));
  anchor.setUTCDate(anchor.getUTCDate() + 1);
  return anchor.toISOString().slice(0, 10);
}

export type ProviderDateRange = {
  /** Inclusive, `YYYY-MM-DD`, interpreted by Google in PT. */
  startDate: string;
  /** **Inclusive**, per Google's documentation. */
  endDate: string;
  /** Every day the range covers, for completeness checking. */
  days: string[];
};

/**
 * Converts a half-open business window into Google's inclusive date range.
 *
 * ## The two conversions happening here
 *
 * **Half-open to inclusive.** Sprint 12B windows are `[start, end)` — the end
 * instant is *not* part of the window. Google's `endDate` is inclusive. Passing
 * the window's end straight through would add a day that the baseline was never
 * measured over, which is the classic off-by-one that makes a 28-day window
 * quietly 29.
 *
 * **The window's zone to PT.** The instants are resolved to calendar days in
 * the zone Google will use, not the zone the window was computed in and not the
 * host's. When those differ the boundary genuinely moves, and moving it here —
 * deterministically, in one place — is the whole point.
 */
export function toProviderRange(window: {
  start: string;
  end: string;
}): ProviderDateRange {
  const startDate = calendarDayIn(window.start, SEARCH_CONSOLE_TIMEZONE);
  // The last day *inside* a half-open window is the day before its end instant.
  const endDate = previousDay(calendarDayIn(window.end, SEARCH_CONSOLE_TIMEZONE));

  if (endDate < startDate) {
    throw new Error("Measurement window is shorter than a provider day.");
  }

  const days: string[] = [];
  for (let day = startDate; day <= endDate; day = nextDay(day)) days.push(day);

  return { startDate, endDate, days };
}

/**
 * Compares what was asked for against what came back finalized (§19).
 *
 * ## Why absence is not zero
 *
 * Search Console finalizes data on a lag, and an unfinalized day simply has no
 * row. A day with genuinely zero impressions **does** come back, as a row with
 * `impressions: 0` — so the two are distinguishable, and conflating them is a
 * choice rather than a necessity.
 *
 * Getting this wrong in the permissive direction is the worst available
 * outcome: summing 26 finalized days as though they were 28 makes a complete
 * baseline look larger than an incomplete measurement window, and the engine
 * reports a decline that never happened.
 */
export function assessCompleteness(
  requested: ProviderDateRange,
  observed: NormalizedDay[],
): WindowCompleteness {
  const finalized = new Set(
    observed.filter((day) => day.state === "final").map((day) => day.day),
  );

  const finalizedDays = requested.days.filter((day) => finalized.has(day)).length;

  return {
    expectedDays: requested.days.length,
    finalizedDays,
    pendingDays: requested.days.length - finalizedDays,
    complete: finalizedDays === requested.days.length,
  };
}

/**
 * Marks the days a window asked for that the provider did not finalize.
 *
 * Returned as explicit `pending` entries rather than as gaps, so a caller
 * cannot iterate the series and mistake a missing key for a zero. The Sprint
 * 12B port then receives only the finalized points — absence there means "no
 * data", which is exactly what the engine's per-window minimum is written to
 * detect.
 */
export function withPendingDays(
  requested: ProviderDateRange,
  finalized: Array<{ day: string; impressions: number }>,
): NormalizedDay[] {
  const byDay = new Map(finalized.map((entry) => [entry.day, entry.impressions]));

  return requested.days.map((day) =>
    byDay.has(day)
      ? { day, state: "final" as const, impressions: byDay.get(day)! }
      : { day, state: "pending" as const },
  );
}
