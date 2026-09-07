import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { scanHandoffStage } from "./scan-handoff";

/**
 * The handoff from watching a browser to waiting for a result.
 *
 * Motion in this repository is encouraged and restricted in exactly one
 * direction: it may never say something the product has not observed. So the
 * assertions below are about the three obligations and the ambience line, not
 * about how it looks.
 */

const SOURCE = readFileSync(
  join(process.cwd(), "src/app/app/projects/[projectId]/scan-handoff.tsx"),
  "utf8",
);

describe("the sequence", () => {
  it("leaves the real browser on screen before taking it over", () => {
    // The founder asked to see the crawl start, and it is the only part of
    // this that is not decoration.
    expect(scanHandoffStage(0, false)).toBe("watching");
    expect(scanHandoffStage(2_000, false)).toBe("watching");
  });

  it("switches off, boots, then gathers", () => {
    expect(scanHandoffStage(2_700, false)).toBe("collapsing");
    expect(scanHandoffStage(3_500, false)).toBe("booting");
    expect(scanHandoffStage(6_000, false)).toBe("gathering");
    expect(scanHandoffStage(90_000, false)).toBe("gathering");
  });

  it("is monotonic — it never returns to an earlier stage", () => {
    const order = ["watching", "collapsing", "booting", "gathering"];
    let lowest = 0;
    for (let ms = 0; ms <= 20_000; ms += 100) {
      const index = order.indexOf(scanHandoffStage(ms, false));
      expect(index, `${ms}ms`).toBeGreaterThanOrEqual(lowest);
      lowest = index;
    }
  });
});

