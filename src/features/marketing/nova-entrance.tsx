"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import { NovaPresence, type NovaPresenceState } from "@/components/nova/nova-presence";

/**
 * Nova's introduction, held until somebody is there to see it (UI-34).
 *
 * ## The problem this solves
 *
 * `NovaPresence introduce` assembles the mark **on mount** — blades seating
 * themselves, the iris opening, the light curve drawn last. On a page that is
 * one screen tall that is exactly right. On an endless scroll it is not: every
 * block below the fold mounts when the page loads, so the one entrance the
 * component was built for played to nobody, roughly six thousand pixels above
 * the reader.
 *
 * So the mark waits. When the block is reached it mounts the introducing one,
 * and the assembly happens in front of the person it is for.
 *
 * ## Why it is drawn on the server anyway
 *
 * A reader with no JavaScript gets no observer and no effect, so a component
 * that renders nothing until told would render nothing at all — and the mark
 * is the one thing this block is *about*. The server draws it settled and
 * visible; the client, once it is running, holds it invisible until the block
 * is reached and then hands over to the introduction.
 *
 * The held state is the same element at the same size, so nothing on the page
 * moves when the swap happens — the third motion obligation, met by keeping
 * the geometry rather than by reserving a box beside it.
 *
 * ## And a reader who asked for no motion keeps the server's mark
 *
 * Drawn, finished, still. There is nothing to hold back for somebody who is
 * never going to be shown an assembly, and hiding it until they scrolled would
 * be movement of a different kind: an element appearing.
 */
export function NovaEntrance({
  state = "listening",
  seed = "vibe",
}: {
  state?: NovaPresenceState;
  seed?: string;
}) {
  const reduced = useReducedMotion();
  const anchor = useRef<HTMLSpanElement>(null);
  const [phase, setPhase] = useState<"drawn" | "held" | "arrived">("drawn");

  useEffect(() => {
    if (reduced) return;

    const node = anchor.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      // No way to tell when she is reached: show the introduction rather than
      // holding a mark back forever.
      setPhase("arrived");
      return;
    }

    setPhase("held");
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setPhase("arrived");
          observer.disconnect();
        }
      },
      { rootMargin: "0px 0px -12% 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [reduced]);

  return (
    <span ref={anchor} className="inline-flex" data-nova-entrance={phase}>
      {phase === "arrived" ? (
        <NovaPresence state={state} seed={seed} size="hero" introduce />
      ) : (
        <NovaPresence
          state={state}
          seed={seed}
          size="hero"
          still
          className={phase === "held" ? "opacity-0" : undefined}
        />
      )}
    </span>
  );
}
