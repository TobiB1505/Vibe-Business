import type { VerificationCheck, VerificationMode } from "./verification";

/**
 * What a run is allowed to do after the code is written — and, since Sprint
 * 0044, when "after" actually begins.
 *
 * ## What run #5 measured, and what run #7 broke
 *
 * Run #5's implementation was complete at 59.3 seconds and the run lasted 191.8.
 * Sixty-nine per cent of it went on exploration nothing had asked for, so this
 * file made exploration scarce once the code stopped changing, with one rule to
 * keep repair alive: **a new edit buys back the budget**.
 *
 * Run #7 showed what that rule cost. The task — canonical URLs across the public
 * pages — legitimately required editing eight files. The counter incremented on
 * every mutation after the first, so eight edits produced seven "completion
 * windows" against a ceiling of four, and every subsequent action was refused.
 * All eight refusals were the agent trying to read the files it had just
 * changed: the LOW plan's own **required** diff review.
 *
 * Two separate mistakes, both fixed here:
 *
 * 1. **Number of edits was used as a proxy for number of convergence cycles.**
 *    Eight edits can mean eight files that need the same change. Raising the
 *    ceiling to twelve would only move the threshold, so the counter's meaning
 *    changed instead: implementation breadth is free, and only a mutation that
 *    arrives *after* the run has already converged consumes a window.
 * 2. **An optional resource control refused a required verification.** No policy
 *    may block another policy's required work. There is now an explicit decision
 *    hierarchy, and required verification sits above every completion budget in
 *    it — while sitting below every real safety boundary, none of which live
 *    here (PART H).
 *
 * ## What is observed and what is not
 *
 * Every transition below is driven by something the harness saw: a file
 * mutation, a tool failure, a read of a path Vibe itself recorded as mutated,
 * the absence of any mutation across a run of tool calls. Nothing asks the model
 * where it thinks it is, and nothing here reads the model's account of its own
 * work (Rule 77).
 *
 * `completing` is therefore not a claim that the step's Done When is satisfied.
 * It is the weaker, checkable statement that the code stopped changing and
 * nothing is failing. Whether the work is *right* is the validator's question,
 * and after that a human's.
 */

/* ---------------------------------------------------------------------------
 * Phases (PART F, PART G)
 * ------------------------------------------------------------------------ */

export const EXECUTION_PHASES_OBSERVED = [
  /** No candidate mutation yet. Orientation and reading. */
  "orienting",
  /**
   * The change is being written.
   *
   * Mutations here are free — as many files as the task requires, in any order,
   * interleaved with the reads needed to write them. This is the phase run #7
   * spent its whole implementation in while being charged for convergence.
   */
  "implementing",
  /** A required or permitted check is being carried out since the last mutation. */
  "verifying",
  /** A command or write failed and no mutation has answered it yet. */
  "repairing",
  /**
   * The code stopped changing and nothing is failing.
   *
   * The only phase in which optional exploration is scarce. Reached by
   * observation — a run of tool calls with no mutation in it — never by the
   * model saying it is finished.
   */
  "completing",
] as const;
export type ObservedExecutionPhase = (typeof EXECUTION_PHASES_OBSERVED)[number];

/* ---------------------------------------------------------------------------
 * The budget (PART J)
 * ------------------------------------------------------------------------ */

