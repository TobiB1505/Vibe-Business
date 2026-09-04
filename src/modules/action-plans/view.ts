import { evidenceSources } from "@/modules/business-audit/map-view";
import { deriveExecutionSurfaceRequirement } from "@/modules/execution-context/surface";
import {
  BUSINESS_SURFACE_LABELS,
  type BusinessSurfaceId,
} from "@/modules/repository-intelligence/schema";
import {
  EXECUTION_MODE_LABELS,
  EXECUTION_REASON_LABELS,
} from "@/modules/execution-contract/view";
import type {
  ExecutionResolution,
  ExecutionResolutionReason,
} from "@/modules/execution-contract/schema";
import type { ActionPlanBlockReason } from "./service";
import type {
  ActionPlanStep,
  ExecutionSupport,
  PlanProgress,
  PlanStalenessReason,
} from "./schema";

/**
 * The Action Plan presentation layer (ACTION PLANNER UI-1).
 *
 * Everything a screen needs to describe a plan in the founder's language,
 * kept separate from the components that render it — the same split
 * `opportunities/view.ts` already draws. Nothing here is a React component
 * and nothing here imports one, so this stays testable without a DOM and
 * reusable by both the Action Plan's panel and onboarding's First Move summary.
 *
 * The rule this file exists to enforce: a component may render `StepActor`,
 * `ExecutionSupport` or a `PlanStalenessReason` only through a lookup here.
 * None of those enum values, and no internal id (conclusion key, capability
 * id, contract/planner version, provider or model), is ever interpolated
 * directly into JSX.
 */

/** Where a blocked notice's action should send the founder. */
export type ActionPlanBlockTarget = "business_audit" | "product_understanding" | "next_moves";

export type ActionPlanBlockNotice = {
  reason: ActionPlanBlockReason;
  actionLabel: string;
  target: ActionPlanBlockTarget;
};

const BLOCK_NOTICE_COPY: Record<
  ActionPlanBlockReason,
  { actionLabel: string; target: ActionPlanBlockTarget }
> = {
  audit_missing: { actionLabel: "Run a business audit", target: "business_audit" },
  audit_stale: { actionLabel: "Update your business audit", target: "business_audit" },
  product_profile_missing: {
    actionLabel: "Let Vibe understand your product",
    target: "product_understanding",
  },
  move_missing: { actionLabel: "Find your next moves", target: "next_moves" },
  move_stale: { actionLabel: "Refresh your next moves", target: "next_moves" },
  move_not_found: { actionLabel: "Choose a move", target: "next_moves" },
  // The Move itself may be current; what failed is linking it back to a
  // business conclusion. The remedy is the same one that regenerates it.
  planner_source_unresolved: { actionLabel: "Refresh your next moves", target: "next_moves" },
};

/** A block never has no way out (mirrors `buildOpportunityBlockNotice`). */
export function buildActionPlanBlockNotice(
  reason: ActionPlanBlockReason | null,
): ActionPlanBlockNotice | null {
  if (reason === null) return null;
  const entry = BLOCK_NOTICE_COPY[reason];
  return { reason, actionLabel: entry.actionLabel, target: entry.target };
}

/**
 * Why a stored plan may no longer describe the current business, in the
 * founder's language rather than the domain's (§42).
 */
export const PLAN_STALENESS_LABELS: Record<PlanStalenessReason, string> = {
  audit_superseded: "Your business audit has changed since this plan was made.",
  move_superseded: "Your next moves have changed since this plan was made.",
  product_profile_changed: "Vibe's understanding of your product has changed since this plan was made.",
  founder_intent_changed: "What you told Vibe about your business has changed since this plan was made.",
  planner_contract_superseded: "Vibe's planning approach has improved since this plan was made.",
};

/** A short, plain-language summary of where the plan stands (§40). */
export const PLAN_PROGRESS_LABELS: Record<PlanProgress, string> = {
  ready: "Vibe can move this forward.",
  needs_founder: "The next step needs you.",
  blocked: "The next step is waiting on someone else.",
  finished: "Every step is done.",
};

