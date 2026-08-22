import type { StageRailStep } from "@/components/ui/stage-rail";
import { deriveChangeSteps } from "@/modules/execution/change-steps";
import type { ChangeStage } from "@/modules/execution/change-progress";
import {
  deriveLoopStage,
  loopBlockMessage,
  type LoopStageFacts,
  type PreparedChangeLoopFacts,
} from "@/modules/execution/loop-stage";

/**
 * The progress spine in a real browser (UI-8 §1, §2).
 *
 * ## Why the steps are *derived* rather than written
 *
 * Every fixture below runs the real `deriveLoopStage` and `deriveChangeSteps`
 * over real facts. A hand-written list of seven steps would render beautifully
 * and prove nothing — it would keep passing after the derivation started
 * disagreeing with it, which is the exact failure this suite exists to catch.
 *
 * ## The pair that matters
 *
 * `loop_moves_blocked` and `loop_moves_unblocked` differ by **one fact**: the
 * block reason the opportunities module reported. Everything else is identical.
 * That is what makes them a transition rather than two unrelated screenshots —
 * the spec asserts the same rail moves from blocked to active when, and only
 * when, the underlying state changes.
 *
 * ## What it cannot prove
 *
 * That `page.tsx` assembles the right facts from the database. The route's own
 * reads are covered by `loop-facts.test.ts` and by the source assertions; this
 * is a floor, not a ceiling — the same documented gap every suite here carries.
 */

function change(overrides: Partial<PreparedChangeLoopFacts> = {}): PreparedChangeLoopFacts {
  return {
    validationPassed: true,
    validationFailed: false,
    approved: false,
    merged: false,
    mergeStalled: false,
    ...overrides,
  };
}

/** A project that has connected, been scanned, audited and has moves. */
function facts(overrides: Partial<LoopStageFacts> = {}): LoopStageFacts {
  return {
    repositoryConnected: true,
    hasProductProfile: true,
    hasAudit: true,
    auditBlockedReason: null,
    hasMoves: true,
    movesBlockedReason: null,
    preparedChanges: [],
    ...overrides,
  };
}

/** The same mapping `page.tsx` performs, so the browser sees what the route renders. */
function railFor(input: LoopStageFacts): StageRailStep[] {
  return deriveLoopStage(input).map((stage) => ({
    id: stage.id,
    label: stage.label,
    state: stage.state,
    note: stage.blockReason ? loopBlockMessage(stage.blockReason) : null,
  }));
}

function gatesFor(stage: ChangeStage): StageRailStep[] {
  return deriveChangeSteps(stage).map((step) => ({
    id: step.id,
    label: step.label,
    state: step.state,
  }));
}

export const E2E_LOOP_SCENARIOS = {
  /** Nothing connected — every step ahead, none of them a problem. */
  loop_connect: () => railFor(facts({ repositoryConnected: false, hasProductProfile: false, hasAudit: false, hasMoves: false })),

  /** Scanned, not yet audited. */
  loop_audit: () => railFor(facts({ hasAudit: false, hasMoves: false })),

  /**
   * The audit predates evidence that exists now, so moves cannot be ranked.
   * Half of the transition pair.
   */
  loop_moves_blocked: () => railFor(facts({ hasMoves: false, movesBlockedReason: "audit_stale" })),

  /** The same project, one fact different: the block is gone. The other half. */
  loop_moves_unblocked: () => railFor(facts({ hasMoves: false, movesBlockedReason: null })),

  /** A change is prepared and waiting to be looked at. */
  loop_review: () => railFor(facts({ preparedChanges: [change()] })),

  /** A change cannot go in as it is. */
  loop_merge_stalled: () =>
    railFor(facts({ preparedChanges: [change({ approved: true, mergeStalled: true })] })),

  /** Round once — every step behind. */
  loop_merged: () => railFor(facts({ preparedChanges: [change({ merged: true })] })),

  /**
   * A project that is past connecting but whose later steps carry block
   * reasons. Nothing may render as blocked: a gate nobody reached cannot have
   * refused anything.
   */
  loop_unreached_not_blocked: () =>
    railFor(
      facts({
        repositoryConnected: false,
        hasProductProfile: false,
        hasAudit: false,
        hasMoves: false,
        movesBlockedReason: "audit_missing",
        preparedChanges: [change({ mergeStalled: true })],
      }),
    ),

  /** The four gates of one prepared change, at each interesting position. */
  gates_validation_failed: () => gatesFor("validation_failed"),
  gates_awaiting_approval: () => gatesFor("awaiting_approval"),
  gates_stalled: () => gatesFor("stalled"),
  gates_merged: () => gatesFor("merged"),
} as const;

export type E2eLoopScenario = keyof typeof E2E_LOOP_SCENARIOS;

export function isE2eLoopScenario(value: string): value is E2eLoopScenario {
  return value in E2E_LOOP_SCENARIOS;
}
