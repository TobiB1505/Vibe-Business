import { MAP_RINGS, type MapRing } from "./map-view";

/**
 * Where the rings sit, and why they are not fixed (AUDIT UI-1.4).
 *
 * ## The problem this exists to solve
 *
 * The map's whole claim is *closer to the centre = sooner*. It shipped with the
 * rings at 0.68 / 0.78 / 0.94 of the radius, which means Now, Soon and Later
 * sat at practically the same distance from the middle and the claim was not
 * legible. The founder said so on the first look, and they were right.
 *
 * Those numbers were not a design choice. They were the smallest radii at which
 * nine cards on *fixed* per-lens angles stop overlapping: two neighbours 40°
 * apart are `2r·sin20°` apart, so a small inner ring guarantees a collision.
 * The geometry was dictating the meaning.
 *
 * ## The trade this makes
 *
 * Lenses no longer keep a fixed absolute angle. Each ring spreads *its own*
 * nodes evenly over the full circle, so a ring holding three lenses gets 120°
 * of clearance instead of 40° — and can therefore sit far inside without its
 * cards touching.
 *
 * What is kept is the property that actually helps a returning reader: the
 * lenses run clockwise from the top in their canonical order, within each ring.
 * The sequence is stable; the absolute bearing is not. A lens already moved
 * between audits (its ring is a judgment, and the ring is its radius), so the
 * map was never a fixed constellation to begin with.
 *
 * ## How a layout is chosen
 *
 * Outward, one ring at a time, and never by trusting the algebra:
 *
 *  1. Start at the ring's preferred radius, raised to the minimum its own node
 *     count needs — for `k` evenly spaced cards the closest pair is `2r·sin(π/k)`
 *     apart, and two rectangles clear each other once that exceeds the card's
 *     diagonal.
 *  2. Of the rotations that clear both the score at the centre and every card
 *     already placed further in, take the one with the most room to spare —
 *     taking the *first* one left every ring starting at twelve o'clock, and
 *     the map read as a vertical list with circles behind it.
 *  3. If none clears, push the ring outward and try again, up to the bound.
 *  4. If the outermost ring runs out of room, compress the preferred radii and
 *     start over — pulling the inner rings in rather than letting the outer one
 *     collide.
 *
 * Every one of the 55 possible ring distributions of nine lenses resolves with
 * no overlapping cards, and `map-layout.test.ts` checks all of them rather than
 * the one in a fixture. Which lens lands on which ring changes with every
 * audit, so the arrangement in any single example proves nothing.
 */

/**
 * The card's footprint and the field it sits in, in CSS pixels at the map's
 * full width. These are UI facts living in the view layer's vocabulary, and
 * `business-map.tsx` must keep its card sizing in step — the browser test
 * `no two lens cards overlap` is what holds the two together.
 */
export const MAP_CARD = { width: 112, height: 80 } as const;

/** Usable radius inside the square, matching `RADIUS` in the component. */
export const MAP_RADIUS = 268;

/** Beyond this a card's outer edge leaves the square. */
export const MAP_MAX_RADIUS = 252;

/**
 * The readiness score's disc, which sits at the centre and is not a card.
 *
 * Treated as an obstacle rather than as empty space. The first attempt at a
 * tight inner ring parked three lenses on top of the score, which is a worse
 * failure than the one it was fixing: the number stops being readable and the
 * middle of the map turns into a pile.
 */
const MAP_CORE = 100;

/**
 * Where each ring would sit if nothing was in the way.
 *
 * This is the meaning, stated first: Now is close enough to the centre to read
 * as *inside*, Later close enough to the edge to read as *out there*, and Soon
 * genuinely between them. The solver only ever moves a ring off these numbers
 * when the cards would otherwise collide.
 */
const RING_PREFERRED: Record<MapRing, number> = {
  now: 0.4,
  soon: 0.66,
  later: 0.92,
};

/** Rotations tried when fitting a ring, in degrees. */
const PHASE_STEP = 5;

/** How far a ring is pushed out per attempt, in pixels. */
const RADIUS_STEP = 3;

/** Applied to every preferred radius when a whole layout fails to resolve. */
const COMPRESSIONS = [1, 0.92, 0.84, 0.76, 0.68, 0.6, 0.5];

export type RingPlacement = {
  /** Distance from the centre, as a fraction of the map radius. */
  radius: number;
  /** Rotation of this ring's first node away from the top, in degrees. */
  phase: number;
};

export type MapLayout = Record<MapRing, RingPlacement>;

type Point = { x: number; y: number };

