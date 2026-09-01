import { describe, expect, it } from "vitest";
import {
  formatClockTime,
  formatDate,
  formatNumber,
  formatTime,
  formatTimestamp,
} from "./format-datetime";

/**
 * The property under test is determinism, not prettiness. These assert exact
 * strings on purpose: the defect these functions exist to prevent is two
 * runtimes producing two different strings from one instant, so a test that
 * accepted "some reasonable rendering" would not have caught it.
 */
describe("formatTimestamp", () => {
  it("renders a fixed UTC string regardless of the runtime's locale or zone", () => {
    // The instant from the real hydration mismatch: the server said
    // "14.8.2026, 15:34:37" and the browser "8/14/2026, 3:34:37 PM".
    expect(formatTimestamp("2026-08-14T13:34:37.000Z")).toBe("14 Aug 2026, 13:34 UTC");
  });

  it("names the zone, so a shifted clock is never silent", () => {
    expect(formatTimestamp("2026-08-14T13:34:37.000Z")).toContain("UTC");
  });

  it("normalises an offset timestamp to the same instant in UTC", () => {
    // 15:34+02:00 and 13:34Z are one instant. They must render identically.
    expect(formatTimestamp("2026-08-14T15:34:37.000+02:00")).toBe(
      formatTimestamp("2026-08-14T13:34:37.000Z"),
    );
  });

  it("pads hours and minutes so widths never jump in a column", () => {
    expect(formatTimestamp("2026-01-05T04:07:00.000Z")).toBe("5 Jan 2026, 04:07 UTC");
  });

  it("returns null rather than a broken string for absent or unparseable input", () => {
    expect(formatTimestamp(null)).toBeNull();
    expect(formatTimestamp(undefined)).toBeNull();
    expect(formatTimestamp("")).toBeNull();
    expect(formatTimestamp("not a date")).toBeNull();
  });
});

describe("formatDate and formatTime", () => {
  it("formats a calendar day without a clock", () => {
    expect(formatDate("2026-08-14T13:34:37.000Z")).toBe("14 Aug 2026");
  });

  it("formats a clock without a day, still zoned", () => {
    expect(formatTime("2026-08-14T13:34:37.000Z")).toBe("13:34 UTC");
  });

  it("crosses a UTC day boundary consistently", () => {
    // 23:30-03:00 is the next day in UTC. Both halves must agree about which.
    expect(formatDate("2026-08-14T23:30:00.000-03:00")).toBe("15 Aug 2026");
    expect(formatTime("2026-08-14T23:30:00.000-03:00")).toBe("02:30 UTC");
  });

  it("returns null for absent input", () => {
    expect(formatDate(null)).toBeNull();
    expect(formatTime(null)).toBeNull();
  });
});

describe("formatClockTime", () => {
  it("keeps the seconds a live feed is read for", () => {
    expect(formatClockTime("2026-08-14T13:34:37.000Z")).toBe("13:34:37");
  });

  it("is UTC like the rest, not the runtime's zone", () => {
    expect(formatClockTime("2026-08-14T15:34:37.000+02:00")).toBe("13:34:37");
  });

  it("pads every field so a gutter column never jumps", () => {
    expect(formatClockTime("2026-01-05T04:07:09.000Z")).toBe("04:07:09");
  });

  it("returns null rather than a broken string", () => {
    expect(formatClockTime(null)).toBeNull();
    expect(formatClockTime("not a date")).toBeNull();
  });
});

describe("formatNumber", () => {
  it("groups integers with a comma in every runtime", () => {
    expect(formatNumber(1240)).toBe("1,240");
    expect(formatNumber(1_234_567)).toBe("1,234,567");
  });

  it("leaves short integers ungrouped", () => {
    expect(formatNumber(0)).toBe("0");
    expect(formatNumber(999)).toBe("999");
  });

  it("groups negative integers without losing the sign", () => {
    expect(formatNumber(-1240)).toBe("-1,240");
  });

  it("gives non-integers two decimals", () => {
    expect(formatNumber(12.5)).toBe("12.50");
    expect(formatNumber(0.125)).toBe("0.13");
  });

  it("does not invent a rendering for a non-finite value", () => {
    expect(formatNumber(Number.NaN)).toBe("NaN");
    expect(formatNumber(Number.POSITIVE_INFINITY)).toBe("Infinity");
  });
});
