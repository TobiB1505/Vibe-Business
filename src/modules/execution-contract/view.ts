import type {
  ExecutionActivityEvent,
  ExecutionAdmissionRefusal,
  ExecutionInterruptType,
  ExecutionMode,
  ExecutionResolutionReason,
  ExecutionRiskClass,
  ExecutionStopReason,
} from "./schema";

/**
 * The execution-contract presentation layer (EXECUTION CORE-3 §5, §33).
 *
 * ## The rule this file exists to enforce
 *
 * §5: *do not expose internal enums directly to customers.* A component may
 * render an `ExecutionMode`, a refusal or an activity state only through a
 * lookup here. `agentic`, `repository_head_moved` and `credit_reservation_insufficient`
 * are vocabulary for this codebase; none of them is a sentence anybody outside
 * it should read.
 *
 * The same split `action-plans/view.ts` and `merge/messages.ts` already draw,
 * and for the same reason: copy that lives beside the enum drifts, and copy
 * that lives in JSX cannot be tested.
 *
 * ## What this sprint does not do with it
 *
 * Nothing renders any of it yet. §40 is explicit: no Execute button, no changed
 * Action Planner UI, no "Let Vibe handle this" that does not connect to
 * anything. These labels exist so that when a Planner→Execution UI sprint
 * arrives, the honest wording is already fixed and reviewed rather than being
 * written against a deadline.
 */

/**
 * What Vibe can do about a step, in the founder's language.
 *
 * `agentic` deliberately does not read as a promise that anything is running.
 * It says Vibe *could* build this — which is true — and stops there, exactly as
 * `vibe_prepares` refuses to read as a button one layer up.
 */
export const EXECUTION_MODE_LABELS: Record<ExecutionMode, string> = {
  deterministic: "Vibe can do this",
  agentic: "Vibe could build this",
  needs_user_input: "Needs your decision",
  blocked: "Waiting on an earlier step",
  manual: "You'll need to do this",
  unsupported: "Not something Vibe can build yet",
};

/**
 * How much is at stake, said plainly.
 *
 * Not shown as a badge next to every step — a risk label on ordinary work
 * teaches people to ignore it. These exist for the cases where Vibe is
 * explaining a refusal.
 */
export const EXECUTION_RISK_LABELS: Record<ExecutionRiskClass, string> = {
  low: "Nothing outside Vibe changes",
  moderate: "Changes how your product behaves",
  high: "Touches sign-in, accounts or an outside service",
  prohibited: "Touches payments — always yours to change",
};

/** Why a step resolved the way it did, without naming an internal concept. */
export const EXECUTION_REASON_LABELS: Record<ExecutionResolutionReason, string> = {
  deterministic_capability_matched: "Vibe already knows how to make this exact change.",
  agentic_v1_eligible: "This is the kind of change Vibe could build for you.",
  founder_decision_required:
    "Only you can settle this, and the work after it depends on the answer.",
  founder_input_required:
    "Only you can provide this information, and the work after it depends on the answer.",
  founder_action_required: "This is real-world work that has to be done by a person.",
  external_party_required: "This is waiting on someone outside your business.",
  dependency_unsatisfied: "An earlier step has to finish first.",
  dependency_cycle_detected:
    "The steps this depends on refer back to each other, so nothing can go first.",
  no_executor_for_vibe_work:
    "This is Vibe's own thinking work rather than a change to your product.",
  change_kind_not_executable:
    "This isn't a change to your product, so there is nothing for Vibe to build.",
  risk_class_not_permitted: "Vibe doesn't yet make changes this sensitive on your behalf.",
  risk_class_prohibited: "Vibe never changes anything to do with taking payments.",
  repository_not_connected: "No code repository is connected to this project.",
  repository_snapshot_missing: "Vibe hasn't read your code yet.",
  validation_profile_unsupported:
    "Vibe can't independently prove a change to this project builds, so it won't make one.",
  // Each names the missing thing and, where there is one, the move that fixes
  // it. "Vibe can't prove a change builds" is true of all of them and useful
  // for none.
  no_node_project:
    "Vibe checks a change by running your project's own build, and this project has no package.json — so there's nothing to check a change against.",
  no_build_script:
    "Your package.json has no build script, so Vibe has no way to tell whether a change still works.",
  no_lockfile:
    "There's no lockfile beside your app, so Vibe can't install exactly what you committed.",
  package_manager_unsupported:
    "Vibe found a lockfile it won't install from exactly. Yarn 1's locked install doesn't reliably fail on a dependency the lockfile doesn't know — Yarn 3 or later works.",
  workspace_choice_required:
    "This repository holds more than one app. Tell Vibe which one to work on.",
  repository_analysis_outdated:
    "Vibe's read of your code predates this check. Refresh it and Vibe will know what it can do here.",
};