export type CompletionBudget = {
  budgetVersion: string;
  mode: VerificationMode;

  /**
   * Consecutive non-mutating tool calls that mark the implementation as settled.
   *
   * The transition into `completing`, and the whole of Sprint 0044's answer to
   * "is this run still implementing?". While the agent keeps returning to write
   * files, this counter keeps resetting and no completion budget applies. When
   * it stops, the run has converged by observation rather than by assertion.
   *
   * Small on purpose: a read-then-edit rhythm never reaches it, and a run that
   * has genuinely stopped editing reaches it within a few calls.
   */
  implementationStabilisationCalls: number;

  /** Optional tool calls allowed after convergence. */
  maxCompletionActions: number;

  /**
   * Reads of files the Execution Brief did not name, after convergence.
   *
   * Separate and much smaller, because the brief exists to make these
   * unnecessary. Reads of files *the run itself changed* are not counted here —
   * those are the required diff review, and they are governed below.
   */
  maxOutsideBriefReads: number;

  /**
   * Mutations that arrive after the run has already converged.
   *
   * The backstop on the reset rule. Without it, converge → explore → edit →
   * explore is unbounded and each cycle costs a full window. It counts only
   * post-convergence mutations, so eight files written in one pass cost nothing.
   *
   * A mutation is never itself refused; exhausting this refuses the *optional*
   * work that follows one.
   */
  maxConvergenceWindows: number;

  /** Mutations that answered a failure the harness observed. */
  maxRepairCycles: number;

  /** Wall clock from the last mutation. */
  maxCompletionWallClockMs: number;

  /**
   * How many times one changed file may be re-read under required diff review.
   *
   * The scope bound on PART I. Diff review outranks the completion budget, so it
   * needs a ceiling of its own — otherwise "review your changes" becomes an
   * unbounded read loop over a set the agent can enlarge by editing another
   * file. Two is enough to read a file and check it again after a fix.
   */
  maxDiffReviewReadsPerPath: number;
};

export const COMPLETION_BUDGET_VERSION = "completion-budget.v2" as const;

/**
 * The three profiles.
 *
 * The post-convergence numbers are unchanged from v1, because run #6 proved they
 * were right: it converged, explored nothing, and was refused nothing. What
 * changed is *when they start applying*, which is the only thing run #7 was
 * wrong about.
 */
const PROFILES: Record<VerificationMode, Omit<CompletionBudget, "budgetVersion" | "mode">> = {
  low: {
    implementationStabilisationCalls: 3,
    maxCompletionActions: 6,
    maxOutsideBriefReads: 1,
    maxConvergenceWindows: 3,
    maxRepairCycles: 2,
    maxCompletionWallClockMs: 120_000,
    maxDiffReviewReadsPerPath: 2,
  },
  medium: {
    implementationStabilisationCalls: 4,
    maxCompletionActions: 10,
    maxOutsideBriefReads: 3,
    maxConvergenceWindows: 4,
    maxRepairCycles: 3,
    maxCompletionWallClockMs: 240_000,
    maxDiffReviewReadsPerPath: 2,
  },
  high: {
    implementationStabilisationCalls: 6,
    maxCompletionActions: 16,
    maxOutsideBriefReads: 6,
    maxConvergenceWindows: 6,
    maxRepairCycles: 4,
    maxCompletionWallClockMs: 480_000,
    maxDiffReviewReadsPerPath: 3,
  },
};

export function compileCompletionBudget(mode: VerificationMode): CompletionBudget {
  return { budgetVersion: COMPLETION_BUDGET_VERSION, mode, ...PROFILES[mode] };
}

/* ---------------------------------------------------------------------------
 * Classifying one action
 * ------------------------------------------------------------------------ */

export const COMPLETION_ACTIVITIES = [
  "candidate_mutation",
  /** A read of a file this run changed, while the plan requires a diff review. */
  "required_diff_review",
  /** A command the verification plan lists as required. */
  "required_check",
  "repair",
  "verification_command",
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
  "convergence_windows_exhausted",
  "repair_cycles_exhausted",
  "diff_review_scope_exhausted",
] as const;
export type CompletionRefusalReason = (typeof COMPLETION_REFUSAL_REASONS)[number];

/** Tools that change the candidate. */
const MUTATING_TOOLS = new Set(["Write", "Edit", "NotebookEdit", "MultiEdit"]);
const READ_TOOLS = new Set(["Read", "NotebookRead"]);
const SEARCH_TOOLS = new Set(["Glob", "Grep"]);

