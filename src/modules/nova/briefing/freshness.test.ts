import { describe, expect, it } from "vitest";

import {
  FRESHNESS_BUCKETS,
  FRESHNESS_LABELS,
  daysBetween,
  freshnessOf,
  worthMentioning,
} from "./freshness";

/**
 * The half of the briefing that moves on its own.
 *
 * Everything else about a project changes because somebody did something. This
 * changes because time passed, and it is the only reason a stored sentence can
 * come to be about a week that has since ended. So the properties worth
 * asserting are the boundaries — where one bucket becomes the next — and the
 * two cases where "no age" must not be read as "brand new".
 */

const NOW = new Date("2026-09-06T12:00:00.000Z");

/** A timestamp exactly `days` before `NOW`. */
function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

describe("an age in whole days", () => {
  it.each([
    [0, 0],
    [1, 1],
    [30, 30],
  ])("reads %s days ago as %s", (given, expected) => {
    expect(daysBetween(daysAgo(given), NOW)).toBe(expected);
  });

  it("rounds down rather than up", () => {
    const almostTwo = new Date(NOW.getTime() - (2 * 24 - 1) * 60 * 60 * 1000).toISOString();

    expect(daysBetween(almostTwo, NOW)).toBe(1);
  });

  /** A clock disagreement is not a negative age. */
  it("reads a future timestamp as no time at all", () => {
    const ahead = new Date(NOW.getTime() + 40_000).toISOString();

    expect(daysBetween(ahead, NOW)).toBe(0);
  });

  it.each([
    ["nothing", null],
    ["something that is not a date", "not-a-date"],
  ])("has no answer for %s", (_label, input) => {
    expect(daysBetween(input, NOW)).toBeNull();
  });
});

describe("the buckets, and where each one starts", () => {
  it.each([
    [0, "today"],
    [1, "a_few_days"],
    [3, "a_few_days"],
    [4, "about_a_week"],
    [10, "about_a_week"],
    [11, "a_few_weeks"],
    [45, "a_few_weeks"],
    [46, "months"],
    [400, "months"],
  ])("puts %s days in %s", (days, bucket) => {
    expect(freshnessOf(daysAgo(days), NOW)).toBe(bucket);
  });

  /** Ordered and total: every bucket is reachable, and nothing falls out. */
  it("reaches every bucket it declares", () => {
    const reached = new Set([0, 1, 4, 11, 46, 1000].map((days) => freshnessOf(daysAgo(days), NOW)));

    expect([...reached].sort()).toEqual([...FRESHNESS_BUCKETS].sort());
  });

  it("never leaves an age unbucketed", () => {
    for (let days = 0; days <= 120; days += 1) {
      expect(freshnessOf(daysAgo(days), NOW), `${days} days`).not.toBeNull();
    }
  });

  /**
   * The distinction the whole module rests on. "Never produced" is not the
   * freshest possible reading — it is the absence of any reading, and calling
   * it `today` would turn a project with no scan into one scanned this morning.
   */
  it("has no bucket for something that never ran", () => {
    expect(freshnessOf(null, NOW)).toBeNull();
  });
});

describe("time alone moves the bucket", () => {
  /**
   * The property the founder asked about: nothing changed, five days passed,
   * and the answer is different. That difference is what carries into the
   * reuse identity and buys a fresh sentence without a fresh event.
   */
  it("changes the answer about an unchanged thing", () => {
    const produced = daysAgo(0);
    const later = new Date(NOW.getTime() + 6 * 24 * 60 * 60 * 1000);

    expect(freshnessOf(produced, NOW)).toBe("today");
    expect(freshnessOf(produced, later)).toBe("about_a_week");
  });

  /** And does not change it every day, which would be a bill for a synonym. */
  it("holds still inside a bucket", () => {
    const produced = daysAgo(0);
    const days = (n: number) => new Date(NOW.getTime() + n * 24 * 60 * 60 * 1000);

    expect(freshnessOf(produced, days(4))).toBe(freshnessOf(produced, days(10)));
  });
});

describe("the words Vibe uses for an age", () => {
  it("names every bucket", () => {
    expect(Object.keys(FRESHNESS_LABELS).sort()).toEqual([...FRESHNESS_BUCKETS].sort());
  });

  /** The number is the screen's job, computed live; these are the model's. */
  it("carries no figures", () => {
    for (const label of Object.values(FRESHNESS_LABELS)) {
      expect(label, label).not.toMatch(/\d/);
    }
  });

  it("says each thing once", () => {
    const labels = Object.values(FRESHNESS_LABELS);

    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe("when an age is worth raising on its own", () => {
  it.each([
    ["today", false],
    ["a_few_days", false],
    ["about_a_week", true],
    ["a_few_weeks", true],
    ["months", true],
  ] as const)("%s → %s", (bucket, expected) => {
    expect(worthMentioning(bucket)).toBe(expected);
  });

  /**
   * Absence is not age. A scan that never ran is raised by the provenance
   * chain as *missing*, which is a stronger thing than old — and reporting it
   * here as well would have Nova say both.
   */
  it("says nothing about something that never ran", () => {
    expect(worthMentioning(null)).toBe(false);
  });
});
