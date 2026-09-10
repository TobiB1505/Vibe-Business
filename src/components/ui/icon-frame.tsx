import type { ReactNode, SVGProps } from "react";

/**
 * The one frame every Vibe icon is drawn in.
 *
 * Extracted from `dashboard-icons.tsx` so the generated Lucide set can share
 * it rather than restate it. That sharing is the whole reason imported paths
 * do not look imported: the geometry already matches — `viewBox 0 0 24 24`,
 * round caps and joins, no fill, stroke on `currentColor` — and the one thing
 * that differs, stroke weight, is set here rather than in the path. Lucide
 * draws at 2; everything rendered through this frame draws at Vibe's 1.8.
 *
 * `aria-hidden` by default: an icon beside a word is decoration, and an icon
 * standing alone needs a name on the control, not on the mark.
 *
 * ## Optical sizing: why the stroke is a calculation
 *
 * `stroke-width` in SVG is expressed in **viewBox units**, and this viewBox is
 * 24. A literal `1.8` therefore renders at `1.8 × size / 24` on screen — which
 * is 1.8px only at 24px, a size this product never uses. It renders icons at 13
 * to 22, and at 15, 16 and 17 for almost everything:
 *
 *     13px → 0.98px     16px → 1.20px     20px → 1.50px
 *     15px → 1.13px     18px → 1.35px     24px → 1.80px
 *
 * Every icon in the product was therefore drawn with a sub-pixel stroke, which
 * a display resolves by spreading the line across two rows of pixels at partial
 * opacity. The result reads as soft and hand-drawn rather than as an icon set —
 * an objection raised about the dismiss cross, which turned out to be true of
 * all thirty-nine marks and to be about weight rather than shape.
 *
 * So the stroke is stated in **screen pixels** and converted. `STROKE_PX` lands
 * on the same weight at every size, which is what an optical size adjustment
 * is; drawing for 24 and scaling down is what a set does when it does not have
 * one.
 *
 * This is the first change in the v2 work that alters what v1 renders, and it
 * does so deliberately: the old behaviour is not a style that v1 chose, it is a
 * unit that was never converted.
 */
export type IconProps = SVGProps<SVGSVGElement> & { size?: number };

/**
 * The rendered stroke, in CSS pixels, at every size.
 *
 * 1.5 rather than 1.8: at 15–17px, where this product actually lives, 1.8px is
 * heavier than the type beside it and the mark starts to shout. 1.5 lands on a
 * whole pixel plus a half on a 2× display and stays crisp on a 1×.
 */
const STROKE_PX = 1.5;

export function IconFrame({ size = 18, children, ...props }: IconProps & { children: ReactNode }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={(STROKE_PX * 24) / size}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {children}
    </svg>
  );
}
