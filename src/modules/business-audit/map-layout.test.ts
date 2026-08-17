import { describe, expect, it } from "vitest";
import { BUSINESS_LENSES } from "./schema";
import { MAP_RINGS, type MapRing } from "./map-view";
import { MAP_CARD, MAP_MAX_RADIUS, MAP_RADIUS, layoutRings, nodeAngle } from "./map-layout";

/**
 * The rings have to mean something (AUDIT UI-1.4).
 *
 * The map's claim is *closer to the centre = sooner*, and it shipped with the
 * three rings at 0.68 / 0.78 / 0.94 — near enough to the same distance that the
 * claim was not legible. Those numbers came from collision avoidance under
 * fixed per-lens angles, so the geometry was quietly dictating the meaning.
 *
 * Which lens lands on which ring changes with every audit, so a fixture proves
 * nothing here. This checks **every distribution of nine lenses across three
 * rings** — 55 of them — for the two properties that matter: the rings are
 * far enough apart to read, and no two cards overlap.
 */

/** Every way nine lenses can be split across the three rings. */
function distributions(): Record<MapRing, number>[] {
  const all: Record<MapRing, number>[] = [];
  for (let now = 0; now <= 9; now += 1) {
    for (let soon = 0; soon <= 9 - now; soon += 1) {
      all.push({ now, soon, later: 9 - now - soon });
    }
  }
  return all;
}

type Card = { x: number; y: number; ring: MapRing; index: number };

function cardsFor(counts: Record<MapRing, number>): Card[] {
  const layout = layoutRings(counts);
  const cards: Card[] = [];

  for (const ring of MAP_RINGS) {
    for (let index = 0; index < counts[ring]; index += 1) {
      const radians = (nodeAngle(index, counts[ring], layout[ring].phase) * Math.PI) / 180;
      const distance = layout[ring].radius * MAP_RADIUS;
      cards.push({
        x: Math.cos(radians) * distance,
        y: Math.sin(radians) * distance,
        ring,
        index,
      });
    }
  }

  return cards;
}

function overlaps(a: Card, b: Card): boolean {
  return Math.abs(a.x - b.x) < MAP_CARD.width && Math.abs(a.y - b.y) < MAP_CARD.height;
}

describe("every ring distribution lays out without collisions", () => {
  it("covers all 55 ways nine lenses can fall across three rings", () => {
    expect(distributions()).toHaveLength(55);
    for (const counts of distributions()) {
      expect(counts.now + counts.soon + counts.later).toBe(BUSINESS_LENSES.length);
    }
  });

  it.each(distributions().map((counts) => [`${counts.now}/${counts.soon}/${counts.later}`, counts]))(
    "%s: no two cards overlap",
    (_label, counts) => {
      const cards = cardsFor(counts as Record<MapRing, number>);
      const collisions: string[] = [];

      for (let i = 0; i < cards.length; i += 1) {
        for (let j = i + 1; j < cards.length; j += 1) {
          if (overlaps(cards[i]!, cards[j]!)) {
            collisions.push(`${cards[i]!.ring}#${cards[i]!.index}/${cards[j]!.ring}#${cards[j]!.index}`);
          }
        }
      }

      expect(collisions).toEqual([]);
    },
  );

  it("keeps every card inside the square", () => {
    for (const counts of distributions()) {
      for (const card of cardsFor(counts)) {
        expect(Math.hypot(card.x, card.y)).toBeLessThanOrEqual(MAP_MAX_RADIUS + 0.001);
      }
    }
  });
});

describe("the rings read as distance", () => {
  /**
   * The defect this whole file exists for. A founder looking at the map has to
   * be able to see that Now is *inside* Soon without measuring.
   */
  it("puts real distance between the rings in the ordinary case", () => {
    const layout = layoutRings({ now: 3, soon: 2, later: 4 });

    // Before UI-1.4 these were 0.68 / 0.78 / 0.94 — two gaps of 0.10 and 0.16,
    // which is why the rings did not read as distance at all.
    expect(layout.now.radius).toBeLessThanOrEqual(0.45);
    expect(layout.later.radius).toBeGreaterThan(0.85);
    expect(layout.soon.radius - layout.now.radius).toBeGreaterThan(0.2);
    expect(layout.later.radius - layout.soon.radius).toBeGreaterThan(0.2);
  });

  it("never draws an outer ring inside an inner one", () => {
    for (const counts of distributions()) {
      const layout = layoutRings(counts);
      const occupied = MAP_RINGS.filter((ring) => counts[ring] > 0);

      for (let i = 1; i < occupied.length; i += 1) {
        expect(layout[occupied[i]!].radius).toBeGreaterThan(layout[occupied[i - 1]!].radius);
      }
    }
  });

  /** An empty ring is not drawn at all, so it gets no radius to draw at. */
  it("gives an unoccupied ring no radius", () => {
    const layout = layoutRings({ now: 0, soon: 4, later: 5 });
    expect(layout.now.radius).toBe(0);
  });

  /**
   * Nine lenses on one ring is the case that forced the old numbers: at 40°
   * apart the ring has to be far out. It is allowed to be — there is no second
   * ring for it to be confused with.
   */
  it("lets a single crowded ring take the room it needs", () => {
    const layout = layoutRings({ now: 9, soon: 0, later: 0 });
    expect(layout.now.radius).toBeGreaterThan(0.6);
  });

  /**
   * The score sits in the middle and is not a card. A tight inner ring that
   * parked lenses on top of it would be a worse failure than the one this
   * sprint is fixing — the number stops being readable and the centre becomes
   * a pile.
   */
  it("never puts a card over the score", () => {
    for (const counts of distributions()) {
      for (const card of cardsFor(counts)) {
        const clearsHorizontally = Math.abs(card.x) >= (MAP_CARD.width + 100) / 2;
        const clearsVertically = Math.abs(card.y) >= (MAP_CARD.height + 100) / 2;
        expect(clearsHorizontally || clearsVertically).toBe(true);
      }
    }
  });

  /** All three rings starting at twelve o'clock read as a list, not a map. */
  it("staggers the rings against each other", () => {
    const layout = layoutRings({ now: 3, soon: 2, later: 4 });
    const phases = [layout.now.phase, layout.soon.phase, layout.later.phase];
    expect(new Set(phases).size).toBe(phases.length);
  });
});

describe("layout is stable", () => {
  /** A reload must not reshuffle the map under a reader. */
  it("returns the same layout for the same counts", () => {
    const counts = { now: 2, soon: 3, later: 4 };
    expect(layoutRings(counts)).toEqual(layoutRings(counts));
  });

  it("spreads a ring's own nodes evenly around the circle", () => {
    // Three lenses on one ring get 120° each — which is the whole reason that
    // ring is allowed to sit close to the centre.
    expect(nodeAngle(0, 3, 0)).toBe(-90);
    expect(nodeAngle(1, 3, 0)).toBe(30);
    expect(nodeAngle(2, 3, 0)).toBe(150);
  });
});
