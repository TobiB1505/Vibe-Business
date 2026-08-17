import type { BusinessLens } from "@/modules/business-audit/schema";
import type { ExecutionCapability } from "@/modules/execution/schema";

/**
 * The Action Plan domain model (CORE-2b §15).
 *
 * ## Where this sits
 *
 * ```
 * Audit          "This is the business problem."
 * Next Move      "This is the intervention I recommend."
 * Action Plan    "This is exactly how we get from here to there."
 * Execution      "This is what Vibe can safely do for you."
 * ```
 *
 * Four layers, deliberately not collapsed. The audit already decided *what
 * matters*; a plan that re-decided it would be a second audit with less
 * evidence (§4). The Opportunity/Next Move layer already decided *which
 * intervention*; a plan that picked its own would make the ranked list
 * decorative. This layer answers only the remaining question — **how** — and
 * its whole contract is shaped by refusing the other three.
 *
 * ## The one architectural rule this file exists to enforce
 *
 * A model may describe a business action. **Only the server may say whether
 * Vibe can execute it** (§10, §46). So `actor` and `changeKind` below are model
 * output, and `executionSupport` and `capability` are not representable as
 * model output at all: there is no wire field for them (`wire-schema.ts`), and
 * they are computed in `classify.ts` from a server-owned registry. A model that
 * emits `capability: "stripe_checkout_v9"` is emitting a field nothing reads.
 *
 * That is also why `executionSupport` is not a boolean (§48). "Vibe has an
 * executor", "this is Vibe's work but nothing runs on a click", "only the
 * founder can decide this" and "we are waiting on Stripe" are four different
 * answers, and a product that flattened them would have to lie about three.
 */

export const ACTION_PLAN_SCHEMA_VERSION = "business-action-plan.v1" as const;
export const ACTION_PLAN_STEP_SCHEMA_VERSION = "business-action-plan-step.v1" as const;

/**
 * The **planner contract** version (§41).
 *
 * Separate from the schema version for the same reason the audit separates its
 * two: the schema describes the payload's shape, this describes what a stored
 * plan *means*. Bumped when a stored plan stops being an acceptable answer to
 * "how would Vibe approach this Move today?".
 */
export const ACTION_PLANNER_CONTRACT_VERSION = "action-planner-contract-v1" as const;

/** Bumped when planning behaviour changes materially. */
export const ACTION_PLANNER_VERSION = "action-planner-v1" as const;

/**
 * Plan size (§29, §30).
 *
 * The best plan is the shortest credible path from the current problem to a
 * meaningfully changed state — not the longest list. Two is a legitimate plan
 * for a simple Move; nine is the hard ceiling, and anything above seven is
 * recorded as a note so plan inflation is visible rather than invisible.
 *
 * Not a target. Nothing pads a plan to reach a number.
 */
export const MIN_PLAN_STEPS = 2;
export const MAX_PLAN_STEPS = 9;
export const PLAN_INFLATION_THRESHOLD = 7;

/**
 * Who or what has to act (§9, §66).
 *
 * Model output, and the only classification the model is trusted with — because
 * it is a statement about the *business action*, not about Vibe's capabilities.
 * "Only the founder can decide which customer to serve" is a judgment about the
 * work; "Vibe can rewrite your homepage" is a claim about our system, and the
 * model has no way to know whether it is true.
 *
 * `founder_decision` and `founder_action` are separate on purpose (§26).
 * Choosing a segment and interviewing five customers are both "the founder does
 * it", and a product that treated them identically would ask someone to spend a
 * week on the screen where it should ask them to pick one of three options.
 */
export const STEP_ACTORS = [
  /** Vibe does this — whether or not an automated capability exists yet. */
  "vibe",
  /** A strategic choice Vibe must not make on the founder's behalf (§22). */
  "founder_decision",
  /** Real-world work only a person can do: calls, interviews, filings (§26). */
  "founder_action",
  /** Blocked on a third party or an external system (§27). Never "Vibe failed". */
  "external_party",
] as const;
export type StepActor = (typeof STEP_ACTORS)[number];

