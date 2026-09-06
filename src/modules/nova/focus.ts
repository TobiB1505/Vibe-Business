import type { ChangeStage } from "../execution/change-progress";
import type { FounderInputRequestOrigin } from "../founder-input/schema";
import type { OperationView } from "../operations/view";
import type { NovaActionId } from "./actions";
import type { AttentionTier } from "../projects/attention";
import { TIER_ORDER } from "../projects/attention";

/**
 * What needs the founder's attention now, and what else is also true.
 *
 * ## Why this is a ranking and not a position
 *
 * `deriveOnboardingState` is a cascade because setup genuinely is linear: a
 * project cannot be scanning and awaiting confirmation at once. A running
 * project can. `prepared_changes_single_active_idx` is unique on
 * `(project_id, execution_identity)` rather than on `project_id`
 * (`supabase/migrations/20260812060000_prepared_changes.sql:127-129`), so one
 * project may hold several live prepared changes at the same instant — and the
 * dashboard read already counts them rather than naming one
 * (`projects/dashboard.ts:550-551`). A project can truthfully be, together:
 * one change awaiting review, a second Move planned, the audit stale, and a
 * founder question open. "The project is in state 14" is not a sentence that
 * can be true about it.
 *
 * So this returns one candidate to lead with and keeps the rest visible. A
 * cascade would have made the others unreachable by returning early, which is
 * the failure mode this shape exists to prevent.
 *
 * ## What it decides, and what it must never decide
 *
 * It decides **order**, and nothing else. Every candidate corresponds to a
 * fact some other module already derived under its own authority: a
 * `ChangeStage` from `deriveChangeProgress`, a `HomeView` from
 * `buildHomeView`, an open `FounderInputRequest`, a Move's persisted `rank`.
 * There is no way for it to invent a candidate, because it has nothing to
 * invent one from — the same property that makes `attention.ts` honest.
 *
 * The ordering itself is not a new rule either: `TIER_ORDER` and
 * `AttentionTier` come from `projects/attention.ts`, which has ranked exactly
 * this question for the account surface since Sprint UI-3.
 *
 * ## What a candidate is not
 *
 * **Not permission.** `merge_ready` says a human approved this commit and the
 * control belongs on screen; whether the merge may happen is re-read against
 * live external state inside the action that writes it (rules 70–71). Stored
 * evidence routes a founder to a decision; it never authorizes the write at
 * the end of it (rule 55).
 *
 * **Not a paid start.** No candidate begins anything. Each names one control,
 * and the founder presses it (rule 60).
 */

/** Everything a candidate can be. */
export const FOCUS_CANDIDATE_KINDS = [
  /**
   * The repository connection is gone — detached, or its access revoked.
   *
   * First, because it is the precondition for everything else: with no source
   * there is nothing to read, nothing to build and nothing to merge into. A
   * founder in this state who is shown a stale audit instead has been told
   * about the wrong problem.
   */
  "source_disconnected",
  /** The last agent run failed and the founder has not been told. */
  "agent_failed",
  /** The last read of the product failed. */
  "scan_failed",
  /** The last audit failed. Retrying is priced, and says so. */
  "audit_failed",
  /**
   * A run has been going far longer than the work can take, so it is presumed
   * lost (`OPERATION_STALL_THRESHOLD_MS`).
   *
   * After the failures, not before: a failure is something Vibe observed, and
   * a stall is something it inferred from a clock. When both are true, the
   * observed one leads.
   */
  "agent_stalled",
  "scan_stalled",
  "audit_stalled",
  /** A safety check ran and did not pass. Nothing downstream can start. */
  "validation_failed",
  /** The repository moved, or the merge was refused, so this cannot advance. */
  "merge_blocked",
  /** The read the executor resolves against is out of date (Stage 4). */
  "repository_read_outdated",
  /** The agent stopped and asked something only the founder can answer. */
  "agent_question",
  /** The plan asked something only the founder can answer. */
  "founder_input_required",
  /** Several apps in one repository, and none chosen yet (Stage 4). */
  "workspace_choice_required",
  /** A prepared change is waiting for a person to look at it. */
  "review_change",
  /** A human approved this exact commit; the merge control belongs on screen. */
  "merge_ready",
  /** The plan's next step is one Vibe can build. */
  "execution_offered",
  /** The default branch carries a change and no outcome is settled yet. */
  "outcome_pending",
  /** A current Move has no current plan. */
  "plan_offered",
  /** This plan has nothing left to do and another Move ranks next. */
  "next_move_available",
  /** The audit behind every recommendation here is no longer current. */
  "audit_outdated",
  /** Nothing is waiting, nothing failed, and nothing is available to start. */
  "nothing_to_do",
] as const;

