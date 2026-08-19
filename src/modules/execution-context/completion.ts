import type { VerificationMode } from "./verification";

/**
 * When the requested job is finished, and what it costs to keep going after
 * that (POST-IMPLEMENTATION COMPLETION CONTROL).
 *
 * ## What run #5 measured
 *
 * The implementation was complete at 59.3 seconds. The run lasted 191.8. Of the
 * 132.5 seconds after the last edit — 69% of the run — eight of fifteen
 * provider calls and $0.1496 of $0.3199 were spent, and nine tool actions
 * happened:
 *
 * ```
 *  62.5s  read  src/app/layout.tsx          the required diff review
 *  63.0s  read  src/app/app/layout.tsx      the required diff review
 *  63.3s  grep  src                         exploration
 *  68.2s  read  .../nextjs-seo-foundations.ts   outside the brief, unrelated
 *  84.7s  bash  node -e "…dependencies.next"    re-derived a brief fact
 *  91.1s  grep  src/app                     exploration
 *  91.1s  glob  *                           exploration
 *  96.8s  grep  landing-contract.test.ts    locating a test
 * 101.6s  bash  vitest run …contract.test.ts    the permitted targeted test
 * ```
 *
 * Four of those nine were the job. Five were not, and one of them re-derived a
 * fact the Execution Brief had already stated. No tool failed; nothing in the
 * evidence justified the widening.
 *
 * ## Why a prompt could not fix this
 *
 * v3 already told the agent to stop. It stopped running *checks* — zero builds,
 * zero full suites, zero typechecks, which is why the wall clock halved — and
 * then filled the space with reading. Asking again is not a mechanism.
 *
 * ## The idea, in one line
 *
 * Exploration becomes scarce once the code is written, and a **new edit buys
 * back the budget** — because an agent that is still changing files is still
 * implementing, and that is exactly the repair loop that must not be broken.
 */

/* ---------------------------------------------------------------------------
 * Phases (PART D)
 * ------------------------------------------------------------------------ */

/**
 * Where a run is, judged only by what Vibe can observe.
 *
 * Every transition below is driven by a tool event the harness saw: a file
 * mutation, a permitted check, a tool failure. None of it asks the model where
 * it thinks it is.
 *
 * `done` is deliberately absent as a *judgement*: the runtime cannot prove the
 * step's Done When is semantically satisfied, because Done When is a sentence
 * about a business outcome. What it can prove is that the code stopped
 * changing, the required checks passed and nothing is failing — and that is
 * what `completing` means. Whether the work is *right* is the validator's
 * question, and after that a human's.
 */
export const EXECUTION_PHASES_OBSERVED = [
  /** No candidate mutation yet. Orientation and reading. */
  "orienting",
  /** At least one mutation, and the most recent thing that happened was one. */
  "implementing",
  /** A permitted check has run since the last mutation. */
  "verifying",
  /** A check or tool failed and has not been answered by a mutation yet. */
  "repairing",
  /** Code written, nothing failing: the window where exploration is scarce. */
  "completing",
] as const;
export type ObservedExecutionPhase = (typeof EXECUTION_PHASES_OBSERVED)[number];

/* ---------------------------------------------------------------------------
 * The budget (PART E, PART J)
 * ------------------------------------------------------------------------ */

export type CompletionBudget = {
  budgetVersion: string;
  mode: VerificationMode;

  /**
   * Tool calls allowed since the last candidate mutation.
   *
   * **Reset by every mutation**, which is what keeps repair alive: an agent
   * that edits a file has demonstrably not finished, so it gets a fresh window
   * rather than an exemption it has to argue for.
   */
  maxToolCallsSinceEdit: number;

  /**
   * Reads of files the Execution Brief did not name, per window.
   *
   * Separate and much smaller, because the brief exists to make these
   * unnecessary. Run #5 made one after its last edit and it was a Vibe-internal
   * generator with no bearing on the two layout files it had changed.
   */
  maxOutsideBriefReadsSinceEdit: number;

  /**
   * How many times a new edit may buy back the window.
   *
   * The backstop on the reset rule: without it, edit → explore → edit → explore
   * is unbounded and each cycle costs a full window. Counts **every** mutation
   * after the first, whether it repaired something or not.
   */
  maxCompletionWindows: number;

  /**
   * How many mutations may follow an observed failure.
   *
   * A strict subset of the windows above, and the one that answers "is this run
   * converging?". Run #6 recorded `repair_cycles: 1` for what was simply its
   * second implementation edit — no check had failed — because one counter was
   * being asked to mean both things. It now means only this.
   */
  maxRepairCycles: number;

  /** Wall clock from the last mutation. */
  maxCompletionWallClockMs: number;
};

export const COMPLETION_BUDGET_VERSION = "completion-budget.v1" as const;