export type CompletionState = {
  phase: ObservedExecutionPhase;
  /** Has any candidate mutation happened? */
  implemented: boolean;
  /** Non-mutating tool calls since the last mutation. Drives convergence. */
  callsSinceEdit: number;
  /** Optional actions spent since the run converged. */
  completionActions: number;
  /** Outside-brief reads spent since the run converged. */
  outsideBriefReads: number;
  /** Mutations written while implementing. Breadth, never charged. */
  implementationMutations: number;
  /** Mutations that arrived after convergence. Each consumed a window. */
  convergenceMutations: number;
  /** Of all mutations, the ones that answered an observed failure. */
  repairCycles: number;
  /** Required verification operations the runtime allowed. */
  requiredVerificationActions: number;
  /** Of those, the ones allowed while a completion budget was already spent. */
  requiredVerificationOverrides: number;
  /**
   * When the last mutation happened, on the harness's own relative clock.
   *
   * Relative rather than absolute for the same reason the progress feed's
   * timestamps are: the sandbox's clock is not Vibe's, and an absolute stamp
   * from inside the VM is a number nobody can safely compare to anything.
   */
  lastEditAt: number | null;
  /**
   * A command or write has failed and no mutation has answered it yet.
   *
   * The one signal that unlocks expansion. Observed by the harness from a tool's
   * own result, never from the model describing a problem.
   */
  unresolvedFailure: boolean;
  /**
   * Repository-relative paths this run has mutated.
   *
   * Vibe's own observation of what the agent wrote — the same source
   * `verifyCandidateChange` uses, never the agent's account of its work.
   * This set is what scopes the required diff review (PART I).
   */
  mutatedPaths: ReadonlySet<string>;
  /** Diff-review reads spent per mutated path. */
  diffReviewReads: ReadonlyMap<string, number>;
};

export function initialCompletionState(): CompletionState {
  return {
    phase: "orienting",
    implemented: false,
    callsSinceEdit: 0,
    completionActions: 0,
    outsideBriefReads: 0,
    implementationMutations: 0,
    convergenceMutations: 0,
    repairCycles: 0,
    requiredVerificationActions: 0,
    requiredVerificationOverrides: 0,
    lastEditAt: null,
    unresolvedFailure: false,
    mutatedPaths: new Set(),
    diffReviewReads: new Map(),
  };
}

export type CompletionDecision =
  | { allowed: true; activity: CompletionActivity; phase: ObservedExecutionPhase }
  | {
      allowed: false;
      reason: CompletionRefusalReason;
      activity: CompletionActivity;
      phase: ObservedExecutionPhase;
    };

export type CompletionActionInput = {
  toolName: string;
  /** Repository-relative path the tool targets, when it has one. */
  path: string | null;
  /** Paths the Execution Brief named. */
  briefPaths: ReadonlySet<string>;
  /**
   * Checks the verification plan marked required, and the check this command
   * maps to. Both trusted Vibe policy; neither derived from model text.
   */
  requiredChecks: readonly VerificationCheck[];
  commandCheck: VerificationCheck | null;
  budget: CompletionBudget;
  /** Milliseconds since the harness started, on the harness's own clock. */
  now: number;
};

/**
 * What one action is, judged from the call and the run's own history.
 *
 * Deterministic inputs only: the tool name, the path, whether Vibe recorded that
 * path as mutated by this run, whether the brief named it, and whether a failure
 * is outstanding. The model's account of *why* it wants something is not read —
 * it has no field to put it in, and a classifier that read one would be a
 * classifier a prompt could argue with.
 */
export function classifyCompletionActivity(input: {
  toolName: string;
  path: string | null;
  briefPaths: ReadonlySet<string>;
  requiredChecks: readonly VerificationCheck[];
  commandCheck: VerificationCheck | null;
  state: CompletionState;
}): CompletionActivity {
  const { toolName, path, briefPaths, requiredChecks, commandCheck, state } = input;

  if (MUTATING_TOOLS.has(toolName)) return "candidate_mutation";
  if (!state.implemented) return "orientation";

  /*
   * Required verification is recognised before anything else, including repair.
   *
   * Not because it outranks repair — it does not, and the hierarchy below still
   * puts an outstanding failure first — but because the activity label has to
   * say what the action *is*, and "reading a file I changed while a check is
   * failing" is still the diff review.
   */
  if (
    READ_TOOLS.has(toolName) &&
    path !== null &&
    state.mutatedPaths.has(path) &&
    requiredChecks.includes("diff_review")
  ) {
    return "required_diff_review";
  }

  if (commandCheck !== null && requiredChecks.includes(commandCheck)) return "required_check";

  if (state.unresolvedFailure) return "repair";

  if (toolName === "Bash") return "verification_command";
  if (SEARCH_TOOLS.has(toolName)) return "search";
  if (READ_TOOLS.has(toolName)) {
    return path !== null && briefPaths.has(path) ? "brief_read" : "outside_brief_read";
  }

  return "orientation";
}