export type FocusCandidateKind = (typeof FOCUS_CANDIDATE_KINDS)[number];

/**
 * The tier vocabulary, plus the one state the account surface never needed.
 *
 * `attention.ts` has four tiers because every item it builds is something to
 * do. Nova has to be able to say "nothing", and `orderProjectsByAttention`
 * already spells that as an ordinal past the last tier
 * (`attention.ts:214`) — this names it instead of leaving it as arithmetic.
 */
export type NovaFocusTier = AttentionTier | "settled";

export type { NovaActionId };

const CANDIDATE_TIER: Record<FocusCandidateKind, NovaFocusTier> = {
  source_disconnected: "blocked",
  agent_failed: "blocked",
  scan_failed: "blocked",
  audit_failed: "blocked",
  agent_stalled: "blocked",
  scan_stalled: "blocked",
  audit_stalled: "blocked",
  validation_failed: "blocked",
  merge_blocked: "blocked",
  repository_read_outdated: "blocked",
  agent_question: "decision",
  founder_input_required: "decision",
  workspace_choice_required: "decision",
  review_change: "decision",
  merge_ready: "decision",
  execution_offered: "ready",
  outcome_pending: "ready",
  plan_offered: "ready",
  next_move_available: "ready",
  /**
   * `setup` rather than `ready`, though re-auditing is work that could start.
   * A stale audit is a statement about the premises under every other
   * recommendation on the screen, and it must never outrank the work those
   * recommendations describe — a founder with a change awaiting review does
   * not need to be sent to the audit first.
   */
  audit_outdated: "setup",
  nothing_to_do: "settled",
};

/**
 * Order within a tier, decided rather than inherited.
 *
 * `attention.ts` breaks ties inside a tier alphabetically by kind, which is
 * fine when the tie is between two projects and arbitrary when it is between
 * two things to do about one. These five `decision` candidates are not
 * interchangeable: an agent that stopped mid-run is holding a sandbox and a
 * Credit hold open, so it precedes a finished change that will still be there
 * in an hour.
 */
const CANDIDATE_ORDER: Record<FocusCandidateKind, number> = Object.fromEntries(
  FOCUS_CANDIDATE_KINDS.map((kind, index) => [kind, index]),
) as Record<FocusCandidateKind, number>;

/**
 * One control per candidate.
 *
 * `validation_failed` and `merge_blocked` each have more than one honest
 * recovery in the module that owns them — discard is the second one in both
 * cases — and Slice 7 renders the full set. What each names here is the one
 * control that leads: the retry where a retry is meaningful, and otherwise the
 * screen where the founder decides.
 */
const CANDIDATE_ACTION: Record<FocusCandidateKind, NovaActionId | null> = {
  /*
   * Four failures, four different recoveries — which is why these are four
   * candidates rather than one carrying a variable action. "Retry" is not one
   * thing here: re-reading a product is free, re-auditing costs 35 Credits,
   * and starting a run again costs between 150 and 350. A single candidate
   * would have had to hide that difference behind one word.
   */
  source_disconnected: "nova.reconnect_source",
  agent_failed: "nova.start_agent",
  scan_failed: "nova.rescan_product",
  audit_failed: "nova.refresh_audit",
  /*
   * A stalled run offers the same control as a failed one, because starting
   * again is the same act. The sentence differs and the price does not: a
   * presumed-lost audit costs the same 35 Credits to run again as a failed
   * one, and hiding that behind the word "resume" would be charging for
   * something the founder was told was already paid for.
   */
  agent_stalled: "nova.start_agent",
  scan_stalled: "nova.rescan_product",
  audit_stalled: "nova.refresh_audit",
  validation_failed: "nova.validate_again",
  merge_blocked: "nova.review_change",
  repository_read_outdated: "nova.rescan_product",
  agent_question: "nova.answer_agent_question",
  founder_input_required: "nova.answer_plan_question",
  workspace_choice_required: "nova.choose_workspace",
  review_change: "nova.review_change",
  merge_ready: "nova.merge_change",
  execution_offered: "nova.start_agent",
  outcome_pending: "nova.verify_outcome",
  plan_offered: "nova.plan_move",
  next_move_available: "nova.view_move",
  audit_outdated: "nova.refresh_audit",
  nothing_to_do: null,
};

