"use client";

import { motion, useReducedMotion } from "motion/react";
import { useId, useMemo } from "react";
import { useDocumentVisible } from "@/lib/client/use-document-visible";
import { cn } from "@/lib/utils/cn";

/**
 * Nova's avatar: a five-blade aperture with her light curve at its centre.
 *
 * Lifted from the high-fidelity prototype (`claude/nova-hifi-prototype`),
 * which is the adopted design target. The geometry, the four states and the
 * reasoning below are that prototype's; what production adds is the binding —
 * a presence state here is derived from what the domain actually observed
 * (`novaPresenceState` in `components/system/status-vocabulary.ts`) rather
 * than chosen per scene, because a mark that could be set to `working` by a
 * caller is a mark that can claim work nobody is doing.
 *
 * ## The two ingredients, and why they belong together
 *
 * An **aperture**, because Nova's job is to look at the product — she reads
 * the repository, the live site and the business around it. An iris dilates
 * when it is taking something in and rests when it is not, which is a picture
 * of attention rather than of labour. It is also machined rather than organic,
 * which keeps the mark on the operations-console side of the register instead
 * of drifting into mascot. Notably it is *not* the glowing orb `DESIGN.md`
 * names as a cliché, and not a second copy of `AgentCore`'s rings, which
 * already mean **work in progress** on the one screen where a founder waits.
 *
 * A **light curve**, because a nova is its light curve: flat, a steep rise, a
 * slow decay. Nested, the instrument is looking at the event — Nova's whole
 * job in one shape.
 *
 * ## The four states
 *
 * - `idle` — the narrowest of the four, dim, and **still**. Nothing is
 *   happening.
 * - `listening` — open and lit. A question is sitting with a person.
 * - `working` — the frame turns at a **constant** rate and the curve traces.
 *   Constant by rule: a mark that accelerated with apparent progress would be
 *   a progress bar in disguise, and no measured fraction exists behind it.
 * - `settled` — widest and brightest, and **still**. A failed run lands here
 *   too, which is why nothing about it celebrates.
 *
 * Continuous motion stops when the tab is hidden and under reduced motion,
 * with the whole mark still legible. The entrance is deliberately *not* gated
 * on visibility — see `introduce`.
 */

export type NovaPresenceState = "idle" | "listening" | "working" | "settled";

const SIZES = {
  sm: { px: 28, stroke: 0.8 },
  md: { px: 44, stroke: 1 },
  lg: { px: 72, stroke: 1.1 },
  hero: { px: 132, stroke: 1.3 },
} as const;

export type NovaPresenceSize = keyof typeof SIZES;

const BLADES = 5;
/** Inner radius per unit of `open`. Wide, so the curve is the subject. */
export const HOLE = 52;

/**
 * The light curve, in its own 48-unit box, and how it is placed in the frame.
 *
 * Exported with `HOLE` and `APERTURE` because the mark has one geometric
 * invariant worth holding: no opening may close inside the curve it exists to
 * frame. `nova-presence.test.ts` derives the curve's reach from these values
 * and checks every state against it, which is the check `idle` shipped
 * without.
 */
export const CURVE = {
  /** Scaled about the curve's *visual* middle, which is not the box's. */
  scale: 40 / 39,
  origin: { x: 24.5, y: 23.5 },
  /** The quiet baseline before the event. */
  baseline: { d: "M5 35 H16", width: 2.4 },
  /** The rise and the decay. Drawn twice: a dim track, then the lit stroke. */
  rise: { d: "M16 35 C19.5 35 20.5 12 24 12 C28.5 12 31 27 44 30.5", width: 2.9 },
  /** The one point on a light curve anybody reads first. */
  peak: { x: 24, y: 12, r: 3.2 },
} as const;

/** How far the iris stands open per state. */
export const APERTURE: Record<NovaPresenceState, number> = {
  /*
   * The one opening the prototype never drew, and so the one it could not
   * hand over. Its nine scenes and its intro render `listening`, `working`
   * and `settled` only; `idle` exists there as a type member and a default
   * argument and is never on screen.
   *
   * It arrived here at 0.4, and at 0.4 the blades close inside the mark they
   * are supposed to frame: the light curve reaches 24.45 units from centre
   * (its far end, bottom-left, half its stroke included) while the blades'
   * inner edge sits at 0.4 × HOLE = 20.8. The curve crossed the blades by
   * 3.65 units — the collision the other three states never show, because
   * the narrowest of them clears it by 3.63.
   *
   * 0.5 puts the inner edge at 26 and clears the curve by 1.55. It keeps
   * `idle` the narrowest opening of the four, which is the whole of what the
   * state has to say geometrically; the rest of what separates it from
   * `working` is `LUMA` and stillness, which is where the difference was
   * always carried.
   */
  idle: 0.5,
  listening: 0.62,
  working: 0.54,
  /*
   * The states should read as one object at different openings, not as four
   * drawings, so the spread between widest and narrowest is kept narrow
   * enough that the blades keep their mass throughout.
   */
  settled: 0.68,
};

