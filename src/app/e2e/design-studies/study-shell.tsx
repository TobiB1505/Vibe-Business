"use client";

import { useEffect, useState, type ReactNode } from "react";
import "./studies.css";
import { STUDY_FONT_CLASSES } from "./study-fonts";
import type { Study } from "./studies";

/**
 * The scope that makes a study a study.
 *
 * `data-vibe-study` is the only thing that switches direction: every token the
 * interface reads is redefined beneath it, so the composition inside is
 * written once and rendered three ways. That is the architecture under test —
 * if a study needed its own markup to look different, the token layer would
 * not be carrying the redesign and S1's plan would be wrong.
 *
 * ## Why this is the client boundary
 *
 * One obligation needs a listener: continuous motion pauses when the tab is
 * hidden. Everything else — entrance, press, focus — is CSS, and the
 * composition it wraps stays a server component, passed through as `children`.
 */
export function StudyShell({ study, children }: { study: Study; children: ReactNode }) {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const sync = () => setHidden(document.visibilityState === "hidden");
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  return (
    <div
      data-vibe-study={study.id}
      className={`study-root ${STUDY_FONT_CLASSES} ${hidden ? "study-paused" : ""}`}
    >
      {/*
        Two fixed layers rather than a background on the root: the grain has to
        sit above the gradients and below everything else, and a single
        background cannot express that. Neither is interactive and neither is
        announced.
      */}
      <div className="study-atmos" aria-hidden />
      <div className="study-grain" aria-hidden />
      {children}
    </div>
  );
}
