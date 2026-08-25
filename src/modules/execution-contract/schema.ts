import type { ExecutionCapability } from "@/modules/execution/schema";

/**
 * The agentic execution contract (EXECUTION CORE-3 §4, §9, §36).
 *
 * ## Where this sits
 *
 * ```
 * Audit           "This is the business problem."
 * Next Move       "This is the intervention I recommend."
 * Action Plan     "This is exactly how we get from here to there."
 * ─────────────── this module ───────────────
 * Resolution      "Is this step executable, by what, and under what authority?"
 * ExecutionSpec   "Here is the bounded instruction package for that work."
 * ───────────────────────────────────────────
 * Coding Agent    "Here is how I would implement it."       ← does not exist yet
 * PreparedChange  the existing validation/review/approval/merge pipeline
 * ```
 *
 * ## The one rule this module exists to enforce
 *
 * **AI decides how. Vibe decides whether, where, what, how much, when to stop,
 * and what must pass.**
 *
 * Every type below is shaped by refusing to let the second half of that
 * sentence be expressed as prose. A policy that lived in a prompt would be a
 * request; a policy that lives in a compiled, versioned structure with a
 * default-deny predicate is a fact. §13 is blunt about the difference and it is
 * the reason `policy.ts` is a compiler rather than a template.
 *
 * ## What this sprint deliberately does not contain
 *
 * No agent SDK, no model call, no tool runtime, no file editing, no repair
 * loop, no execute button. The resolver is deterministic (§37): it consumes
 * structured Planner output plus deterministic repository facts and produces a
 * reproducible answer. Nothing here spends a Credit or contacts a provider.
 */

/* ---------------------------------------------------------------------------
 * Versions (§36)
 * ------------------------------------------------------------------------ */

/** The shape of a persisted `ExecutionSpec` document. */
export const EXECUTION_SPEC_SCHEMA_VERSION = "execution-spec.v1" as const;

/**
 * How a step is classified into an execution route.
 *
 * Separate from the spec schema because they change for different reasons: the
 * schema moves when the *payload* changes, this moves when the same step would
 * legitimately resolve differently — a new deterministic capability, a widened
 * agentic boundary, a changed dependency rule. A stored resolution must never
 * be reinterpreted under rules it was not decided by.
 *
 * **v2** is the changed dependency rule that clause anticipated: an unfinished
 * prerequisite that is Vibe's own technical preparation no longer blocks a
 * downstream agentic step, because that execution absorbs it (see
 * `dependencies.ts`). A step that resolved `blocked` under v1 can resolve
 * `agentic` under v2 with nothing about the plan or the repository having
 * changed — which is exactly the situation this constant exists to keep
 * legible, and why v1 rows are never re-read as though they were v2 answers.
 */
export const EXECUTION_RESOLVER_VERSION = "execution-resolver-v2" as const;

/**
 * What the compiled policy permits and forbids.
 *
 * Versioned for the same reason `SANDBOX_POLICY_VERSION` is: the tool grants,
 * the write scope, the network stance and the secret stance together define
 * what "bounded" meant. A spec produced under v1 must never be executed under
 * v2's grants without someone deciding that.
 */
export const EXECUTION_POLICY_VERSION = "execution-policy-v1" as const;

/** How structured step facts map to a risk class. */
export const EXECUTION_RISK_POLICY_VERSION = "execution-risk-policy-v1" as const;

/* ---------------------------------------------------------------------------
 * Execution modes (§5)
 * ------------------------------------------------------------------------ */

/**
 * The execution route a step needs (§5, §6).
 *
 * **Server-derived, always, and derived independently of the Planner.** The
 * plan's own `executionSupport` is *not* read to produce this — see
 * `resolver.ts`. A Planner step saying "Vibe can do this" is an intent
 * statement about the business action; whether a safe route exists is a
 * statement about this system, and only this system may make it (§6).
 *
 * Six values rather than a boolean, for the reason the Planner's own support
 * enum has six: "we have an executor", "an agent could do this", "nobody has
 * made the decision this rests on", "the step in front of it is not done",
 * "this is genuinely your work" and "we understand it and cannot safely do it"
 * are six different things to tell someone, and each has a different remedy.
 */
