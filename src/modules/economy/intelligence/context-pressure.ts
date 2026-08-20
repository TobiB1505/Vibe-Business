import { type RepositoryContextSize, briefWasClipped } from "../cost-drivers";

/**
 * How hard the Context Compiler had to squeeze (Sprint 0054, PART F).
 *
 * ## Why size is the wrong question
 *
 * Two repositories:
 *
 * - A: 100,000 files, 5 candidates relevant to the step.
 * - B: 5,000 files, 200 candidates relevant to the step.
 *
 * A is twenty times larger and B is the expensive one. The brief cap is 12
 * candidates, so B discards 188 relevant files and the agent has to go find
 * them itself — reads Vibe did not pay for in the brief and pays for twice in
 * the loop. A sends everything it had and the agent is done looking.
 *
 * The economically interesting quantity is therefore not "how big" but "how
 * much of what mattered did not fit".
 *
 * ## Why the ratio can be null
 *
 * `candidatesSent` saturates at `BRIEF_BUDGET.maxCandidates`, so 12-of-12 and
 * 12-of-200 are the same number on that column alone. Without
 * `candidatesAvailable` the question is unanswerable, and this returns null
 * rather than 1 — because 1 reads as "nothing was discarded", which is the one
 * conclusion the data cannot support. `briefWasClipped` in `cost-drivers.ts`
 * already draws that line and is reused rather than reimplemented.
 */

export const CONTEXT_PRESSURE_SIGNALS = ["unknown", "unclipped", "moderate", "severe"] as const;
export type ContextPressureSignal = (typeof CONTEXT_PRESSURE_SIGNALS)[number];

/** Above this ratio of discarded-to-sent, the brief is missing most of what mattered. */
const SEVERE_PRESSURE_RATIO = 2;

export type ContextPressure = {
  /**
   * `candidatesAvailable / candidatesSent`. 1 means everything relevant fitted;
   * 4 means the compiler saw four times what it could send. Null when either
   * side is unrecorded, or when nothing was sent at all.
   */
  candidatePressure: number | null;
  /** From `briefWasClipped` — null when unanswerable, never false. */
  clipped: boolean | null;
  signal: ContextPressureSignal;
};

export function deriveContextPressure(size: RepositoryContextSize | null): ContextPressure {
  const clipped = briefWasClipped(size);
  const available = size?.candidatesAvailable ?? null;
  const sent = size?.candidatesSent ?? null;

  // Zero sent is not a division problem to be papered over: it means the brief
  // carried no candidates, so there is no ratio to speak of.
  const candidatePressure = available === null || sent === null || sent === 0 ? null : available / sent;

  return { candidatePressure, clipped, signal: pressureSignal(candidatePressure, clipped) };
}

function pressureSignal(pressure: number | null, clipped: boolean | null): ContextPressureSignal {
  if (pressure === null) return clipped === false ? "unclipped" : "unknown";
  if (pressure <= 1) return "unclipped";
  return pressure >= SEVERE_PRESSURE_RATIO ? "severe" : "moderate";
}
