import type { AuditDenialReason } from "@/modules/business-audit/entitlement";
import type { OpportunityBlockReason } from "@/modules/opportunities/service";

/**
 * Where a *project* stands in the product loop (UI-8 §1).
 *
 * ## Why this has to exist
 *
 * The loop has seven steps — connect, scan, audit, opportunities, prepare,
 * review, merged — and the product performs every one of them. What it has
 * never done is say which one you are on. A linear stepper exists, but it
 * belongs to onboarding (`modules/onboarding/state.ts`) and stops after the
 * first move; from `/moves` onward there is no orientation at all.
 *
 * So a founder who has connected a repository, paid for an audit, and had a
 * change prepared sees eight equal navigation entries and no answer to "what
 * happens next?". The information to answer it already existed, spread across
 * four modules that each knew their own part.
 *
 * ## What this is not
 *
 * **Not a second opinion, and not a second state machine.** Every fact here is
 * decided somewhere else — onboarding derives connection and profile,
 * `business-audit/entitlement.ts` decides whether an audit may run,
 * `opportunities/service.ts` decides whether moves may be generated, and
 * `deriveChangeProgress` decides where one prepared change stands. This reads
 * those answers and says which of seven boxes the project is in.
 *
 * **Not a router.** A stage names the workspace section that owns it, and
 * nothing more. The eight sections in `PROJECT_SECTIONS` remain the navigation;
 * this is orientation laid over them. `loop-stage.test.ts` pins every
 * `sectionId` against that list so the two cannot drift apart.
 *
 * **Not `ChangeStage`.** Those twelve states answer "where is *this* prepared
 * change?" and stay untouched. These seven answer "where is the *project*?".
 * One prepared change maps onto three of these boxes; three prepared changes
 * still map onto one project position. Conflating them would mean either
 * losing eleven states or inventing a project that is in three places at once.
 *
 * Pure and synchronous — no database handle, no clock, no polling. That is
 * enforced by the signature rather than by convention: a projection that could
 * read is a projection that will eventually decide something, and the moment
 * it decides something it becomes a second source of truth for a question
 * another module already answers.
 */

/** The seven steps, in loop order. The rail renders exactly this list. */
export const LOOP_STAGES = [
  { id: "connect", label: "Connect", sectionId: "overview" },
  { id: "scan", label: "Scan", sectionId: "understanding" },
  { id: "audit", label: "Audit", sectionId: "business-audit" },
  { id: "moves", label: "Opportunities", sectionId: "next-moves" },
  { id: "prepare", label: "Prepare", sectionId: "prepared" },
  { id: "review", label: "Review", sectionId: "prepared" },
  { id: "merged", label: "Merged", sectionId: "prepared" },
] as const;

export type LoopStageId = (typeof LOOP_STAGES)[number]["id"];

/** The workspace section that owns a stage. Pinned against `PROJECT_SECTIONS`. */
export type LoopSectionId = (typeof LOOP_STAGES)[number]["sectionId"];

export type LoopStageState =
  /** Behind the project — the artifact this step produces exists. */
  | "done"
  /** Where the project is now, whether Vibe is working or it is the founder's turn. */
  | "active"
  /** Where the project is now, and it cannot advance without something changing. */
  | "blocked"
  /** Not reached. Never rendered as a problem. */
  | "pending";

/**
 * Why a stage cannot advance.
 *
 * Every value is re-exported from the module that decides it. Nothing is
 * minted here — a reason this file invented would be a rule only the rail
 * knows, which is exactly what a projection must not have.
 *
 * `credits_required` is deliberately **absent**, even though it is an
 * `AuditDenialReason`. Its own docblock says so: it stopped being terminal in
 * BILLING CORE-2, it routes into paying, and "a UI must not render it as a
 * wall". A rail that painted it red would be re-deciding a question billing
 * already answered, in the opposite direction.
 */
export type LoopBlockReason =
  | Exclude<AuditDenialReason, "credits_required">
  | OpportunityBlockReason
  | "validation_failed"
  | "merge_stalled";

export type LoopStageView = {
  id: LoopStageId;
  label: string;
  sectionId: LoopSectionId;
  state: LoopStageState;
  /** Set only when `state` is `blocked`. */
  blockReason: LoopBlockReason | null;
};

/**
 * One short sentence per block reason, written to the founder.
 *
 * Copy, not logic — the same division `STAGE_HEADLINES` keeps beside
 * `ChangeStage`. Each says what is true and leaves the remedy to the section
 * the stage links to, which knows the specifics and owns the control.
 */
const BLOCK_MESSAGES: Record<LoopBlockReason, string> = {
  audit_already_running: "An audit is already running for this project.",
  start_attempts_exhausted: "Too many audits were started recently.",
  product_profile_missing: "Vibe has not worked out what your product is yet.",
  product_profile_stale: "Your product has changed since Vibe last read it.",
  audit_missing: "There is no audit to prioritize from yet.",
  audit_stale: "The audit predates evidence that exists now.",
  validation_failed: "A prepared change did not pass its safety checks.",
  merge_stalled: "A prepared change cannot go into your repository as it is.",
};

export function loopBlockMessage(reason: LoopBlockReason): string {
  return BLOCK_MESSAGES[reason];
}