export const EXECUTION_MODES = [
  /** An existing, registry-backed deterministic capability handles this (§7). */
  "deterministic",
  /** Inside the bounded agentic V1 boundary and otherwise unobstructed (§20). */
  "agentic",
  /** A founder/business decision this rests on has not been made (§28). */
  "needs_user_input",
  /** Something in front of it is unfinished, or someone outside must act (§27). */
  "blocked",
  /** Genuinely the customer's own work — real-world action, not a code change. */
  "manual",
  /** Vibe understands the task and has no safe execution path for it today. */
  "unsupported",
] as const;
export type ExecutionMode = (typeof EXECUTION_MODES)[number];

/** Modes that describe work Vibe could carry out itself. */
export const VIBE_EXECUTABLE_MODES: readonly ExecutionMode[] = ["deterministic", "agentic"] as const;

/* ---------------------------------------------------------------------------
 * Execution classes (§8)
 * ------------------------------------------------------------------------ */

/**
 * The broad, policy-bound class of work an agent would perform (§8).
 *
 * ## Why there is exactly one
 *
 * §8 is explicit that Vibe must not grow one capability per customer request —
 * `add_login_button_v1`, `create_pricing_page_v1` — because that does not scale
 * across individual products. The answer is broader classes bound by policy.
 *
 * It is equally explicit that the taxonomy must not be over-designed now. So
 * the honest question is: *which distinctions can this system actually make?*
 *
 * `UI_CHANGE` vs `CONFIG_CHANGE` vs `TEST_CHANGE` are distinctions about
 * intent, and the only place intent is expressed is the Planner's prose. Keying
 * a policy class on model wording would mean a prompt tweak or a translation
 * silently changed what an agent is permitted to touch — the exact failure the
 * capability registry refuses (CORE-2b §10) and Rule 57 forbids. The structured
 * vocabulary available here (`changeKind`, cited evidence ids, repository
 * facts) cannot separate them.
 *
 * So V1 has one class: *a bounded change to application source*. It is the
 * broadest class that is still true, and it carries the whole V1 boundary in
 * `eligibility.ts` rather than in a name. Additional classes are added when a
 * *structured* signal exists to route on — not when a model can describe one.
 *
 * The higher-risk classes §8 anticipates (`DATABASE_CHANGE`,
 * `AUTH_SECURITY_CHANGE`, `EXTERNAL_SERVICE_CHANGE`) are deliberately absent
 * for a stronger reason: they are outside the V1 boundary entirely, so a class
 * for them would be a name for something that always resolves to `unsupported`.
 * `risk.ts` recognises those shapes and refuses them; it does not label them.
 */
export const EXECUTION_CLASSES = [
  /** A bounded change to application source, inside an isolated workspace. */
  "application_code_change",
] as const;
export type ExecutionClass = (typeof EXECUTION_CLASSES)[number];

export const CURRENT_AGENTIC_EXECUTION_CLASS: ExecutionClass = "application_code_change";

/* ---------------------------------------------------------------------------
 * Risk (§19)
 * ------------------------------------------------------------------------ */

/**
 * How much could go wrong if this were carried out badly (§19).
 *
 * Categorical rather than scored, deliberately. A number invites tuning a
 * threshold until the work passes; four named classes force the question
 * "should an agent be allowed near this at all?" to be answered as policy.
 *
 * Derived from structured step facts only — never from prose. See `risk.ts`.
 */
export const EXECUTION_RISK_CLASSES = [
  /** Vibe's own reasoning work, or a change with no external consequence. */
  "low",
  /** A real change to application behaviour, reviewable and reversible. */
  "moderate",
  /** Authentication, sessions, data migration, or a new external integration. */
  "high",
  /** Financial authority, credentials, destructive external action. Never Vibe's. */
  "prohibited",
] as const;
export type ExecutionRiskClass = (typeof EXECUTION_RISK_CLASSES)[number];

/**
 * The highest risk class V1 agentic execution may be offered for (§20).
 *
 * Conservative on purpose. The architecture generalises; the *permission* does
 * not, and widening this is a deliberate decision with an ADR behind it rather
 * than a constant somebody raises.
 */
export const MAX_AGENTIC_V1_RISK: ExecutionRiskClass = "moderate";

