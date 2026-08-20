import {
  VALIDATION_DEPTH_LABELS,
  VALIDATION_DEPTH_REASON_LABELS,
  type ValidationDepth,
  type ValidationDepthReason,
} from "./depth";
import {
  VALIDATION_STEPS,
  type SourceIntegrity,
  type ValidationFailureCode,
  type ValidationStage,
  type ValidationStatus,
  type ValidationStepName,
  type ValidationStepResult,
} from "./schema";

/**
 * What a validation looks like while it is happening (Sprint 10A §15, §16, §24).
 *
 * ## Why this is a pure function and not component logic
 *
 * The panel must show six real phases progressing over roughly five minutes.
 * There are two ways to know where a run has got to, and only one of them is
 * allowed:
 *
 *  - **the workflow's internal step index** — available, tempting, and wrong.
 *    It is a third-party execution detail; it would tie the product's copy to
 *    the shape of a provider's durable log, and it would report progress for
 *    work whose result was never persisted (§4).
 *  - **the ValidationRun row** — what actually happened, written phase by phase
 *    as each completes. Supabase stays the source of truth for product state,
 *    and the UI is a rendering of it.
 *
 * So this function takes persisted state and nothing else. It is exhaustively
 * unit-tested precisely because it is the whole progress model: a bug here is a
 * user watching a run that finished, or a green tick over a phase that never
 * ran.
 *
 * ## No percentages
 *
 * Deliberately absent. A percentage would have to be invented — the phases have
 * wildly different durations and the only honest estimate is the previous run's
 * timings, which is not a promise this product should make. Named phases with
 * real elapsed seconds say more and claim less (§5, §17).
 */

export type ValidationPhaseName =
  | "source"
  | "install"
  | "typecheck"
  | "test"
  | "build"
  | "finalize";

export type ValidationPhaseState =
  | "pending"
  | "active"
  | "passed"
  | "failed"
  | "skipped"
  | "timed_out"
  /**
   * The run ended before this phase was reached.
   *
   * Distinct from `pending`, and the distinction is the point: after a failure
   * the panel must be able to say *"Build was not run"* rather than leave an
   * empty circle that reads as "still to come" on a run that is over (§16).
   */
  | "not_run";

export type ValidationPhaseView = {
  phase: ValidationPhaseName;
  /** Copy for a finished phase. */
  label: string;
  /** Copy for a phase in flight — present tense, because it is happening. */
  activeLabel: string;
  state: ValidationPhaseState;
  durationMs: number | null;
  /** Bounded, already-sanitized failure output. Never present for a pass. */
  outputTail: string | null;
  outputTruncated: boolean;
};

const PHASE_ORDER: readonly ValidationPhaseName[] = [
  "source",
  "install",
  "typecheck",
  "test",
  "build",
  "finalize",
];

const PHASE_LABELS: Record<ValidationPhaseName, { label: string; activeLabel: string }> = {
  source: { label: "Source integrity", activeLabel: "Verifying the prepared commit" },
  install: { label: "Dependencies", activeLabel: "Installing dependencies" },
  typecheck: { label: "Typecheck", activeLabel: "Checking types" },
  test: { label: "Tests", activeLabel: "Running tests" },
  build: { label: "Production build", activeLabel: "Building application" },
  finalize: { label: "Finalizing", activeLabel: "Finalizing" },
};

/**
 * Which phase a persisted stage belongs to.
 *
 * The stage vocabulary is finer than the phase vocabulary on purpose:
 * `provisioning`, `acquiring_source`, `verifying_source` and `securing_sandbox`
 * are four real, separately-observable stages that all belong to the one thing
 * a user cares about — *is the source it is about to run the source we
 * prepared?*
 */
const STAGE_PHASE: Partial<Record<ValidationStage, ValidationPhaseName>> = {
  provisioning: "source",
  acquiring_source: "source",
  verifying_source: "source",
  securing_sandbox: "source",
  installing: "install",
  typechecking: "typecheck",
  testing: "test",
  building: "build",
  collecting_results: "finalize",
  cleaning_up: "finalize",
};

/** Failures that are a statement about source verification itself. */
const SOURCE_FAILURE_CODES: readonly ValidationFailureCode[] = [
  "source_integrity_failed",
  "credential_scrub_failed",
];

const STEP_PHASES: readonly ValidationStepName[] = ["install", "typecheck", "test", "build"];

function isStepPhase(phase: ValidationPhaseName): phase is ValidationStepName {
  return (STEP_PHASES as readonly string[]).includes(phase);
}

export type ValidationProgressInput = {
  status: ValidationStatus;
  stage: ValidationStage;
  steps: Partial<Record<ValidationStepName, ValidationStepResult>>;
  sourceIntegrity: SourceIntegrity | null;
  failureCode: ValidationFailureCode | null;
};