const REQUIRED_ACTIVITIES: ReadonlySet<CompletionActivity> = new Set<CompletionActivity>([
  "required_diff_review",
  "required_check",
]);

/**
 * Whether one action may proceed, and what the run's state becomes.
 *
 * ## The decision hierarchy (PART H)
 *
 * ```
 * 1  tool availability                  canUseTool — a tool that does not exist
 * 2  verification plan                  a forbidden or over-budget check command
 * 3  unresolved failure / repair        bounded by maxRepairCycles
 * 4  REQUIRED agent verification        bounded by scope, never by these budgets
 * 5  completion resource controls       windows, wall clock, outside-brief, actions
 * 6  optional exploration               whatever is left
 * ```
 *
 * Levels 1 and 2 are decided before this function is called and are unchanged.
 * What this adds is that level 4 exists at all, and that it sits above level 5:
 * "review every file you changed" is an instruction Vibe gave, so Vibe's own
 * resource budget may not refuse it.
 *
 * It emphatically does **not** outrank tool availability, the write scope,
 * sandbox isolation, gateway budgets or secret controls. None of those are
 * decided here, and calling something required cannot reach them.
 *
 * ## Why state comes back out
 *
 * One pure function owns both the answer and the transition, so the harness
 * inside the sandbox and Vibe's tests cannot drift on either. The harness mirrors
 * this logic in `AGENT_RUNTIME_PROGRAM`, and the canary runs that mirror against
 * the same fixtures — which is what makes "they agree" a failing test rather
 * than a paid run's surprise.
 */
export function evaluateCompletionAction(
  state: CompletionState,
  input: CompletionActionInput,
): { decision: CompletionDecision; state: CompletionState } {
  const { budget, now } = input;
  const activity = classifyCompletionActivity({ ...input, state });

  /* 3′ — a mutation is never refused. It is the work. */
  if (activity === "candidate_mutation") {
    return { decision: { allowed: true, activity, phase: "implementing" }, state: onMutation(state, input) };
  }

  /* Nothing here applies before the first edit: the brief is evidence, not truth. */
  if (!state.implemented) {
    return {
      decision: { allowed: true, activity, phase: "orienting" },
      state: { ...state, phase: "orienting" },
    };
  }

  /* 3 — concrete evidence of a problem outranks every budget below. */
  if (activity === "repair") {
    if (state.repairCycles >= budget.maxRepairCycles) {
      return {
        decision: { allowed: false, reason: "repair_cycles_exhausted", activity, phase: "repairing" },
        state: { ...state, phase: "repairing" },
      };
    }
    return {
      decision: { allowed: true, activity, phase: "repairing" },
      state: { ...advanceCall(state), phase: "repairing" },
    };
  }

  /* 4 — required verification, bounded by scope rather than by budget. */
  if (REQUIRED_ACTIVITIES.has(activity)) {
    return decideRequiredVerification(state, input, activity);
  }

  const converged = hasConverged(state, budget);

  /*
   * 5 — the completion budgets, and only once the run has actually converged.
   *
   * While the implementation is still moving, optional reads and searches are
   * the reads that make the next edit possible. Charging for them is what turned
   * run #7's eight-file change into eight refusals.
   */
  if (!converged) {
    return {
      decision: { allowed: true, activity, phase: "implementing" },
      state: { ...advanceCall(state), phase: "implementing" },
    };
  }

  const refuse = (reason: CompletionRefusalReason) => ({
    decision: { allowed: false as const, reason, activity, phase: "completing" as const },
    state: { ...state, phase: "completing" as const },
  });

  if (state.convergenceMutations >= budget.maxConvergenceWindows) {
    return refuse("convergence_windows_exhausted");
  }
  if (msSinceEdit(state, now) >= budget.maxCompletionWallClockMs) {
    return refuse("completion_wall_clock_exhausted");
  }
  if (
    activity === "outside_brief_read" &&
    state.outsideBriefReads >= budget.maxOutsideBriefReads
  ) {
    return refuse("outside_brief_budget_exhausted");
  }
  if (state.completionActions >= budget.maxCompletionActions) {
    return refuse("completion_budget_exhausted");
  }

  const next = advanceCall(state);
  return {
    decision: { allowed: true, activity, phase: "completing" },
    state: {
      ...next,
      phase: "completing",
      completionActions: next.completionActions + 1,
      outsideBriefReads:
        activity === "outside_brief_read" ? next.outsideBriefReads + 1 : next.outsideBriefReads,
    },
  };
}