const RISK_ORDER: Record<ExecutionRiskClass, number> = {
  low: 0,
  moderate: 1,
  high: 2,
  prohibited: 3,
};

export function riskExceeds(risk: ExecutionRiskClass, ceiling: ExecutionRiskClass): boolean {
  return RISK_ORDER[risk] > RISK_ORDER[ceiling];
}

/* ---------------------------------------------------------------------------
 * Why a resolution came out the way it did
 * ------------------------------------------------------------------------ */

/**
 * The reason behind a resolution (§5, §6, §27).
 *
 * A closed set, because these drive copy, tests and future routing. Each names
 * a *fact about this system or this project*, never an internal exception and
 * never a model's opinion.
 */
export const EXECUTION_RESOLUTION_REASONS = [
  /** A server-owned registry capability matched on structured evidence. */
  "deterministic_capability_matched",
  /** Inside the V1 agentic boundary, with every gate satisfied. */
  "agentic_v1_eligible",
  /** The Planner marked this a founder decision, and it is unmade (§28). */
  "founder_decision_required",
  "founder_input_required",
  /** Real-world work only a person can do. */
  "founder_action_required",
  /** Waiting on a third party or an external system. */
  "external_party_required",
  /**
   * One or more prerequisite steps are unfinished and must genuinely happen
   * first (§27).
   *
   * Since resolver v2 this names a *hard* dependency only — a founder decision,
   * real-world work, an external prerequisite, or a change to the product that
   * has to exist before this one. Vibe's own technical preparation no longer
   * reaches this reason; it is absorbed into the execution instead.
   */
  "dependency_unsatisfied",
  /**
   * The prerequisites this step reaches form a loop (§32).
   *
   * Plan validation repairs cycles, so a stored plan should not contain one.
   * The resolver refuses rather than trusting that: a loop has no order in
   * which the work could happen, so there is nothing to absorb and nothing to
   * wait for, and guessing which edge to ignore is not the resolver's call.
   */
  "dependency_cycle_detected",
  /** Vibe's own reasoning work, for which no executor exists. */
  "no_executor_for_vibe_work",
  /** The change kind cannot be produced by any execution route Vibe has. */
  "change_kind_not_executable",
  /** Beyond the V1 agentic risk ceiling (§19, §20). */
  "risk_class_not_permitted",
  /** Financial authority, credentials or destructive external action (§15). */
  "risk_class_prohibited",
  /** No repository is connected, so there is nowhere to act. */
  "repository_not_connected",
  /** No successful repository snapshot exists to reason from. */
  "repository_snapshot_missing",
  /** No validation profile matches this repository, so nothing could prove a change (§30). */
  "validation_profile_unsupported",
] as const;
export type ExecutionResolutionReason = (typeof EXECUTION_RESOLUTION_REASONS)[number];

/* ---------------------------------------------------------------------------
 * Admission (§16, §24, §29, §49, §52)
 * ------------------------------------------------------------------------ */

/**
 * Why work that is *classified* as executable still may not start now.
 *
 * ## Why this is separate from the mode
 *
 * Classification answers "what kind of route does this step need?" and is a
 * property of the plan plus the project. Admission answers "may this start at
 * this instant?" and is a property of live external state and money. Collapsing
 * them would make a stale repository look like an unsupported task, and an
 * unfunded account look like a broken plan.
 *
 * It is also the same split the rest of the product already draws:
 * `sandbox_validation_passed` authorizes nothing (Rule 66), an approval
 * authorizes nothing (Rule 68), and here a mode authorizes nothing either.
 */
