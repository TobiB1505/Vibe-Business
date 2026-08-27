import { describe, expect, it } from "vitest";
import { mapWithConcurrency, PER_CHANGE_CONCURRENCY } from "./concurrency";

/**
 * The bound shared by the two per-change read models (VB-023, VB-024).
 *
 * Both fan out one branch per prepared change and each branch can reach GitHub.
 * The helper has to do two things that pull against each other — overlap the
 * work, and refuse to overlap it without limit — and preserve input order while
 * doing so, because these lists are what a founder reads.
 */

function tracked(limit: number, count: number, durationOf: (i: number) => number) {
  let inFlight = 0;
  let peak = 0;
  const order: number[] = [];

  const run = mapWithConcurrency(
    Array.from({ length: count }, (_, i) => i),
    limit,
    async (i) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, durationOf(i)));
      inFlight -= 1;
      order.push(i);
      return i * 2;
    },
  );

  return { run, peak: () => peak, completion: order };
}

describe("overlap", () => {
  it("runs more than one at a time", async () => {
    const t = tracked(4, 8, () => 5);
    await t.run;

    expect(t.peak()).toBeGreaterThan(1);
  });

  it("never exceeds the limit", async () => {
    const t = tracked(3, 30, () => 2);
    await t.run;

    expect(t.peak()).toBeLessThanOrEqual(3);
  });

  it("does not spawn more workers than there is work", async () => {
    const t = tracked(50, 2, () => 2);
    await t.run;

    expect(t.peak()).toBeLessThanOrEqual(2);
  });
});

describe("order", () => {
  /**
   * The property that makes this a drop-in for a sequential loop. Results are
   * positional; completion order is not.
   */
  it("returns input order even when later items finish first", async () => {
    const t = tracked(4, 4, (i) => (4 - i) * 5);
    const results = await t.run;

    expect(results).toEqual([0, 2, 4, 6]);
    // ...and the work genuinely did finish out of order, or the assertion above
    // would prove nothing.
    expect(t.completion).not.toEqual([0, 1, 2, 3]);
  });

  it("handles an empty list without hanging", async () => {
    expect(await mapWithConcurrency([], PER_CHANGE_CONCURRENCY, async (x) => x)).toEqual([]);
  });
});

describe("failure", () => {
  /**
   * A rejection propagates rather than being swallowed to keep the rest of the
   * list rendering. A card list that quietly drops the one change that failed
   * is worse than a page that says something went wrong.
   */
  it("rejects when any item rejects", async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error("boom");
        return n;
      }),
    ).rejects.toThrow("boom");
  });
});