export function novaCandidateTier(kind: FocusCandidateKind): NovaFocusTier {
  return CANDIDATE_TIER[kind];
}

export function novaCandidateAction(kind: FocusCandidateKind): NovaActionId | null {
  return CANDIDATE_ACTION[kind];
}

/** One prepared change, as the change's own module already reads it. */
export type NovaChangeFact = {
  preparedChangeId: string;
  /** From `deriveChangeProgress`. Nova never re-derives a stage. */
  stage: ChangeStage;
  /** The stage's own sentence, already written to a founder. */
  headline: string;
};

/** One open question, whoever asked it. */
export type NovaQuestionFact = {
  founderInputRequestId: string;
  question: string;
  /**
   * Who is waiting on the answer. `execution_blocker` is the agent's own
   * question, asked mid-run; `planner` is the plan's. They are different
   * candidates because one of them stopped a run and the other did not.
   */
  origin: FounderInputRequestOrigin;
  /** The plan step the question belongs to, when it belongs to one. */
  stepOrder: number | null;
};

/** A Move, narrowed to what an ordering needs. `rank` is the engine's own. */
export type NovaMoveFact = { id: string; rank: number; title: string };

/**
 * The three operations Nova can say something about going wrong.
 *
 * One shape for both failures and stalls, because the split is the same one
 * and for the same reason: the recovery differs by kind, and one of the three
 * is free while another costs 35 Credits, so a single "something went wrong"
 * would have had to hide that behind one word.
 */
export type NovaOperationFlags = {
  agent: boolean;
  scan: boolean;
  audit: boolean;
};

export type NovaFocusFacts = {
  /**
   * No live repository connection: detached, or its access revoked.
   *
   * The precondition for everything else Nova could say, which is why it
   * outranks every other candidate rather than joining the queue.
   */
  sourceDisconnected: boolean;
  /**
   * The last attempt of each kind, when it failed and nothing has succeeded
   * since. Kept per kind because the recovery differs by kind — and one of the
   * three is free while another costs 35 Credits.
   */
  failedOperations: NovaOperationFlags;
  /**
   * The runs that have been going far longer than the work can take.
   *
   * Three rather than six, and the gap is deliberate: these are the three
   * whose restart Nova owns a control for. A stalled merge, planning run or
   * opportunity generation stays in `working` instead, where the progress
   * entry renders it as stalled and the panel that owns the operation offers
   * its own recovery — Nova does not invent a way out it does not have.
   *
   * The pairing that makes that safe is `read.ts`'s: a stalled run is stated
   * exactly once, as a candidate here or as `working`, never both and never
   * neither.
   */
  stalledOperations: NovaOperationFlags;
  changes: readonly NovaChangeFact[];
  questions: readonly NovaQuestionFact[];
  /** The current Moves, with the ranks the opportunity engine persisted. */
  moves: readonly NovaMoveFact[];
  /** The Move the current plan covers, when a plan exists. */
  plannedMoveId: string | null;
  /**
   * The plan's first actionable step, when the resolver says Vibe can build
   * it. Null covers both "nothing left to do" and "the next step is a person's
   * — the distinction lives in the resolver, and Nova does not re-decide it.
   */
  executableStep: { order: number; title: string } | null;
  /** A current Move exists and no current plan covers it. */
  planOffered: boolean;
  /** The audit behind the recommendations on screen is no longer current. */
  auditOutdated: boolean;
  /** Stage 4: `repository_analysis_outdated` from the validation profile. */
  repositoryReadOutdated: boolean;
  /** Stage 4: candidates exist and `workspace_root` names none of them. */
  workspaceChoiceRequired: boolean;
  /**
   * What is running right now.
   *
   * The three positions that are pure waiting — a scan, an agent run, a
   * validation — are not candidates. Nothing is asked of the founder while
   * they run, so they belong here rather than in a list of things to decide.
   */
  working: OperationView | null;
};

