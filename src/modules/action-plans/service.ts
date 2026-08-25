import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { ACTION_PLANNING_CONFIG } from "@/modules/ai/operations";
import { getAuditCurrency } from "@/modules/business-audit/service";
import { getLatestSuccessfulAudit } from "@/modules/business-audit/store";
import { getLatestOpportunities } from "@/modules/opportunities/service";
import { getLatestProfile } from "@/modules/product-understanding/store";
import { getFounderIntent } from "@/modules/projects/founder-intent-store";
import { ACTION_PLANNER_PROMPT_VERSION } from "./prompt";
import { ACTION_PLANNER_RUBRIC_VERSION } from "./rubric";
import {
  ACTION_PLANNER_CONTRACT_VERSION,
  ACTION_PLANNER_VERSION,
  ACTION_PLAN_SCHEMA_VERSION,
  type ActionPlanStep,
  type PlanProgress,
  type PlanStalenessReason,
} from "./schema";
import { firstActionableStep, planProgress } from "./sequence";
import {
  defaultPlannedOpportunity,
  resolvePlannerSource,
  resolveRequestedOpportunity,
  type ConclusionLineage,
  type SourceUnresolvedReason,
} from "./source";
import {
  computeActionPlanInputHash,
  getLatestCompletedActionPlan,
  type StoredActionPlan,
} from "./store";
import { completedStepsFromFounderResolutions } from "@/modules/founder-input/completion";
import {
  listActiveFounderResolutions,
  listFounderInputRequestsForPlan,
} from "@/modules/founder-input/store";
import type { FounderInputRequest } from "@/modules/founder-input/schema";

/**
 * Action Plan readiness, staleness and read models (CORE-2b §42, §59).
 *
 * Three separate questions, kept separate because they have different answers
 * and different remedies:
 *
 *  - **May a plan be generated?** Only from a current audit and a current Move.
 *    Planning from a diagnosis we already know is out of date produces
 *    confident advice about a business that has since changed.
 *  - **Is the stored plan still current?** Shown with its staleness, never
 *    deleted and never silently refreshed — a paid refresh is the user's
 *    action, never Vibe's (Rule 60, §43).
 *  - **What could happen next?** Derived from the steps, not stored (§39, §40).
 */

export type ActionPlanBlockReason =
  /** No audit exists yet — there is nothing to plan within. */
  | "audit_missing"
  /** The audit predates evidence that exists now. */
  | "audit_stale"
  /** No Move has been generated, so there is nothing to plan. */
  | "move_missing"
  /** The Moves were prioritized from an older audit than the current one. */
  | "move_stale"
  /**
   * An explicitly requested Move does not name anything in the current set (§83).
   *
   * Distinct from `move_missing`: the project has Moves, the founder chose one of
   * them, and that one is no longer there — a stale link, not an empty list. Never
   * silently substitutes rank 1 for the one actually requested.
   */
  | "move_not_found"
  /** Vibe has no understanding of the product to plan against. */
  | "product_profile_missing"
  /**
   * The business problem behind the Move could not be established (FIX §7, §8).
   *
   * The Move exists and is current; what is missing is its link back to an audit
   * conclusion. Planning anyway would produce a task list with no problem to check it
   * against, so readiness refuses and no inference is ever reached (§9).
   */
  | "planner_source_unresolved";

export type ActionPlanReadiness = {
  ready: boolean;
  blockedReason: ActionPlanBlockReason | null;
  auditId: string | null;
  /** The Move a plan would be built for, when there is one (§6, §83). */
  opportunityId: string | null;
  /**
   * Whether `opportunityId` is the engine's own rank 1, or a founder's explicit
   * deviation from it (§83). The caller renders this — never infers it from
   * rank on its own copy of the set — so the disclosure and the resolution can
   * never drift apart.
   */
  isDefaultMove: boolean;
  /** The conclusion that Move addresses, once it has been established (FIX §7). */
  conclusionKey: string | null;
  /** How it was established — stated, or recovered for a legacy Move (FIX §4). */
  conclusionLineage: ConclusionLineage | null;
  /** Why the source could not be established, when that is the blocker. */
  unresolvedSourceReason: SourceUnresolvedReason | null;
};