/**
 * What kind of changed state the step produces (§19, §32).
 *
 * A closed vocabulary rather than free prose, because two things downstream
 * depend on it and neither may read model wording: capability reconciliation
 * (`capability-registry.ts`) and execution-support derivation (`classify.ts`).
 * Model wording is not a machine API — the same lesson `execution/capabilities.ts`
 * records, applied one layer earlier.
 *
 * Note what is absent: there is no `write_code`, no `open_pull_request`, no
 * `deploy`. A plan step names a business outcome; how a product change is
 * carried out is execution's vocabulary, not planning's (§12, §13).
 */
export const STEP_CHANGE_KINDS = [
  /** A choice gets made and becomes the basis for later work. */
  "decision",
  /** Options, comparison, or a recommendation are produced. No external change. */
  "analysis",
  /** The product itself ends up different — copy, code, configuration. */
  "product_change",
  /** Something outside the product is set up: an account, an integration, a listing. */
  "external_setup",
  /**
   * A signal is *defined* so the outcome becomes observable.
   *
   * Defining it, not building it. Wiring analytics into the product is a
   * `product_change` — the distinction matters because it decides whether the
   * step is Vibe's reasoning work or a change to someone's repository.
   */
  "measurement",
  /** Information is gathered from people or the market, not from the product. */
  "research",
] as const;
export type StepChangeKind = (typeof STEP_CHANGE_KINDS)[number];

/**
 * Whether Vibe can act on this step **today** (§10, §46, §48, §67).
 *
 * Server-derived, always. There is no wire field for it, and `classify.ts` is
 * the only thing that produces it.
 *
 * The dangerous value is the first one, so it is the most constrained:
 * `vibe_executes_now` is emitted only when a real entry in the server-owned
 * capability registry matched on structured evidence. No amount of model
 * confidence reaches it.
 *
 * `vibe_prepares` is the honest middle. It says *this is Vibe's work, not
 * yours* — which is true, useful, and the thing §24 asks the product to
 * establish — while saying nothing about a button existing. Never render it as
 * one.
 */
export const EXECUTION_SUPPORT = [
  /** A registry capability matched. Vibe has a real executor for this. */
  "vibe_executes_now",
  /** Vibe's own work, done from what it already knows. Nothing runs on a click. */
  "vibe_prepares",
  /** Only the founder can settle this (§22). */
  "founder_decides",
  /** Manual work by the founder (§26). */
  "founder_acts",
  /** Waiting on someone or something outside (§27). */
  "external_dependency",
  /**
   * A valid business action Vibe should eventually do and currently cannot (§28).
   *
   * Kept in the plan rather than suppressed. A plan that hid every step Vibe
   * cannot automate would be a plan about Vibe rather than about the business.
   */
  "not_yet_supported",
] as const;
export type ExecutionSupport = (typeof EXECUTION_SUPPORT)[number];

/** Support values that mean "Vibe has an executor". Exactly one, and it is checked. */
export const EXECUTABLE_SUPPORT: readonly ExecutionSupport[] = ["vibe_executes_now"] as const;

/**
 * The two axes, and why neither collapses into the other (CORE-2b FIX §11–§13).
 *
 * ```
 * actor             — RESPONSIBILITY.  Who conceptually owns this work.        model
 * executionSupport  — PLATFORM.        What Vibe can actually perform today.   server
 * ```
 *
 * They are not the same question and they are not the same authority. A step can be
 * unambiguously Vibe's responsibility and unambiguously beyond what Vibe can perform —
 * *"prepare a positioning direction for the chosen segment"* is Vibe's work and needs no
 * executor at all, while *"apply that positioning to the production website"* is also
 * Vibe's work and needs one that does not exist.
 *
 * `executionSupport` therefore mirrors `actor` for every non-Vibe case
 * (`founder_decides`, `founder_acts`, `external_dependency`) and **splits** it for Vibe:
 * `vibe_prepares`, `vibe_executes_now`, `not_yet_supported`. That mirroring is a
 * projection of one server-owned answer, not a second source of truth — the server
 * derives the whole field from `actor` plus `changeKind` plus the registry, and there is
 * no wire field through which a model could disagree with it.
 *
 * The renaming §11 offers is not taken, for that reason: the current enums already
 * separate responsibility from capability cleanly, and renaming them would churn a
 * migration, a CHECK constraint and every label for no change in meaning.
 */

