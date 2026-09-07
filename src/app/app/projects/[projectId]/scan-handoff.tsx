"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { VibeMark } from "@/components/brand/vibe-mark";
import { useDocumentVisible } from "@/lib/client/use-document-visible";

/**
 * The handoff from watching a browser to waiting for a result.
 *
 * ## What it is for
 *
 * When the founder is signed in, Vibe takes the browser and reads about twenty
 * pages in a minute and a half. The live view stays useful for the first
 * seconds — a person can see the crawl start, and that is worth showing — and
 * then it is a video of pages flicking past that nobody is driving. What
 * followed was a spinner and a seconds counter.
 *
 * So the picture is handed over: the frame switches off the way a CRT does,
 * the mark takes its place, and Vibe visibly gathers while the analysis runs.
 *
 * ## Why this is admissible motion (DESIGN.md § Craft and Motion)
 *
 * The three properties the motion skill requires, held in the code rather than
 * claimed in a comment:
 *
 *  - **Bound to an observed state.** It is mounted only while an analysis
 *    Vibe actually started is actually running. It cannot appear over a
 *    pending, paused or failed scan, because it is not rendered then.
 *  - **Removable without loss.** Every word a founder needs is in the status
 *    panel below it — what is happening, how long it usually takes, and that
 *    closing the window stops the browser. Delete this component and nothing
 *    a person knows changes.
 *  - **Carrying no timing.** The tiles arrive on a fixed period. Nothing here
 *    speeds up, fills up, or counts down, because the analysis reports nothing
 *    until it is finished and any pace would be invented.
 *
 * ## Why the tiles carry no text
 *
 * They are shapes, and that is deliberate rather than timid. Everything else
 * on screen during this animation is decoration a person reads as decoration.
 * A tile reading `/app/billing` would be the one element they read as
 * *information* — and Vibe does not know, from here, which page is being read
 * at any moment, because the analysis runs inside one request and reports when
 * it is done. A path that is wrong teaches a founder that Vibe's screen makes
 * things up, which costs more than the animation earns.
 */

/** How long the founder keeps watching the real browser before the handoff. */
const WATCH_MS = 2_600;
/** The switch-off itself. Short: it is a transition, not a scene. */
const COLLAPSE_MS = 620;

export type ScanHandoffStage = "watching" | "collapsing" | "gathering";

/**
 * Which stage a given moment belongs to.
 *
 * Pure, so the sequence is testable without a browser, a timer or a rendered
 * frame — and so the reduced-motion answer is a value rather than a branch
 * scattered through the component.
 */
export function scanHandoffStage(elapsedMs: number, reducedMotion: boolean): ScanHandoffStage {
  // Reduced motion is not a degraded experience: it is the same information
  // without the movement. The end state is the information, so it starts there.
  if (reducedMotion) return "gathering";
  if (elapsedMs < WATCH_MS) return "watching";
  if (elapsedMs < WATCH_MS + COLLAPSE_MS) return "collapsing";
  return "gathering";
}

/**
 * Where each tile starts, as a fraction of the box.
 *
 * Fixed rather than random. A random field re-rolls on every re-render — and
 * this component re-renders on every state change in the dialog above it — so
 * tiles would jump mid-flight. Twelve is enough that the loop does not read as
 * a loop.
 */
const TILE_ORIGINS = [
  { x: -0.62, y: -0.34 },
  { x: 0.58, y: -0.4 },
  { x: -0.7, y: 0.18 },
  { x: 0.66, y: 0.3 },
  { x: -0.28, y: -0.52 },
  { x: 0.3, y: 0.52 },
  { x: -0.55, y: 0.46 },
  { x: 0.5, y: -0.5 },
  { x: -0.74, y: -0.06 },
  { x: 0.72, y: 0.02 },
  { x: 0.12, y: -0.58 },
  { x: -0.1, y: 0.58 },
];

/** One tile's flight, on a fixed period with a fixed offset. */
const TILE_FLIGHT_S = 2.2;
const TILE_STAGGER_S = 0.34;

