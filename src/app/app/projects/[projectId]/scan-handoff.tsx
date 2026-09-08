"use client";

import { useEffect, useRef, useState, type ReactElement } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { VibeMark } from "@/components/brand/vibe-mark";
import { CodeIcon } from "@/components/ui/dashboard-icons";
import {
  AtGlyph,
  BellGlyph,
  ButtonGlyph,
  CartGlyph,
  FieldGlyph,
  FolderGlyph,
  ImageGlyph,
  LinkGlyph,
  ParagraphGlyph,
  PlayGlyph,
  TableGlyph,
} from "./scan-glyphs";
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
/**
 * The boot.
 *
 * An **indeterminate** sweep, not a filling bar, and the difference is the
 * whole reason this is allowed to exist. A bar that fills reads as a fraction
 * of the work; it would reach the end in under two seconds and then sit there
 * for another ninety, which is a completion claim over a scan still running. A
 * segment travelling a track accumulates nothing and claims nothing.
 */
const BOOT_MS = 1_900;
/**
 * The check, when the analysis comes back.
 *
 * Was 1.5 seconds, and the founder's report was "Haken und weg" — the tick
 * drew and the dialog was already gone. 0.2s of delay plus 0.42s of drawing
 * leaves under a second of a finished check on screen, which is not enough to
 * register as the answer to a ninety-second wait. It is the last thing a
 * person sees of this flow, and it should feel like an ending.
 */
const SEAL_MS = 2_600;

export type ScanHandoffStage = "watching" | "collapsing" | "booting" | "gathering" | "sealing";

/**
 * Which stage a given moment belongs to.
 *
 * Pure, so the sequence is testable without a browser, a timer or a rendered
 * frame — and so the reduced-motion answer is a value rather than a branch
 * scattered through the component.
 */