/**
 * The three profiles.
 *
 * Derived from what run #5 actually needed rather than chosen round. Its
 * legitimate post-edit work was four tool actions — two diff-review reads, one
 * search to locate a test, one targeted test — so LOW is six: enough for that
 * plus two, and less than the nine it took.
 *
 * MEDIUM and HIGH are scaled for tasks the classifier already treats as
 * broader. A billing or auth change that fails a check needs room to read the
 * failure, the implicated file and its neighbour before it can fix anything,
 * and starving that would trade money for a wrong change — which is the wrong
 * direction on both counts.
 */
const PROFILES: Record<VerificationMode, Omit<CompletionBudget, "budgetVersion" | "mode">> = {
  low: {
    maxToolCallsSinceEdit: 6,
    maxOutsideBriefReadsSinceEdit: 1,
    // Run #6 used two: one per file it had to touch. Four leaves room for a
    // repair on each without letting a run reset itself indefinitely.
    maxCompletionWindows: 4,
    maxRepairCycles: 2,
    maxCompletionWallClockMs: 120_000,
  },
  medium: {
    maxToolCallsSinceEdit: 10,
    maxOutsideBriefReadsSinceEdit: 3,
    maxCompletionWindows: 6,
    maxRepairCycles: 3,
    maxCompletionWallClockMs: 240_000,
  },
  high: {
    maxToolCallsSinceEdit: 16,
    maxOutsideBriefReadsSinceEdit: 6,
    maxCompletionWindows: 10,
    maxRepairCycles: 4,
    maxCompletionWallClockMs: 480_000,
  },
};

export function compileCompletionBudget(mode: VerificationMode): CompletionBudget {
  return { budgetVersion: COMPLETION_BUDGET_VERSION, mode, ...PROFILES[mode] };
}

/* ---------------------------------------------------------------------------
 * Classifying one post-implementation action (PART F)
 * ------------------------------------------------------------------------ */

/**
 * What a tool call is, judged from the call and the run's own history.
 *
 * Deterministic inputs only: the tool name, the path, whether the Execution
 * Brief named that path, and whether a check has failed since the last
 * mutation. The model's account of *why* it wants something is not read — it
 * has no field to put it in, and a classifier that read one would be a
 * classifier a prompt could argue with.
 *
 * It does not need to be right about intent. It needs to tell the obvious tail
 * behaviour from the obvious repair loop, and leave the middle permitted.
 */
export const COMPLETION_ACTIVITIES = [
  "candidate_mutation",
  "required_verification",
  "repair",
  "brief_read",
  "outside_brief_read",
  "search",
  "orientation",
] as const;
export type CompletionActivity = (typeof COMPLETION_ACTIVITIES)[number];

export const COMPLETION_REFUSAL_REASONS = [
  "completion_budget_exhausted",
  "outside_brief_budget_exhausted",
  "completion_wall_clock_exhausted",
  "completion_windows_exhausted",
  "repair_cycles_exhausted",
] as const;
export type CompletionRefusalReason = (typeof COMPLETION_REFUSAL_REASONS)[number];

/** Tools that change the candidate. The only thing that buys a new window. */
const MUTATING_TOOLS = new Set(["Write", "Edit", "NotebookEdit", "MultiEdit"]);
const READ_TOOLS = new Set(["Read", "NotebookRead"]);
const SEARCH_TOOLS = new Set(["Glob", "Grep"]);

export type CompletionState = {
  /** Has any candidate mutation happened? */
  implemented: boolean;
  /** Tool calls since the last mutation. */
  toolCallsSinceEdit: number;
  /** Outside-brief reads since the last mutation. */
  outsideBriefReadsSinceEdit: number;
  /** Mutations after the first. Each one bought back the window. */
  windowResets: number;
  /** Of those, the ones that followed an observed failure. A real repair. */
  repairCycles: number;
  /** Milliseconds since the last mutation. Null before the first. */
  msSinceEdit: number | null;
  /**
   * A check or tool has failed and no mutation has answered it yet.
   *
   * The one signal that unlocks expansion (PART G). Observed by the harness
   * from a tool's own result, never from the model describing a problem.
   */
  unresolvedFailure: boolean;
};

export type CompletionDecision =
  | { allowed: true; activity: CompletionActivity }
  | { allowed: false; reason: CompletionRefusalReason; activity: CompletionActivity };

export function classifyCompletionActivity(input: {
  toolName: string;
  path: string | null;
  briefPaths: ReadonlySet<string>;
  state: CompletionState;
}): CompletionActivity {
  const { toolName, path, briefPaths, state } = input;

  if (MUTATING_TOOLS.has(toolName)) return "candidate_mutation";
  if (!state.implemented) return "orientation";

  // A failed check has not been answered yet, so reading is diagnosis.
  if (state.unresolvedFailure) return "repair";

  if (toolName === "Bash") return "required_verification";
  if (SEARCH_TOOLS.has(toolName)) return "search";
  if (READ_TOOLS.has(toolName)) {
    return path !== null && briefPaths.has(path) ? "brief_read" : "outside_brief_read";
  }

  return "orientation";
}

