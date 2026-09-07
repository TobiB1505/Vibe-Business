import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  charactersOf,
  frameCoordinates,
  isComposingKey,
  isTap,
  modifiersOf,
} from "./live-browser-canvas";

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

/**
 * The two decisions that make this usable from a phone.
 *
 * The browser worked on a desktop and could not be typed into on a phone, for
 * a reason no rendering catches: iOS opens its keyboard only for a focused
 * editable element, and a canvas is not one whatever its tabindex. So a person
 * could watch their own product, scroll it, tap it — and never enter a
 * password, which is the entire point of the session.
 */
describe("a keystroke the soft keyboard refuses to name", () => {
  it("recognises both shapes a phone reports", () => {
    // iOS says `Unidentified`; Android's composition path says keyCode 229.
    // Forwarding either sends Chromium a keystroke with no key in it.
    expect(isComposingKey({ key: "Unidentified", keyCode: 0 })).toBe(true);
    expect(isComposingKey({ key: "a", keyCode: 229 })).toBe(true);
  });

  it("leaves every real key on the ordinary path", () => {
    // A hardware keyboard, and the three keys a login form needs beyond
    // letters. Treating any of these as composition would break the desktop.
    for (const event of [
      { key: "a", keyCode: 65 },
      { key: "Backspace", keyCode: 8 },
      { key: "Enter", keyCode: 13 },
      { key: "Tab", keyCode: 9 },
      { key: "Shift", keyCode: 16 },
    ]) {
      expect(isComposingKey(event), `${event.key} must not be treated as composition`).toBe(false);
    }
  });
});

describe("typed text becomes the characters a person meant", () => {
  it("splits a word into its letters", () => {
    expect(charactersOf("abc")).toEqual(["a", "b", "c"]);
  });

  it("keeps a two-unit character whole", () => {
    // `split("")` would send two halves of one character, and a password
    // containing one would be typed as something else entirely.
    expect(charactersOf("é😀")).toEqual(["é", "😀"]);
  });

  it("sends nothing for an empty field", () => {
    // The field is emptied after every keystroke, so it is read empty often.
    expect(charactersOf("")).toEqual([]);
  });
});

/**
 * What a phone needs that no pure function can hold.
 *
 * This project has no React rendering harness, so these are source assertions —
 * the same substitute `merge-ui.test.ts` uses and for the same reason. They do
 * not prove what a person sees; they prove the four things whose absence is
 * exactly what made the browser unusable on a phone, each of which is one
 * deletion away from coming back.
 */
/**
 * Frames arriving faster than a device can decode them.
 *
 * Each frame used to get its own `Image` and its own decode. On a phone during
 * a page load that queues work whose only visible effect is the last one: every
 * earlier frame is decoded, painted, and immediately replaced. The device pays
 * for all of them and the person watches the picture run behind.
 */
describe("only the newest frame is decoded", () => {
  const source = readFileSync(
    join(process.cwd(), "src/app/app/projects/[projectId]/live-browser-canvas.tsx"),
    "utf8",
  );

  it("holds the newest frame instead of queueing every one", () => {
    expect(source).toContain("pending.current = message");
    expect(source).toContain("if (decoding.current) return");
  });

  it("takes the held frame as soon as the current decode finishes", () => {
    // Without this the newest frame waits for another to arrive, and a
    // browser that stops changing freezes one frame behind.
    expect(source).toContain("drawNext()");
  });

  it("does not let one bad frame stop the ones behind it", () => {
    expect(source).toContain("image.onerror");
  });

  it("keeps the coordinate space the browser's, not the picture's", () => {
    // The frame may arrive smaller than the viewport. A click is still
    // reported in the page's own pixels, or it lands somewhere else entirely.
    expect(source).toContain("frameSize.current = { w: next.w, h: next.h }");
    expect(source).toContain("drawImage(image, 0, 0, canvas.width, canvas.height)");
  });
});

describe("the keyboard comes up on a tap and not on a scroll", () => {
  /*
   * The first version raised it on every touch, so it reappeared on each drag
   * — covering half the product on a screen that had little enough of it.
   */
  it("treats a still finger as a tap", () => {
    expect(isTap({ x: 100, y: 200 }, { x: 100, y: 200 })).toBe(true);
  });

  it("forgives the wobble a deliberate tap has", () => {
    // A finger is not a mouse. Requiring an exact pixel would mean the
    // keyboard sometimes does not come up, which is the original bug again.
    expect(isTap({ x: 100, y: 200 }, { x: 104, y: 197 })).toBe(true);
  });

  it("treats a drag as a scroll, in either direction", () => {
    expect(isTap({ x: 100, y: 200 }, { x: 100, y: 340 })).toBe(false);
    expect(isTap({ x: 100, y: 200 }, { x: 260, y: 200 })).toBe(false);
  });
});

describe("the temporary browser can be operated by touch", () => {
  const source = readFileSync(
    join(process.cwd(), "src/app/app/projects/[projectId]/live-browser-canvas.tsx"),
    "utf8",
  );

  it("translates touch into the two things a finger means", () => {
    for (const handler of ["onTouchStart", "onTouchMove", "onTouchEnd"]) {
      expect(source).toContain(handler);
    }
  });

  it("scrolls a drag rather than dragging a selection", () => {
    /*
     * The first version pressed on touchstart and sent `mouseMoved` with the
     * button still down. That is not scrolling — it is dragging a selection,
     * and it highlighted the page instead of moving it. A finger has no
     * button; a drag is a wheel.
     */
    const move = source.slice(source.indexOf("onTouchMove"), source.indexOf("onTouchEnd"));

    expect(move).toContain('t: "wheel"');
    expect(move).not.toContain('type: "mouseMoved"');
  });

  it("presses nothing until the finger lifts on a tap", () => {
    // A press sent on touchstart has to be released somewhere, and every
    // release after a drag is a selection.
    const start = source.slice(source.indexOf("onTouchStart"), source.indexOf("onTouchMove"));

    expect(start).not.toContain("mousePressed");
  });

  it("sends the press and the release together, on the tap", () => {
    const end = source.slice(source.indexOf("onTouchEnd"), source.indexOf("onContextMenu"));

    expect(end).toContain("mousePressed");
    expect(end).toContain("mouseReleased");
    expect(end).toContain("isTap(began, point)");
  });

  it("stops a drag scrolling Vibe's page instead of the product", () => {
    expect(source).toContain("touch-none");
  });

  it("keeps a focusable field for the keyboard to attach to", () => {
    // The whole reason a phone could not type: iOS raises its keyboard only
    // for a focused editable element, and a canvas is not one.
    expect(source).toContain("keyboardRef");
    expect(source).toContain("focus({ preventScroll: true })");
  });

  it("raises the keyboard only from the gesture that asked for it", () => {
    // iOS opens a keyboard only inside a user gesture, and `touchend` is one.
    // Moving this out of the handler is how it silently stops working.
    const end = source.slice(source.indexOf("onTouchEnd"), source.indexOf("onContextMenu"));

    expect(end).toContain("takeKeyboard()");
  });

  it("never leaves what was typed sitting in Vibe's DOM", () => {
    // The field is a conduit. Text left in it would be a password in the page.
    expect(source).toContain('event.target.value = ""');
  });

  it("does not ask the browser to remember a credential that is not Vibe's", () => {
    // A password field here would offer to save the customer's product login
    // against Vibe's origin.
    expect(source).toContain('autoComplete="off"');
    expect(source).not.toContain('type="password"');
  });
});