/**
 * Has the implementation stopped moving?
 *
 * One question, answered by counting: this many tool calls have happened and
 * none of them changed a file. That is the strongest statement the runtime can
 * make without reading the model's own claim about being finished, and it is
 * deliberately the *weaker* half of the two signals PART G lists — the other
 * being the model's completion contract, which stays advisory and reaches no
 * decision here.
 */
function hasConverged(state: CompletionState, budget: CompletionBudget): boolean {
  return state.phase === "completing" || state.callsSinceEdit >= budget.implementationStabilisationCalls;
}

/**
 * Required verification, scoped to what the run actually changed (PART I).
 *
 * The allowance is not "read whatever you like now". It is: each path Vibe
 * observed this run mutate may be re-read up to `maxDiffReviewReadsPerPath`
 * times, and a check the plan lists as required may run. An unrelated config
 * file is not a changed path, so it is refused by the ordinary budgets exactly
 * as before — which is the property PART I asks to be provable.
 */
function decideRequiredVerification(
  state: CompletionState,
  input: CompletionActionInput,
  activity: CompletionActivity,
): { decision: CompletionDecision; state: CompletionState } {
  const phase: ObservedExecutionPhase = "verifying";

  if (activity === "required_diff_review") {
    const path = input.path ?? "";
    const spent = state.diffReviewReads.get(path) ?? 0;
    if (spent >= input.budget.maxDiffReviewReadsPerPath) {
      return {
        decision: { allowed: false, reason: "diff_review_scope_exhausted", activity, phase },
        state: { ...state, phase },
      };
    }

    const reads = new Map(state.diffReviewReads);
    reads.set(path, spent + 1);
    return {
      decision: { allowed: true, activity, phase },
      state: withRequiredVerification({ ...advanceCall(state), diffReviewReads: reads }, state, input),
    };
  }

  return {
    decision: { allowed: true, activity, phase },
    state: withRequiredVerification(advanceCall(state), state, input),
  };
}

/**
 * Records that a required operation ran, and whether it needed the hierarchy.
 *
 * `requiredVerificationOverrides` is the number PART L asks for: how often a
 * required operation went ahead that the completion budget alone would have
 * refused. On a healthy run it is zero. On run #7's shape it is eight, and it is
 * the difference between "the policies agreed" and "one policy had to win".
 */
function withRequiredVerification(
  next: CompletionState,
  previous: CompletionState,
  input: CompletionActionInput,
): CompletionState {
  const wouldHaveBeenRefused =
    hasConverged(previous, input.budget) &&
    (previous.convergenceMutations >= input.budget.maxConvergenceWindows ||
      previous.completionActions >= input.budget.maxCompletionActions ||
      msSinceEdit(previous, input.now) >= input.budget.maxCompletionWallClockMs);

  return {
    ...next,
    phase: "verifying",
    requiredVerificationActions: next.requiredVerificationActions + 1,
    requiredVerificationOverrides:
      next.requiredVerificationOverrides + (wouldHaveBeenRefused ? 1 : 0),
  };
}

/** One non-mutating call happened. */
function advanceCall(state: CompletionState): CompletionState {
  return { ...state, callsSinceEdit: state.callsSinceEdit + 1 };
}

/** Zero before the first mutation, so the wall clock never bites during orientation. */
function msSinceEdit(state: CompletionState, now: number): number {
  return state.lastEditAt === null ? 0 : Math.max(0, now - state.lastEditAt);
}