/** A candidate about one prepared change. Carries the change's own sentence. */
type ChangeCandidateKind =
  | "validation_failed"
  | "merge_blocked"
  | "review_change"
  | "merge_ready"
  | "outcome_pending";

/** A candidate about one open question. */
type QuestionCandidateKind = "agent_question" | "founder_input_required";

/** A candidate that carries nothing but itself: the fact is the whole story. */
type BareCandidateKind =
  | "repository_read_outdated"
  | "workspace_choice_required"
  | "audit_outdated"
  | "source_disconnected"
  | "agent_failed"
  | "scan_failed"
  | "audit_failed"
  | "agent_stalled"
  | "scan_stalled"
  | "audit_stalled";

export type FocusCandidate =
  | { kind: ChangeCandidateKind; preparedChangeId: string; headline: string }
  | {
      kind: QuestionCandidateKind;
      founderInputRequestId: string;
      question: string;
      stepOrder: number | null;
    }
  | { kind: "execution_offered"; stepOrder: number; stepTitle: string }
  | { kind: "plan_offered" | "next_move_available"; move: NovaMoveFact }
  | { kind: BareCandidateKind }
  | { kind: "nothing_to_do" };

export type NovaFocus = {
  /** What Nova leads with. Never null: `nothing_to_do` is a real answer. */
  primary: FocusCandidate;
  /** True, and not what to do now. */
  secondary: FocusCandidate[];
  working: OperationView | null;
  /** The one control the primary carries. */
  nextAction: NovaActionId | null;
};

/**
 * The stage-to-candidate map, total over `ChangeStage` on purpose.
 *
 * A `switch` with no default means a new stage in `change-progress.ts` fails
 * the build here rather than silently disappearing from Nova — a change in a
 * state nobody mapped would otherwise be a founder with no way forward, which
 * is the one thing every surface in this product is required not to do.
 *
 * Five stages raise nothing, and each for the same reason: Vibe owes the next
 * move, not the founder. `not_validated` is the gap between a prepared change
 * and the validation `finish.ts` enqueues for it; `validating`, `reviewing`
 * and `merging` are work in flight; `observed` is finished. None of them is
 * something to decide, and `working` is where the in-flight ones are shown.
 *
 * `not_validated` in particular must never become `review_change`: presenting
 * an unchecked change as ready to look at is exactly the false-confidence
 * failure `checks.ts` and rule 66 exist to prevent.
 */
function candidateForStage(stage: ChangeStage): ChangeCandidateKind | null {
  switch (stage) {
    case "validation_failed":
      return "validation_failed";
    case "stalled":
      return "merge_blocked";
    case "review_required":
    case "review_unavailable":
    case "awaiting_approval":
      return "review_change";
    case "ready_to_merge":
      return "merge_ready";
    case "merged":
      return "outcome_pending";
    case "not_validated":
    case "validating":
    case "reviewing":
    case "merging":
    case "observed":
      return null;
  }
}

/**
 * Where a candidate sits inside its own kind.
 *
 * §O.1's tie-break: a Move's `rank`, a plan step's `order`. Both are the
 * domain's own numbering — `BusinessOpportunity.rank` is "1-based, unique and
 * contiguous within the set" and `ActionPlanStep.order` the same within a plan
 * — so neither is a judgement made here. Candidates with no such number sort
 * after those that have one, and the subject id keeps the result stable.
 */
function candidateRank(candidate: FocusCandidate): number | null {
  if (candidate.kind === "plan_offered" || candidate.kind === "next_move_available") {
    return candidate.move.rank;
  }
  if (candidate.kind === "execution_offered") return candidate.stepOrder;
  if (candidate.kind === "agent_question" || candidate.kind === "founder_input_required") {
    return candidate.stepOrder;
  }
  return null;
}

function candidateSubject(candidate: FocusCandidate): string {
  if ("preparedChangeId" in candidate) return candidate.preparedChangeId;
  if ("founderInputRequestId" in candidate) return candidate.founderInputRequestId;
  if ("move" in candidate) return candidate.move.id;
  return candidate.kind;
}