/**
 * Where one step stands relative to the plan's single genuine entry point
 * (§38, §39 in the sequencing module this reads).
 *
 * `start_here` is never assigned by position — it is whichever step
 * `firstActionableStep` actually returned. `also_ready` exists because more
 * than one zero-dependency step can be true at once; only one is highlighted
 * as the plan's current entry point, but the others should not read as
 * blocked when they are not.
 */
export type StepDisplayState =
  | "start_here"
  | "also_ready"
  | "waiting_on_steps"
  | "done"
  | "covered";

export function stepDisplayState(
  step: ActionPlanStep,
  firstActionableOrder: number | null,
  completed: ReadonlySet<number> = new Set(),
  /**
   * Covered step order → the order of the step whose run covered it.
   *
   * A fifth state rather than a sixth flavour of `done`, because the two are
   * different claims (ADR 0091). "Done" says somebody carried this out; this
   * says a larger run performed it on the way to something else, and the row
   * names which. Checked after `completed` so a step that is genuinely both —
   * absorbed and later executed on its own — reads as executed.
   */
  absorbedByStepOrder: ReadonlyMap<number, number> = new Map(),
): StepDisplayState {
  if (completed.has(step.order)) return "done";
  if (absorbedByStepOrder.has(step.order)) return "covered";
  if (firstActionableOrder !== null && step.order === firstActionableOrder) return "start_here";
  if (step.dependsOn.length === 0) return "also_ready";
  return "waiting_on_steps";
}

/** The titles of a step's prerequisites, in plan order — never their raw order numbers alone. */
export function stepDependencyTitles(step: ActionPlanStep, allSteps: ActionPlanStep[]): string[] {
  const byOrder = new Map(allSteps.map((entry) => [entry.order, entry.title]));
  return step.dependsOn
    .map((order) => byOrder.get(order))
    .filter((title): title is string => Boolean(title));
}

/**
 * The one-line responsibility statement a scanning founder reads first
 * (ACTION PLANNER UI-1.1 §20–§25).
 *
 * Keyed by `ExecutionSupport` alone rather than by `(actor, executionSupport)`
 * — the six values already carry the actor distinction the density pass asks
 * for (`vibe_prepares` / `vibe_executes_now` / `not_yet_supported` are the
 * three ways "Vibe" can read; `founder_decides` / `founder_acts` are the two
 * ways "you" can), so a second key would only be able to disagree with the
 * first, never add information.
 */
export const RESPONSIBILITY_HEADLINES: Record<ExecutionSupport, string> = {
  vibe_executes_now: "Vibe can do this",
  vibe_prepares: "Vibe can prepare this",
  founder_decides: "Needs your decision",
  founder_provides_input: "Needs your input",
  founder_acts: "You'll need to do this",
  external_dependency: "Depends on something else",
  not_yet_supported: "Vibe's work",
};

/**
 * The one case the headline alone reads as ambiguous: "Vibe's work" says
 * whose it is, not whether it runs. This is not a second name for
 * `not_yet_supported` — it is the reason `isExecutableByVibe` exists at all
 * — and it must never soften into something that could be misread as "this
 * is happening automatically."
 */
export const RESPONSIBILITY_SUBLABELS: Partial<Record<ExecutionSupport, string>> = {
  not_yet_supported: "Not automated yet",
};

