import { describe, expect, it } from "vitest";
import { frameCoordinates, modifiersOf } from "./live-browser-canvas";

/**
 * The two pure halves of driving a remote browser by hand.
 *
 * Both fail silently. A wrong coordinate puts the click somewhere else on the
 * page, and a dropped Shift bit turns a typed password into a lowercase one —
 * neither throws, neither shows an error, and both read to a person as their
 * own mistake.
 */

const FRAME = { w: 1280, h: 800 };

describe("pointer coordinates", () => {
  it("maps a click at the element's centre to the frame's centre", () => {
    const box = { left: 0, top: 0, width: 640, height: 400 };

    expect(frameCoordinates({ clientX: 320, clientY: 200 }, box, FRAME)).toEqual({ x: 640, y: 400 });
  });

  it("scales up when the canvas is laid out smaller than the frame", () => {
    // The normal case: 1280x800 rendered into a half-width column.
    const box = { left: 0, top: 0, width: 640, height: 400 };

    expect(frameCoordinates({ clientX: 64, clientY: 40 }, box, FRAME)).toEqual({ x: 128, y: 80 });
  });

  it("subtracts the element's offset in the page", () => {
    // A dialog is not at the origin. Forgetting this shifts every click by the
    // dialog's position, which is far enough to hit a different control.
    const box = { left: 100, top: 50, width: 1280, height: 800 };

    expect(frameCoordinates({ clientX: 100, clientY: 50 }, box, FRAME)).toEqual({ x: 0, y: 0 });
    expect(frameCoordinates({ clientX: 500, clientY: 250 }, box, FRAME)).toEqual({ x: 400, y: 200 });
  });

  it("answers the origin for a canvas that has not been laid out", () => {
    // Dividing by a zero-sized box sends NaN, and the guard coerces NaN to 0 —
    // a click at the top-left corner, which is a real place on a real page. So
    // it is refused here rather than turned into a plausible-looking event.
    const box = { left: 0, top: 0, width: 0, height: 0 };

    expect(frameCoordinates({ clientX: 500, clientY: 250 }, box, FRAME)).toEqual({ x: 0, y: 0 });
  });

  it("returns integers, because CDP coordinates are pixels", () => {
    const box = { left: 0, top: 0, width: 333, height: 111 };

    const { x, y } = frameCoordinates({ clientX: 100, clientY: 37 }, box, FRAME);
    expect(Number.isInteger(x)).toBe(true);
    expect(Number.isInteger(y)).toBe(true);
  });
});

describe("modifier bits", () => {
  const none = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false };

  it("is zero when nothing is held", () => {
    expect(modifiersOf(none)).toBe(0);
  });

  it("uses CDP's own order", () => {
    expect(modifiersOf({ ...none, altKey: true })).toBe(1);
    expect(modifiersOf({ ...none, ctrlKey: true })).toBe(2);
    expect(modifiersOf({ ...none, metaKey: true })).toBe(4);
    expect(modifiersOf({ ...none, shiftKey: true })).toBe(8);
  });

  it("carries Shift, which is what a capital letter in a password needs", () => {
    // Without the bit the page sees an unmodified keypress, and a typed
    // password silently becomes lowercase.
    expect(modifiersOf({ ...none, shiftKey: true }) & 8).toBe(8);
  });

  it("combines held modifiers", () => {
    expect(modifiersOf({ altKey: true, ctrlKey: true, metaKey: true, shiftKey: true })).toBe(15);
    // The guard clamps at 15, so nothing here can exceed it.
    expect(modifiersOf({ altKey: true, ctrlKey: true, metaKey: true, shiftKey: true })).toBeLessThanOrEqual(15);
  });
});