function blocked(
  reason: ActionPlanBlockReason,
  auditId: string | null,
  unresolvedSourceReason: SourceUnresolvedReason | null = null,
): ActionPlanReadiness {
  return {
    ready: false,
    blockedReason: reason,
    auditId,
    opportunityId: null,
    isDefaultMove: true,
    conclusionKey: null,
    conclusionLineage: null,
    unresolvedSourceReason,
  };
}

/**
 * Action Plan readiness for the engine's own rank-1 Move, or for a Move the
 * founder explicitly chose instead (§6, §83; PRODUCT.md §6 step 7).
 *
 * `requestedOpportunityId` is `null` by every existing caller today and stays
 * that way unless a founder clicked "Plan this Move" on a specific card — so
 * omitting it is not a degraded call, it is the whole product's behavior
 * before this parameter existed. See `resolveRequestedOpportunity` for why an
 * explicit selection can never silently fall back to rank 1 the way an absent
 * one intentionally does.
 */
export async function getActionPlanReadiness(
  supabase: SupabaseClient,
  projectId: string,
  requestedOpportunityId: string | null = null,
): Promise<ActionPlanReadiness> {
  const [audit, currency, opportunities, profile] = await Promise.all([
    getLatestSuccessfulAudit(supabase, projectId),
    getAuditCurrency(supabase, projectId),
    getLatestOpportunities(supabase, projectId),
    getLatestProfile(supabase, projectId),
  ]);

  if (!audit?.result) return blocked("audit_missing", null);

  // Refusing rather than warning, for the reason prioritization refuses: a plan
  // built from a diagnosis we know is out of date reads exactly like one built
  // from current evidence, and nothing on screen would say otherwise.
  if (!currency.upToDate) return blocked("audit_stale", audit.id);
  if (!profile) return blocked("product_profile_missing", audit.id);
  if (!opportunities) return blocked("move_missing", audit.id);
  if (opportunities.stale) return blocked("move_stale", audit.id);

  // Rank 1 by default. A founder's explicit choice can name a different Move
  // (§83) — Vibe itself never substitutes one on its own.
  const move = resolveRequestedOpportunity(opportunities.set.opportunities, requestedOpportunityId);
  if (!move) {
    return blocked(requestedOpportunityId === null ? "move_missing" : "move_not_found", audit.id);
  }
  const isDefaultMove = move.id === defaultPlannedOpportunity(opportunities.set.opportunities)?.id;

  /*
   * The source gate (FIX §7, §9).
   *
   * Deliberately part of *readiness* rather than of the planning step, so the refusal
   * happens where every caller already asks "may this run?" — and therefore before the
   * operation row exists, before token counting, and a long way before any provider
   * call. Placing it later would leave the ordering correct today and one refactor away
   * from a paid call on an unresolvable Move.
   */
  const source = resolvePlannerSource(audit.result, move);
  if (!source.resolved) {
    return blocked("planner_source_unresolved", audit.id, source.reason);
  }

  return {
    ready: true,
    blockedReason: null,
    auditId: audit.id,
    opportunityId: move.id,
    isDefaultMove,
    conclusionKey: source.source.conclusionKey,
    conclusionLineage: source.source.lineage,
    unresolvedSourceReason: null,
  };
}

/** Resolves the identity a planning run would carry, or why it cannot. */
export async function resolveActionPlanIdentity(
  supabase: SupabaseClient,
  projectId: string,
  requestedOpportunityId: string | null = null,
): Promise<
  | {
      ok: true;
      auditId: string;
      opportunitySetId: string;
      opportunityId: string;
      conclusionKey: string;
      conclusionLineage: ConclusionLineage;
      inputHash: string;
    }
  | { ok: false; error: ActionPlanBlockReason }
