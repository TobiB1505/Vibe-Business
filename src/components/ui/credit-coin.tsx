import { useId, type SVGProps } from "react";

/**
 * A Credit: a struck gold coin with Vibe's V raised on it.
 *
 * ## Why a coin and not a glyph
 *
 * Because the objection was that a price reads as body text. A price is the
 * one line on a screen that means money is about to move, and nothing about
 * "35 Credits" set in the interface face says so. An object does — a reader
 * knows what a coin is before reading the number beside it.
 *
 * ## Why it may be gold when amber is already spoken for
 *
 * DESIGN.md reserves amber for incomplete and waiting states, and
 * `StatusPill` paints `waiting` with it. Gold sits beside amber in hue, so a
 * flat gold disc would read as a status dot.
 *
 * What separates them is the material, not the colour: **a status is always a
 * flat fill; metal always has a ramp and a rim.** That is the rule this
 * component exists to keep, and `credit-coin.test.ts` holds both halves of it.
 *
 * ## How it is built
 *
 * Two concentric raised rings with a groove between them, a chamfer falling
 * away to a domed field, and the V raised out of that field rather than cut
 * into it. Light comes from the upper left, as it does on everything else
 * raised in the product, so every ring is lit on one shoulder and shadowed on
 * the other — which is the whole reason it reads as metal and not as a
 * circle filled with a gradient.
 *
 * The V is the wordmark's own geometry: two rounded bars at ∓19°, not a
 * letterform. One translation was needed. In the wordmark the left bar sits
 * at 55% opacity, and metal has no half-transparency — so it is **struck
 * shallower** instead: the same bar, with less relief and a dimmer lit facet.
 * That is what a lighter weight becomes when the material is gold.
 *
 * ## Why the detail is a function of size
 *
 * A struck coin is milling, two rings, a chamfer and relief. At 44px all of
 * it is legible. At 12px the rim is one pixel and the V is four, and drawing
 * the same artwork smaller produces a brown smudge — the specific failure the
 * icon frame already fixed once, where stroke width was a viewBox unit and
 * every mark got heavier as it got smaller.
 *
 * So this draws three coins, not one scaled coin:
 *
 *   >= 32   the full strike: milling, both rings, chamfer, relief on the V
 *   >= 20   one ring and the field, the V raised with a single shadow
 *    < 20   the disc and the V, contrast pushed so the V still reads
 *
 * The last is not a small coin; it is the smallest drawing that is still
 * unmistakably this coin.
 *
 * ## Inert
 *
 * `aria-hidden` always. The number beside it is the information; a screen
 * reader announcing "coin, 35 Credits" reads the decoration twice.
 */

/** The V, from `public/brand/vibe-mark-mono.svg`, on this coin's 48 grid. */
const BARS = [
  { x: 8.4, y: 5, w: 6.2, h: 38, r: 3.1, rotate: -19, ox: 11.5, oy: 5, shallow: true },
  { x: 33.4, y: 5, w: 6.2, h: 38, r: 3.1, rotate: 19, ox: 36.5, oy: 5, shallow: false },
] as const;

function Bars({
  fill,
  opacity,
  dy = 0,
  shallowOpacity,
}: {
  fill: string;
  opacity?: number;
  dy?: number;
  /** What the lighter bar of the wordmark becomes in metal: less relief. */
  shallowOpacity?: number;
}) {
  return (
    <g transform={dy ? `translate(0 ${dy})` : undefined}>
      {BARS.map((bar, index) => (
        <rect
          key={index}
          x={bar.x}
          y={bar.y}
          width={bar.w}
          height={bar.h}
          rx={bar.r}
          fill={fill}
          opacity={bar.shallow ? (shallowOpacity ?? opacity) : opacity}
          transform={`rotate(${bar.rotate} ${bar.ox} ${bar.oy})`}
        />
      ))}
    </g>
  );
}

export type CreditCoinProps = SVGProps<SVGSVGElement> & { size?: number };