/**
 * What one step's responsibility line says, given what Vibe can currently do.
 *
 * ## Why the stored classification is not the whole answer
 *
 * There are three independent answers to "can Vibe do this", and the plan
 * screen used to render the weakest. `executionSupport` is derived by
 * `classify.ts` from the deterministic capability registry alone — one entry —
 * so a `vibe` + `product_change` step with no registry match is stored as
 * `not_yet_supported` and read as *"Vibe's work / Not automated yet"*, while
 * `resolveStepExecution` would classify the same step `agentic` and the Agent
 * workspace would offer to run it. Both sentences were on screen at once, in
 * the same product, about the same step.
 *
 * The resolver is the one that knows about the coding agent, so for that one
 * stored value it speaks. Everywhere else the stored answer is unchanged:
 *
 *  * `vibe_executes_now` keeps "Vibe can do this" — `isExecutableByVibe` is
 *    untouched and the deterministic path's meaning does not move;
 *  * `vibe_prepares` keeps "Vibe can prepare this" — letting the resolver speak
 *    there would render "Not something Vibe can build yet" over real work that
 *    Vibe genuinely does;
 *  * no resolution at all keeps today's copy, which is the honest answer when
 *    the route could not resolve one.
 *
 * ## Why `intrinsicMode`
 *
 * A step waiting on an earlier one is still a step the agent could build, and
 * the row prints its own "Waiting for step N" line immediately below from
 * `stepSequenceStatus`. Two facts, neither contradicting the other. `mode`
 * would collapse them into "blocked" and lose the capability statement.
 *
 * Neither new string may read as "this is happening automatically" — "could
 * build" is a capability statement, which is exactly why
 * `EXECUTION_MODE_LABELS.agentic` was written the way it was.
 */
export type StepResponsibility = { headline: string; sublabel: string | null };

/**
 * Why Vibe cannot work in this repository — as opposed to why it cannot do
 * this step.
 *
 * The distinction is the whole of this set. A step waiting on an earlier one,
 * or owed a founder decision, or refused for touching payments, is a fact about
 * *the step*, and the row already prints its own sequence status beneath —
 * repeating it in the responsibility line would say one thing twice. Every
 * reason here is a fact about *the repository*, which the row says nowhere
 * else, and which is the same for every step in the plan.
 *
 * Each is also actionable, which is why naming it beats "Not automated yet":
 * a missing lockfile, a missing build script, an unanswered question about
 * which app, or — the one with a free fix — an analysis older than the check
 * that reads it.
 */
const REPOSITORY_CAPABILITY_REASONS: readonly ExecutionResolutionReason[] = [
  "repository_not_connected",
  "repository_snapshot_missing",
  "repository_analysis_outdated",
  "no_node_project",
  "no_build_script",
  "no_lockfile",
  "package_manager_unsupported",
  "workspace_choice_required",
  "validation_profile_unsupported",
];

/**
 * Reasons that mean "there is nothing here for Vibe to build", not "not yet".
 *
 * Both come from `classifyIntrinsic` refusing a `vibe` step whose change kind
 * is not `product_change`. Naming them is what lets the plan screen offer a
 * confirmation instead of a dead end (ADR 0090).
 */
const NO_EXECUTOR_REASONS: readonly ExecutionResolutionReason[] = [
  "no_executor_for_vibe_work",
  "change_kind_not_executable",
];

export function stepResponsibility(
  step: Pick<ActionPlanStep, "executionSupport">,
  resolution: Pick<ExecutionResolution, "intrinsicMode" | "reason"> | null,
): StepResponsibility {
  const stored: StepResponsibility = {
    headline: RESPONSIBILITY_HEADLINES[step.executionSupport],
    sublabel: RESPONSIBILITY_SUBLABELS[step.executionSupport] ?? null,
  };

  if (step.executionSupport !== "not_yet_supported") return stored;

  if (resolution?.intrinsicMode === "agentic") {
    return {
      headline: EXECUTION_MODE_LABELS.agentic,
      sublabel: EXECUTION_REASON_LABELS.agentic_v1_eligible,
    };
  }

  /*
   * The other half of the argument above, which was only ever half-applied.
   *
   * The resolver is asked here because the stored classification knows only the
   * deterministic registry — that is what made a step the agent could build
   * read "Not automated yet". But when the resolver answers *no*, it also says
   * why, and that answer was thrown away: a founder whose analysis is one
   * version out of date, or whose app has no lockfile, read the same four words
   * as a founder asking for something Vibe genuinely cannot do.
   *
   * "Not automated yet" is not merely vague there. For a stale analysis it is
   * **false** — the work is automated, and one free scan is the whole of what
   * stands in the way.
   */
  if (resolution !== null && REPOSITORY_CAPABILITY_REASONS.includes(resolution.reason)) {
    return { headline: stored.headline, sublabel: EXECUTION_REASON_LABELS[resolution.reason] };
  }

  /*
   * The class the argument above left out, found by a founder getting stuck.
   *
   * These two are not a missing prerequisite the founder could go and fix —
   * they say the step is not a change to the product at all, so no executor
   * can exist for it. That is a different sentence from a repository reason,
   * and it is a far better one than "Not automated yet", which reads as a
   * feature Vibe has not shipped yet and leaves the founder waiting for it.
   *
   * Kept as its own list rather than folded into the one above so each keeps
   * its own argument: those name something to repair, these name something to
   * confirm.
   */
  if (resolution !== null && NO_EXECUTOR_REASONS.includes(resolution.reason)) {
    return { headline: stored.headline, sublabel: EXECUTION_REASON_LABELS[resolution.reason] };
  }

  return stored;
}

