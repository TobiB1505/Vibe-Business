import type { SVGProps } from "react";
import { IconFrame } from "./icon-frame";

/**
 * GENERATED FILE — do not edit.
 *
 * `node scripts/generate-icons.mjs` rewrites it from Lucide 1.41.0 (ISC).
 * Add an icon by adding a line to that script's MANIFEST and re-running it.
 *
 * The paths are Lucide's; the frame, the stroke weight and the sizing are
 * Vibe's, so these sit beside the hand-drawn marks in `dashboard-icons.tsx`
 * without looking imported. Product-specific marks — Nova's aperture, the
 * wordmark — stay hand-drawn there, because no catalogue has them.
 */

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

/** Lucide `pencil`. */
export function EditIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
      <path d="m15 5 4 4" />
    </IconFrame>
  );
}

/** Lucide `trash-2`. */
export function DeleteIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </IconFrame>
  );
}

/** Lucide `x`. */
export function DismissIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </IconFrame>
  );
}