/**
 * One prepared change, as five verdicts their own modules already reached.
 *
 * ## Why this is not a `ChangeStage`
 *
 * `deriveChangeProgress` answers this question better than anything here could,
 * and the obvious design was to take its twelve states as input. It was
 * rejected on cost, not on taste: producing one requires the full prepared-
 * change workspace — validation, preview, review, approval, merge, outcome and
 * impact per change, plus up to four GitHub reads for an approved one, plus
 * signed review-image URLs, plus a sandbox origin for a running preview.
 *
 * A spine is only worth having if it is on the screen a founder actually opens,
 * and paying a workspace read to render seven words there is precisely the debt
 * UI-2 split the routes to pay down. So the rail asks for less: each field
 * below is a **persisted verdict from the module that owns it**, readable with
 * a count-only query — never an approximation of one, and never a second
 * opinion about it.
 *
 * The cost of that choice is real and worth naming: the rail cannot distinguish
 * "the comparison is unavailable" from "it is ready to review", because that
 * distinction lives in `ReviewCard` and `PreviewCard`. `/prepared` shows it in
 * full. The rail says which of seven boxes you are in; it does not replace the
 * section that owns the box.
 */
export type PreparedChangeLoopFacts = {
  /** `validation_runs.status = 'passed'` — the validation module's verdict. */
  validationPassed: boolean;
  /** `validation_runs.status = 'failed'`. A cancelled run is neither. */
  validationFailed: boolean;
  /** An approval that currently stands, from `change_approvals`. */
  approved: boolean;
  /** The default branch carries this change, and Vibe read it back. */
  merged: boolean;
  /** A merge was refused or failed, from `change_merges`. */
  mergeStalled: boolean;
};

export type LoopStageFacts = {
  /** A GitHub repository is connected to this project. */
  repositoryConnected: boolean;
  /** A Product Profile exists — the artifact the scan produces. */
  hasProductProfile: boolean;
  /** A completed Business Readiness Audit exists. */
  hasAudit: boolean;
  /**
   * Why an audit cannot start, from `authorizeAudit`. `credits_required` is
   * not a block — see `LoopBlockReason`.
   */
  auditBlockedReason: AuditDenialReason | null;
  /** A ranked opportunity set exists. */
  hasMoves: boolean;
  /** Why moves cannot be generated, from `getOpportunityReadiness`. */
  movesBlockedReason: OpportunityBlockReason | null;
  /** Every prepared change in this project. Order is irrelevant — the furthest decides. */
  preparedChanges: PreparedChangeLoopFacts[];
};

/**
 * Which loop stage one prepared change sits in.
 *
 * Read from the far end backwards, for the same reason `deriveChangeProgress`
 * does: a merged change has been through every gate before it, and asking about
 * validation first would let an early verdict speak for a change long past it.
 *
 * The mapping runs one way only. Nothing reads a loop stage back into a
 * `ChangeStage`, and nothing here decides anything `deriveChangeProgress`
 * decides — these are its inputs, not its output.
 */
function loopIndexOfChange(change: PreparedChangeLoopFacts): number {
  if (change.merged) return LOOP_STAGES.length; // the loop has been round once
  if (change.mergeStalled) return 6;
  if (change.approved) return 6;
  if (change.validationPassed) return 5;

  return 4;
}

/**
 * The index of the stage the project is on, or `LOOP_STAGES.length` once a
 * change has actually been merged.
 *
 * Read forwards, because each step genuinely requires the one before it: there
 * is nothing to audit without a profile, nothing to rank without an audit, and
 * nothing to prepare without a move. `deriveChangeProgress` reads *backwards*
 * for the opposite reason — a merged change has been through every gate, so
 * an early gate must not speak for it. Both directions are right for their
 * question.
 *
 * The **furthest** prepared change decides. A project with one merged change
 * and one just-prepared change has been round the loop; showing it as stuck at
 * "prepare" would forget that.
 */
function reachedIndex(facts: LoopStageFacts): number {
  if (!facts.repositoryConnected) return 0;
  if (!facts.hasProductProfile) return 1;
  if (!facts.hasAudit) return 2;
  if (!facts.hasMoves) return 3;
  if (facts.preparedChanges.length === 0) return 4;

  return Math.max(...facts.preparedChanges.map(loopIndexOfChange));
}

/**
 * Why the stage at `index` cannot advance, or null.
 *
 * Only the stage the project is actually on can be blocked. A blocked audit on
 * a project that already has three merged changes is not something to paint
 * across the rail — it is history, and the audit section says so itself.
 */
function blockReasonAt(index: number, facts: LoopStageFacts): LoopBlockReason | null {
  if (index === 2) {
    const reason = facts.auditBlockedReason;
    // `credits_required` routes into paying rather than blocking (see above).
    return reason === null || reason === "credits_required" ? null : reason;
  }
  if (index === 3) return facts.movesBlockedReason;

  const changes = facts.preparedChanges;
  if (index === 4 && changes.some((change) => change.validationFailed)) return "validation_failed";
  if (index === 6 && changes.some((change) => change.mergeStalled)) return "merge_stalled";

  return null;
}

/**
 * Project facts in, seven stages out.
 *
 * Every stage before the current one is `done`, the current one is `active` or
 * `blocked`, and every stage after it is `pending`. A stage after the current
 * one is never `blocked` — a step nobody has reached cannot have failed, and
 * saying otherwise would turn "not yet" into "went wrong".
 */
export function deriveLoopStage(facts: LoopStageFacts): LoopStageView[] {
  const reached = reachedIndex(facts);
  const blockReason = reached < LOOP_STAGES.length ? blockReasonAt(reached, facts) : null;

  return LOOP_STAGES.map((stage, index) => {
    const state: LoopStageState =
      index < reached ? "done" : index > reached ? "pending" : blockReason ? "blocked" : "active";

    return {
      id: stage.id,
      label: stage.label,
      sectionId: stage.sectionId,
      state,
      blockReason: state === "blocked" ? blockReason : null,
    };
  });
}
