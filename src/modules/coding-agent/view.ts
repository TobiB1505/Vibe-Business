import {
  EXECUTION_ADMISSION_LABELS,
  EXECUTION_REASON_LABELS,
} from "@/modules/execution-contract/view";
import type { ExecutionAdmission } from "@/modules/execution-contract/schema";
import type { AgentStartRefusal } from "./service";
import type { PreflightRefusal } from "./preflight";
import type { AgentStartRefusalDetail, DogfoodStepReason } from "./start-refusal";
import type { BuildChainBoundaryReason } from "@/modules/execution-contract/chain";
import type { RunForecast, RunForecastDriver } from "./run-forecast";

/**
 * Customer-safe copy for the coding-agent runtime (EXECUTION CORE-4 website gate, §5).
 *
 * The same rule `execution-contract/view.ts` states: a component may render a
 * `PreflightRefusal` or an `AgentStartRefusal` only through a lookup here.
 * Everything else Core-4 needs already has a home — activity events, interrupt
 * questions and operation stage/failure copy all live in `execution-contract/view.ts`
 * and `operations/{view,messages}.ts`, extended by Core-4 itself. These two
 * enums are the only gap: they exist to gate a website surface that did not
 * exist until now.
 */

export const PREFLIGHT_REFUSAL_LABELS: Record<PreflightRefusal, string> = {
  not_agentic: "This step isn't the kind of change Vibe's coding agent can attempt.",
  not_admissible: "Vibe couldn't confirm your code hasn't changed since it last looked.",
  risk_too_high: "This step is too sensitive for Vibe's coding agent to attempt.",
  validation_unsupported: "Vibe can't independently prove a change to this project builds.",
  not_authorized: "The coding agent isn't turned on for this project.",
  no_budget: "No spending limit is configured for this run.",
  budget_scope_mismatch: "The spending limit and the change limit disagree — refusing rather than guessing.",
  no_tool_grants: "Nothing was granted to work with, so there is nothing to run.",
  forbidden_grant: "The compiled policy names something it should never be allowed to.",
  user_decision_missing: "This step is waiting on a decision only you can make.",
};

export const AGENT_START_REFUSAL_LABELS: Record<AgentStartRefusal, string> = {
  project_not_found: "That project couldn't be found.",
  execution_spec_not_found: "That step's instructions couldn't be found — try again.",
  spec_not_agentic: "This step isn't the kind of change Vibe's coding agent can attempt.",
  agentic_execution_not_authorized: "The coding agent isn't turned on for this project.",
  insufficient_credits: "There aren't enough Credits to reserve for this run.",
  credit_reservation_insufficient: "The Credits held don't cover this run's spending limit.",
  execution_start_failed: "Vibe couldn't start the run — try again.",
  agent_start_failed: "Vibe couldn't start the run — try again.",
};

/**
 * Why a start attempt stopped before `startAgentExecution` was even reached.
 *
 * Separate from {@link AGENT_START_REFUSAL_LABELS} because these happen one
 * step earlier — while recording the instruction package the run would execute.
 * They were previously invisible: a refused insert was reported as "this isn't
 * the kind of change Vibe can attempt", on a screen that had just said the
 * opposite in the sentence above it.
 */
export const DOGFOOD_START_REFUSAL_LABELS = {
  spec_not_persisted: "Vibe couldn't record what this run would do, so it didn't start one.",
  project_not_found: "That project couldn't be found.",
} as const;

/**
 * Why the chain stopped before a run could be described at all.
 *
 * These are the coarsest answers — the ones reached before there is a
 * resolution or a preflight to be more specific with. `not_agentic` and
 * `preflight_refused` have their own, better sentences below and only fall back
 * here when the finer answer was not established.
 */
export const DOGFOOD_STEP_REASON_LABELS: Record<DogfoodStepReason, string> = {
  not_dogfood_eligible: "The coding agent isn't turned on for this project.",
  no_action_plan: "There's no finished plan for Vibe to work from yet.",
  step_not_found: "That step isn't in your current plan any more.",
  repository_not_connected: "No code repository is connected to this project.",
  repository_snapshot_missing: "Vibe hasn't read your code yet.",
  plan_incomplete: "This plan is missing something Vibe needs before it can start work.",
  not_agentic: "This step isn't the kind of change Vibe's coding agent can attempt.",
  preflight_refused: "Vibe's own checks refused this run before it started.",
};

