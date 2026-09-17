"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils/cn";

/**
 * The marketing nav, out of the way while a reader is going down (UI-34).
 *
 * The founder, on the endless scroll: *"den Header beim Scrollen ausblenden,
 * nur wenn man nach oben fährt soll sie aufblenden — sie stört beim Scrollen."*
 *
 * A page whose whole shape is a scroll spends its top 4.5rem on chrome that is
 * only useful at the two moments somebody wants to leave the scroll: at the top,
 * and when they have turned back. So the bar leaves on the way down and returns
 * on the way up, which is the pattern every reading surface on a phone uses and
 * for the same reason.
 *
 * ## What it must not do
 *
 * **Move the page.** It is `sticky`, so its space in the flow belongs to the top
 * of the document and a transform takes it off screen without anything below it
 * shifting — the third motion obligation, met by the mechanism rather than by a
 * reserved box.
 *
 * **Take an action away from somebody who asked for no movement.** Reduced
 * motion keeps the bar pinned: *Sign in* and *Get started* stay present, which
 * is what that setting is for. The behaviour is a convenience and not
 * information, so removing it costs a reader nothing.
 *
 * **Hide a control the keyboard is inside.** A bar translated off screen still
 * holds five focusable links, and tabbing into one that cannot be seen is worse
 * than never hiding it. Focus anywhere inside brings it back.
 *
 * ## Why a threshold and not every pixel
 *
 * A trackpad emits scroll events with sub-pixel deltas in both directions, and
 * reacting to each one makes a bar that flickers. Movement accumulates until it
 * passes `STEP`, so a direction has to be meant before it counts.
 */

/** How far past the bar's own height a reader must be before it may hide. */
const HIDE_BELOW = 96;

/** Accumulated movement in one direction before it counts as a direction. */
const STEP = 8;

export function MarketingHeader({ children }: { children: ReactNode }) {
  const reduced = useReducedMotion();
  const [away, setAway] = useState(false);
  const last = useRef(0);

  /*
   * Derived rather than reset. `useReducedMotion` answers `null` on the server
   * and resolves after hydration, so a reader whose setting arrives late would
   * need the state clearing — and clearing state from inside an effect is the
   * loop this codebase's lint rule exists to stop. Reading the two together at
   * render time has no such moment.
   */
  const hidden = away && !reduced;

  useEffect(() => {
    if (reduced) return;

    last.current = window.scrollY;
    let frame = 0;

    const read = () => {
      frame = 0;
      const y = window.scrollY;
      const delta = y - last.current;

      // Near the top the bar is always there — that is where somebody who
      // wants it looks for it, and a page that has not been scrolled has no
      // direction to read.
      if (y <= HIDE_BELOW) {
        last.current = y;
        setAway(false);
        return;
      }

      if (Math.abs(delta) < STEP) return;
      last.current = y;
      setAway(delta > 0);
    };

    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(read);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [reduced]);

  return (
    <header
      data-marketing-header={hidden ? "hidden" : "shown"}
      onFocusCapture={() => setAway(false)}
      className={cn(
        "border-line-1 bg-app/60 sticky top-0 z-30 border-b backdrop-blur-xl",
        "duration-[200ms] ease-[var(--ease-vibe)] transition-transform",
        hidden && "-translate-y-full",
      )}
    >
      {children}
    </header>
  );
}
