import { describe, expect, it } from "vitest";
import {
  SPARKLINE_INSET,
  SPARKLINE_VIEWBOX,
  sparklinePoints,
  sparklinePolyline,
} from "./sparkline-geometry";

/**
 * The sparkline's rules are about honesty, not geometry (UI-8).
 *
 * Every case below is one where the obvious implementation draws a claim the
 * data does not support: a flat line from a single measurement, a crash from a
 * missing one, a divide-by-zero from a project whose score has not moved.
 */

const { width, height } = SPARKLINE_VIEWBOX;
const top = SPARKLINE_INSET;
const bottom = height - SPARKLINE_INSET;

describe("a series with nothing to say draws nothing", () => {
  it("returns null for an empty series", () => {
    expect(sparklinePoints([])).toBeNull();
    expect(sparklinePolyline([])).toBeNull();
  });

  it("returns null for a single point", () => {
    /*
     * The case this exists for. One audit tells you where a project stands and
     * nothing about direction — and a lone point rendered as a horizontal line
     * says "unchanged", which is a claim about a comparison that was never
     * made.
     */
    expect(sparklinePoints([72])).toBeNull();
    expect(sparklinePolyline([72])).toBeNull();
  });

  it("draws from two points, which is the smallest real trend", () => {
    expect(sparklinePoints([60, 72])).toHaveLength(2);
  });
});

describe("normalisation", () => {
  it("puts the lowest value at the bottom and the highest at the top", () => {
    const points = sparklinePoints([40, 90]);

    expect(points).not.toBeNull();
    expect(points![0].y).toBeCloseTo(bottom);
    expect(points![1].y).toBeCloseTo(top);
  });

  it("insets the extremes so a stroke is not clipped at the edge", () => {
    // Half of a 1.5-unit stroke centred on y=0 would be drawn outside the
    // viewBox, so the top of a rising line would lose its cap.
    const points = sparklinePoints([10, 20])!;

    expect(Math.min(...points.map((point) => point.y))).toBeGreaterThan(0);
    expect(Math.max(...points.map((point) => point.y))).toBeLessThan(height);
  });

  it("spreads points evenly across the full width, oldest first", () => {
    const points = sparklinePoints([1, 2, 3])!;

    expect(points.map((point) => point.x)).toEqual([0, width / 2, width]);
  });

  it("keeps a falling series falling", () => {
    const points = sparklinePoints([90, 70, 40])!;

    expect(points[0].y).toBeLessThan(points[1].y);
    expect(points[1].y).toBeLessThan(points[2].y);
  });

  it("centres a series that never moved instead of dividing by its range", () => {
    // max - min is 0 here. The naive normalisation is NaN, which renders as an
    // invalid `points` attribute and silently draws nothing.
    const points = sparklinePoints([68, 68, 68])!;

    for (const point of points) {
      expect(Number.isFinite(point.y)).toBe(true);
      expect(point.y).toBeCloseTo(top + (bottom - top) / 2);
    }
  });
});

describe("the polyline attribute", () => {
  it("is space-separated x,y pairs", () => {
    expect(sparklinePolyline([0, 100])).toMatch(/^[\d.]+,[\d.]+ [\d.]+,[\d.]+$/);
  });

  it("carries no exponential or over-long numbers into the attribute", () => {
    const points = sparklinePolyline([1, 3, 2, 7, 5])!;

    expect(points).not.toContain("e");
    for (const pair of points.split(" ")) {
      for (const value of pair.split(",")) {
        expect(value.split(".")[1]?.length ?? 0).toBeLessThanOrEqual(3);
      }
    }
  });
});