export const EXECUTION_ADMISSION_REFUSALS = [
  /** The mode is not one Vibe can carry out. */
  "not_executable_mode",
  /** The live default-branch HEAD could not be established (§23, §29). */
  "source_revision_unverified",
  /** The repository moved since the snapshot the plan reasoned from (§16, §52). */
  "repository_head_moved",
  /** A newer repository snapshot exists; the premise is not the current one. */
  "repository_snapshot_stale",
  /**
   * A live-product defect the step cites has since been fixed (Rule 55).
   *
   * The step's own `evidenceIds` name what it is for — `live.seo.canonical_missing`
   * and its siblings are minted only while the defect is present, so an id that
   * a fresh scan no longer mints is a premise that stopped being true. Three of
   * five calibration fixtures ran into exactly this and failed with
   * `agent_produced_no_change`: the agent read the files, correctly found
   * nothing to fix, and the run was paid for anyway.
   */
  "live_premise_no_longer_true",
  /**
   * The live premise could not be observed, which is not the same as fine.
   *
   * A crawl that hit a budget degrades to `partial` (Rule 39) and may simply
   * not have reached the surface the cited evidence is about. Absence of an id
   * from a partial pack means unobserved, never fixed — so it refuses rather
   * than passing quietly, the same way an unread HEAD does above.
   */
  "live_premise_unverified",
  /** The plan is no longer the project's current plan. */
  "action_plan_superseded",
  /** No approved Credit policy prices agentic execution yet (§24, §25). */
  "agentic_pricing_not_configured",
  /** No authorized Credit reservation is bound to this work (§24, §49). */
  "credit_reservation_required",
  /** The bound reservation does not cover the spec's authorized maximum (§26). */
  "credit_reservation_insufficient",
  /** The bound reservation is no longer active. */
  "credit_reservation_not_active",
] as const;
export type ExecutionAdmissionRefusal = (typeof EXECUTION_ADMISSION_REFUSALS)[number];

export type ExecutionAdmission =
  | { admissible: true }
  | { admissible: false; refusal: ExecutionAdmissionRefusal };

/* ---------------------------------------------------------------------------
 * Stop conditions (§23)
 * ------------------------------------------------------------------------ */

/**
 * Why a future agent run must stop completely (§23).
 *
 * Structural, not narrative. Each of these is observable by Vibe without asking
 * the model what happened — which is the property that makes a stop reason
 * trustworthy. There is deliberately no `agent_gave_up` and no free-text field.
 */
export const EXECUTION_STOP_REASONS = [
  /** The source revision cannot be verified, so nothing can be pinned (§16). */
  "source_revision_unverifiable",
  /** Continuing would require an action the compiled policy forbids (§13, §15). */
  "policy_violation_required",
  /** A secret would have to be read. Never granted (§11, §15). */
  "secret_access_required",
  /** A prohibited production side effect would be required (§15). */
  "prohibited_side_effect_required",
  /** The authorized Credit maximum is exhausted and nothing more is approved (§26). */
  "budget_exhausted",
  /** Required validation failed more times than the budget permits (§25). */
  "repair_limit_reached",
  /** The repository moved and the premise no longer holds (§29, §52). */
  "repository_state_drifted",
  /** A question was asked and no answer came (§21, §22). */
  "interrupt_unanswered",
] as const;
export type ExecutionStopReason = (typeof EXECUTION_STOP_REASONS)[number];

/* ---------------------------------------------------------------------------
 * Interrupts (§21, §22)
 * ------------------------------------------------------------------------ */

/**
 * Why a future agent stopped to ask (§22).
 *
 * A closed vocabulary of *situations*, not a free-text question channel. The
 * customer-facing wording is authored by Vibe against the type (`view.ts`), so
 * a model can select a situation but never phrase the product's own question —
 * which is the same boundary `EXECUTION_SUPPORT_LABELS` draws one layer up.
 *
 * What is absent matters as much: there is no "clarify implementation detail".
 * §22 wants useful autonomy, not constant clarification, and an agent that can
 * infer a convention from the repository must do so rather than ask.
 */
export const EXECUTION_INTERRUPT_TYPES = [
  /** A business decision is genuinely ambiguous and Vibe must not pick (§22). */
  "business_decision_required",
  /** Several materially different product outcomes are all defensible. */
  "materially_different_outcomes",
  /** Required role or permission semantics are unknown. */
  "permission_semantics_unknown",
  /** A new, paid external service would be required. */
  "external_paid_service_required",
  /** A destructive data migration appears necessary. */
  "destructive_migration_required",
  /** The work is materially larger than the step described. */
  "scope_expansion_required",
  /** More Credits than the customer authorized would be needed (§26). */
  "additional_credits_required",
  /** A potentially consequential action needs explicit human approval. */
  "consequential_action_approval_required",
] as const;
export type ExecutionInterruptType = (typeof EXECUTION_INTERRUPT_TYPES)[number];

