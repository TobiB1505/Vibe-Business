"use client";

import { useEffect } from "react";

/**
 * The hidden-tab pause, as one listener for the whole product (S2).
 *
 * Stamps `data-motion="paused"` on the document root while the tab is hidden.
 * `globals.css` keys every animation off that attribute, so a component gets
 * the obligation by using `Reveal` rather than by subscribing to anything —
 * which is the point: twenty-two components import `motion` today and each one
 * had to remember this on its own.
 *
 * ## Why the root element and not a context
 *
 * A context would only reach components that read it, and the ones most likely
 * to forget are exactly the ones that would not. An attribute on `<html>` is
 * reachable by CSS from anywhere, including a component written later by
 * somebody who has never read this file.
 *
 * ## Why it renders nothing
 *
 * So it can be mounted once in the root layout without adding an element to
 * the document or a `"use client"` boundary around anything. The layout stays
 * a server component; only this leaf is client.
 */
export function MotionProvider() {
  useEffect(() => {
    const root = document.documentElement;
    const sync = () => {
      root.dataset.motion = document.visibilityState === "hidden" ? "paused" : "running";
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      document.removeEventListener("visibilitychange", sync);
      // Left without the attribute rather than stamped "running": the absence
      // is the honest state once nothing is listening, and a stale "running"
      // would claim a pause is still being watched for.
      delete root.dataset.motion;
    };
  }, []);

  return null;
}