/**
 * What the confirmation card says, given why this step needs confirming.
 *
 * Two shapes behind one control, and they must not read alike. A
 * `founder_action` step is the founder's own work and always was. A `vibe`
 * step reaching this card means Vibe has no executor for it — and a founder
 * who is told "Your action" about work the plan attributes to Vibe would be
 * right to think the product had changed its mind about who does what.
 *
 * The actor is read here rather than interpolated into JSX, which is the rule
 * this file exists to enforce.
 */
export type AttestationPrompt = {
  pill: string;
  lead: string | null;
  footnote: string;
  submitLabel: string;
  /**
   * The written answer this step is closed with, or null when it is closed by
   * confirmation alone (ADR 0092).
   *
   * A `founder_action` step confirms that the world changed: the sitemap is
   * submitted or it is not, and there is nothing to write down. A `vibe` step
   * that no run can finish is the opposite — the finding **is** the step's
   * output, and closing it with a tick records that the work happened while
   * losing what it produced, which is what left the plan's later steps
   * planning against the guess they started from.
   *
   * The prompt is Vibe's own wording and stays deliberately open. Vibe does
   * not derive choices from the step's completion criterion: that criterion is
   * model output, and turning model wording into a set of machine options is
   * the mistake this codebase refuses everywhere else. The criterion is shown
   * beside the field, in its own element, and the founder answers it.
   */
  finding: { label: string; help: string } | null;
};

export function attestationPrompt(step: Pick<ActionPlanStep, "actor">): AttestationPrompt {
  if (step.actor === "vibe") {
    return {
      pill: "Vibe can't run this one",
      lead:
        "This is Vibe's own work, but it isn't a change to your product — so there is no run " +
        "that could finish it. Write down what you found and the plan moves on with it.",
      footnote:
        "Your finding is recorded against this exact plan step and given to the next planning " +
        "run. It does not claim Vibe did the work.",
      submitLabel: "Record this finding",
      finding: {
        label: "What did you find?",
        help: "In your own words. The next plan is written with this in front of it.",
      },
    };
  }

  return {
    pill: "Your action",
    lead: null,
    footnote: "This records your confirmation against this exact plan step.",
    submitLabel: "Confirm this is complete",
    finding: null,
  };
}

/** Where a step's compact sequence status lands — three states, each a distinct visual weight. */
export type StepSequenceState = "ready" | "waiting" | "done";

export type StepSequenceStatus = {
  label: string;
  state: StepSequenceState;
};

