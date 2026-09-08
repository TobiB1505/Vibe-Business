import type { CSSProperties, ElementType, ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * The motion primitives (S2).
 *
 * `DESIGN.md` asks three things of every animation in this product, and asked
 * them of every component individually until now: honour reduced motion, pause
 * while the tab is hidden, and reserve geometry so nothing moves under a
 * reader. Twenty-two components import `motion` and each of them had to
 * remember all three. One that forgets is not a compile error and not a test
 * failure — it is a screen that jumps for one person on one machine.
 *
 * So the obligations moved into the mechanism. `Reveal` cannot skip them:
 *
 * - **Reduced motion** is a media query on the class, not a prop.
 * - **The hidden-tab pause** is one attribute on the document root, stamped by
 *   `MotionProvider`, and one rule in `globals.css`. A component does not
 *   subscribe to anything.
 * - **Reserved geometry** is the keyframes themselves: `vibe-reveal`
 *   interpolates opacity and transform and has no layout property to animate,
 *   so a component that wanted to animate height would have to leave this
 *   primitive to do it — visibly, in review.
 *
 * ## Why these are server components
 *
 * An entrance has no state. Expressing it in `motion/react` would put a
 * `"use client"` boundary over every subtree that wants one, which is the
 * opposite of the rule that the boundary belongs at the leaf. The `motion`
 * dependency stays for what genuinely needs it — layout-driven animation,
 * presence, orchestration — and is not replaced by this.
 */

/**
 * The stagger index, as a typed custom property.
 *
 * A number, not a delay: the delay is `index × --stagger-row`, so the rhythm
 * is a design token and changing it does not mean finding every call site.
 */
function revealStyle(index: number, rise?: number): CSSProperties {
  const style: Record<string, string | number> = { "--vibe-index": index };
  if (rise !== undefined) style["--vibe-rise"] = `${rise}px`;
  return style as CSSProperties;
}

export function Reveal({
  children,
  index = 0,
  rise,
  as: Component = "div",
  className,
  style,
}: {
  children: ReactNode;
  /** Position in a staggered group. `0` is the first thing to arrive. */
  index?: number;
  /** How far it travels, in pixels. Defaults to the token's 10. */
  rise?: number;
  as?: ElementType;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <Component
      className={cn("vibe-reveal", className)}
      style={{ ...revealStyle(index, rise), ...style }}
    >
      {children}
    </Component>
  );
}

/**
 * A staggered group, so the indices are not hand-counted at the call site.
 *
 * Hand-counted indices are the failure this exists to prevent: a row inserted
 * in the middle of a list and every delay below it off by one, which reads as
 * a stutter rather than as a sequence and is invisible in a screenshot.
 */
export function Stagger({
  items,
  as: Component = "div",
  itemAs,
  className,
  rise,
}: {
  items: readonly ReactNode[];
  as?: ElementType;
  itemAs?: ElementType;
  className?: string;
  rise?: number;
}) {
  return (
    <Component className={className}>
      {items.map((item, index) => (
        <Reveal key={index} index={index} rise={rise} as={itemAs}>
          {item}
        </Reveal>
      ))}
    </Component>
  );
}