export function buildValidationProgress(run: ValidationProgressInput): ValidationPhaseView[] {
  const inFlight = run.status === "queued" || run.status === "running";
  const activePhase = inFlight ? (STAGE_PHASE[run.stage] ?? null) : null;

  return PHASE_ORDER.map((phase) => {
    const copy = PHASE_LABELS[phase];
    const recorded = isStepPhase(phase) ? run.steps[phase] : undefined;

    let state: ValidationPhaseState;
    let durationMs: number | null = null;
    let outputTail: string | null = null;
    let outputTruncated = false;

    if (recorded) {
      // A recorded phase outranks everything else: it is the only evidence that
      // the work actually happened.
      state = recorded.status;
      durationMs = recorded.durationMs > 0 ? recorded.durationMs : null;
      if (recorded.status !== "passed" && recorded.status !== "skipped" && recorded.outputTail) {
        outputTail = recorded.outputTail;
        outputTruncated = recorded.outputTruncated;
      }
    } else if (phase === "source") {
      state = run.sourceIntegrity
        ? "passed"
        : inFlight
          ? activePhase === "source"
            ? "active"
            : "pending"
          : run.failureCode && SOURCE_FAILURE_CODES.includes(run.failureCode)
            ? "failed"
            : "not_run";
    } else if (phase === "finalize") {
      state =
        run.status === "passed"
          ? "passed"
          : inFlight
            ? activePhase === "finalize"
              ? "active"
              : "pending"
            : "not_run";
    } else {
      state = inFlight ? (activePhase === phase ? "active" : "pending") : "not_run";
    }

    return {
      phase,
      label: copy.label,
      activeLabel: copy.activeLabel,
      state,
      durationMs,
      outputTail,
      outputTruncated,
    };
  });
}

/**
 * Everything the panel renders about one validation.
 *
 * Built on the server from the persisted run, so the client component holds no
 * derivation logic of its own — it renders phases it was given.
 */
export type ValidationSummary = {
  status: ValidationStatus;
  phases: ValidationPhaseView[];
  failureMessage: string | null;
  sandboxDurationMs: number | null;
  /**
   * How much of the profile ran, and why (Sprint 0047).
   *
   * Null for runs validated before depth existed — those ran the full set, and
   * saying "Standard" about them would be relabelling history. The panel shows
   * nothing rather than a depth nobody chose.
   */
  depth: ValidationDepthView | null;
  /**
   * Whether this result was produced under the integrity policy in force now.
   *
   * A stored pass describes the rules it was checked against. When those rules
   * tighten, the old result is still true about the old rules and false about
   * the new ones — so the panel says which, rather than showing a green tick
   * that quietly means less than it used to.
   */
  underCurrentPolicy: boolean;
};

/**
 * The depth, as the panel renders it.
 *
 * Carries the label and the reason together because they only mean anything
 * together: "Fast" alone invites "why did you skip things?", and the answer —
 * "low-risk presentational change" — is the whole point of showing it.
 */
export type ValidationDepthView = {
  depth: ValidationDepth;
  label: string;
  reason: string;
  /** The steps this depth deliberately did not run. Empty at full depth. */
  notRun: ValidationStepName[];
};

function buildDepthView(run: {
  validationDepth: ValidationDepth | null;
  validationDepthReason: string | null;
  steps: Partial<Record<ValidationStepName, ValidationStepResult>>;
}): ValidationDepthView | null {
  if (!run.validationDepth) return null;

  const reason = run.validationDepthReason as ValidationDepthReason | null;

  return {
    depth: run.validationDepth,
    label: VALIDATION_DEPTH_LABELS[run.validationDepth],
    // An unrecognised stored reason is shown as the generic sentence rather
    // than as a raw enum: a future policy version may record a reason this
    // build has no copy for, and leaking `sensitive_domain_changed` into the
    // UI would be worse than saying less.
    reason:
      reason && reason in VALIDATION_DEPTH_REASON_LABELS
        ? VALIDATION_DEPTH_REASON_LABELS[reason]
        : "Validation depth chosen by policy",
    notRun: VALIDATION_STEPS.filter(
      (step) => run.steps[step]?.skipReason === "not_in_profile",
    ),
  };
}

export function buildValidationSummary(
  run: ValidationProgressInput & {
    sandboxDurationMs: number | null;
    sandboxPolicyVersion: string;
    validationDepth?: ValidationDepth | null;
    validationDepthReason?: string | null;
  },
  options: { currentPolicyVersion: string; failureMessage: string | null },
): ValidationSummary {
  return {
    status: run.status,
    phases: buildValidationProgress(run),
    failureMessage: options.failureMessage,
    sandboxDurationMs: run.sandboxDurationMs,
    depth: buildDepthView({
      validationDepth: run.validationDepth ?? null,
      validationDepthReason: run.validationDepthReason ?? null,
      steps: run.steps,
    }),
    underCurrentPolicy: run.sandboxPolicyVersion === options.currentPolicyVersion,
  };
}

/**
 * The phase a failed run stopped at, for the headline sentence.
 *
 * Returns null for a run that passed or never started a phase — the caller
 * shows the failure code's own message instead. Fail-fast means at most one
 * phase can be failed, so the first match is the answer (§14).
 */
export function failedPhase(phases: readonly ValidationPhaseView[]): ValidationPhaseView | null {
  return phases.find((phase) => phase.state === "failed" || phase.state === "timed_out") ?? null;
}
