import { MEASUREMENT_POLICY_VERSION, type MeasurementWindow } from "./schema";

/**
 * Baseline and post-change windows (Sprint 12B §11, §12, §13, §32, §42).
 *
 * ## The three ways a window comparison lies
 *
 * **Partial periods.** Comparing a full previous week against "Monday morning
 * so far" is the classic one. It reports a catastrophic collapse in every
 * metric, every time, and it is entirely an artefact of the clock. So windows
 * are whole calendar days, and the merge day itself — which is partial by
 * definition — is never one of them (§13).
 *
 * **Implicit timezone.** "Seven days before the merge" is a different set of
 * data in `America/Los_Angeles` than in `Europe/Berlin`, and the difference is
 * concentrated exactly where the traffic is. The zone is therefore an explicit
 * input, stored on every window, and never taken from the server's clock — a
 * Vercel function's timezone is a deployment detail and must not decide what a
 * customer's week was (§32).
 *
 * **Windows that move.** If the baseline is recomputed each time a measurement
 * is read, a result changes retroactively as the calendar advances. So windows
 * are computed once, written to the row, and read back — never derived at
 * comparison time (§42).
 *
 * ## The settling gap
 *
 * The post-change window does not start the instant the merge lands. A merge is
 * not a deployment, a deployment is not a cache flush, and for search metrics a
 * crawler has to come back at all. The gap is a plan-level number rather than a
 * constant, because "how long until this could plausibly show up" is a property
 * of the capability, not of measurement in general (§9).
 */

/**
 * Timezone used when the project's own is unknown (§32).
 *
 * UTC, deliberately and documentedly. It is the one zone that is never a
 * surprise, never shifts for daylight saving, and never silently inherits a
 * server's locale. A real analytics source usually reports its own zone, and
 * when one is connected the plan should carry it instead — but a *documented
 * deterministic* fallback beats a plausible guess about where a customer is.
 */
export const DEFAULT_MEASUREMENT_TIMEZONE = "UTC" as const;

/**
 * The calendar day an instant falls on, in a given zone, as `YYYY-MM-DD`.
 *
 * Uses `Intl` rather than date arithmetic so real zone rules — including
 * daylight-saving transitions — are applied by the platform rather than
 * approximated here.
 */
export function calendarDayIn(instant: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);

  const lookup = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${lookup("year")}-${lookup("month")}-${lookup("day")}`;
}

/** The UTC instant at which a calendar day begins in the given zone. */
export function startOfDayIn(day: string, timezone: string): Date {
  // Probe midday UTC on the requested day, read back what local day that is,
  // and correct. Two passes settle every real zone offset, including the
  // half-hour and 45-minute ones, without hardcoding an offset table.
  const [year, month, date] = day.split("-").map(Number);
  let guess = Date.UTC(year, month - 1, date, 0, 0, 0);

  for (let pass = 0; pass < 2; pass += 1) {
    const offsetMinutes = zoneOffsetMinutes(new Date(guess), timezone);
    guess = Date.UTC(year, month - 1, date, 0, 0, 0) - offsetMinutes * 60_000;
  }

  return new Date(guess);
}

/** Minutes the zone is ahead of UTC at a given instant. */
function zoneOffsetMinutes(instant: Date, timezone: string): number {
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);

  const lookup = (type: string) => Number(formatted.find((part) => part.type === type)?.value ?? "0");
  const asUtc = Date.UTC(
    lookup("year"),
    lookup("month") - 1,
    lookup("day"),
    lookup("hour") % 24,
    lookup("minute"),
    lookup("second"),
  );

  return Math.round((asUtc - instant.getTime()) / 60_000);
}

function addDays(day: string, delta: number): string {
  const [year, month, date] = day.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, date + delta));
  return shifted.toISOString().slice(0, 10);
}

function windowFromDays(firstDay: string, days: number, timezone: string): MeasurementWindow {
  return {
    start: startOfDayIn(firstDay, timezone).toISOString(),
    // Exclusive: the instant the day *after* the last included day begins.
    // Half-open windows are what makes "these two windows do not overlap"
    // checkable by comparison rather than by an off-by-one argument.
    end: startOfDayIn(addDays(firstDay, days), timezone).toISOString(),
    timezone,
    days,
  };
}

export type WindowPlan = {
  baseline: MeasurementWindow;
  measurement: MeasurementWindow;
  /** The instant the post-change window closes and a result becomes computable. */
  resultAvailableAt: string;
  policyVersion: string;
};

export type WindowPlanInput = {
  /** When the default branch actually moved. */
  mergedAt: Date;
  baselineDays: number;
  measurementDays: number;
  /** Whole days after the merge day before the post-window opens (§13). */
  settlingDays: number;
  timezone?: string;
};

/**
 * Computes both windows from one merge instant.
 *
 * ```
 *   … baselineDays complete days …  │ merge day │ … settlingDays …  │ … measurementDays …
 *   ◀────────── baseline ─────────▶ │ excluded  │     excluded      │ ◀── measurement ──▶
 * ```
 *
 * The merge day is excluded from **both** sides. It is partial on the before
 * side and contaminated on the after side, and including it in either would
 * import exactly the bias §13 exists to prevent.
 *
 * The two windows cannot overlap by construction: the baseline ends at the
 * start of the merge day, and the measurement starts strictly after it.
 */
export function planWindows(input: WindowPlanInput): WindowPlan {
  const timezone = input.timezone ?? DEFAULT_MEASUREMENT_TIMEZONE;
  const mergeDay = calendarDayIn(input.mergedAt, timezone);

  // Baseline: the N complete days ending the day before the merge.
  const baselineFirstDay = addDays(mergeDay, -input.baselineDays);
  const baseline = windowFromDays(baselineFirstDay, input.baselineDays, timezone);

  // Measurement: opens after the merge day plus the settling gap.
  const measurementFirstDay = addDays(mergeDay, 1 + input.settlingDays);
  const measurement = windowFromDays(measurementFirstDay, input.measurementDays, timezone);

  return {
    baseline,
    measurement,
    resultAvailableAt: measurement.end,
    policyVersion: MEASUREMENT_POLICY_VERSION,
  };
}

/**
 * Do two windows share any instant? (§42)
 *
 * Half-open comparison, so a baseline ending exactly where a measurement begins
 * is adjacent rather than overlapping. Asserted in tests rather than argued
 * about, because an overlap silently compares part of a period against itself
 * and biases every result toward "no change".
 */
export function windowsOverlap(left: MeasurementWindow, right: MeasurementWindow): boolean {
  return left.start < right.end && right.start < left.end;
}

/** Has the post-change window closed, so a result can be computed? */
export function windowHasClosed(window: MeasurementWindow, now: Date): boolean {
  return now.getTime() >= Date.parse(window.end);
}

/** How many of a window's days have completed. Never more than the window (§23). */
export function completedDays(window: MeasurementWindow, now: Date): number {
  const start = Date.parse(window.start);
  if (now.getTime() <= start) return 0;

  const elapsedDays = Math.floor((now.getTime() - start) / (24 * 60 * 60 * 1000));
  return Math.min(elapsedDays, window.days);
}
