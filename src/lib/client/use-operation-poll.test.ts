import { describe, expect, it } from "vitest";
import { POLL_BACKOFF_MAX_MULTIPLIER, pollBackoffMultiplier } from "./use-operation-poll";

/**
 * The hook itself needs a DOM and is not tested here (see its docblock). Its
 * one decision is, because a retry schedule buried in a timer is a schedule
 * nobody can assert on — and this one exists to stop a failing backend being
 * asked every 1.8 seconds by every open tab.
 */
describe("how long a failed reading waits (PERF-003)", () => {
  it("does not delay the first attempt after a healthy read", () => {
    expect(pollBackoffMultiplier(0)).toBe(1);
  });

  it("treats a negative count the same as none, rather than shrinking the interval", () => {
    expect(pollBackoffMultiplier(-1)).toBe(1);
  });

  it("doubles, so one dropped request costs a skipped reading and an outage costs more", () => {
    expect(pollBackoffMultiplier(1)).toBe(2);
    expect(pollBackoffMultiplier(2)).toBe(4);
    expect(pollBackoffMultiplier(3)).toBe(8);
  });

  it("stops doubling at the ceiling, so a poll never backs off into looking stopped", () => {
    expect(pollBackoffMultiplier(4)).toBe(POLL_BACKOFF_MAX_MULTIPLIER);
    expect(pollBackoffMultiplier(40)).toBe(POLL_BACKOFF_MAX_MULTIPLIER);
  });

  it("never returns a wait a caller could read as zero", () => {
    for (let failures = 0; failures <= 20; failures += 1) {
      expect(pollBackoffMultiplier(failures)).toBeGreaterThanOrEqual(1);
    }
  });

  /**
   * The fastest caller in the product is the Product Scan at 1.8s. At the
   * ceiling that is a reading every ~14 seconds — slow enough to stop being
   * pressure, fast enough that a recovery is noticed while somebody is still
   * looking at the screen.
   */
  it("keeps the slowest retry within a screenful of attention", () => {
    const fastestIntervalMs = 1_800;
    expect(fastestIntervalMs * pollBackoffMultiplier(99)).toBeLessThanOrEqual(15_000);
  });
});