/**
 * What kind of answer would unblock the question.
 *
 * Structured so the future UI can render a real control rather than a text box,
 * and so the answer arrives as data the next resolution can consume (§28)
 * instead of prose somebody has to re-interpret.
 */
export type ExecutionInterruptResponseSchema =
  | { kind: "single_choice"; options: readonly { id: string; label: string }[] }
  | { kind: "confirmation" }
  /** Bounded free text, for the cases where no option set is honest. */
  | { kind: "text"; maxLength: number };

export const EXECUTION_INTERRUPT_STATUSES = ["open", "answered", "cancelled", "expired"] as const;
export type ExecutionInterruptStatus = (typeof EXECUTION_INTERRUPT_STATUSES)[number];

/**
 * One structured question a future agent run stopped to ask (§21).
 *
 * Deliberately absent: any field that could carry model reasoning. There is no
 * `thinking`, no `rationale`, no `transcript` — §34 and Rule 43 forbid
 * persisting hidden reasoning, and the way to enforce that is to have nowhere
 * to put it. `whyBlocked` is a closed enum, not prose.
 */
export type ExecutionInterrupt = {
  id: string;
  projectId: string;
  executionSpecId: string;
  type: ExecutionInterruptType;
  /** Vibe-authored, customer-safe. Never a model's own sentence. */
  question: string;
  responseSchema: ExecutionInterruptResponseSchema;
  /** Why execution cannot safely continue, as a stop-shaped fact. */
  whyBlocked: ExecutionInterruptType;
  status: ExecutionInterruptStatus;
  createdAt: string;
  answeredAt: string | null;
  /** The structured answer, matching `responseSchema`. Never a reasoning trace. */
  answer: ExecutionInterruptAnswer | null;
};

export type ExecutionInterruptAnswer =
  | { kind: "single_choice"; optionId: string }
  | { kind: "confirmation"; confirmed: boolean }
  | { kind: "text"; value: string };

/* ---------------------------------------------------------------------------
 * Activity events (§33, §34)
 * ------------------------------------------------------------------------ */

/**
 * Customer-safe activity states for a future "Vibe is working…" surface (§33).
 *
 * **These are not chain-of-thought.** Every one is derived from something Vibe
 * observed deterministically — a tool call it brokered, a command it ran, a
 * validation verdict it recorded. None is a model self-report, and none may
 * carry a model's explanation of what it was doing (§34, Rule 43).
 *
 * The payload type below enforces that structurally: there is no message field.
 */
export const EXECUTION_ACTIVITY_EVENTS = [
  "inspecting_repository",
  /**
   * Added in Core-4, alongside the runtime that emits it (§23).
   *
   * Core-3 could not know which of these a real gateway would observe, so it
   * shipped the ones it could name. These three are the ones the first agent
   * loop actually produced: a bounded content search is a distinct action from
   * reading a file, a build is a distinct check from a test, and re-running a
   * check after a failure is the loop §16 exists to prove.
   *
   * `repairing` in particular is derived from what Vibe observed — the previous
   * check it brokered exited non-zero — never from a model saying it is fixing
   * something.
   */
  "searching_code",
  "found_existing_pattern",
  "editing_files",
  "running_typecheck",
  "running_tests",
  "running_build",
  "repairing",
  "validating",
  "needs_user_input",
  "waiting_for_budget",
  "ready_for_review",
  "failed_safely",
] as const;
export type ExecutionActivityEvent = (typeof EXECUTION_ACTIVITY_EVENTS)[number];

/**
 * One activity record.
 *
 * Every field is a count, an identifier or a Vibe-constructed command string.
 * There is no free-text field at all, which is the point: a schema that cannot
 * express a sentence cannot leak a reasoning trace, whatever a future caller
 * intends. `changedPaths` carries repository-relative paths, which are facts
 * about the change rather than statements about it.
 */
export type ExecutionActivityRecord = {
  event: ExecutionActivityEvent;
  at: string;
  /** How many files were read. Never which content. */
  filesRead?: number;
  /** Repository-relative paths written in the isolated workspace. */
  changedPaths?: readonly string[];
  /** A command Vibe constructed. Never a repository-supplied string. */
  command?: string;
};