/**
 * What a completed step is allowed to say it is (ADR 0054, rule 66).
 *
 * The three completion authorities do not mean the same thing, and only two of
 * them mean "finished":
 *
 *  * a `founder_decision` / `founder_input` step completes on a durable
 *    resolution — the founder answered, and that is the whole of the work;
 *  * a `founder_action` step completes on the founder's own attestation;
 *  * a **`vibe` step completes on validation evidence alone** — the agent
 *    produced a Prepared Change, Vibe verified the observed candidate, and
 *    independent validation passed.
 *
 * That third one is not done. The change sits on an isolated `vibe/*` branch;
 * nobody has approved it and nothing has been merged. ADR 0054 says so in as
 * many words — *"It does not mean approved, merged, deployed, live, safe"* —
 * and rule 66 turns it into a prohibition: a validation pass must **never** be
 * rendered as safe, reviewed, mergeable or production ready.
 *
 * "Done" is exactly that rendering, so an agent step says what is true instead:
 * the work happened and it is the founder's turn. The visual weight stays
 * `done` — the step really has left the queue — but the sentence does not
 * promise a merge that has not happened.
 */
function stepCompletedStatus(step: ActionPlanStep): StepSequenceStatus {
  if (step.actor === "vibe") return { label: "Ready to review", state: "done" };
  return { label: "Done", state: "done" };
}

/**
 * The scannable answer to "can this happen right now?" (§16, §17).
 *
 * A blocked step says exactly what it is waiting for — by title, never by a
 * bare order number — so the founder understands sequencing without opening
 * anything. `also_ready` and `start_here` both read "Ready now": the
 * distinction between "the" entry point and "an" unblocked step is carried
 * by `StepDisplayState`/highlighting, not by this label.
 */
/**
 * What a covered row says, and what it refuses to say.
 *
 * Never "done": the step was not carried out. It names the step whose run
 * performed the work, so a founder reading the plan a month later can tell the
 * difference between an analysis somebody did and one that came free with a
 * build — which is the whole reason absorption is not completion.
 */
function coveredLabel(coveredByOrder: number | null): string {
  return coveredByOrder === null
    ? "Covered by an earlier run"
    : `Covered by step ${String(coveredByOrder).padStart(2, "0")}`;
}

export function stepSequenceStatus(
  step: ActionPlanStep,
  allSteps: ActionPlanStep[],
  display: StepDisplayState,
  coveredByOrder: number | null = null,
): StepSequenceStatus {
  if (display === "done") return stepCompletedStatus(step);
  if (display === "covered") return { label: coveredLabel(coveredByOrder), state: "done" };
  if (display !== "waiting_on_steps") return { label: "Ready now", state: "ready" };

  const byOrder = new Map(allSteps.map((entry) => [entry.order, entry]));
  const prerequisites = step.dependsOn
    .map((order) => byOrder.get(order))
    .filter((entry): entry is ActionPlanStep => Boolean(entry));

  if (prerequisites.length === 0) return { label: "Ready now", state: "ready" };
  if (prerequisites.length === 1) {
    const [only] = prerequisites;
    return { label: `Waiting for step ${only.order}: ${only.title}`, state: "waiting" };
  }
  return { label: `Waiting for ${prerequisites.length} earlier steps`, state: "waiting" };
}

/**
 * The plan's own restrained meta line (§33): "5 steps · 1 founder decision".
 *
 * Nothing here is provider, model, cost or token data — those never reach a
 * screen at all — and nothing is invented beyond a count of the plan's own
 * steps and how many of them are the founder's to decide.
 */
export function planMetaSummary(steps: ActionPlanStep[]): string {
  const stepCount = steps.length;
  const decisionCount = steps.filter((step) => step.actor === "founder_decision").length;

  const parts = [`${stepCount} ${stepCount === 1 ? "step" : "steps"}`];
  if (decisionCount > 0) {
    parts.push(`${decisionCount} ${decisionCount === 1 ? "founder decision" : "founder decisions"}`);
  }
  return parts.join(" · ");
}

/* ---------------------------------------------------------------------------
 * What the plan's own panel says beside the steps (ACTION PLAN UI-2)
 * ------------------------------------------------------------------------ */