describe("reduced motion is the same information without the movement", () => {
  it("starts at the end state rather than playing the sequence", () => {
    // Not a degraded experience: every piece of content is present at first
    // paint. The end state is the information; there is nothing to wait for.
    for (const ms of [0, 500, 2_700, 40_000]) {
      expect(scanHandoffStage(ms, true), `${ms}ms`).toBe("gathering");
    }
  });

  it("renders no switch-off and no tiles", () => {
    expect(SOURCE).toContain('stage === "collapsing" && !reducedMotion');
    expect(SOURCE).toMatch(/\{!reducedMotion &&\s*\n\s*visible &&/);
  });
});

describe("the three obligations", () => {
  it("pauses continuous motion on a hidden tab", () => {
    // A loop in a background tab is a battery cost nobody consented to.
    expect(SOURCE).toContain("useDocumentVisible");
    expect(SOURCE).toMatch(/visible &&\s*\n\s*box !== null/);
  });

  it("reserves no geometry of its own", () => {
    /*
     * It fills the frame's box, which the dialog already sizes from the live
     * picture. A component that introduced its own height here would move
     * text a person is reading at the exact moment the picture disappears.
     */
    expect(SOURCE).toContain("pointer-events-none absolute inset-0 overflow-hidden");
  });

  it("animates only properties that composite", () => {
    // No width, height, top, left or box-shadow — this runs on a phone in the
    // middle of a scan, on two vCPUs it does not own.
    const animated = SOURCE.match(/animate=\{\{[\s\S]*?\}\}/g) ?? [];
    expect(animated.length).toBeGreaterThan(0);
    for (const block of animated) {
      expect(block, block).not.toMatch(/\b(width|top|left|boxShadow):/);
    }
  });
});

describe("ambience, not a false state", () => {
  it("carries no text a person could read as a page Vibe visited", () => {
    /*
     * The tiles are shapes. Vibe does not know from here which page is being
     * read at any moment — the analysis runs inside one request and reports
     * when it is done — so a tile reading `/app/billing` would be the one
     * element in this animation a person reads as information, and wrong.
     */
    const tiles = SOURCE.slice(SOURCE.indexOf("TILE_ORIGINS.map"));
    expect(tiles).not.toMatch(/\/app\//);
    expect(tiles).not.toMatch(/children|<span|\{surface/);
  });

  it("carries no timing: nothing here is derived from elapsed or remaining", () => {
    // A treatment that accelerates with apparent progress is an unmeasured
    // percentage. The flight is a constant.
    const tiles = SOURCE.slice(SOURCE.indexOf("TILE_ORIGINS.map"));
    expect(tiles).toContain("duration: TILE_FLIGHT_S");
    expect(tiles).not.toContain("elapsed");
  });

  it("is bound to a state Vibe observed, and unreachable otherwise", () => {
    // `running` is an analysis Vibe started and has not heard back from. The
    // component renders nothing without it, so it cannot appear over a
    // pending, cancelled or failed scan.
    expect(SOURCE).toContain("if (!running) return null;");

    const panel = readFileSync(
      join(process.cwd(), "src/app/app/projects/[projectId]/deep-scan-panel.tsx"),
      "utf8",
    );
    // `sealing` keeps it mounted through the closing check, which is the one
    // state that outlives `busy` — and it is still gated on an error being
    // absent, so a failed analysis gets no animation at all.
    expect(panel).toContain("running={(busy || sealing) && !error}");
  });

  it("is hidden from assistive technology, because it says nothing", () => {
    // Everything a founder needs is in the status panel below it. If this
    // were announced, it would be announcing decoration.
    expect(SOURCE).toContain("aria-hidden");
  });
});

/*
 * This shipped with a `useEffect` that had **no dependency array** and set a
 * fresh object on every observation. `ResizeObserver` fires on `observe`, that
 * set state, the state re-rendered, the effect ran again because it had no
 * deps, and it observed again — a render loop React ends by throwing, which
 * the section's error boundary caught as "this section didn't load".
 *
 * A founder watched 42 seconds of live browser where the handoff should have
 * been, and leaving the tab made it worse, because a visibility change is
 * another render into the same loop.
 *
 * Neither `react-hooks/set-state-in-effect` nor `exhaustive-deps` sees this:
 * an effect with no array is legal, and the `setState` is inside a callback.
 * So the assertion is here, against every effect in the file rather than the
 * one that was wrong.
 */
describe("no effect in this file can re-run itself", () => {
  /** Every `useEffect(...)` call in the file, balanced to its closing paren. */
  function effectBodies(source: string): string[] {
    const bodies: string[] = [];
    for (const match of source.matchAll(/useEffect\(/g)) {
      let depth = 0;
      let index = source.indexOf("(", match.index);
      const start = index;
      while (index < source.length) {
        if (source[index] === "(") depth += 1;
        else if (source[index] === ")") {
          depth -= 1;
          if (depth === 0) break;
        }
        index += 1;
      }
      bodies.push(source.slice(start, index + 1));
    }
    return bodies;
  }

  it("finds the effects at all, so an empty pass cannot look like a green one", () => {
    expect(effectBodies(SOURCE).length).toBeGreaterThanOrEqual(2);
  });

  it("gives every effect a dependency array", () => {
    for (const body of effectBodies(SOURCE)) {
      expect(body.slice(-400), body.slice(-120)).toMatch(/\}\s*,\s*\[/);
    }
  });

  it("does not turn an unchanged measurement into a state change", () => {
    /*
     * The second half of the fix, and it is needed on its own: a resize
     * observer on a box whose size is a fraction of a live video frame reports
     * the same numbers repeatedly, and a fresh object each time is a re-render
     * each time even with the deps correct.
     */
    const measure = SOURCE.slice(SOURCE.indexOf("new ResizeObserver"));
    expect(measure).toContain("current.w === rect.width && current.h === rect.height");
  });

  it("has the box mounted before the switch-off needs its size", () => {
    // It returned `null` during `watching`, so the element the observer needs
    // did not exist until the collapse had already begun, and the tiles had no
    // geometry for their first frames.
    expect(SOURCE).not.toContain('if (stage === "watching") return null;');
    expect(SOURCE).toContain("pointer-events-none absolute inset-0 overflow-hidden");
  });
});

/*
 * The scan runs for a minute and a half. The first version of this had one
 * scene, so the founder watched the same twelve shapes orbit for most of it.
 */
describe("the boot, and why it is a sweep and not a bar", () => {
  it("plays before the gathering and then never again", () => {
    expect(scanHandoffStage(3_500, false)).toBe("booting");
    // Never returns to it — a boot that replayed would read as a restart.
    for (let ms = 6_000; ms <= 120_000; ms += 1_000) {
      expect(scanHandoffStage(ms, false), `${ms}ms`).not.toBe("booting");
    }
  });

  it("travels rather than fills", () => {
    /*
     * A bar that fills reads as a fraction of the work. It would reach the end
     * in under two seconds and sit full for another ninety while the scan is
     * still running — a completion claim, and the first entry on the
     * never-animate list. A segment crossing a track accumulates nothing.
     */
    const boot = SOURCE.slice(SOURCE.indexOf('stage === "booting"'));
    const scene = boot.slice(0, boot.indexOf('stage === "sealing"'));
    expect(scene).toContain('animate={{ x: ["-120%", "320%"] }}');
    expect(scene).not.toMatch(/width:|scaleX: \[0/);
  });
});

describe("the check is bound to a result, and nothing else", () => {
  it("outranks the clock, so a result never waits for a scene", () => {
    for (const ms of [0, 1_000, 3_500, 90_000]) {
      expect(scanHandoffStage(ms, false, true), `${ms}ms`).toBe("sealing");
    }
  });

  it("is unreachable while the scan is still running", () => {
    // Success animated before success exists is the first thing the motion
    // rules forbid. `succeeded` is the only way into this stage.
    for (let ms = 0; ms <= 120_000; ms += 500) {
      expect(scanHandoffStage(ms, false, false), `${ms}ms`).not.toBe("sealing");
      expect(scanHandoffStage(ms, true, false), `${ms}ms reduced`).not.toBe("sealing");
    }
  });

  it("draws the tick rather than fading it in", () => {
    const seal = SOURCE.slice(SOURCE.indexOf('stage === "sealing"'));
    expect(seal).toContain("pathLength: 0");
    expect(seal).toContain("pathLength: 1");
  });

  it("closes the dialog after the check, not during it", () => {
    expect(SOURCE).toContain("setTimeout(() => onSealed?.(), reducedMotion ? 0 : SEAL_MS)");
  });

  it("makes nobody wait for an outro they cannot see", () => {
    // Reduced motion gets no animation, so a delay before closing would be a
    // pause with no content in it.
    expect(SOURCE).toContain("reducedMotion ? 0 : SEAL_MS");
  });
});

describe("the glyphs are page furniture, not findings", () => {
  it("draws things a web page is made of", () => {
    for (const glyph of ["AtGlyph", "FolderGlyph", "CartGlyph", "TableGlyph", "CodeIcon"]) {
      expect(SOURCE, glyph).toContain(glyph);
    }
  });

  it("still carries no text and no path", () => {
    /*
     * An `@` says "web pages contain things like this", which is true of every
     * web page. It does not say Vibe found a contact form in *this* product.
     * The moment one carries a label or a path, it stops being decoration.
     */
    const tiles = SOURCE.slice(SOURCE.indexOf("TILE_ORIGINS.map"));
    expect(tiles).not.toMatch(/\/app\//);
    expect(tiles).not.toMatch(/\{surface|\{page|label/);
  });
});
