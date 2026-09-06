import { describe, expect, it } from "vitest";
import { APERTURE, CURVE, HOLE, type NovaPresenceState } from "./nova-presence";

/**
 * The mark's one geometric invariant: no opening closes inside the curve.
 *
 * Nova's avatar is an aperture framing her light curve, and that reading only
 * survives while the blades stay outside the curve. When they close past it
 * the mark stops being an instrument looking at an event and becomes two
 * shapes overlapping — which is what `idle` did, at `open` 0.4, for as long as
 * it was the one state the prototype never drew and so never checked.
 *
 * The check is arithmetic rather than a rendering, because the collision is
 * arithmetic: the blades' inner edge is a radius, the curve has a reach, and
 * the first must clear the second. Both sides are taken from the component's
 * own constants, so a change to either geometry is what this notices.
 */

type Point = { x: number; y: number };

/** Into the 100-unit frame, exactly as the component's transform places it. */
function place(point: Point): Point {
  return {
    x: 50 + CURVE.scale * (point.x - CURVE.origin.x),
    y: 50 + CURVE.scale * (point.y - CURVE.origin.y),
  };
}

function distanceFromCentre(point: Point): number {
  const placed = place(point);
  return Math.hypot(placed.x - 50, placed.y - 50);
}

function cubic(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  return {
    x: u ** 3 * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t ** 3 * p3.x,
    y: u ** 3 * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t ** 3 * p3.y,
  };
}

const SAMPLES = 400;

/**
 * How far the drawn curve reaches from the centre, half its stroke included.
 *
 * The paths are read as the shapes the component draws rather than parsed
 * from their `d` strings: a general path parser would be more code than the
 * thing it protects, and these two shapes are fixed by `CURVE`.
 */
function curveReach(): number {
  const reaches: number[] = [];

  // `CURVE.baseline.d` — "M5 35 H16", a horizontal run.
  for (let step = 0; step <= SAMPLES; step += 1) {
    const x = 5 + (16 - 5) * (step / SAMPLES);
    reaches.push(distanceFromCentre({ x, y: 35 }) + (CURVE.baseline.width / 2) * CURVE.scale);
  }

  // `CURVE.rise.d` — two cubics: the rise to the peak, then the decay.
  const rise: [Point, Point, Point, Point][] = [
    [
      { x: 16, y: 35 },
      { x: 19.5, y: 35 },
      { x: 20.5, y: 12 },
      { x: 24, y: 12 },
    ],
    [
      { x: 24, y: 12 },
      { x: 28.5, y: 12 },
      { x: 31, y: 27 },
      { x: 44, y: 30.5 },
    ],
  ];
  for (const [p0, p1, p2, p3] of rise) {
    for (let step = 0; step <= SAMPLES; step += 1) {
      const point = cubic(p0, p1, p2, p3, step / SAMPLES);
      reaches.push(distanceFromCentre(point) + (CURVE.rise.width / 2) * CURVE.scale);
    }
  }

  reaches.push(distanceFromCentre(CURVE.peak) + CURVE.peak.r * CURVE.scale);

  return Math.max(...reaches);
}

const STATES: NovaPresenceState[] = ["idle", "listening", "working", "settled"];

describe("Nova's mark", () => {
  it("agrees with the endpoints the curve is actually drawn from", () => {
    /*
     * `curveReach` restates the two cubics as points. If someone edits the `d`
     * string without editing them, the reach would be computed for a curve
     * that is no longer on screen, and every assertion below would pass while
     * saying nothing.
     */
    expect(CURVE.baseline.d).toBe("M5 35 H16");
    expect(CURVE.rise.d).toBe("M16 35 C19.5 35 20.5 12 24 12 C28.5 12 31 27 44 30.5");
  });

  it("keeps every opening outside the curve it frames", () => {
    const reach = curveReach();

    for (const state of STATES) {
      const innerEdge = APERTURE[state] * HOLE;
      expect(
        innerEdge,
        `${state}: blades close to ${innerEdge.toFixed(2)}, curve reaches ${reach.toFixed(2)}`,
      ).toBeGreaterThan(reach);
    }
  });

  it("leaves idle the narrowest opening, which is what the state says", () => {
    for (const state of STATES) {
      if (state === "idle") continue;
      expect(APERTURE.idle).toBeLessThan(APERTURE[state]);
    }
  });

  it("keeps the four states one object rather than four drawings", () => {
    /*
     * The prototype's own note on `settled`: retracted far enough and the
     * blades become slivers, and the mark stops reading as the same object at
     * a different opening. The widest may not be more than twice the narrowest.
     */
    const openings = STATES.map((state) => APERTURE[state]);
    expect(Math.max(...openings)).toBeLessThanOrEqual(Math.min(...openings) * 2);
  });
});