/**
 * Whether one post-implementation action may proceed.
 *
 * Pure, so the harness and Vibe's tests reach the same answer without either
 * being able to drift — the property that would have made the `allowedTools`
 * bug a failing test rather than a paid run.
 *
 * Three things are never refused here: a mutation (still implementing), work
 * while a failure is unresolved (repair), and anything at all before the first
 * edit (PART I — the brief is evidence, not truth, and an agent that cannot
 * look around cannot discover the brief is wrong).
 */
export function decideCompletionAction(input: {
  toolName: string;
  path: string | null;
  briefPaths: ReadonlySet<string>;
  budget: CompletionBudget;
  state: CompletionState;
}): CompletionDecision {
  const { budget, state } = input;
  const activity = classifyCompletionActivity(input);

  // Before the first edit, and while still editing, nothing here applies.
  if (!state.implemented || activity === "candidate_mutation") {
    return { allowed: true, activity };
  }

  // Concrete evidence of a problem outranks every budget below.
  if (activity === "repair") {
    return state.repairCycles >= budget.maxRepairCycles
      ? { allowed: false, reason: "repair_cycles_exhausted", activity }
      : { allowed: true, activity };
  }

  /*
   * The reset rule's own backstop.
   *
   * Checked after repair, so an agent genuinely answering failures is bounded
   * by its repair allowance rather than by this — and before the per-window
   * budgets, because once a run has bought back its window too many times the
   * remaining question is not how much of this window is left.
   */
  if (state.windowResets >= budget.maxCompletionWindows) {
    return { allowed: false, reason: "completion_windows_exhausted", activity };
  }

  if (
    state.msSinceEdit !== null &&
    state.msSinceEdit >= budget.maxCompletionWallClockMs
  ) {
    return { allowed: false, reason: "completion_wall_clock_exhausted", activity };
  }

  if (
    activity === "outside_brief_read" &&
    state.outsideBriefReadsSinceEdit >= budget.maxOutsideBriefReadsSinceEdit
  ) {
    return { allowed: false, reason: "outside_brief_budget_exhausted", activity };
  }

  if (state.toolCallsSinceEdit >= budget.maxToolCallsSinceEdit) {
    return { allowed: false, reason: "completion_budget_exhausted", activity };
  }

  return { allowed: true, activity };
}

/** What the agent is told. Vibe's words, never a reason it can argue with. */
export const COMPLETION_MESSAGES: Record<CompletionRefusalReason, string> = {
  completion_budget_exhausted:
    "The implementation and its required checks are complete, and the budget for further " +
    "work on this step is used up. Vibe validates the prepared change independently after " +
    "you stop. Summarise what you changed and finish.",
  outside_brief_budget_exhausted:
    "This file is outside the set Vibe's analysis pointed at, and the allowance for reading " +
    "further afield after implementing is used up. If a check has actually failed, fix what " +
    "it reported; otherwise finish.",
  completion_wall_clock_exhausted:
    "The time budget for work after the implementation is used up. Vibe validates the " +
    "prepared change independently after you stop. Summarise what you changed and finish.",
  repair_cycles_exhausted:
    "This step has been through its allowed repair attempts. Stop and describe honestly what " +
    "is still wrong — a partial change that is accurately reported is far more useful than " +
    "another attempt Vibe cannot pay for.",
  completion_windows_exhausted:
    "This step has been edited and revisited as many times as its budget allows. Stop and " +
    "describe what you changed and anything you left undone.",
};

/** The completion half of what crosses into the sandbox. */
export type SandboxCompletionPolicy = {
  budget: Omit<CompletionBudget, "budgetVersion" | "mode">;
  /** Repository-relative paths the Execution Brief named. */
  briefPaths: readonly string[];
  mutatingTools: readonly string[];
  readTools: readonly string[];
  searchTools: readonly string[];
  messages: Record<CompletionRefusalReason, string>;
};

export function toSandboxCompletionPolicy(input: {
  budget: CompletionBudget;
  briefPaths: readonly string[];
}): SandboxCompletionPolicy {
  const { budgetVersion: _version, mode: _mode, ...budget } = input.budget;
  return {
    budget,
    briefPaths: input.briefPaths,
    mutatingTools: [...MUTATING_TOOLS],
    readTools: [...READ_TOOLS],
    searchTools: [...SEARCH_TOOLS],
    messages: COMPLETION_MESSAGES,
  };
}
