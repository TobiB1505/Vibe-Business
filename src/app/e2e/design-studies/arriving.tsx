"use client";

import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";

/**
 * The thread, arriving one message at a time, with Nova composing in between.
 *
 * ## What the three dots actually are
 *
 * Not a state. They were built as one — a standing indicator bound to a
 * running operation — and that is wrong about what they mean. A phone shows
 * them for a moment *before a message lands*, and then the message replaces
 * them. They are the beat before an arrival, not a report that somebody is at
 * a keyboard.
 *
 * That distinction is also what makes them honest. Dots that stand there while
 * a run happens assert that Nova is writing, which nothing observed. Dots that
 * appear for a beat and are immediately replaced by the line they preceded
 * assert only that the next line is coming — which is true, because it is.
 *
 * ## Not one beat per bubble
 *
 * The beat marks a *turn*, not a line. Nova saying three sentences in a row is
 * one turn, and pausing to compose between each of them takes five seconds to
 * deliver something a founder could have read in two — the choreography stops
 * being a nicety and starts being a wait.
 *
 * So a caller marks which items open a turn. The first sentence does, and so
 * does the block, because a thing she *made* is a different kind of arrival
 * from a thing she said. The sentences between them follow immediately, the
 * way a person sends three quick lines and then stops.
 *
 * ## Why this appends instead of reserving
 *
 * The motion obligation is that nothing moves under a reader. Reserving the
 * whole thread's height satisfies that literally and looks wrong: a panel
 * three-quarters empty while one bubble sits at the top of it, with the
 * composing beat stranded at the bottom where the last message will eventually
 * be. It also puts the beat nowhere near the line it precedes.
 *
 * So the thread grows downward, the way the form it borrows does. The
 * obligation still holds, and for the reason it exists: everything appears
 * *below* what has already been read, so no line a founder is looking at ever
 * shifts. The composing bubble sits at the end, in the slot the next message
 * takes, and is replaced by it rather than pushed aside.
 *
 * ## Reduced motion, and the open question under it
 *
 * With `prefers-reduced-motion` there is no staging at all: everything is
 * present from the first frame and the dots never appear.
 *
 * The preference is read through `useSyncExternalStore` rather than set from
 * an effect, which is what makes the *server's* answer "no staging" — so the
 * markup that arrives, and the markup a reader without JavaScript keeps, is
 * the complete thread. Staging is something the client adds on top, never
 * something the page needs in order to be readable.
 *
 * The honest caveat is that `visibility: hidden` also hides a message from a
 * screen reader for the second or two before its turn. That is the right
 * trade-off to *notice* rather than to hide: a reader on reduced motion — as
 * most assistive-technology users are — gets the complete thread immediately,
 * and the decision for everyone else belongs with the accessibility pass
 * rather than in a lab file. It is written down here so it is not discovered
 * later as a surprise.
 */

/** How long the thread rests before Nova starts composing the next turn. */
const REST_MS = 420;

/** How long she composes before the message lands. */
const BEAT_MS = 620;

/** Between lines of one turn. Quick, because nobody pauses mid-thought. */
const LINE_MS = 220;

/** One arrival: a node, and whether Nova pauses to compose before it. */
export type ArrivingItem = {
  key: string;
  node: ReactNode;
  /** True when this opens a turn — the first line, or something she made. */
  beat?: boolean;
};

export function Arriving({
  items,
  /** Rendered under the thread once every message has arrived. */
  children,
}: {
  items: ArrivingItem[];
  children?: ReactNode;
}) {
  const [arrived, setArrived] = useState(0);
  const [composing, setComposing] = useState(false);
  const staged = useMotionAllowed();

  /* Not staging means everything is here, which is also the server's answer. */
  const shown = staged ? arrived : items.length;
  const settled = shown >= items.length;

  useEffect(() => {
    if (!staged || settled) return;

    const next = items[shown];
    if (!next) return;

    /* A line of the same turn follows immediately; a new turn is composed. */
    if (!next.beat) {
      const land = window.setTimeout(() => setArrived((count) => count + 1), LINE_MS);
      return () => window.clearTimeout(land);
    }

    const rest = shown === 0 ? 0 : REST_MS;
    const compose = window.setTimeout(() => setComposing(true), rest);
    const land = window.setTimeout(() => {
      setComposing(false);
      setArrived((count) => count + 1);
    }, rest + BEAT_MS);

    return () => {
      window.clearTimeout(compose);
      window.clearTimeout(land);
    };
  }, [items, settled, shown, staged]);

  return (
    <div className="flex flex-col gap-1.5">
      {items.slice(0, shown).map((item) => (
        <div key={item.key}>{item.node}</div>
      ))}

      {/*
        At the end, in the slot the next message takes, so its arrival replaces
        the beat rather than pushing it aside.
      */}
      {composing && <Composing />}

      {/* The controls wait for the last word, the way a person does. */}
      {settled && children}
    </div>
  );
}

/**
 * Whether this reader wants motion, answered `false` on the server.
 *
 * A subscription rather than a flag set from an effect: the server and the
 * hydrating client agree on "no staging", so the complete thread is what the
 * markup contains and staging is only ever added afterwards.
 *
 * Exported because the opening choreography needs the same answer, and two
 * readings of one preference is how a screen ends up half-staged: the thread
 * present from the first frame while the panel around it is still assembling.
 */
export function useMotionAllowed(): boolean {
  const subscribe = useCallback((onChange: () => void) => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  return useSyncExternalStore(
    subscribe,
    () => !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
}

/**
 * Nova composing, in the shape a phone taught everybody.
 *
 * `aria-hidden`: it says nothing a reader needs, and the message it precedes
 * is a second away. Announcing "Nova is typing" before every line would be a
 * screen reader reading out the choreography instead of the thread.
 */
function Composing() {
  return (
    <div
      aria-hidden
      className="bubble bubble-neutral bubble-tailed bubble-arrive flex w-fit items-center gap-1.5 px-3.5 py-3"
    >
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className="study-typing size-1.5 rounded-full bg-fg-muted"
          /* Only the offset is inline; the animation is a class so the shell's
             hidden-tab pause and the reduced-motion block can both reach it. */
          style={{ animationDelay: `${index * 0.18}s` }}
        />
      ))}
    </div>
  );
}
