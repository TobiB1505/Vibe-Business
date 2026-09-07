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
 * - **Glass is the material, and a section is where it stops.** In the second
 *   palette `card` and `panel` are both panes — a deeper blur for the card,
 *   a shallow one for the panel, because there can be a dozen panels on a
 *   screen. `section` stays a fill on purpose: glass behind glass gives the
 *   inner pane another pane to sample instead of the ground, and neither
 *   reads as glass then. See [ADR 0099](../../../docs/decisions/0099-glass-is-the-material.md).
 *   v1 is unchanged — there, only `card` blurs.
 *
 * ## The `vibe-surface-*` hooks (S2)
 *
 * Every surface emits a class naming what it is. In v1 those classes match no
 * rule and change nothing; `theme-v2.css` is where they acquire material.
 *
 * A class rather than a `data-` attribute because `buttonClasses()` has to
 * carry the same kind of hook to `<Link className={...}>` call sites, which
 * have no component to hang an attribute on — one mechanism is easier to
 * reason about than two. They are emitted from the primitive's own base list,
 * so a caller's `className` can add to them but never remove them: `cn` is a
 * join, and a join cannot drop what it was given first.
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
  // No blur utility here. The blur is material, and material belongs to the
  // palette: the utility hard-coded 24px, so `--glass-blur` could say 14 and
  // the card would still render 24 — a token that lies. It is set once, on the
  // `vibe-surface-card` hook in `globals.css`, from tokens both palettes
  // declare. v1's values are the utility's, so v1 renders unchanged.
  card: "rounded-card shadow-card",
};

/** Inert in v1. See the note above, and `theme-v2.css`. */
const LEVEL_HOOK: Record<SurfaceLevel, string> = {
  section: "vibe-surface vibe-surface-section",
  panel: "vibe-surface vibe-surface-panel",
  card: "vibe-surface vibe-surface-card",
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
  /**
   * Blur a `section`, which is the one level the palette leaves opaque.
   *
   * Unused at HEAD, and it should stay rare: the reason a section is a fill
   * is structural, not a default someone forgot to change.
   */
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
        LEVEL_HOOK[level],
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
    <div className={cn("vibe-well rounded-well border-line-2 bg-well border p-4", className)}>
      {children}
    </div>
  );
}