/** How lit the mark is. One scalar, so the four states stay one idea. */
const LUMA: Record<NovaPresenceState, number> = {
  idle: 0.4,
  listening: 0.82,
  working: 0.94,
  settled: 1,
};

/**
 * A small integer hash, so one project always draws the same mark.
 *
 * Not cryptographic and not trying to be — it decides a rotation offset. What
 * it has to be is *stable*, which `Math.random` on mount would not be, and
 * distinct enough that two neighbouring project names do not collide visually.
 */
function seedPhase(seed: string): number {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) | 0;
  }
  return (Math.abs(hash) % 360) / 360;
}

/**
 * One iris blade, as a polygon.
 *
 * A real iris blade **pivots**: closing, it swings across the centre and
 * slides over its neighbour, and the hole that remains is the polygon their
 * overlapping inner edges leave behind. Two terms carry that — `swing` rotates
 * the blade, and `curl` offsets its inner edge past the outer one into the
 * leaf shape that lets it lie over the next. Both fall to zero as it opens.
 *
 * `spread` interpolates: 0.62 of a fifth when open, a full fifth when shut,
 * where the blades meet exactly.
 */
function bladePoints(index: number, open: number, phase: number): string {
  const shut = 1 - open;
  const swing = shut * 0.6;
  const curl = shut * 0.9;

  const base = (index / BLADES) * Math.PI * 2 + phase * Math.PI * 2 - Math.PI / 2 + swing;
  const inner = open * HOLE;
  const outer = 44;
  const spread = ((Math.PI * 2) / BLADES) * (0.62 + shut * 0.38);

  const point = (radius: number, offset: number) =>
    `${(50 + Math.cos(base + offset) * radius).toFixed(2)},${(50 + Math.sin(base + offset) * radius).toFixed(2)}`;

  return [
    point(outer, -spread / 2),
    point(outer, spread / 2),
    point(inner, spread / 2 + curl),
    point(inner, -spread / 2 + curl),
  ].join(" ");
}

