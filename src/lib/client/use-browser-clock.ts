"use client";

import { useEffect, useState } from "react";

/**
 * The browser's wall clock — null until there is a browser to ask.
 *
 * ## Why a hook and not `Date.now()`
 *
 * Reading the clock while rendering a Client Component reads it twice: once in
 * the Node process that writes the HTML and once in the browser that hydrates
 * it. The two answers are a second or so apart, which is enough for a
 * countdown to render "4 min left" into the markup and "3 min left" on
 * hydration — a mismatch React resolves by throwing the server's subtree away.
 * `format-datetime.ts` documents the same defect for dates and settled it the
 * same way: make the two renders agree, and let the truth arrive afterwards.
 *
 * It is also why the clock cannot simply be read once hydration is known to be
 * over: `Date.now()` is impure, so it does not belong in a render at all. The
 * value comes from state that an effect writes, which is the shape
 * `useDocumentVisible` already uses for the same reason.
 *
 * ## `intervalMs`
 *
 * Null reads once, on mount — enough for anything coarse, like "you can try
 * again in about two minutes". A number keeps it ticking, for a countdown that
 * has to stay true while somebody watches it. Passing null while a surface is
 * idle is how a ticker stops without unmounting anything.
 */
export function useBrowserClock(intervalMs: number | null = null): number | null {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const read = () => setNow(Date.now());
    read();

    if (intervalMs === null) return;
    const timer = setInterval(read, intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  return now;
}