/**
 * "Expected change" — which parts of the product this plan lands on.
 *
 * Derived the one way this codebase allows a scope to be derived: from the
 * step's `evidenceIds`, through `deriveExecutionSurfaceRequirement`. Those ids
 * are minted by Vibe's own detectors from a closed vocabulary and validated at
 * planning time to exist in the pack, so nothing a model wrote in prose — and
 * nothing in a customer's repository or website — can reach this list
 * (rule 57, `docs/sprints/0044-execution-surface-generalization.md`).
 *
 * Two consequences worth stating, because both look like bugs and are not:
 *
 *  - A plan made only of decisions, research or measurement returns **nothing**.
 *    `deriveExecutionSurfaceRequirement` answers `EMPTY_SURFACE_REQUIREMENT` for
 *    a non-mutating step, and the panel renders no section rather than guessing
 *    a surface for work that changes no surface.
 *  - There is no file count anywhere in this file. How many files a change
 *    touches is knowable only after the change exists (`changedFilesVerified`),
 *    and a range printed before it would be a number the product cannot stand
 *    behind.
 */
export type PlanSurface = { id: BusinessSurfaceId; label: string };

export function planExpectedChange(steps: ActionPlanStep[]): PlanSurface[] {
  const named: BusinessSurfaceId[] = [];

  // `deriveExecutionSurfaceRequirement` already answers in vocabulary order, so
  // taking each step's answer in step order and dropping repeats keeps the list
  // stable for one plan without a second ordering rule here.
  for (const step of [...steps].sort((a, b) => a.order - b.order)) {
    const requirement = deriveExecutionSurfaceRequirement({
      changeKind: step.changeKind,
      evidenceIds: step.evidenceIds,
    });
    for (const surface of requirement.surfaces) {
      if (!named.includes(surface)) named.push(surface);
    }
  }

  return named.map((id) => ({ id, label: BUSINESS_SURFACE_LABELS[id] }));
}

/**
 * "Needs from you" — the steps this plan cannot finish without the founder.
 *
 * Read from `executionSupport`, which is server-derived and not representable
 * as model output (`schema.ts` §10, §46), and filtered by the completion the
 * plan view already projected — a decision already resolved is no longer
 * something the plan needs. An empty list is the panel's "Nothing right now",
 * and it is empty because nothing is outstanding, never because nothing was
 * checked.
 */
export function planFounderDemands(
  steps: ActionPlanStep[],
  completedStepOrders: readonly number[],
): string[] {
  const completed = new Set(completedStepOrders);

  return steps
    .filter((step) => !completed.has(step.order) && isFounderResponsibility(step.executionSupport))
    .map((step) => step.title);
}

const FOUNDER_RESPONSIBILITIES: readonly ExecutionSupport[] = [
  "founder_decides",
  "founder_provides_input",
  "founder_acts",
];

function isFounderResponsibility(support: ExecutionSupport): boolean {
  return FOUNDER_RESPONSIBILITIES.includes(support);
}

/**
 * The founder-question call to action, and the count in it.
 *
 * The count is the number of requests the store says are open for this plan —
 * never the number of steps that *could* ask something, and never a guess. Zero
 * open requests returns null, so a card cannot offer to answer questions that
 * do not exist.
 */
export function founderQuestionCta(openRequestCount: number): string | null {
  if (openRequestCount <= 0) return null;
  return openRequestCount === 1 ? "Answer question" : `Answer ${openRequestCount} questions`;
}

/**
 * "12 signals · 4 sources" — what this plan actually rests on.
 *
 * Counted from the ids the plan's steps cite, exactly as `countSignals` counts
 * for the audit, and never from the size of the evidence pack: a number taken
 * from the pack would grow when Vibe looked at more and say nothing about
 * whether the plan used any of it. Every id here survived planning-time
 * validation against the pack (rule 45), so each one is resolvable copy rather
 * than an unverifiable citation.
 */
export type PlanEvidenceSummary = { signals: number; sources: number };

export function planEvidenceSummary(steps: ActionPlanStep[]): PlanEvidenceSummary {
  const cited = new Set<string>();
  for (const step of steps) for (const id of step.evidenceIds) cited.add(id);

  return { signals: cited.size, sources: evidenceSources([...cited]).length };
}