> {
  const readiness = await getActionPlanReadiness(supabase, projectId, requestedOpportunityId);
  if (!readiness.ready) return { ok: false, error: readiness.blockedReason ?? "audit_missing" };

  const [audit, opportunities, profile, founderIntent] = await Promise.all([
    getLatestSuccessfulAudit(supabase, projectId),
    getLatestOpportunities(supabase, projectId),
    getLatestProfile(supabase, projectId),
    getFounderIntent(supabase, projectId),
  ]);

  if (!audit?.result) return { ok: false, error: "audit_missing" };
  if (!opportunities) return { ok: false, error: "move_missing" };
  if (!profile) return { ok: false, error: "product_profile_missing" };

  // Re-derived rather than trusting `readiness.opportunityId`: the audit or the
  // Moves can be superseded between the two calls, and re-resolving is what
  // makes that show up as `move_not_found`/`move_stale` instead of an identity
  // built from a Move that already isn't current (§55 in spirit).
  const move = resolveRequestedOpportunity(opportunities.set.opportunities, requestedOpportunityId);
  if (!move) return { ok: false, error: requestedOpportunityId === null ? "move_missing" : "move_not_found" };

  // Already checked by readiness above; re-derived here because the identity needs the
  // key, and re-deriving is free while passing it through two layers is a chance to drift.
  const source = resolvePlannerSource(audit.result, move);
  if (!source.resolved) return { ok: false, error: "planner_source_unresolved" };

  return {
    ok: true,
    auditId: audit.id,
    opportunitySetId: opportunities.set.id,
    opportunityId: move.id,
    conclusionKey: source.source.conclusionKey,
    conclusionLineage: source.source.lineage,
    inputHash: computeActionPlanInputHash({
      auditId: audit.id,
      auditInputHash: audit.inputHash,
      opportunitySetId: opportunities.set.id,
      opportunityId: move.id,
      conclusionKey: source.source.conclusionKey,
      productProfileId: profile.stored.id,
      founderIntentHash: founderIntent.intentHash,
      evidencePackVersion: audit.result.evidencePackVersion,
      contractVersion: ACTION_PLANNER_CONTRACT_VERSION,
      plannerVersion: ACTION_PLANNER_VERSION,
      promptVersion: ACTION_PLANNER_PROMPT_VERSION,
      rubricVersion: ACTION_PLANNER_RUBRIC_VERSION,
      schemaVersion: ACTION_PLAN_SCHEMA_VERSION,
      provider: "anthropic",
      model: ACTION_PLANNING_CONFIG.model,
    }),
  };
}

/**
 * Everything a plan's staleness depends on, read once.
 *
 * Taken as an argument rather than fetched inside the check so the rule is a
 * pure function and can be tested without a database — the four staleness
 * causes in §42 are exactly the four fields here.
 */
export type PlanCurrencyFacts = {
  latestAuditId: string | null;
  latestOpportunitySetId: string | null;
  latestProductProfileId: string | null;
  latestFounderIntentHash: string | null;
  currentContractVersion: string;
};

/**
 * Why a stored plan may no longer describe the current business (§42, §88–§90).
 *
 * Every reason is *observed*, never inferred from age. A plan does not become
 * stale because time passed; it becomes stale because something it was derived
 * from moved.
 *
 * Note what is deliberately not here: a cosmetic profile edit. Staleness keys
 * on the profile *row identity*, which is what the audit's own reuse key uses —
 * so a re-run that produced an identical profile does not invalidate a plan,
 * and a genuinely new understanding does (§90).
 */
export function planStaleness(
  plan: StoredActionPlan,
  facts: PlanCurrencyFacts,
): PlanStalenessReason[] {
  const reasons: PlanStalenessReason[] = [];

  if (facts.latestAuditId !== null && facts.latestAuditId !== plan.businessAuditId) {
    reasons.push("audit_superseded");
  }
  if (
    facts.latestOpportunitySetId !== null &&
    facts.latestOpportunitySetId !== plan.opportunitySetId
  ) {
    reasons.push("move_superseded");
  }
  if (
    facts.latestProductProfileId !== null &&
    facts.latestProductProfileId !== plan.productProfileId
  ) {
    reasons.push("product_profile_changed");
  }
  if (
    facts.latestFounderIntentHash !== null &&
    facts.latestFounderIntentHash !== plan.founderIntentHash
  ) {
    reasons.push("founder_intent_changed");
  }
  if (facts.currentContractVersion !== plan.contractVersion) {
    reasons.push("planner_contract_superseded");
  }

  return reasons;
}