/** The angle of the `index`-th node of a ring holding `count` of them. */
export function nodeAngle(index: number, count: number, phase: number): number {
  if (count <= 0) return -90;
  return -90 + phase + (index * 360) / count;
}

function ringPoints(count: number, radius: number, phase: number): Point[] {
  const points: Point[] = [];
  for (let index = 0; index < count; index += 1) {
    const radians = (nodeAngle(index, count, phase) * Math.PI) / 180;
    points.push({ x: Math.cos(radians) * radius, y: Math.sin(radians) * radius });
  }
  return points;
}

/** Axis-aligned overlap of two cards centred on these points. */
function collides(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) < MAP_CARD.width && Math.abs(a.y - b.y) < MAP_CARD.height;
}

/** Whether a card at this point would sit over the score. */
function coversCore(point: Point): boolean {
  return (
    Math.abs(point.x) < (MAP_CARD.width + MAP_CORE) / 2 &&
    Math.abs(point.y) < (MAP_CARD.height + MAP_CORE) / 2
  );
}

/** How much clearance two cards have; negative when they overlap. */
function clearance(a: Point, b: Point): number {
  return Math.max(
    Math.abs(a.x - b.x) - MAP_CARD.width,
    Math.abs(a.y - b.y) - MAP_CARD.height,
  );
}

/**
 * The smallest radius at which `count` evenly spaced cards clear each other.
 *
 * Two rectangles overlap only when they are close on *both* axes, so the
 * binding case is the separation that splits evenly between them — which is
 * satisfied exactly when the chord reaches the card's diagonal.
 */
function minimumRadius(count: number): number {
  if (count <= 1) return 0;
  const diagonal = Math.hypot(MAP_CARD.width, MAP_CARD.height);
  return diagonal / (2 * Math.sin(Math.PI / count));
}

function attempt(counts: Record<MapRing, number>, compression: number): MapLayout | null {
  const placed: Point[] = [];
  const layout = {} as MapLayout;

  for (const ring of MAP_RINGS) {
    const count = counts[ring];
    if (count === 0) {
      layout[ring] = { radius: 0, phase: 0 };
      continue;
    }

    let radius = Math.max(RING_PREFERRED[ring] * compression * MAP_RADIUS, minimumRadius(count));
    let fitted: RingPlacement | null = null;

    while (radius <= MAP_MAX_RADIUS && fitted === null) {
      /*
       * Not the first rotation that fits — the roomiest one.
       *
       * Taking the first left every ring starting at twelve o'clock, so all
       * three put a node straight up and the map read as a vertical list with
       * circles behind it. Maximising the tightest gap staggers the rings
       * against each other for free, and stays deterministic.
       */
      let best: { phase: number; room: number } | null = null;

      for (let phase = 0; phase < 360; phase += PHASE_STEP) {
        const points = ringPoints(count, radius, phase);
        if (points.some((point) => coversCore(point))) continue;
        if (points.some((point) => placed.some((other) => collides(point, other)))) continue;

        let room = Number.POSITIVE_INFINITY;
        for (const point of points) {
          for (const other of placed) room = Math.min(room, clearance(point, other));
        }
        if (best === null || room > best.room) best = { phase, room };
      }

      if (best !== null) fitted = { radius, phase: best.phase };
      else radius += RADIUS_STEP;
    }

    if (fitted === null) return null;

    layout[ring] = fitted;
    placed.push(...ringPoints(count, fitted.radius, fitted.phase));
  }

  return layout;
}

/**
 * Radii and rotations for one audit's ring distribution.
 *
 * Deterministic: the same counts always produce the same layout, so a reload
 * never reshuffles the map under a reader.
 */
export function layoutRings(counts: Record<MapRing, number>): MapLayout {
  for (const compression of COMPRESSIONS) {
    const layout = attempt(counts, compression);
    if (layout !== null) {
      return {
        now: fraction(layout.now),
        soon: fraction(layout.soon),
        later: fraction(layout.later),
      };
    }
  }

  /*
   * Unreachable for nine lenses — the exhaustive test covers every
   * distribution — but a map is not worth throwing for. The tightest
   * compression still separates the rings; it may crowd two cards.
   */
  const fallback = attempt(counts, COMPRESSIONS[COMPRESSIONS.length - 1]!);
  return {
    now: fraction(fallback?.now ?? { radius: 0, phase: 0 }),
    soon: fraction(fallback?.soon ?? { radius: 0, phase: 0 }),
    later: fraction(fallback?.later ?? { radius: MAP_MAX_RADIUS, phase: 0 }),
  };
}

function fraction(placement: RingPlacement): RingPlacement {
  return { radius: placement.radius / MAP_RADIUS, phase: placement.phase };
}