/**
 * A mutation happened.
 *
 * Where breadth and convergence part company. A mutation while the run is still
 * implementing costs nothing at all; one that arrives after the run had already
 * converged consumes a window; one that answers an observed failure is a repair.
 * Run #6 recorded a repair for its ordinary second edit because a single counter
 * was asked to mean all three.
 */
function onMutation(state: CompletionState, input: CompletionActionInput): CompletionState {
  const converged = state.implemented && hasConverged(state, input.budget);
  const mutated = new Set(state.mutatedPaths);
  if (input.path) mutated.add(input.path);

  return {
    ...state,
    phase: "implementing",
    implemented: true,
    callsSinceEdit: 0,
    completionActions: 0,
    outsideBriefReads: 0,
    implementationMutations:
      state.implementationMutations + (converged ? 0 : 1),
    convergenceMutations: state.convergenceMutations + (converged ? 1 : 0),
    repairCycles: state.repairCycles + (state.unresolvedFailure ? 1 : 0),
    unresolvedFailure: false,
    lastEditAt: input.now,
    mutatedPaths: mutated,
  };
}

/**
 * A tool failed, as the harness saw it.
 *
 * Only a command or a write counts. A failed `Read` means the agent guessed a
 * path that is not there — which says nothing about whether the implementation
 * is wrong, and everything about whether the guess was. Treating it as a failure
 * unlocked unlimited exploration, a bypass any model could have found by
 * accident, and the canary caught it.
 */
export function observeToolFailure(state: CompletionState, toolName: string): CompletionState {
  const counts = toolName === "Bash" || MUTATING_TOOLS.has(toolName);
  if (!state.implemented || !counts) return state;
  return { ...state, unresolvedFailure: true, phase: "repairing" };
}

/** What the agent is told. Vibe's words, never a reason it can argue with. */
export const COMPLETION_MESSAGES: Record<CompletionRefusalReason, string> = {
  completion_budget_exhausted:
    "The implementation and its required checks are complete, and the budget for further " +
    "work on this step is used up. Vibe validates the prepared change independently after " +
    "you stop. Summarise what you changed and finish.",
  outside_brief_budget_exhausted:
    "This file is outside the set Vibe's analysis pointed at, and the allowance for reading " +
    "further afield after implementing is used up. Reviewing the files you changed is still " +
    "available. If a check has actually failed, fix what it reported; otherwise finish.",
  completion_wall_clock_exhausted:
    "The time budget for work after the implementation is used up. Vibe validates the " +
    "prepared change independently after you stop. Summarise what you changed and finish.",
  repair_cycles_exhausted:
    "This step has been through its allowed repair attempts. Stop and describe honestly what " +
    "is still wrong — a partial change that is accurately reported is far more useful than " +
    "another attempt Vibe cannot pay for.",
  convergence_windows_exhausted:
    "This step has been finished and reopened as many times as its budget allows. Stop and " +
    "describe what you changed and anything you left undone.",
  diff_review_scope_exhausted:
    "You have already reviewed this file. Review the other files you changed, or finish — " +
    "Vibe validates the prepared change independently after you stop.",
};

/** The completion half of what crosses into the sandbox. */
export type SandboxCompletionPolicy = {
  budget: Omit<CompletionBudget, "budgetVersion" | "mode">;
  /** Repository-relative paths the Execution Brief named. */
  briefPaths: readonly string[];
  /** Checks the verification plan marked required. Trusted Vibe policy. */
  requiredChecks: readonly VerificationCheck[];
  mutatingTools: readonly string[];
  readTools: readonly string[];
  searchTools: readonly string[];
  messages: Record<CompletionRefusalReason, string>;
};

export function toSandboxCompletionPolicy(input: {
  budget: CompletionBudget;
  briefPaths: readonly string[];
  requiredChecks: readonly VerificationCheck[];
}): SandboxCompletionPolicy {
  const { budgetVersion: _version, mode: _mode, ...budget } = input.budget;
  return {
    budget,
    briefPaths: input.briefPaths,
    requiredChecks: input.requiredChecks,
    mutatingTools: [...MUTATING_TOOLS],
    readTools: [...READ_TOOLS],
    searchTools: [...SEARCH_TOOLS],
    messages: COMPLETION_MESSAGES,
  };
}