/**
 * True only when Vibe has a real, registry-backed executor for this step.
 *
 * The one predicate any caller — report, future UI, future execution routing — should
 * ask. It exists so that "can Vibe do this?" is answered in one place rather than by
 * each caller re-deriving it, and so that `vibe_prepares` can never be mistaken for a
 * yes: preparing is Vibe's *responsibility*, never its *capability* (§12).
 */
export function isExecutableByVibe(step: {
  executionSupport: ExecutionSupport;
  capability: ExecutionCapability | null;
}): boolean {
  // Both halves, because either alone would be a weaker claim than the product makes:
  // the support value is the classifier's answer, and the capability is the thing that
  // would actually run. The database enforces the same pairing.
  return step.executionSupport === "vibe_executes_now" && step.capability !== null;
}

/**
 * True when Vibe owns the work, whether or not it can automate any of it.
 *
 * Deliberately not the same predicate as `isExecutableByVibe`, and deliberately not
 * derived from `executionSupport` alone — this is the responsibility question, so it
 * reads the responsibility field.
 */
export function isVibesResponsibility(step: { actor: StepActor }): boolean {
  return step.actor === "vibe";
}

export type ActionPlanStep = {
  /** Deterministic, derived from position and title. Never model-supplied. */
  id: string;
  /** 1-based, unique and contiguous after validation. */
  order: number;
  title: string;
  /** What actually happens, in one to three sentences. */
  description: string;
  /**
   * What this changes and why the plan needs it (§19).
   *
   * Separate from `description` because "rewrite the main promise" and "so
   * visitors can recognise themselves in the first sentence" are different
   * facts, and a plan that only carries the first is a task list.
   */
  purpose: string;
  actor: StepActor;
  changeKind: StepChangeKind;
  /**
   * How we know it is done (§20).
   *
   * Required. A step with no completion criterion cannot be executed, cannot be
   * measured, and is the exact shape of the consulting checklist §32 rejects.
   */
  completionCriteria: string;
  /**
   * Orders of steps that must finish first (§21).
   *
   * Explicit rather than implied by position, because the relationship is
   * load-bearing: it is what stops a downstream step being offered as the first
   * actionable one while the decision it depends on is still open (§39, §78).
   */
  dependsOn: number[];
  /** Evidence ids from the pack, validated to exist (§35). May be empty (§35). */
  evidenceIds: string[];
  /**
   * Server-derived. Never model output — see the file header.
   */
  executionSupport: ExecutionSupport;
  /**
   * The registry capability backing `vibe_executes_now`, or null (§47).
   *
   * Non-null if and only if `executionSupport === "vibe_executes_now"`, which
   * is asserted in `classify.ts` and again in `validate.ts`.
   */
  capability: ExecutionCapability | null;
  /**
   * Whether carrying this step out would need a human's explicit approval (§50).
   *
   * Server-derived, and deliberately independent of `executionSupport`: a step
   * can require approval and be unsupported at the same time, and pretending
   * otherwise is how "we'd need your sign-off" quietly becomes "we can do this".
   */
  requiresApproval: boolean;
};

/**
 * A plan for **one** business Move (§6).
 *
 * Not "the twelve-month growth plan". One selected Move, so the plan stays
 * bounded, measurable, explainable and — later — executable.
 */