/**
 * Why work that could happen is not starting right now.
 *
 * Every one of these is temporary or fixable, and the copy says so — a refusal
 * that reads as a dead end is a refusal people work around.
 */
export const EXECUTION_ADMISSION_LABELS: Record<ExecutionAdmissionRefusal, string> = {
  not_executable_mode: "There is nothing here for Vibe to run.",
  source_revision_unverified: "Vibe couldn't confirm which version of your code is current.",
  repository_head_moved: "Your code has changed since Vibe last read it.",
  repository_snapshot_stale: "Vibe has a newer read of your code than this plan used.",
  live_premise_no_longer_true:
    "This is already fixed on your live site, so there's nothing to change.",
  live_premise_unverified:
    "Vibe couldn't finish checking your live site, so it won't start work it can't justify.",
  action_plan_superseded: "This plan has been replaced by a newer one.",
  agentic_pricing_not_configured: "Vibe isn't building changes like this for anyone yet.",
  credit_reservation_required: "This needs Credits set aside before it can start.",
  credit_reservation_insufficient: "The Credits set aside don't cover what this could cost.",
  credit_reservation_not_active: "The Credits set aside for this are no longer held.",
};

/** Why a future run would stop completely. */
export const EXECUTION_STOP_LABELS: Record<ExecutionStopReason, string> = {
  source_revision_unverifiable:
    "Vibe couldn't confirm which version of your code it was working from.",
  policy_violation_required: "Finishing would have meant doing something Vibe isn't allowed to do.",
  secret_access_required:
    "Finishing would have needed one of your secrets. Vibe never reads those.",
  prohibited_side_effect_required: "Finishing would have changed something outside your code.",
  budget_exhausted: "This reached the Credit limit you approved.",
  repair_limit_reached: "Vibe couldn't get the change passing its checks.",
  repository_state_drifted: "Your code changed while Vibe was working.",
  interrupt_unanswered: "Vibe asked a question and stopped to wait for it.",
};

/**
 * The question Vibe asks, per situation (§21).
 *
 * Vibe-authored, always. A model may select the *situation*; it never phrases
 * the product's own question, which is what stops an injected README from
 * writing a sentence a customer reads as coming from Vibe.
 */
export const EXECUTION_INTERRUPT_QUESTIONS: Record<ExecutionInterruptType, string> = {
  business_decision_required: "This needs a business decision Vibe shouldn't make for you.",
  founder_input_required: "Vibe needs information only you can provide before it can continue.",
  materially_different_outcomes: "There are a few genuinely different ways this could turn out.",
  permission_semantics_unknown: "Vibe needs to know who should be able to do this.",
  external_paid_service_required: "This would mean signing up for a paid service.",
  destructive_migration_required: "This would change existing data in a way that can't be undone.",
  scope_expansion_required: "This turned out to be bigger than the step described.",
  additional_credits_required: "Finishing this would cost more Credits than you approved.",
  consequential_action_approval_required: "Vibe needs your go-ahead before doing this.",
};

/**
 * What Vibe is doing, for a future "Vibe is working…" surface (§33).
 *
 * Present-tense, concrete, and derived from something Vibe observed. None of
 * these is a model narrating itself.
 */
export const EXECUTION_ACTIVITY_LABELS: Record<ExecutionActivityEvent, string> = {
  inspecting_repository: "Reading your code",
  searching_code: "Looking for the right place to change",
  found_existing_pattern: "Following your project's existing patterns",
  editing_files: "Making the change",
  running_typecheck: "Checking the types",
  running_tests: "Running your tests",
  running_build: "Building the app",
  // "Fixing" rather than "repairing": the customer-facing word for a check that
  // came back red and is being answered. Emitted only when Vibe observed the
  // previous check fail.
  repairing: "Fixing what the checks found",
  validating: "Proving the change builds",
  needs_user_input: "Waiting on your answer",
  waiting_for_budget: "Waiting for you to approve more Credits",
  ready_for_review: "Ready for you to look at",
  failed_safely: "Stopped without changing anything",
};