export type ActionPlanView = {
  plan: StoredActionPlan;
  /**
   * Why the plan may no longer be current. Empty when it is.
   *
   * The plan stays visible either way — it was true when it was made, and
   * hiding a founder's plan because the diagnosis moved would be worse than
   * saying so. Nothing here starts a paid refresh (Rule 60).
   */
  staleness: PlanStalenessReason[];
  /** What could genuinely happen next, or null when nothing can (§39). */
  firstActionableStep: ActionPlanStep | null;
  /** Where the plan stands, derived from its steps (§40). */
  progress: PlanProgress;
  /** Serializable projection of type-specific completion evidence. */
  completedStepOrders: number[];
  /** The request for the current actionable founder-owned step, if one is open. */
  founderInputRequest: FounderInputRequest | null;
};

export async function getLatestActionPlan(
  supabase: SupabaseClient,
  projectId: string,
): Promise<ActionPlanView | null> {
  const plan = await getLatestCompletedActionPlan(supabase, projectId);
  if (!plan) return null;

  const [audit, opportunities, profile, founderIntent, resolutions, requests] = await Promise.all([
    getLatestSuccessfulAudit(supabase, projectId),
    getLatestOpportunities(supabase, projectId),
    getLatestProfile(supabase, projectId),
    getFounderIntent(supabase, projectId),
    listActiveFounderResolutions(supabase, projectId),
    listFounderInputRequestsForPlan(supabase, plan.id),
  ]);

  const completed = completedStepsFromFounderResolutions(plan.steps, resolutions);
  const actionable = firstActionableStep(plan.steps, completed);

  return {
    plan,
    staleness: planStaleness(plan, {
      latestAuditId: audit?.id ?? null,
      latestOpportunitySetId: opportunities?.set.id ?? null,
      latestProductProfileId: profile?.stored.id ?? null,
      latestFounderIntentHash: founderIntent.intentHash,
      currentContractVersion: ACTION_PLANNER_CONTRACT_VERSION,
    }),
    firstActionableStep: actionable,
    progress: planProgress(plan.steps, completed),
    completedStepOrders: [...completed],
    founderInputRequest:
      actionable === null
        ? null
        : (requests.find(
            (request) =>
              request.actionPlanStepKey === actionable.id && request.status === "open",
          ) ?? null),
  };
}

/**
 * What onboarding's First Move phase may render (§59, §60).
 *
 * A read model rather than a redesign. Onboarding already reaches `first_move`
 * and already shows the Move; this lets it also show the plan and the one step
 * that could actually happen next — "this is where Vibe would start, and here
 * is the plan".
 *
 * ## Why this cannot block onboarding
 *
 * Every field is nullable and nothing here is a prerequisite. A plan may not
 * exist, may still be running, may begin with a founder decision, or may begin
 * with something Vibe cannot automate — and in every one of those cases
 * onboarding must still be completable. Activation is not the First Win, and
 * CORE-2b must not be what regresses that (§60).
 */
export type OnboardingFirstMoveView = {
  plan: StoredActionPlan | null;
  firstActionableStep: ActionPlanStep | null;
  progress: PlanProgress | null;
  completedStepOrders: number[];
};

export async function getOnboardingFirstMove(
  supabase: SupabaseClient,
  projectId: string,
): Promise<OnboardingFirstMoveView> {
  const plan = await getLatestCompletedActionPlan(supabase, projectId);
  if (!plan) {
    return { plan: null, firstActionableStep: null, progress: null, completedStepOrders: [] };
  }

  const resolutions = await listActiveFounderResolutions(supabase, projectId);
  const completed = completedStepsFromFounderResolutions(plan.steps, resolutions);

  return {
    plan,
    firstActionableStep: firstActionableStep(plan.steps, completed),
    progress: planProgress(plan.steps, completed),
    completedStepOrders: [...completed],
  };
}