/**
 * The sentence for a refused start, at the finest grain that was established.
 *
 * The order is most-specific-first, and each stage is skipped when the chain
 * never reached it:
 *
 *  1. **Admission** — a moved default branch, a stale read, a superseded plan.
 *     These are what a founder can actually act on, and they are the reason
 *     this function exists: the run the founder pressed was refused because
 *     their repository had moved since Vibe last read it, and the screen said
 *     "no longer eligible".
 *  2. **Preflight** — Vibe's own gates on a step that classified fine.
 *  3. **Classification** — why the step is not agentic in the first place.
 *  4. **The stage that stopped** — coarse, and only when nothing finer exists.
 *
 * Admission comes before preflight deliberately: `not_admissible` is one
 * preflight refusal standing in for eleven admission answers, and rendering the
 * generic one tells a founder their code changed when the truth might be that
 * no Agent price exists.
 */
export function startRefusalLabel(detail: AgentStartRefusalDetail): string {
  // `preflightRefusalLabel` already prefers the admission sentence for
  // `not_admissible` and keeps its own for every other refusal, which is the
  // distinction this would otherwise have to re-make and could get wrong.
  if (detail.preflight) {
    return detail.admission
      ? preflightRefusalLabel(detail.preflight, detail.admission)
      : PREFLIGHT_REFUSAL_LABELS[detail.preflight];
  }

  if (detail.admission && !detail.admission.admissible) {
    return EXECUTION_ADMISSION_LABELS[detail.admission.refusal];
  }

  if (detail.reason === "not_agentic" && detail.resolutionReason) {
    return EXECUTION_REASON_LABELS[detail.resolutionReason];
  }

  return DOGFOOD_STEP_REASON_LABELS[detail.reason];
}

/** The one way forward a refused start can offer, when there is one. */
export type StartRefusalRecovery = {
  kind: "repository_read";
  label: string;
  /** Why the founder is the one pressing it. */
  note: string;
};

/**
 * The way forward, when a fresh read of the founder's code is it.
 *
 * **Offered, never taken.** Not because of what it costs — a Product Scan is
 * free (`kill-switch.ts` files it under free work, and the rate card prices
 * understanding at zero) — but because it is the founder's code, and Rule 60
 * says blocked work explains what needs refreshing rather than reaching for it
 * on their behalf. This returns copy and a kind, no URL: a view module has no
 * business knowing what a route segment is called.
 *
 * Only for the refusals a re-read actually clears. A permanent refusal — this
 * step touches payments, the agent is not on for this project — gets nothing,
 * because a way forward that leads to the same wall is worse than none.
 *
 * Three of the four arrive after a start was refused. The fourth,
 * `repository_analysis_outdated`, is the one that never gets that far: the step
 * does not resolve agentic, so no start control renders and nothing can be
 * clicked to produce it. The Agent screen asks the same question directly and
 * uses this answer, which is why it is here rather than in a second copy table.
 */
export function startRefusalRecovery(
  detail: AgentStartRefusalDetail,
): StartRefusalRecovery | null {
  const stale =
    detail.reason === "repository_snapshot_missing" ||
    detail.resolutionReason === "repository_analysis_outdated" ||
    (detail.admission !== undefined &&
      !detail.admission.admissible &&
      (detail.admission.refusal === "repository_head_moved" ||
        detail.admission.refusal === "repository_snapshot_stale"));

  if (!stale) return null;

  return {
    kind: "repository_read",
    label: "Re-read my code",
    note: "You start this — Vibe never re-reads your code on its own.",
  };
}

/**
 * The refusal, said accurately.
 *
 * `not_admissible` is one preflight refusal standing in for nine different
 * admission answers — a moved HEAD, an unread HEAD, a stale snapshot, a
 * superseded plan, no approved price, and three Credit states. Rendering the
 * generic label for all of them tells a founder "your code changed since Vibe
 * last looked" when the truth might be that no Agent price exists, which is
 * both wrong and unactionable.
 *
 * `EXECUTION_ADMISSION_LABELS` already carries the honest sentence for each, so
 * this prefers it whenever the resolution knows which one applies. Every other
 * refusal keeps its own copy: those are about the *classification*, which
 * admission has nothing to say about.
 */
export function preflightRefusalLabel(
  refusal: PreflightRefusal,
  admission: ExecutionAdmission,
): string {
  if (refusal === "not_admissible" && !admission.admissible) {
    return EXECUTION_ADMISSION_LABELS[admission.refusal];
  }

  return PREFLIGHT_REFUSAL_LABELS[refusal];
}

/* ---------------------------------------------------------------------------
 * The evidence behind the ceiling on the Run button (ADR 0072)
 * ------------------------------------------------------------------------ */

/**
 * What a founder is told about a cost driver.
 *
 * Keyed on the driver and its direction, never on `EstimateCostDriver.detail` —
 * those strings are Vibe's own working notes ("complexity 1.34x against the
 * reference repository") and belong in a calibration report, not on a screen
 * somebody is about to spend money from.
 *
 * A `Record` over the closed union, so a new driver without copy is a type
 * error rather than a blank line under a price.
 */
