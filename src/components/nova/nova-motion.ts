"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Whether this reader wants motion, answered `false` on the server.
 *
 * A subscription rather than a flag set from an effect, and the distinction is
 * the whole reason this exists: the server and the hydrating client agree on
 * *no staging*, so the complete screen is what the markup contains and staging
 * is only ever added on top. A flag flipped in an effect renders the staged —
 * that is, incomplete — screen first, and a reader without JavaScript keeps it.
 *
 * One copy, because two readings of one preference is how a screen ends up
 * half-staged: the thread present from the first frame while the panel around
 * it is still assembling.
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