const SETTLED_TIER_ORDER = Object.keys(TIER_ORDER).length;

function tierOrder(kind: FocusCandidateKind): number {
  const tier = CANDIDATE_TIER[kind];
  return tier === "settled" ? SETTLED_TIER_ORDER : TIER_ORDER[tier];
}

function compareCandidates(a: FocusCandidate, b: FocusCandidate): number {
  const tier = tierOrder(a.kind) - tierOrder(b.kind);
  if (tier !== 0) return tier;

  const kind = CANDIDATE_ORDER[a.kind] - CANDIDATE_ORDER[b.kind];
  if (kind !== 0) return kind;

  const rankA = candidateRank(a);
  const rankB = candidateRank(b);
  if (rankA !== rankB) {
    if (rankA === null) return 1;
    if (rankB === null) return -1;
    return rankA - rankB;
  }

  return candidateSubject(a).localeCompare(candidateSubject(b));
}

function lowestRanked(moves: readonly NovaMoveFact[]): NovaMoveFact | null {
  if (moves.length === 0) return null;
  return moves.reduce((best, candidate) => (candidate.rank < best.rank ? candidate : best));
}

export function deriveNovaFocus(facts: NovaFocusFacts): NovaFocus {
  const candidates: FocusCandidate[] = [];

  if (facts.sourceDisconnected) candidates.push({ kind: "source_disconnected" });
  if (facts.failedOperations.agent) candidates.push({ kind: "agent_failed" });
  if (facts.failedOperations.scan) candidates.push({ kind: "scan_failed" });
  if (facts.failedOperations.audit) candidates.push({ kind: "audit_failed" });

  /*
   * A stall and a failure of the same kind can both be true — a run failed,
   * the founder started another, and that one is now presumed lost. Both are
   * raised: they are two different sentences about two different runs, and
   * suppressing either would tell the founder about only half of what is
   * wrong. Ordering puts the observed failure first.
   */
  if (facts.stalledOperations.agent) candidates.push({ kind: "agent_stalled" });
  if (facts.stalledOperations.scan) candidates.push({ kind: "scan_stalled" });
  if (facts.stalledOperations.audit) candidates.push({ kind: "audit_stalled" });

  for (const change of facts.changes) {
    const kind = candidateForStage(change.stage);
    if (kind === null) continue;
    candidates.push({
      kind,
      preparedChangeId: change.preparedChangeId,
      headline: change.headline,
    });
  }

  for (const question of facts.questions) {
    candidates.push({
      kind: question.origin === "execution_blocker" ? "agent_question" : "founder_input_required",
      founderInputRequestId: question.founderInputRequestId,
      question: question.question,
      stepOrder: question.stepOrder,
    });
  }

  if (facts.repositoryReadOutdated) candidates.push({ kind: "repository_read_outdated" });
  if (facts.workspaceChoiceRequired) candidates.push({ kind: "workspace_choice_required" });

  if (facts.executableStep !== null) {
    candidates.push({
      kind: "execution_offered",
      stepOrder: facts.executableStep.order,
      stepTitle: facts.executableStep.title,
    });
  }

  const topMove = lowestRanked(facts.moves);
  if (facts.planOffered && topMove !== null) {
    candidates.push({ kind: "plan_offered", move: topMove });
  }

  /**
   * The next Move is only a candidate once this plan has nothing left to do.
   * Offering it while a step is still executable would be Nova proposing that
   * the founder abandon work it just recommended.
   */
  if (!facts.planOffered && facts.executableStep === null) {
    const nextMove = lowestRanked(facts.moves.filter((move) => move.id !== facts.plannedMoveId));
    if (nextMove !== null) candidates.push({ kind: "next_move_available", move: nextMove });
  }

  if (facts.auditOutdated) candidates.push({ kind: "audit_outdated" });

  if (candidates.length === 0) {
    return {
      primary: { kind: "nothing_to_do" },
      secondary: [],
      working: facts.working,
      nextAction: null,
    };
  }

  const ordered = [...candidates].sort(compareCandidates);
  const [primary, ...secondary] = ordered as [FocusCandidate, ...FocusCandidate[]];

  return {
    primary,
    secondary,
    working: facts.working,
    nextAction: CANDIDATE_ACTION[primary.kind],
  };
}