const FORECAST_DRIVER_COPY: Record<
  RunForecastDriver["driver"],
  Partial<Record<RunForecastDriver["effect"], string>>
> = {
  historical_baseline: {
    unknown: "Vibe has not run work of this shape before, so this ceiling rests on policy rather than on a measurement.",
  },
  repository_complexity: {
    raises: "Your repository is larger than the one this ceiling was measured against, so this run may sit near the top of it.",
    lowers: "Your repository is smaller than the one this ceiling was measured against.",
    unknown: "Vibe has not measured your repository at this commit, so the size of it is not in this figure.",
  },
  context_pressure: {
    raises: "Not all of the relevant code fits into what Vibe hands the agent, which tends to make a run cost more.",
  },
  repository_drift: {
    raises: "Your repository has moved a lot since Vibe last worked in it, so the agent has more to read.",
  },
  validation_depth: {
    raises: "This change needs deeper checks than usual.",
    lowers: "This change needs lighter checks than usual.",
    // The ordinary pre-run answer: depth is resolved from a Prepared Change,
    // which does not exist yet. Silent rather than alarming — "we do not know
    // yet" beside a Run button reads as a warning, and it is not one.
  },
  cohort_correction: {
    raises: "Vibe is allowing for having under-estimated work like this before.",
    lowers: "Vibe is allowing for having over-estimated work like this before.",
  },
};

/**
 * The sentences that go under the Credit ceiling, in order, at most two.
 *
 * Two because this sits directly above the button that spends money, and a
 * paragraph there is a paragraph nobody reads. The estimator emits its drivers
 * in a fixed order — baseline, repository, pressure, drift, validation, cohort
 * — so the two a founder sees are deterministic rather than whichever happened
 * to be loudest.
 */
export function forecastDriverNotes(forecast: RunForecast): readonly string[] {
  return forecast.drivers
    .map((driver) => FORECAST_DRIVER_COPY[driver.driver][driver.effect])
    .filter((copy): copy is string => copy !== undefined)
    .slice(0, 2);
}

/**
 * How much evidence stands behind the ceiling.
 *
 * Says the count, because "based on 7 comparable runs" and "based on Vibe's
 * pricing policy" are different claims and only one of them is a measurement.
 * Zero is not hidden: a ceiling with nothing behind it is exactly the thing a
 * founder should be told about before they press the button (rule 78).
 */
export function forecastEvidenceNote(forecast: RunForecast): string {
  if (forecast.comparableRuns === 0) {
    return "No comparable run has been completed yet, so this is Vibe's policy ceiling rather than a measured one.";
  }

  return forecast.comparableRuns === 1
    ? "Based on 1 comparable run Vibe has completed."
    : `Based on ${forecast.comparableRuns} comparable runs Vibe has completed.`;
}

/**
 * Why a build chain stopped where it did, in a founder's words.
 *
 * A chain shorter than someone expected, with nothing said about why, reads as
 * a defect — and on the founder's own plan the very first chain stops at a
 * Stripe step, which is the most alarming-looking correct refusal there is. So
 * every boundary has a sentence, and `no_successor` deliberately has none: the
 * chain reached the end of the plan, and there is nothing to explain.
 */
export const BUILD_CHAIN_BOUNDARY_LABELS: Record<BuildChainBoundaryReason, string | null> = {
  no_successor: null,
  successor_not_agentic: "The next step is yours to do, so Vibe stops here.",
  successor_capability_matched:
    "Vibe already knows how to make the next change exactly, so it runs on its own rather than in this build.",
  successor_risk_ceiling:
    "The next step is more sensitive than Vibe builds on your behalf — it stays yours.",
  dependency_outside_chain: "The next step is also waiting on something this build does not cover.",
  chain_length_ceiling: "Vibe builds at most three steps of a Move in one go.",
  cycle_detected: "These steps refer back to each other, so none of them can go first.",
};

/**
 * What one run will deliver, said before the click.
 *
 * Counts steps rather than naming them, because the names are already listed
 * beside it and repeating them in a sentence makes the sentence unreadable at
 * three members.
 */
export function buildChainOfferLabel(memberCount: number): string {
  return memberCount === 1 ? "Build this step" : `Build all ${memberCount} steps`;
}

/**
 * What a finished chained run actually produced.
 *
 * One change, one check, several steps — and it has to say exactly that. "3
 * steps done" would imply three artifacts and three verdicts, where there is
 * one of each: rule 66's standard, applied to the sentence a founder reads
 * after paying for a chain.
 */
export function buildChainCompletionNote(memberCount: number): string {
  return memberCount === 1
    ? "One change, checked once."
    : `One change, checked once, covering these ${memberCount} steps.`;
}