export function NovaPresence({
  state = "idle",
  seed = "vibe",
  size = "md",
  introduce = false,
  className,
}: {
  /**
   * Derived from observed state, never chosen for effect.
   *
   * `novaPresenceState` is the one function that produces this from a focus
   * tier and an operation phase. A caller passing `working` by hand would be
   * asserting activity the product has not observed.
   */
  state?: NovaPresenceState;
  /** Stable per project, so the mark is an identity rather than an ornament. */
  seed?: string;
  size?: NovaPresenceSize;
  /**
   * Assemble the mark on mount, once.
   *
   * Reserved for the one screen where a founder meets Nova for the first time:
   * the blades seat themselves one by one, the iris opens with all five moving
   * together, and the curve draws itself last.
   *
   * **Gated on reduced motion only, never on visibility.** `useDocumentVisible`
   * starts `false` because there is no `document` during server rendering, and
   * Motion reads `initial` on the first render and never again — so including
   * it here would mount the mark already finished and the introduction would
   * silently not happen. `DESIGN.md`'s obligation is that *continuous* motion
   * pauses while hidden; an entrance is not continuous.
   */
  introduce?: boolean;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const visible = useDocumentVisible();
  const animate = !reduceMotion && visible;

  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const { px, stroke } = SIZES[size];
  const phase = useMemo(() => seedPhase(seed), [seed]);
  const open = APERTURE[state];
  const luma = LUMA[state];

  const blades = useMemo(
    () => Array.from({ length: BLADES }, (_, index) => bladePoints(index, open, phase)),
    [open, phase],
  );
  /* The shut position the introduction opens from. Same geometry, zero open. */
  const shutBlades = useMemo(
    () => Array.from({ length: BLADES }, (_, index) => bladePoints(index, 0, phase)),
    [phase],
  );

  const opening = introduce && reduceMotion !== true;
  /* Only a live read turns the frame or traces the curve. */
  const working = state === "working" && animate;

  return (
    <span
      className={cn("relative inline-flex shrink-0", className)}
      style={{ width: px, height: px }}
      data-nova-presence={state}
    >
      {/* Contained atmosphere. Absent at rest — a glow behind an idle mark
          would claim activity the product cannot support. */}
      <span
        aria-hidden
        className="pointer-events-none absolute rounded-full"
        style={{
          inset: "-20%",
          background: `radial-gradient(circle, color-mix(in oklab, var(--color-mint) ${Math.round(luma * 24)}%, transparent) 0%, transparent 66%)`,
          filter: "blur(5px)",
        }}
      />

      <svg viewBox="0 0 100 100" width={px} height={px} aria-hidden className="relative">
        {!reduceMotion && (
          <style>{`
            @keyframes nTrace-${id} {
              0% { stroke-dashoffset: 62; } 55% { stroke-dashoffset: 0; } 100% { stroke-dashoffset: 0; }
            }
            .nTrace-${id} { stroke-dasharray: 62; animation: nTrace-${id} 2.6s linear infinite; }

            /*
              The peak lights when the stroke reaches it, not before. The peak
              is roughly 46% along the path, and the trace covers the path over
              the first 55% of the cycle — so the light belongs at about 28%.
              The trace runs on a linear curve for the same reason: with an
              eased one the two could not be lined up by arithmetic.
            */
            @keyframes nPeakTrace-${id} {
              0%, 25% { opacity: 0; } 31%, 100% { opacity: 1; }
            }
            .nPeakTrace-${id} { animation: nPeakTrace-${id} 2.6s linear infinite; }

            @keyframes nDraw-${id} { from { stroke-dashoffset: 62; } to { stroke-dashoffset: 0; } }
            .nDraw-${id} { stroke-dasharray: 62; animation: nDraw-${id} 750ms cubic-bezier(0.33,0,0.2,1) 1.3s both; }

            /* Same rule for the entrance: the swipe passes, then the peak lights. */
            @keyframes nPeakDraw-${id} { from { opacity: 0; } to { opacity: 1; } }
            .nPeakDraw-${id} { animation: nPeakDraw-${id} 240ms ease-out 1.72s both; }

            @keyframes nSpin-${id} { to { transform: rotate(360deg); } }
            .nSpin-${id} { animation: nSpin-${id} 26s linear infinite; transform-origin: 50px 50px; }
          `}</style>
        )}

        {/*
          The frame turns slowly while Nova reads. The curve below sits outside
          this group on purpose: the instrument moves and the measurement holds
          still, and a logo that spun with its housing would stop being a logo.
        */}
        <g className={working ? `nSpin-${id}` : undefined}>
          {blades.map((points, index) => (
            <motion.polygon
              key={index}
              points={points}
              fill="var(--color-mint)"
              fillOpacity={0.09 * luma}
              stroke="var(--color-mint)"
              strokeOpacity={0.42 * luma}
              strokeWidth={stroke}
              strokeLinejoin="round"
              /*
                Two phases, staggered oppositely on purpose. **Assembling** —
                the blades appear one after another, because these are parts
                arriving and watching them seat is the point. **Operating** —
                the iris then opens with every blade moving at once, because
                the blades of an aperture are mechanically linked and a cascade
                is what a fan does, not a mechanism.
              */
              initial={opening ? { points: shutBlades[index], opacity: 0, scale: 0.88 } : false}
              animate={{ points, opacity: 1, scale: 1 }}
              transition={
                reduceMotion
                  ? { duration: 0 }
                  : opening
                    ? {
                        opacity: { duration: 0.26, delay: 0.2 + index * 0.045 },
                        scale: {
                          duration: 0.4,
                          delay: 0.2 + index * 0.045,
                          ease: [0.16, 1, 0.3, 1],
                        },
                        /* Held until the last blade is seated, then together. */
                        points: { duration: 0.6, delay: 0.66, ease: [0.16, 1, 0.3, 1] },
                      }
                    : { duration: 0.7, ease: [0.16, 1, 0.3, 1], delay: index * 0.02 }
              }
            />
          ))}
        </g>

        {/*
          Nova's light curve. Scaled into the 100-unit frame from its own
          48-unit box and centred on its *visual* middle (24.5, 23.5) rather
          than the box's, because those are not the same point.

          During the introduction the whole group is held back until the iris
          has finished opening: nothing of the mark exists until the aperture
          is open to show it.
        */}
        <motion.g
          transform={`translate(50 50) scale(${CURVE.scale.toFixed(3)}) translate(${-CURVE.origin.x} ${-CURVE.origin.y})`}
          initial={opening ? { opacity: 0 } : false}
          animate={{ opacity: 1 }}
          transition={reduceMotion ? { duration: 0 } : { duration: 0.2, delay: opening ? 1.28 : 0 }}
        >
          {/* The quiet baseline before the event. */}
          <path
            d={CURVE.baseline.d}
            fill="none"
            stroke="var(--color-fg)"
            strokeOpacity={0.18 * luma + 0.06}
            strokeWidth={CURVE.baseline.width}
            strokeLinecap="round"
          />
          {/* A dim track, so the trace has something to run along and the shape
              stays legible at every point of the loop. */}
          <path
            d={CURVE.rise.d}
            fill="none"
            stroke="var(--color-mint)"
            strokeOpacity={0.16}
            strokeWidth={CURVE.rise.width}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            className={
              working ? `nTrace-${id}` : opening && !reduceMotion ? `nDraw-${id}` : undefined
            }
            d={CURVE.rise.d}
            fill="none"
            stroke="var(--color-mint)"
            strokeOpacity={luma}
            strokeWidth={CURVE.rise.width}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* The peak. The one point on a light curve anybody reads first —
              and it lights when the stroke gets there, never ahead of it. */}
          <circle
            className={
              working
                ? `nPeakTrace-${id}`
                : opening && !reduceMotion
                  ? `nPeakDraw-${id}`
                  : undefined
            }
            cx={CURVE.peak.x}
            cy={CURVE.peak.y}
            r={CURVE.peak.r}
            fill="var(--color-mint)"
            fillOpacity={luma}
          />
        </motion.g>
      </svg>
    </span>
  );
}
