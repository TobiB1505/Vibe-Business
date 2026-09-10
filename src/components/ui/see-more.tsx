"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import { ChevronDownIcon } from "./icons.generated";

/**
 * A paragraph that continues rather than a block that opens.
 *
 * ## Why this is not `Disclosure`
 *
 * `Disclosure` is a `<details>`, and `<details>` hides everything that is not
 * its `<summary>`. That is right for "Technical details" and wrong here: the
 * whole point of *see more* is that the first line stays visible, and the first
 * line is exactly what the element would hide. A draft that tried it rendered a
 * card with a control and no text.
 *
 * Putting the paragraph inside the `<summary>` fixes the picture and gives a
 * screen reader the text twice, which is worse. So this is the one disclosure
 * in the product that needs client state — a cost worth naming rather than
 * discovering.
 *
 * ## What a screen reader gets
 *
 * All of it, always. `line-clamp` is a visual truncation: the text is in the
 * DOM in both states, so nothing is hidden from assistive technology and the
 * control is an honest `aria-expanded` over a region that grew rather than a
 * region that appeared.
 *
 * ## Why the fade is a mask and not a gradient over the top
 *
 * The obvious build paints a `transparent → surface` gradient across the last
 * line. It does not work here, because Vibe's surfaces are translucent white
 * over the page ground: `--color-surface-3` is `rgb(255 255 255 / 0.048)`, so
 * a gradient ending in it is a five-percent wash that occludes nothing. It
 * would need the *composited* colour, which no token holds and which changes
 * with every surface the component is dropped onto.
 *
 * A mask fades the text's own alpha instead. It is correct on every surface
 * without being told which one it is on, and there is no second element over
 * the paragraph to get the geometry wrong.
 *
 * ## Why it measures
 *
 * A "see more" over text that is already fully visible is a control that lies,
 * and a fade under a sentence that ends there promises a continuation that
 * does not exist. Whether the text overflows depends on the container's width
 * and the reader's font size, so it cannot be decided from the string — it is
 * measured, and the control and the fade appear only when there is something
 * behind them.
 *
 * The measurement only runs while closed. Open, the clamp is off and every
 * paragraph "fits", which would delete the control the reader needs to close
 * it again.
 *
 * ## Where it belongs
 *
 * Prose only. A fade over a list of SHAs or a table of technical fields
 * promises a sentence continuing, and there is no sentence — those keep
 * `Disclosure`.
 */
/**
 * `useLayoutEffect` before paint on the client, `useEffect` on the server.
 *
 * A client component is still rendered during SSR, and `useLayoutEffect`
 * warns there because it cannot run. Measuring before paint is the point —
 * it is what stops the control from flashing on text that does not overflow.
 */
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function SeeMore({
  children,
  lines = 2,
  moreLabel = "See more",
  lessLabel = "Show less",
  textClassName = "text-caption text-fg-prose",
  className,
}: {
  children: ReactNode;
  /** How much stays visible when closed. Two lines is enough to judge by. */
  lines?: 1 | 2 | 3;
  moreLabel?: string;
  lessLabel?: string;
  /**
   * How the text is set. The clamp has to sit on the element that holds the
   * text, so the styling comes in rather than being decided here — a "see
   * more" over a lead paragraph and one over a caption are the same control
   * at two sizes.
   */
  textClassName?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  /*
   * Starts `true` so the server's markup carries the control, and the layout
   * effect removes it before the first client paint rather than after it.
   */
  const [overflows, setOverflows] = useState(true);
  const textRef = useRef<HTMLDivElement>(null);
  const id = useId();

  useIsomorphicLayoutEffect(() => {
    if (open) return;
    const el = textRef.current;
    if (!el) return;

    // A pixel of tolerance: sub-pixel line heights round the two apart on
    // text that fits exactly.
    const measure = () => setOverflows(el.scrollHeight > el.clientHeight + 1);
    measure();

    // Width decides this, so it has to be re-asked when the width changes —
    // a panel that opens beside a sidebar is the common case.
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [open, lines, children]);

  const CLAMP = { 1: "line-clamp-1", 2: "line-clamp-2", 3: "line-clamp-3" } as const;
  /*
   * Where the mask starts, so roughly the last line is what dissolves. The
   * percentages are of the clamped box, so they have to move with the line
   * count — one value would fade a whole single line or barely touch three.
   */
  const FADE = { 1: "mask-b-from-35%", 2: "mask-b-from-62%", 3: "mask-b-from-74%" } as const;

  return (
    <div className={className}>
      <div
        ref={textRef}
        id={id}
        className={cn(textClassName, !open && CLAMP[lines], !open && overflows && FADE[lines])}
      >
        {children}
      </div>
      {overflows && (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((value) => !value)}
          className={cn(
            "vibe-tap mt-1.5 inline-flex items-center gap-1 rounded-inline text-caption text-fg-muted",
            "transition-interactive hover:text-fg-body",
          )}
        >
          {open ? lessLabel : moreLabel}
          {/*
            No container on this one, deliberately. It continues a sentence
            rather than sitting beside one, so a pill here would read as a
            separate object rather than as the end of the paragraph — which is
            the whole argument for this treatment over the other three.
          */}
          <ChevronDownIcon
            size={13}
            className={cn("transition-transform duration-150", open && "rotate-180")}
          />
        </button>
      )}
    </div>
  );
}
