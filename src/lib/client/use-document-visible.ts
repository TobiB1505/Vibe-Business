"use client";

import { useEffect, useState } from "react";

/**
 * Whether this tab is currently the one being looked at.
 *
 * ## Why the signature surfaces need it
 *
 * Continuous motion — a breathing core, an orbiting path — costs a frame budget
 * for nobody when the tab is in the background, and on a laptop that is a fan
 * spinning up for an animation no one can see. Every signature surface in
 * DESIGN.md is required to pause on hidden.
 *
 * ## Why it starts false
 *
 * There is no `document` during server rendering, so the first paint has to
 * assume something. It assumes hidden: the effect confirms visibility one tick
 * later, and a motion that begins a frame late is invisible, while a motion
 * that begins before we know is exactly the thing this exists to prevent.
 *
 * This was copied into two components before it was a file. The copies had
 * drifted — one defaulted true, one false — which is the ordinary way a
 * duplicated hook becomes two behaviours.
 */
export function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const update = () => setVisible(document.visibilityState === "visible");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  return visible;
}