export function CreditCoin({ size = 16, ...props }: CreditCoinProps) {
  // Gradients are document-scoped, so two coins sharing one id would render
  // the first lit and the rest flat — a list of prices with one coin and
  // eleven amber dots. `useId` is what keeps that from happening.
  const id = useId();
  const ring = `ring-${id}`;
  const field = `field-${id}`;
  const dome = `dome-${id}`;

  const full = size >= 32;
  const medium = size >= 20;

  return (
    <svg
      aria-hidden
      viewBox="0 0 48 48"
      width={size}
      height={size}
      fill="none"
      className="shrink-0"
      {...props}
    >
      <defs>
        {/* The rings: lit on the upper-left shoulder, dark on the lower-right. */}
        <linearGradient id={ring} x1="0.12" y1="0.05" x2="0.88" y2="0.95">
          <stop offset="0" stopColor="var(--color-gold-light)" />
          <stop offset="0.38" stopColor="var(--color-gold)" />
          <stop offset="1" stopColor="var(--color-gold-rim)" />
        </linearGradient>
        {/* The field, one step deeper than the rings so the chamfer reads. */}
        <linearGradient id={field} x1="0.2" y1="0.05" x2="0.8" y2="0.95">
          <stop offset="0" stopColor="var(--color-gold)" />
          <stop offset="0.55" stopColor="var(--color-gold)" />
          <stop offset="1" stopColor="var(--color-gold-deep)" />
        </linearGradient>
        {/* A dome, so the field is not flat under the device. */}
        <radialGradient id={dome} cx="0.36" cy="0.3" r="0.82">
          <stop offset="0" stopColor="var(--color-gold-light)" stopOpacity="0.55" />
          <stop offset="0.6" stopColor="var(--color-gold-light)" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* The blank, and the shadow its edge throws. */}
      <circle cx="24" cy="24" r="23.5" fill="var(--color-gold-rim)" />

      {full && (
        /* Milling: the knurled edge a struck coin has and a token does not.
           Thirty-six ticks — enough to read as an edge at 44px, coarse enough
           at 32px that they do not merge into a ring. */
        <g stroke="var(--color-gold-deep)" strokeWidth="1.5" opacity="0.6">
          {Array.from({ length: 36 }, (_, index) => {
            const angle = (index / 36) * Math.PI * 2;
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);
            return (
              <line
                key={index}
                x1={24 + cos * 21.6}
                y1={24 + sin * 21.6}
                x2={24 + cos * 23.5}
                y2={24 + sin * 23.5}
              />
            );
          })}
        </g>
      )}

      {/* Outer raised ring. */}
      <circle cx="24" cy="24" r={full ? 21.5 : 22.5} fill={`url(#${ring})`} />

      {full && (
        <>
          {/* The groove between the two rings: a dark line, lit on its far
              side, which is what a channel in metal actually looks like. */}
          <circle
            cx="24"
            cy="24"
            r="18.8"
            fill="none"
            stroke="var(--color-gold-rim)"
            strokeWidth="2.4"
            opacity="0.85"
          />
          {/* Inner raised ring. */}
          <circle cx="24" cy="24" r="17.2" fill={`url(#${ring})`} />
        </>
      )}

      {/* The field the device is struck on. */}
      <circle cx="24" cy="24" r={full ? 15.4 : medium ? 18 : 21} fill={`url(#${field})`} />
      <circle cx="24" cy="24" r={full ? 15.4 : medium ? 18 : 21} fill={`url(#${dome})`} />

      {full && (
        <>
          {/* The lit inner shoulder of each ring, and the shadow opposite.
              Arcs rather than rings: a ring lit all the way round is a bead. */}
          <path
            d="M9 30.6A15.9 15.9 0 0 1 30.6 9"
            stroke="var(--color-gold-light)"
            strokeWidth="1.5"
            strokeLinecap="round"
            opacity="0.7"
          />
          <path
            d="M39 17.4A15.9 15.9 0 0 1 17.4 39"
            stroke="var(--color-gold-deep)"
            strokeWidth="1.5"
            strokeLinecap="round"
            opacity="0.55"
          />
        </>
      )}

      {/* The device, raised out of the field. Three passes: the shadow it
          casts down-right, its lit upper-left facet, then the body between
          them. Emboss rather than intaglio — the reference is a raised
          strike, and a raised one survives being made small because its
          highlight sits outside the shape rather than inside it. */}
      <g
        transform={`translate(24 24) scale(${full ? 0.64 : medium ? 0.68 : 0.76}) translate(-24 -24)`}
      >
        {medium && (
          <Bars fill="var(--color-gold-rim)" opacity={0.85} shallowOpacity={0.5} dy={1.9} />
        )}
        {full && (
          <Bars fill="var(--color-gold-light)" opacity={1} shallowOpacity={0.55} dy={-1.3} />
        )}
        <Bars
          fill={medium ? "var(--color-gold)" : "var(--color-gold-ink)"}
          opacity={1}
          shallowOpacity={medium ? 0.82 : 0.62}
        />
      </g>
    </svg>
  );
}
