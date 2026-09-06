import { useId, type SVGProps } from "react";

/**
 * A Credit: a struck gold coin with Vibe's V in it.
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
 * component exists to keep. A Credit is never drawn flat, and a status is
 * never given a bevel — and then the two cannot be confused at any size, in
 * any palette, by anybody.
 *
 * ## Why the detail is a function of size
 *
 * A struck coin is milling, a raised rim, a recessed field and relief on the
 * device. At 44px all of that is legible. At 12px the rim is one pixel and the
 * V is four, and drawing the same artwork smaller produces a brown smudge —
 * the specific failure the icon work already fixed once, where stroke width
 * was a viewBox unit and every mark got heavier as it got smaller.
 *
 * So this draws three coins, not one scaled coin:
 *
 *   >= 32   the full strike: milled edge, raised rim, relief on the V
 *   >= 20   rim and field and V, no milling and no relief
 *    < 20   the disc and the V, contrast pushed so the V still reads
 *
 * The reduction is deliberate at each step rather than emergent. The last one
 * is not a small coin; it is the smallest drawing that is still unmistakably
 * this coin.
 *
 * ## Inert
 *
 * `aria-hidden` always. The number beside it is the information; a screen
 * reader that announced "coin, 35 Credits" would be reading the decoration
 * twice. A caller that needs the coin to carry meaning alone labels its own
 * container.
 */

/** The V, from `public/brand/vibe-mark-mono.svg`, on this coin's 48 grid. */
const V_LEFT = { x: 7.5, y: 4, w: 6.5, h: 40, r: 3.25, rotate: -19, ox: 10.75, oy: 4 };
const V_RIGHT = { x: 33.5, y: 4, w: 6.5, h: 40, r: 3.25, rotate: 19, ox: 36.75, oy: 4 };

export type CreditCoinProps = SVGProps<SVGSVGElement> & { size?: number };

export function CreditCoin({ size = 16, ...props }: CreditCoinProps) {
  // Gradients are document-scoped, so two coins on one page would share one
  // id and the second would inherit the first's fill. `useId` is what keeps a
  // list of prices from rendering one lit coin and eleven flat ones.
  const id = useId();
  const face = `face-${id}`;
  const rim = `rim-${id}`;
  const strike = `strike-${id}`;

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
        {/* The light comes from the upper left, as it does on every other
            raised thing in the product. */}
        <linearGradient id={face} x1="0.15" y1="0" x2="0.85" y2="1">
          <stop offset="0" stopColor="var(--color-gold-light)" />
          <stop offset="0.45" stopColor="var(--color-gold)" />
          <stop offset="1" stopColor="var(--color-gold-deep)" />
        </linearGradient>
        <linearGradient id={rim} x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor="var(--color-gold)" />
          <stop offset="1" stopColor="var(--color-gold-rim)" />
        </linearGradient>
        {/* The recess: darkest where the strike bit deepest. */}
        <linearGradient id={strike} x1="0.3" y1="0" x2="0.7" y2="1">
          <stop offset="0" stopColor="var(--color-gold-ink)" />
          <stop offset="1" stopColor="var(--color-gold-deep)" />
        </linearGradient>
      </defs>

      {/* The blank. */}
      <circle cx="24" cy="24" r="23" fill={`url(#${rim})`} />

      {full && (
        /* Milling — the knurled edge a struck coin has and a token does not.
           Twenty-eight ticks: enough to read as an edge, few enough that at
           32px they do not merge into a ring. */
        <g stroke="var(--color-gold-rim)" strokeWidth="1.6" opacity="0.55">
          {Array.from({ length: 28 }, (_, index) => {
            const angle = (index / 28) * Math.PI * 2;
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);
            return (
              <line
                key={index}
                x1={24 + cos * 21.4}
                y1={24 + sin * 21.4}
                x2={24 + cos * 23}
                y2={24 + sin * 23}
              />
            );
          })}
        </g>
      )}

      {/* The field, sunk inside the rim. */}
      <circle cx="24" cy="24" r={medium ? 19 : 21} fill={`url(#${face})`} />

      {full && (
        <>
          {/* The lit inner edge of the rim, and the shadow it throws across
              the field's lower right. Two arcs rather than a ring: a ring lit
              all the way round is a bead, not a rim. */}
          <path
            d="M6.5 28.5A19 19 0 0 1 28.5 6.5"
            stroke="var(--color-gold-light)"
            strokeWidth="1.4"
            strokeLinecap="round"
            opacity="0.75"
          />
          <path
            d="M41.5 19.5A19 19 0 0 1 19.5 41.5"
            stroke="var(--color-gold-rim)"
            strokeWidth="1.4"
            strokeLinecap="round"
            opacity="0.5"
          />
        </>
      )}

      {/* The strike. At full size the device is cut twice — once a pixel low
          in the highlight colour, once in the ink — which is what makes it
          read as pressed into the metal rather than printed on it. */}
      <g transform={`translate(24 24) scale(${medium ? 0.62 : 0.74}) translate(-24 -24)`}>
        {full && (
          <g opacity="0.5" transform="translate(0 1.1)">
            {[V_LEFT, V_RIGHT].map((bar, index) => (
              <rect
                key={index}
                x={bar.x}
                y={bar.y}
                width={bar.w}
                height={bar.h}
                rx={bar.r}
                fill="var(--color-gold-light)"
                transform={`rotate(${bar.rotate} ${bar.ox} ${bar.oy})`}
              />
            ))}
          </g>
        )}
        {[V_LEFT, V_RIGHT].map((bar, index) => (
          <rect
            key={index}
            x={bar.x}
            y={bar.y}
            width={bar.w}
            height={bar.h}
            rx={bar.r}
            /* The left stroke sits at 55% in the wordmark; the strike keeps
               that so the coin carries the real mark and not a symmetric
               lookalike. Below 20px both go solid, because a 45%-opacity
               shape four pixels wide is not there. */
            fill={full || medium ? `url(#${strike})` : "var(--color-gold-ink)"}
            opacity={index === 0 && medium ? 0.62 : 1}
            transform={`rotate(${bar.rotate} ${bar.ox} ${bar.oy})`}
          />
        ))}
      </g>
    </svg>
  );
}
