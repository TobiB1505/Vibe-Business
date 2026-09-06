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
 */
export type IconProps = SVGProps<SVGSVGElement> & { size?: number };

export function IconFrame({ size = 18, children, ...props }: IconProps & { children: ReactNode }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {children}
    </svg>
  );
}
