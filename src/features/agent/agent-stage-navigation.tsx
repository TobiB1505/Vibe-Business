"use client";

import { createContext, useContext } from "react";
import type { AgentStage } from "@/modules/coding-agent/observability/agent-stages";

/**
 * How a control inside one stage moves the panel to another (UI-19).
 *
 * ## Why a context rather than a prop
 *
 * The stage bodies are built on the server and handed to the panel as elements,
 * and a function cannot cross that boundary. But context does not care where an
 * element was *created* — only where it is rendered — so the panel can provide
 * this and a client component nested inside any body can consume it.
 *
 * ## Why this exists at all
 *
 * Stage four's "Review changes" was an anchor link to the merge panel further
 * down the page. It scrolled, so the founder stayed on stage four looking at
 * two empty preview frames while the thing they had asked for sat somewhere
 * below. The step they pressed forward on is stage five, so pressing it should
 * put them on stage five.
 *
 * Absent by default: a body rendered outside the panel (the scenario harness
 * mounts several that way) gets a no-op rather than a crash, and `canNavigate`
 * lets a control render as plain text instead of a dead button.
 */
const StageNavigation = createContext<((stage: AgentStage) => void) | null>(
  null,
);

export const StageNavigationProvider = StageNavigation.Provider;

export function useStageNavigation() {
  const go = useContext(StageNavigation);
  return { go, canNavigate: go !== null };
}
