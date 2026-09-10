import type { ChangeStage } from "@/modules/execution/change-progress";
import type { PreparedChangeWorkspaceItem } from "@/modules/execution/workspace";
import type {
  ValidationCheck,
  ValidationCheckState,
} from "@/app/app/projects/[projectId]/agent/agent-validation-checks";
import type { MergeSummary } from "@/app/app/projects/[projectId]/agent/agent-merge-stage";
import type { ValidationPhaseView } from "@/modules/validation/view";

/**
 * Projecting one prepared change onto the Agent's own stage screens.
 *
 * ## Why this module exists rather than the workspace read
 *
 * Every function here is pure — a change card in, a stage's props out — and
 * two surfaces need them: the Agent workspace, which reaches them through
 * `readAgentWorkspace`, and Nova's thread, which holds the same card and no
 * workspace at all.
 *
 * They lived in `agent-workspace.ts`, which is `server-only`. Importing that
 * into Nova's block would have made the whole block barrel server-only, and
 * the barrel re-exports a client component — so a future client caller would
 * have found out at build time, in a file that had nothing to do with it.
 * Pure code with no `server-only` and no client boundary can be read from
 * either side.
 */

/**
 * Which of the Agent's five stage screens a prepared change belongs on.
 *
 * ## The three that matter to a change, and the two that do not
 *
 * `understand` and `build` are about a *run*: what the agent was asked and
 * what it wrote. A prepared change is what a run left behind, so a card alone
 * can never place one on those two.
 *
 * ## Why this is a mapping over `ChangeStage` and not over Nova's candidates
 *
 * Because Nova's candidate kinds lose the distinction that decides it.
 * `review_required` and `awaiting_approval` are both `review_change` to the
 * ranking, and they are opposite states: `reviewGate` returns
 * `review_required` exactly when the approval is blocked with
 * `approval_preview_required` — *"start a preview and look at the change
 * first"* — while `awaiting_approval` means everything a person needs in
 * order to decide is already on screen.
 *
 * Mapping the candidate kind is what produced the dead end a founder reached
 * on a phone: a change whose next step was a preview was shown the decision
 * screen, which refused, naming a step that had no control anywhere on it. The
 * change's own stage knew. This reads it.
 *
 * Total over `ChangeStage`, so a twelfth stage fails the build here rather
 * than defaulting into a screen nobody chose for it.
 */
export const AGENT_STAGE_FOR_CHANGE: Record<ChangeStage, "validate" | "preview" | "review"> = {
  /* Nothing has been checked, is being checked, or passed. */
  not_validated: "validate",
  validating: "validate",
  validation_failed: "validate",

  /* Checked, and what a person looks at does not exist yet. The preview *is*
     the review (ADR 0063), so all three of these want the screen that starts
     one. */
  reviewing: "preview",
  review_required: "preview",
  review_unavailable: "preview",

  /* The evidence is there and the next move is a decision. */
  awaiting_approval: "review",
  ready_to_merge: "review",
  merging: "review",
  /* A refused or overtaken merge. The decision screen carries the refusal and
     the branch it is about; a preview would be answering a question nobody
     asked. */
  stalled: "review",

  /* After the fact. The same screen, which is where the post-merge record
     lives — what moved, on which commit, and whether it was read back. */
  merged: "review",
  observed: "review",
};

export function agentStageForChange(stage: ChangeStage): "validate" | "preview" | "review" {
  return AGENT_STAGE_FOR_CHANGE[stage];
}

/**
 * The sandbox's phase states, in the check rows' own words.
 *
 * Moved from `agent-workspace.ts` rather than copied: two tables mapping one
 * set of states is two tables that come to disagree, and the disagreement is
 * a founder told a step passed on one screen and timed out on another.
 *
 * The rows say `running` and `pending` for the same two things — a difference
 * in copy, not in meaning. `skipped` stays `skipped`: a step that did not need
 * to run is not a step that has not run yet. And a step the sandbox cut off
 * produced no verdict, which is a failure.
 */
const PHASE_STATE: Record<ValidationPhaseView["state"], ValidationCheckState> = {
  passed: "passed",
  failed: "failed",
  active: "running",
  pending: "pending",
  skipped: "skipped",
  not_run: "pending",
  timed_out: "failed",
};

const SKIP_REASONS: Record<string, string> = {
  outside_depth: "not needed for this change",
  not_configured: "your project defines no such step",
  unsupported: "Vibe cannot run this here",
};

/**
 * The sandbox's own steps, as rows.
 *
 * Empty when nothing has been validated — which is a real state and not a
 * missing one, so the stage renders its own notice rather than an empty table.
 */
export function validationChecks(change: PreparedChangeWorkspaceItem | null): ValidationCheck[] {
  const run = change?.validation ?? null;
  if (run === null) return [];

  return run.phases.map((phase) => ({
    name: phase.label,
    detail:
      phase.state === "skipped"
        ? `Skipped — ${phase.skipReason ? (SKIP_REASONS[phase.skipReason] ?? "not needed here") : "not needed here"}`
        : phase.state === "active"
          ? phase.activeLabel
          : phase.label,
    state: PHASE_STATE[phase.state],
  }));
}

/**
 * The card carries the validation run's overall status, not per-step results,
 * so tests and build report the same verdict in their own vocabulary. Claiming
 * a step-level outcome nothing can see would be worse than being honestly
 * coarse.
 */
function testVerdict(change: PreparedChangeWorkspaceItem | null): MergeSummary["tests"] {
  const status = change?.validation?.status ?? null;
  if (status === "passed") return "passing";
  if (status === "failed") return "failing";
  return "not_run";
}

function buildVerdict(change: PreparedChangeWorkspaceItem | null): MergeSummary["build"] {
  const status = change?.validation?.status ?? null;
  if (status === "passed") return "successful";
  if (status === "failed") return "failed";
  return "not_run";
}

export function mergeSummaryFor(change: PreparedChangeWorkspaceItem | null): MergeSummary {
  return {
    filesChanged: change?.filePaths.length ?? 0,
    /* Absent when preparation could not measure every file; never fake zero. */
    ...(change?.lineStats
      ? {
          linesAdded: change.lineStats.added,
          linesRemoved: change.lineStats.removed,
        }
      : {}),
    tests: testVerdict(change),
    build: buildVerdict(change),
  };
}