export type ActionPlan = {
  schemaVersion: typeof ACTION_PLAN_SCHEMA_VERSION;
  stepSchemaVersion: typeof ACTION_PLAN_STEP_SCHEMA_VERSION;
  contractVersion: typeof ACTION_PLANNER_CONTRACT_VERSION;
  plannerVersion: typeof ACTION_PLANNER_VERSION;
  promptVersion: string;
  rubricVersion: string;
  evidencePackVersion: string;
  provider: string;
  model: string;

  /** One business-level goal, concrete enough to be wrong (§16). */
  goal: string;
  /**
   * Why this Move is the one being worked on now (§17).
   *
   * Carries the audit's materiality forward rather than inventing a second
   * justification. The audit already answered this; the plan restates it so a
   * reader of the plan alone is not left guessing.
   */
  whyNow: string;
  /** The state of the business if every step succeeds (§64). */
  expectedOutcome: string;
  /**
   * How the outcome changes the source root problem (§37, §64).
   *
   * The planner's equivalent of the audit's abstraction check: if this sentence
   * cannot be written, the plan is solving something other than the problem it
   * was asked about.
   */
  addressesRootProblem: string;
  /**
   * What the plan is assuming, and what remains genuinely open (§15).
   *
   * Distinct from a founder-decision step: an assumption is something the plan
   * proceeds on, a decision step is work in the plan.
   */
  assumptions: string[];

  steps: ActionPlanStep[];

  /** Integrity notes from validation. Repairs are recorded, never hidden. */
  validationNotes: string[];
  generatedAt: string;
};

/**
 * Where a plan came from (§5, §41).
 *
 * Every plan traces to the exact judgment it was derived from. Stored beside
 * the plan rather than inside it, because these are database identities and the
 * plan document is the model's contribution.
 */
export type ActionPlanProvenance = {
  auditId: string;
  opportunitySetId: string;
  /** The Move this plan carries through. */
  opportunityId: string;
  /**
   * Which audit conclusion the Move rests on, when one can be identified.
   *
   * Nullable because conclusions are not database rows — they live inside the
   * stored audit document, identified by their root problem. A plan that could
   * not resolve one still records the audit and the Move.
   */
  rootProblem: string | null;
  lenses: BusinessLens[];
  productProfileId: string;
  founderIntentHash: string;
};

/**
 * The **run** lifecycle of a plan row (§40).
 *
 * Deliberately not the same thing as "where has this plan got to", which is
 * derived from the steps at read time (`PlanProgress` below). Storing derived
 * progress would give it somewhere to drift from the steps that define it.
 */
export const ACTION_PLAN_STATUSES = [
  "planning",
  "completed",
  "failed",
  /** A newer plan for the same project replaced it. Kept, never deleted (§43). */
  "superseded",
] as const;
export type ActionPlanStatus = (typeof ACTION_PLAN_STATUSES)[number];

/**
 * What can happen next, derived from the steps (§40).
 *
 * Answers the four questions §40 requires a lifecycle to answer, without
 * storing an answer that could disagree with the plan it describes.
 */
export const PLAN_PROGRESS_STATES = [
  /** Something can happen now, and it is Vibe's move. */
  "ready",
  /** The next thing needs the founder — a decision or an action (§23). */
  "needs_founder",
  /** Nothing can proceed: the next step waits on something external. */
  "blocked",
  /** Every step is done. */
  "finished",
] as const;
export type PlanProgress = (typeof PLAN_PROGRESS_STATES)[number];

/**
 * Why a stored plan may no longer describe the current business (§42).
 *
 * A list rather than a boolean: "your audit moved" and "you changed what you
 * told Vibe about your business" are different things to say to someone, and
 * the remedy differs. Nothing here deletes or refreshes anything — a paid
 * refresh is always the user's action (Rule 60).
 */
export const PLAN_STALENESS_REASONS = [
  "audit_superseded",
  "move_superseded",
  "product_profile_changed",
  "founder_intent_changed",
  /** The planner contract itself moved on (§41). */
  "planner_contract_superseded",
] as const;
export type PlanStalenessReason = (typeof PLAN_STALENESS_REASONS)[number];

export const ACTOR_LABELS: Record<StepActor, string> = {
  vibe: "Vibe",
  founder_decision: "Your decision",
  founder_action: "You do this",
  external_party: "Someone else",
};

/**
 * User-facing execution copy.
 *
 * Never promises automation that does not exist — `vibe_prepares` deliberately
 * does not read as a button, because it is not one.
 */
export const EXECUTION_SUPPORT_LABELS: Record<ExecutionSupport, string> = {
  vibe_executes_now: "Vibe can do this",
  vibe_prepares: "Vibe works this out",
  founder_decides: "Needs your decision",
  founder_acts: "Needs you",
  external_dependency: "Waiting on someone else",
  not_yet_supported: "Not automated yet",
};
