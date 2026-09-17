import type { BusinessLens } from "@/modules/business-audit/schema";

/**
 * The shapes `readAgentWorkspace` and `agentStageForChange` hand a screen.
 *
 * ## Why they are here and not beside the components that render them
 *
 * They were declared in `agent-task-panel.tsx`, `agent-validation-checks.tsx`,
 * `agent-preview-stage.tsx` and `agent-merge-stage.tsx`, and this module
 * imported them from there — a domain read model whose return type lived in a
 * route directory. It compiled because a `type` import is erased, and it was
 * still a real dependency: the module could not be read, moved or reused
 * without the component tree it described.
 *
 * ADR 0109's layering makes the direction the point. `src/modules` imports
 * nothing above it, and an import into `src/features` can never be registered
 * as transitional, so when Slice 2 moved the Agent surface into
 * `src/features/agent/` these four had to come the other way. The components
 * import them from here now, which is the direction that was always correct:
 * the domain says what a task, a check, a preview change and a merge summary
 * *are*, and a component decides how to draw one.
 *
 * Nothing about any of them changed in the move. `AgentTaskRating` is written
 * as a union rather than `keyof typeof IMPACT_LABELS` because the label tables
 * stayed with the component; `Record<AgentTaskRating, string>` there keeps the
 * two from drifting, which the inferred form did by construction.
 */

/** How a Move rates its impact or its effort. */
export type AgentTaskRating = "high" | "medium" | "low";

/** The Move a run is working on, as the Agent's screens state it. */
export type AgentTask = {
  title: string;
  /** The Move's current-state problem, in its own words. */
  problem: string;
  /** Why it deserves attention now. Absent on a Move that did not say. */
  whyNow: string | null;
  /** Absent when the task came from a stored origin, which carries no rating. */
  impact: AgentTaskRating | null;
  effort: AgentTaskRating | null;
  lens: BusinessLens | null;
  /**
   * The one plan step this run is doing. Null before a run is bound to one.
   *
   * A run executes a *step*, never a whole Move — the start action submits a
   * step key and the spec records it — and until this existed the screen said
   * only the Move, so a founder watching the agent work could not tell which
   * part of a five-step plan was being built.
   */
  step: { order: number; title: string } | null;
  /**
   * What this run will do: its absorbed preparation and every step it delivers,
   * in plan order. Not the whole plan — see `resolveTask`.
   *
   * The kinds are not decoration. Preparation is work the run performs on the
   * way to its objective and the plan step for it is never marked done;
   * a delivery is a step this one run completes. Before build chains the list
   * was one delivery and its preparation, so a flat list of titles was
   * unambiguous. With a chain it is not: three bullets could be one delivery
   * with two preparations, or three deliveries, and those are different offers
   * at different prices.
   */
  steps: { title: string; kind: "preparation" | "delivery" }[];
};

export type ValidationCheckState = "passed" | "failed" | "running" | "pending" | "skipped";

/** One check Vibe ran against a prepared change, and how it went. */
export type ValidationCheck = {
  name: string;
  /** What the check is doing, or why it did not run. */
  detail: string;
  state: ValidationCheckState;
};

/** One thing a preview shows a founder, in Vibe's words. */
export type PreviewChange = {
  /** What changed, in Vibe's words. */
  title: string;
  detail: string;
  kind: "added" | "connected" | "improved";
};

/** What a merge would carry, summarised from the change and its validation. */
export type MergeSummary = {
  filesChanged: number;
  linesAdded?: number;
  linesRemoved?: number;
  /** From the validation run, when one exists. */
  tests?: "passing" | "failing" | "not_run";
  build?: "successful" | "failed" | "not_run";
};