export function ScanHandoff({ running }: { running: boolean }) {
  const reducedMotion = useReducedMotion() ?? false;
  const visible = useDocumentVisible();

  /*
   * Elapsed is state rather than a ref because the stage is derived from it
   * during render. A ref read at render time is the bug that would make this
   * stop advancing, and the repository has an existing note about exactly that
   * in `useElapsedSeconds`.
   */
  const [elapsedMs, setElapsedMs] = useState(0);
  const startedAt = useRef<number | null>(null);

  /*
   * The box, measured.
   *
   * The tiles fly from the edges to the centre, and that distance is a
   * fraction of *this container* — which a CSS percentage on a transform is
   * not: `x: "100%"` on a 48-pixel tile moves it 48 pixels. Measuring is the
   * only way to get a phone and a desktop both right, and the alternative
   * (fixed pixel offsets) is wrong on both.
   */
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    if (!running) {
      startedAt.current = null;
      return;
    }
    startedAt.current = Date.now();

    // Coarse on purpose: the sequence has two boundaries, and a 16ms timer to
    // find them would wake the main thread sixty times a second to compare two
    // numbers. Motion itself runs on the compositor.
    const timer = setInterval(() => {
      if (startedAt.current === null) return;
      setElapsedMs(Date.now() - startedAt.current);
    }, 120);

    return () => clearInterval(timer);
  }, [running]);

  useEffect(() => {
    const element = boxRef.current;
    if (!element) return;

    // Observed rather than read once: the dialog's box is sized from the live
    // frame, so it can change shape under this component.
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      setBox({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    observer.observe(element);

    return () => observer.disconnect();
  });

  if (!running) return null;

  const stage = scanHandoffStage(elapsedMs, reducedMotion);
  // The picture stays on screen and untouched while the founder is still
  // watching it; this component only takes over at the switch-off.
  if (stage === "watching") return null;

  return (
    <div ref={boxRef} className="absolute inset-0 overflow-hidden bg-app" aria-hidden>
      <AnimatePresence>
        {stage === "collapsing" && !reducedMotion && (
          /*
           * The switch-off. A CRT collapses vertically to a line, holds it for
           * a moment as it brightens, then pulls the line into a point.
           *
           * `transform` and `opacity` only — both composite, so this costs no
           * layout on a phone in the middle of a scan.
           */
          <motion.div
            key="collapse"
            className="absolute inset-0 flex items-center justify-center"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="w-full bg-mint"
              initial={{ height: "100%", scaleX: 1, opacity: 0.9 }}
              animate={{ height: ["100%", "2px", "2px"], scaleX: [1, 1, 0], opacity: [0.35, 1, 0] }}
              transition={{
                duration: COLLAPSE_MS / 1000,
                times: [0, 0.55, 1],
                ease: "easeInOut",
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {stage === "gathering" && (
        <div className="absolute inset-0 flex items-center justify-center">
          {/*
            The mark arrives once and then holds. It is the thing the tiles are
            arriving *at*, so it must not be moving itself — two things in
            motion around each other reads as instability rather than gathering.
          */}
          <motion.div
            initial={reducedMotion ? false : { scale: 0.7, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.42, ease: [0.2, 0.8, 0.2, 1] }}
            className="relative"
          >
            {/* A soft ground so the tiles disappear into something. */}
            <div className="absolute -inset-8 rounded-full bg-mint-tint blur-2xl" />
            <VibeMark size={56} className="relative" />
          </motion.div>

          {/*
            The tiles run only while the tab is being looked at. A loop in a
            background tab is a battery cost nobody consented to, and reduced
            motion removes them entirely — nothing they carry is information.
          */}
          {!reducedMotion &&
            visible &&
            box !== null &&
            TILE_ORIGINS.map((origin, index) => (
              <motion.div
                key={index}
                className="border-line-2 bg-surface-3 rounded-nav shadow-card absolute h-8 w-12 border"
                initial={{
                  x: origin.x * box.w,
                  y: origin.y * box.h,
                  opacity: 0,
                  scale: 0.9,
                  rotate: origin.x * 14,
                }}
                animate={{
                  x: [origin.x * box.w, origin.x * box.w * 0.82, 0],
                  y: [origin.y * box.h, origin.y * box.h * 0.82, 0],
                  opacity: [0, 1, 0],
                  scale: [0.9, 1, 0.3],
                  rotate: [origin.x * 14, origin.x * 8, 0],
                }}
                transition={{
                  duration: TILE_FLIGHT_S,
                  times: [0, 0.2, 1],
                  ease: [0.32, 0, 0.2, 1],
                  repeat: Infinity,
                  // The stagger spreads twelve tiles across one cycle, so the
                  // field never empties and never arrives all at once.
                  repeatDelay: Math.max(
                    0,
                    TILE_ORIGINS.length * TILE_STAGGER_S - TILE_FLIGHT_S,
                  ),
                  delay: index * TILE_STAGGER_S,
                }}
              />
            ))}
        </div>
      )}
    </div>
  );
}
