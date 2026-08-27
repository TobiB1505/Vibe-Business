import type { ElementType, HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * The surface hierarchy (UI-0).
 *
 * Four levels, and they are a hierarchy rather than a menu:
 *
 *   0  canvas       the page background (`--color-app`), owned by the shell
 *   1  section      a grouping band — quiet, no elevation
 *   2  panel        the workhorse: a self-contained block of content
 *   3  card         one primary object per view, or a modal
 *
 * Two rules the levels exist to enforce:
 *
 * - **No card inside a card inside a card.** Nesting goes *down* the levels,
 *   never sideways at the same level, and content that needs to recede inside
 *   a surface uses `<Well>` (black) rather than a fifth white layer.
 * - **Glass is emphasis, not a default.** Only `card` blurs. A panel that
 *   genuinely needs to sit over moving background can opt in with `glass`,
 *   and that should be rare enough to notice in review.
 */
export type SurfaceLevel = "section" | "panel" | "card";

/**
 * Tinted surfaces report a state. `mint` is Vibe's own action framing (a cost
 * disclosure, an offer), `amber` is waiting or blocked, `coral` is failure.
 * A surface never takes a tint for decoration.
 */
export type SurfaceTone = "neutral" | "mint" | "amber" | "coral";

/**
 * Shape and elevation belong to the level whatever the tone is.
 */
const LEVEL_SHAPE: Record<SurfaceLevel, string> = {
  section: "rounded-panel",
  panel: "rounded-panel",
  card: "rounded-card shadow-card backdrop-blur-xl",
};

/** The untinted fill and border of each level. */
const LEVEL_SURFACE: Record<SurfaceLevel, string> = {
  section: "bg-surface-2 border border-line-2",
  panel: "bg-surface-3 border border-line-3",
  card: "bg-surface-4 border border-line-4",
};

/**
 * A tone *replaces* the level's fill rather than being listed beside it.
 *
 * `cn` is a join, not a merge, so a tone appended after the level's own
 * `bg-surface-3` produced two background utilities in one class list and the
 * stylesheet's order decided — which meant every tinted panel in the product
 * kept its neutral fill and showed the tone in its border alone. The tint was
 * written, generated, shipped, and invisible.
 */
const TONE_CLASSES: Record<SurfaceTone, string> = {
  neutral: "",
  mint: "bg-mint-tint-soft border border-mint-line",
  amber: "bg-amber-tint-soft border border-amber-line",
  coral: "bg-coral-tint-soft border border-coral-line",
};

const PADDING_CLASSES = {
  none: "",
  sm: "p-4",
  md: "p-5 sm:p-6",
  lg: "p-6 sm:p-8",
} as const;

export type SurfaceProps = Omit<HTMLAttributes<HTMLElement>, "color"> & {
  children: ReactNode;
  level?: SurfaceLevel;
  tone?: SurfaceTone;
  padding?: keyof typeof PADDING_CLASSES;
  /** Opt a non-card surface into the blur. Emphasis only — see above. */
  glass?: boolean;
  as?: ElementType;
};

export function Surface({
  children,
  level = "panel",
  tone = "neutral",
  padding = "md",
  glass = false,
  as: Component = "div",
  className,
  ...rest
}: SurfaceProps) {
  return (
    <Component
      className={cn(
        LEVEL_SHAPE[level],
        tone === "neutral" ? LEVEL_SURFACE[level] : TONE_CLASSES[tone],
        PADDING_CLASSES[padding],
        glass && "backdrop-blur-xl",
        className,
      )}
      {...rest}
    >
      {children}
    </Component>
  );
}


/** Level 3 — the primary object on a view, or a modal. */
export function VibeCard(props: Omit<SurfaceProps, "level">) {
  return <Surface {...props} level="card" />;
}

/**
 * A recess *inside* a surface: black at low alpha rather than another white
 * layer. Code blocks, field wells, read-only values, anything that should read
 * as cut into the panel instead of stacked on top of it.
 */
export function Well({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-well border-line-2 bg-well border p-4", className)}>{children}</div>
  );
}
