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

  it("switches off, then gathers", () => {
    expect(scanHandoffStage(2_700, false)).toBe("collapsing");
    expect(scanHandoffStage(4_000, false)).toBe("gathering");
    expect(scanHandoffStage(90_000, false)).toBe("gathering");
  });

  it("is monotonic — it never returns to an earlier stage", () => {
    const order = ["watching", "collapsing", "gathering"];
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
    expect(SOURCE).toContain('className="absolute inset-0 overflow-hidden bg-app"');
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
    expect(panel).toContain("<ScanHandoff running={busy && !error} />");
  });

  it("is hidden from assistive technology, because it says nothing", () => {
    // Everything a founder needs is in the status panel below it. If this
    // were announced, it would be announcing decoration.
    expect(SOURCE).toContain("aria-hidden");
  });
});
