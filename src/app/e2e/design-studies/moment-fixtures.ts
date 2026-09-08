import type { FocusCandidateKind, NovaFocusFacts } from "@/modules/nova/focus";

/**
 * The smallest fact set that raises each of Nova's twenty-one moments.
 *
 * Shared, because two element sheets needed it and a second copy is how two
 * sheets start disagreeing about what a moment *is*. A `Record` over
 * `FocusCandidateKind` rather than a list, so the compiler is the thing that
 * notices when the domain grows a twenty-second one.
 *
 * Lab fixtures: nothing under `/app` imports this.
 */
/** Nothing true, nothing running. Every fixture below is this plus one fact. */
export const NO_FACTS: NovaFocusFacts = {
  sourceDisconnected: false,
  failedOperations: { agent: false, scan: false, audit: false },
  stalledOperations: { agent: false, scan: false, audit: false },
  changes: [],
  questions: [],
  moves: [],
  plannedMoveId: null,
  executableStep: null,
  planOffered: false,
  auditOutdated: false,
  repositoryReadOutdated: false,
  workspaceChoiceRequired: false,
  working: null,
};

const CHANGE = { preparedChangeId: "change_moment", headline: "Two files changed on a branch" };
const MOVE = { id: "move_moment", rank: 1, title: "Add a pricing page" };

export const MOMENT_FACTS: Record<FocusCandidateKind, NovaFocusFacts> = {
  source_disconnected: { ...NO_FACTS, sourceDisconnected: true },
  agent_failed: { ...NO_FACTS, failedOperations: { agent: true, scan: false, audit: false } },
  scan_failed: { ...NO_FACTS, failedOperations: { agent: false, scan: true, audit: false } },
  audit_failed: { ...NO_FACTS, failedOperations: { agent: false, scan: false, audit: true } },
  agent_stalled: { ...NO_FACTS, stalledOperations: { agent: true, scan: false, audit: false } },
  scan_stalled: { ...NO_FACTS, stalledOperations: { agent: false, scan: true, audit: false } },
  audit_stalled: { ...NO_FACTS, stalledOperations: { agent: false, scan: false, audit: true } },
  validation_failed: { ...NO_FACTS, changes: [{ ...CHANGE, stage: "validation_failed" }] },
  merge_blocked: { ...NO_FACTS, changes: [{ ...CHANGE, stage: "stalled" }] },
  repository_read_outdated: { ...NO_FACTS, repositoryReadOutdated: true },
  agent_question: {
    ...NO_FACTS,
    questions: [
      {
        founderInputRequestId: "fir_moment",
        question: "Which of the two checkout flows should stay?",
        origin: "execution_blocker",
        stepOrder: 2,
      },
    ],
  },
  founder_input_required: {
    ...NO_FACTS,
    questions: [
      {
        founderInputRequestId: "fir_moment",
        question: "Which of the two checkout flows should stay?",
        origin: "planner",
        stepOrder: 2,
      },
    ],
  },
  workspace_choice_required: { ...NO_FACTS, workspaceChoiceRequired: true },
  review_change: { ...NO_FACTS, changes: [{ ...CHANGE, stage: "review_required" }] },
  merge_ready: { ...NO_FACTS, changes: [{ ...CHANGE, stage: "ready_to_merge" }] },
  execution_offered: { ...NO_FACTS, executableStep: { order: 1, title: "Add a pricing page" } },
  outcome_pending: { ...NO_FACTS, changes: [{ ...CHANGE, stage: "merged" }] },
  plan_offered: { ...NO_FACTS, planOffered: true, moves: [MOVE] },
  next_move_available: { ...NO_FACTS, moves: [MOVE] },
  audit_outdated: { ...NO_FACTS, auditOutdated: true },
  nothing_to_do: NO_FACTS,
};
