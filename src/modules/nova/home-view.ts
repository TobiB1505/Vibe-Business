import type { OperationView } from "../operations/view";
import { operationPollPhase, OPERATION_STAGE_LABELS } from "../operations/view";
import { novaCandidateMessage, novaCandidateOption, novaCandidatePrompt } from "./feed";
import type { NovaChoiceOption } from "./feed";
import { novaCandidateTier } from "./focus";
import type { FocusCandidate, FocusCandidateKind, NovaFocus, NovaFocusTier } from "./focus";

/**
 * Nova Home, as data (UI Sourcing Spec C1).
 *
 * ## Why this exists beside `buildNovaFeed`
 *
 * The feed is a linear transcript: message, control, progress, asides. Home is
 * a composition — one dominant card, a working strip, a short stack — and the
 * two need different shapes for the same facts.
 *
 * What they must not need is different *facts*. So this re-projects
 * `deriveNovaFocus`'s output and reuses the feed's own sentence table through
 * `novaCandidateMessage`. Nova's copy is written once. The ranking is decided
 * once, in `focus.ts`, and nothing here reorders it: `primary` is the primary
 * the domain chose, and `secondary` arrives already sorted.
 *
 * ## What it adds
 *
 * Only presentation facts a component would otherwise have to work out for
 * itself: which tier a candidate sits in, whether its control can honestly be
 * bound on this surface, and what the working operation is called. It adds no
 * candidate, no ordering and no state.
 */

/**
 * How a candidate's control can be rendered *here*.
 *
 * The third case is the one that matters. Nova's catalog binds every id to a
 * real action, but several of those actions need arguments Home does not have:
 * a merge needs the approval id, a build needs the plan step key. Rendering
 * the catalog's label over an action that cannot be called would be a button
 * that fails, and rendering the catalog's label over a *link* would be a
 * control that says "Merge it" and does not merge.
 *
 * So a candidate whose action Home cannot supply arguments for is `elsewhere`:
 * the founder is sent to the surface that owns the decision, with wording that
 * says so. Nothing is hidden and nothing is promised.
 */
export type NovaControlKind = "server_action" | "navigation" | "elsewhere";

export type NovaHomeControl =
  | { kind: "server_action"; option: NovaChoiceOption }
  | { kind: "navigation"; option: NovaChoiceOption }
  /** Go and decide where the decision lives. Carries its own honest label. */
  | { kind: "elsewhere"; label: string; section: NovaHomeSection }
  /** Nothing to press. `nothing_to_do` has no control, and inventing one would be work Nova made up. */
  | { kind: "none" };

/** The rooms Home can send a founder to. Resolved to hrefs in the app layer. */
export type NovaHomeSection = "agent" | "action-plan" | "business-health" | "my-product";

export type NovaHomeEntry = {
  /** Stable across renders for the same subject, so React keys are honest. */
  id: string;
  kind: FocusCandidateKind;
  tier: NovaFocusTier;
  /** Nova's sentence for this candidate — the feed's words, not a second set. */
  message: string;
  /** The question above the control, when the candidate asks one. */
  prompt: string | null;
  /**
   * The subject's own sentence, when the candidate carries one.
   *
   * A change's `headline` comes from `deriveChangeProgress` and a question's
   * text from the request that asked it. Nova never writes either.
   */
  detail: string | null;
  control: NovaHomeControl;
  candidate: FocusCandidate;
};

export type NovaWorkingEntry = {
  operationId: string;
  /** The named stage, never a percentage. */
  stageLabel: string;
  /** `working`, `waiting_user`, `stalled` — the operations view's own reading. */
  phase: ReturnType<typeof operationPollPhase>;
  shouldPoll: boolean;
};

export type NovaHomeView = {
  primary: NovaHomeEntry;
  secondary: NovaHomeEntry[];
  working: NovaWorkingEntry | null;
};

/**
 * Which candidates Home can drive itself, and which belong to another screen.
 *
 * Read as a list of what is *missing* rather than what is refused:
 *
 * - `merge_ready` needs a `changeApprovalId`, which the focus facts do not
 *   carry and which the merge action requires. The Agent's review stage has it.
 * - `execution_offered` needs the plan step key; `read.ts` also fixes
 *   `executableStep` at null until the execution resolver is wired, so this
 *   candidate cannot currently arise at all.
 * - `workspace_choice_required` needs the candidate roots, and `read.ts` fixes
 *   the flag at false for the same reason.
 * - The two question kinds need the bounded-options card that owns answering.
 *   Restating a question's options in a second component is how two answers to
 *   one question get built.
 */
const ELSEWHERE: Partial<Record<FocusCandidateKind, { label: string; section: NovaHomeSection }>> =
  {
    merge_ready: { label: "Go to the change", section: "agent" },
    execution_offered: { label: "Go to the plan", section: "action-plan" },
    workspace_choice_required: { label: "Choose in the Agent", section: "agent" },
    agent_question: { label: "Answer in the Agent", section: "agent" },
    founder_input_required: { label: "Answer in the plan", section: "action-plan" },
  };

function detailFor(candidate: FocusCandidate): string | null {
  if ("headline" in candidate) return candidate.headline;
  if ("question" in candidate) return candidate.question;
  if ("move" in candidate) return candidate.move.title;
  if (candidate.kind === "execution_offered") return candidate.stepTitle;
  return null;
}

function subjectKey(candidate: FocusCandidate): string {
  if ("preparedChangeId" in candidate) return candidate.preparedChangeId;
  if ("founderInputRequestId" in candidate) return candidate.founderInputRequestId;
  if ("move" in candidate) return candidate.move.id;
  if (candidate.kind === "execution_offered") return String(candidate.stepOrder);
  return "project";
}

function controlFor(candidate: FocusCandidate): NovaHomeControl {
  const elsewhere = ELSEWHERE[candidate.kind];
  if (elsewhere) return { kind: "elsewhere", ...elsewhere };

  const option = novaCandidateOption(candidate);
  if (option === null) return { kind: "none" };

  return option.control === "navigation"
    ? { kind: "navigation", option }
    : { kind: "server_action", option };
}

function entryFor(candidate: FocusCandidate): NovaHomeEntry {
  return {
    id: `${candidate.kind}:${subjectKey(candidate)}`,
    kind: candidate.kind,
    tier: novaCandidateTier(candidate.kind),
    message: novaCandidateMessage(candidate.kind),
    prompt: novaCandidatePrompt(candidate.kind),
    detail: detailFor(candidate),
    control: controlFor(candidate),
    candidate,
  };
}

function workingFor(operation: OperationView | null): NovaWorkingEntry | null {
  if (operation === null) return null;

  return {
    operationId: operation.operationId,
    stageLabel: OPERATION_STAGE_LABELS[operation.stage],
    phase: operationPollPhase(operation),
    shouldPoll: operation.shouldPoll,
  };
}

/**
 * How many secondary items Home shows before it stops.
 *
 * Five, and the rest are reachable through the rooms they belong to. A stack
 * that grew without limit would recreate the wall of equally weighted choices
 * that Nova exists to replace — and the ranking means the ones past five are,
 * by the domain's own ordering, the least urgent.
 */
export const NOVA_SECONDARY_LIMIT = 5;

export function buildNovaHomeView(focus: NovaFocus): NovaHomeView {
  return {
    primary: entryFor(focus.primary),
    secondary: focus.secondary.slice(0, NOVA_SECONDARY_LIMIT).map(entryFor),
    working: workingFor(focus.working),
  };
}