export function scanHandoffStage(
  elapsedMs: number,
  reducedMotion: boolean,
  /** Set once the analysis has come back with a result. */
  succeeded = false,
): ScanHandoffStage {
  // The outcome outranks the clock. A result that arrives during the boot
  // must not wait for a scene the founder no longer needs.
  if (succeeded) return "sealing";
  // Reduced motion is not a degraded experience: it is the same information
  // without the movement. The end state is the information, so it starts there.
  if (reducedMotion) return "gathering";
  if (elapsedMs < WATCH_MS) return "watching";
  if (elapsedMs < WATCH_MS + COLLAPSE_MS) return "collapsing";
  if (elapsedMs < WATCH_MS + COLLAPSE_MS + BOOT_MS) return "booting";
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
const TILE_ORIGINS: { x: number; y: number; Glyph: (props: { size?: number }) => ReactElement }[] = [
  { x: -0.62, y: -0.34, Glyph: AtGlyph },
  { x: 0.58, y: -0.4, Glyph: FolderGlyph },
  { x: -0.7, y: 0.18, Glyph: CodeIcon },
  { x: 0.66, y: 0.3, Glyph: ImageGlyph },
  { x: -0.28, y: -0.52, Glyph: FieldGlyph },
  { x: 0.3, y: 0.52, Glyph: CartGlyph },
  { x: -0.55, y: 0.46, Glyph: TableGlyph },
  { x: 0.5, y: -0.5, Glyph: ButtonGlyph },
  { x: -0.74, y: -0.06, Glyph: ParagraphGlyph },
  { x: 0.72, y: 0.02, Glyph: BellGlyph },
  { x: 0.12, y: -0.58, Glyph: LinkGlyph },
  { x: -0.1, y: 0.58, Glyph: PlayGlyph },
];

/** One tile's flight, on a fixed period with a fixed offset. */
const TILE_FLIGHT_S = 2.2;
const TILE_STAGGER_S = 0.34;

export function ScanHandoff({
  running,
  succeeded = false,
  progress = null,
  onSealed,
}: {
  running: boolean;
  /** The analysis came back with a result. Drives the closing check. */
  succeeded?: boolean;
  /**
   * Pages read so far, counted by the analysis itself.
   *
   * `null` until the running scan has answered, and the scene reads correctly
   * without it — which is the test of whether it is decoration or information.
   * This one is information: it is the only true thing this animation can say
   * about how far the work has got, so it is rendered as text, not as motion.
   */
  progress?: { pagesInspected: number; maxPages: number } | null;
  /** Called once the check has played, so the dialog closes after it and not during. */
  onSealed?: () => void;
}) {
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

  /*
   * Measured once the element exists, and re-measured only when it changes.
   *
   * This shipped with **no dependency array** and a fresh object on every
   * observation. `ResizeObserver` fires on `observe`, that set state, the
   * state re-rendered, the effect ran again because it had no deps, and it
   * observed again — a render loop that React ends by throwing, which the
   * section's error boundary caught as "this section didn't load". The
   * animation never appeared; a founder watched 42 seconds of live browser
   * where the handoff should have been, and leaving the tab made it worse
   * because the visibility change is another render.
   *
   * Two fixes, and both are needed. The dependency array stops the effect
   * re-running per render, and the equality check stops an observation that
   * reports the same size from being a state change at all — a resize
   * observer on a box whose size is a fraction of a live video frame will
   * report the same numbers repeatedly.
   */
  useEffect(() => {
    const element = boxRef.current;
    if (!element) return;

    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      setBox((current) =>
        current && current.w === rect.width && current.h === rect.height
          ? current
          : { w: rect.width, h: rect.height },
      );
    });
    observer.observe(element);

    return () => observer.disconnect();
  }, [running]);

  /*
   * The dialog closes after the check, not during it.
   *
   * The callback is in the dependency list rather than stashed in a ref
   * written during render — the caller holds it in a `useCallback`, which is
   * where stability belongs. A ref assigned at render time is the thing this
   * repository has already been bitten by twice.
   */
  useEffect(() => {
    if (!succeeded) return;
    // Reduced motion gets no outro to wait for: there is nothing to watch, so
    // making somebody wait for it would be a delay with no content in it.
    const timer = setTimeout(() => onSealed?.(), reducedMotion ? 0 : SEAL_MS);
    return () => clearTimeout(timer);
  }, [succeeded, reducedMotion, onSealed]);

  if (!running) return null;

  const stage = scanHandoffStage(elapsedMs, reducedMotion, succeeded);

  /*
   * The box is mounted for the whole run, empty while the founder is still
   * watching the real browser.
   *
   * It used to return `null` during `watching`, so the element the observer
   * needed did not exist until the switch-off had already begun — the tiles
   * then had no geometry for their first frames. An empty, transparent,
   * pointer-transparent box costs nothing and means the measurement is ready
   * before it is wanted.
   */
  return (
    <div
      ref={boxRef}
      className={`pointer-events-none absolute inset-0 overflow-hidden ${
        stage === "watching" ? "" : "bg-app"
      }`}
    >
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
            aria-hidden
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

      {stage === "booting" && (
        /*
         * The boot.
         *
         * An **indeterminate** sweep: a bright segment crossing a track, twice,
         * then gone. Not a filling bar — a bar that fills reads as a fraction
         * of the work, would reach the end in under two seconds, and would then
         * sit full for another ninety while the scan is still running. That is
         * a completion claim, and it is the exact thing the motion rules name
         * as never animatable. A travelling segment accumulates nothing.
         */
        <div
          aria-hidden
          className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-8"
        >
          <motion.p
            className="text-fg-meta font-mono text-meta tracking-[0.3em] uppercase"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            Deep Scan
          </motion.p>
          <div className="border-line-2 relative h-[3px] w-full max-w-xs overflow-hidden rounded-full border-y-0 bg-surface-3">
            <motion.div
              className="bg-mint absolute inset-y-0 w-1/3 rounded-full"
              initial={{ x: "-120%" }}
              animate={{ x: ["-120%", "320%"] }}
              transition={{
                duration: BOOT_MS / 2 / 1000,
                ease: "easeInOut",
                repeat: 1,
              }}
            />
          </div>
        </div>
      )}

      {stage === "sealing" && (
        /*
         * The close.
         *
         * Bound to the one state that earns it: `succeeded` is set only when
         * the analysis has come back with a result. A check drawn before a
         * result exists would be success animated before success — the first
         * entry on the never-animate list.
         */
        <div aria-hidden className="absolute inset-0 flex items-center justify-center">
          <motion.div
            className="bg-mint text-mint-ink flex size-20 items-center justify-center rounded-full"
            initial={reducedMotion ? false : { scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.42, ease: [0.2, 0.9, 0.2, 1] }}
          >
            {/*
              The tick is *drawn* rather than faded in: `pathLength` animates
              the stroke itself, so it reads as Vibe finishing something rather
              than as an image appearing.
            */}
            <motion.svg
              viewBox="0 0 24 24"
              className="size-10"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <motion.path
                d="m5 12.5 4.5 4.5L19 7.5"
                initial={reducedMotion ? false : { pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.42, delay: 0.2, ease: "easeOut" }}
              />
            </motion.svg>
          </motion.div>
        </div>
      )}

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
            aria-hidden
            className="relative"
          >
            {/* A soft ground so the tiles disappear into something. */}
            <div className="absolute -inset-8 rounded-full bg-mint-tint blur-2xl" />
            <VibeMark size={56} className="relative" />
          </motion.div>

          {progress !== null && (
            /*
             * The count, and the reason this scene is worth watching.
             *
             * Measured, not estimated: it is pages the analysis has actually
             * recorded, polled from the running row. The bar behind it is the
             * same number against Vibe's page budget — honest as a ceiling
             * rather than a forecast, which is why the words say "up to". A
             * scan often stops before the budget because it runs out of
             * product, so the bar reaching four fifths and then handing over
             * to the check is the normal ending, not a truncation.
             *
             * `role="status"` and `aria-live="polite"`: this is the one thing
             * on screen here that carries information, so it is the one thing
             * announced.
             */
            <div
              role="status"
              aria-live="polite"
              /*
               * Announced, and the only thing here that is.
               *
               * The whole container used to be `aria-hidden`, which is right
               * for twelve orbiting shapes and wrong for the one element that
               * carries a fact. A browser test caught it: `getByRole("status")`
               * found nothing, because a decorative wrapper had removed the
               * information inside it from the accessibility tree.
               */
              className="absolute inset-x-6 bottom-6 space-y-2 text-center sm:inset-x-10"
            >
              <p className="text-fg-body font-mono text-sm">
                {progress.pagesInspected === 0
                  ? "Opening the first page"
                  : `${progress.pagesInspected} ${progress.pagesInspected === 1 ? "page" : "pages"} read`}
                <span className="text-fg-meta"> · up to {progress.maxPages}</span>
              </p>
              <div className="bg-surface-3 mx-auto h-[3px] w-full max-w-xs overflow-hidden rounded-full">
                <motion.div
                  className="bg-mint h-full rounded-full"
                  initial={false}
                  animate={{
                    scaleX: Math.min(1, progress.pagesInspected / progress.maxPages),
                  }}
                  style={{ transformOrigin: "left" }}
                  transition={{ duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }}
                />
              </div>
            </div>
          )}

          {/*
            The tiles run only while the tab is being looked at. A loop in a
            background tab is a battery cost nobody consented to, and reduced
            motion removes them entirely — nothing they carry is information.
          */}
          {!reducedMotion &&
            visible &&
            box !== null &&
            TILE_ORIGINS.map(({ Glyph, ...origin }, index) => (
              <motion.div
                key={index}
                aria-hidden
                className="border-line-2 bg-surface-3 rounded-nav shadow-card text-fg-muted absolute flex h-11 w-11 items-center justify-center border"
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
              >
                <Glyph size={18} />
              </motion.div>
            ))}
        </div>
      )}
    </div>
  );
}