/* ---------------------------------------------------------------------------
 * The resolution result
 * ------------------------------------------------------------------------ */

/**
 * What the resolver concluded about one Action Plan step.
 *
 * `intrinsicMode` is the interesting field. A step whose prerequisites are
 * unfinished resolves to `blocked` and that is the authoritative answer (§27) —
 * but "will Vibe be able to do this once I decide?" is a genuinely different
 * and useful question, and answering it does not weaken the block. It is a
 * forecast, never an admission: nothing downstream may read `intrinsicMode` to
 * start work, and `agentReady` is computed from `mode` alone.
 */
export type ExecutionResolution = {
  resolverVersion: typeof EXECUTION_RESOLVER_VERSION;
  riskPolicyVersion: typeof EXECUTION_RISK_POLICY_VERSION;

  stepOrder: number;
  stepKey: string;

  mode: ExecutionMode;
  /** What this would resolve to with nothing standing in front of it. A forecast. */
  intrinsicMode: ExecutionMode;
  reason: ExecutionResolutionReason;
  riskClass: ExecutionRiskClass;
  /** Non-null only when an agentic route is the classified one. */
  executionClass: ExecutionClass | null;

  /** The registry capability, when one matched. Re-derived, never read from the plan. */
  capability: ExecutionCapability | null;
  capabilityVersion: string | null;

  /**
   * Orders of the unfinished prerequisites that genuinely block this step.
   *
   * Since resolver v2 this is the *hard* subset. A prerequisite classified as
   * Vibe's own preparation is not here — it is in `absorbedPreparation`, because
   * it is going to happen inside this execution rather than before it.
   */
  blockedBy: readonly number[];
  /**
   * Prerequisite steps this execution would carry out itself, in plan order.
   *
   * Non-empty only for an agentic route: an agent reads context and acts on it,
   * and no other route does. These steps are **not** marked complete and the
   * plan is not rewritten — this records how the execution boundary was
   * compiled, and nothing more.
   */
  absorbedPreparation: readonly number[];
  /** Every gate this step failed, so a report can tell the whole truth. */
  unmetRequirements: readonly ExecutionResolutionReason[];

  /** Whether the *step itself* requires a founder decision before anything can run. */
  requiresUserInput: boolean;

  /** Live-state and money gates, evaluated separately from classification. */
  admission: ExecutionAdmission;
};

/** True only when a bounded agent could be handed this step right now. */
export function isAgentReady(resolution: ExecutionResolution): boolean {
  return resolution.mode === "agentic" && resolution.admission.admissible;
}

/** True only when an existing deterministic executor could run this right now. */
export function isDeterministicReady(resolution: ExecutionResolution): boolean {
  return (
    resolution.mode === "deterministic" &&
    resolution.capability !== null &&
    resolution.admission.admissible
  );
}

/**
 * The earliest step Vibe could actually start, or null (semantics fix §17, §37).
 *
 * ## Why this is here and not in `action-plans/sequence.ts`
 *
 * Because they answer different questions, and collapsing them would move
 * execution authority into the Planner layer — which §6 forbids.
 *
 * ```
 * firstActionableStep   "what happens next in the plan?"   plan ordering
 * firstExecutableStep   "what could Vibe start now?"       execution truth
 * ```
 *
 * `sequence.ts` has no repository, no snapshot, no validation profile and no
 * economics, so it cannot answer the second question and must not pretend to.
 * It also keeps giving the right answer to its own: on the real SEO plan the
 * first actionable step is still step 1, Vibe's own preparation, because
 * nothing stands in front of it.
 *
 * What this function adds is that step 1 is no longer the *only* answer. After
 * the dependency fix, steps 2–4 are executable while step 1 is unfinished, and
 * this is where a surface asks which one — by reading the resolver, never by
 * naming a step (§37).
 */
export function firstExecutableStep(
  resolutions: readonly ExecutionResolution[],
): ExecutionResolution | null {
  return (
    [...resolutions]
      .sort((a, b) => a.stepOrder - b.stepOrder)
      .find((resolution) => isAgentReady(resolution) || isDeterministicReady(resolution)) ?? null
  );
}
