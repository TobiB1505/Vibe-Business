import type { OperationView } from "../operations/view";
import { operationPollPhase, OPERATION_STAGE_LABELS } from "../operations/view";
import { novaCandidateMessage, novaCandidateOption, novaCandidatePrompt } from "./feed";
import type { NovaChoiceOption } from "./feed";
import { novaCandidateTier } from "./focus";
import type {
  FocusCandidate,
  FocusCandidateKind,
  NovaFocus,
  NovaFocusTier,
  NovaWorkingFact,
} from "./focus";
import type { OperationType } from "../operations/schema";
import type { ProgressSequenceId } from "../operations/view";
import { progressSequenceFor } from "./blocks";

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
 *
 * ## Why a fourth kind exists now
 *
 * Two of those five candidates were `elsewhere` for a reason that has stopped
 * being true. An open question carries its own request id on the candidate, and
 * the component that answers one — `FounderInputCard` — takes that request and
 * its resolution action as props, so it renders anywhere the request can be
 * read. Home can read it.
 *
 * `answer` says so. It is not a control at all in the sense the other three
 * are: there is no label and no href, because the answering card is the
 * control, and it brings its own options, its own recommendation and its own
 * submit. What this carries is the identity of the thing to answer.
 *
 * The distinction still holds where it was true. A merge needs an approval id
 * that no candidate carries; a build needs a plan step key. Those stay
 * `elsewhere`, and sending somebody to a decision Home cannot hold is still
 * better than a button that fails.
 */
export type NovaControlKind =
  | "server_action"
  | "navigation"
  | "elsewhere"
  | "answer"
  | "gate"
  | "choose"
  | "offer";

export type NovaHomeControl =
  | { kind: "server_action"; option: NovaChoiceOption }
  | { kind: "navigation"; option: NovaChoiceOption }
  /**
   * Answered here. The card is the control, so there is no label to render —
   * only the request to answer, which the candidate already names.
   */
  | { kind: "answer"; founderInputRequestId: string }
  /**
   * Decided here, through the change's own gates.
   *
   * Like `answer`, this carries an identity rather than a label: the gate is
   * the control, and it brings its own sequence — validation, preview, review,
   * approval, merge, outcome — each reachable only through the one above it.
   * Which of those a founder lands on is read from the change's own stage, not
   * narrowed here: a candidate kind cannot tell `review_required` from
   * `awaiting_approval`, and narrowing on it is what produced a screen with no
   * control on it.
   */
  | { kind: "gate"; preparedChangeId: string }
  /**
   * Chosen here, from the applications Vibe found.
   *
   * Carries nothing, and that is the honest shape: the candidate genuinely
   * names no application, because the list comes from the repository analysis
   * rather than from the ranking. The surface reads it — which is a read, not
   * an argument the view model was withholding.
   */
  | { kind: "choose" }
  /**
   * Started here, from the offer the block draws.
   *
   * Carries nothing, for the reason `choose` carries nothing: what a founder
   * presses is two controls at two prices, and neither the step key nor either
   * ceiling is on the candidate. `AgentReadyStage` resolves them — the chain,
   * both economics, the forecast behind the figure — and `AgentStartControls`
   * is the one component that renders the pair, so the thread cannot come to
   * show a price the plan page would not.
   *
   * This is the variant that replaced `elsewhere` for `execution_offered`, and
   * the objection that put it there is answered rather than overruled: both
   * prices are on screen, in the thread, above the button that charges them.
   */
  | { kind: "offer" }
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
  /** What kind of run this is. Decides the stage list, never chosen by a screen. */
  type: OperationType;
  /** The named stages this run has, or null when this kind has none. */
  sequence: ProgressSequenceId | null;
  /** The reading itself, for a block that draws the stages. */
  operation: OperationView;
  /** The named stage, never a percentage. */
  stageLabel: string;
  /** `working`, `waiting_user`, `stalled` — the operations view's own reading. */
  phase: ReturnType<typeof operationPollPhase>;
  shouldPoll: boolean;
};

export type NovaHomeView = {
  primary: NovaHomeEntry;
  secondary: NovaHomeEntry[];
  /**
   * How many unfinished changes this view set aside behind the one it shows.
   *
   * Zero when there is one change or none. It exists so a surface can say
   * there are others: showing one of nine in silence would be the same defect
   * as the pile it replaced, wearing the opposite face.
   */
  changesWaiting: number;
  working: NovaWorkingEntry | null;
};

/**
 * The decisions Home genuinely cannot hold.
 *
 * None.
 *
 * It was one until this commit, and the entry is worth reading rather than
 * deleting, because the argument that put it there was correct and is now
 * satisfied instead of overruled.
 *
 * `execution_offered` was routed to the Action Plan. The first reason was that
 * `read.ts` fixed `executableStep` at null, so the candidate could not arise;
 * the resolver is read now and it can. The second reason was the *decision*:
 * `startAgentRunAction` takes a step key and a `chain` boolean — build this
 * step, or build the run of steps it heads — and those are two pieces of work
 * at two prices, so *"offering one of them here would be offering half a
 * decision at a price the founder was not shown the alternative to."*
 *
 * That is a requirement about what the surface must show, and the answer to it
 * is to show both. `AgentReadyStage` is the screen that does, `presentation`
 * drops its front door, and `AgentStartControls` is now one component rather
 * than a pair of call sites — which is what makes "the same two prices" a
 * property of the code instead of a thing two files agree about. The control
 * is `offer`.
 *
 * The five that left before it did so for three different reasons, and they
 * are worth keeping straight, because each is a different kind of "Home
 * cannot".
 *
 * The questions carry the id of what is being asked, which is the whole of
 * what answering needs. The merge does not carry an approval id — and that
 * turned out to be the wrong thing to look for: the *gates* are what travels,
 * not a button lifted out of them, and they name their own approval.
 *
 * The workspace choice was the last, and its reason was the weakest of the
 * three. The candidate names no application — true — but the list was never an
 * argument the ranking was withholding. It is a read, and Home can make it.
 *
 * The table stays. Emptiness here is a claim about today's moments, not about
 * the mechanism: the next moment whose decision genuinely lives on another
 * screen should say so honestly with a label rather than grow a control Home
 * cannot honour.
 */
const ELSEWHERE: Partial<Record<FocusCandidateKind, { label: string; section: NovaHomeSection }>> =
  {};

/**
 * Which moments are about a prepared change, and therefore decided in its gate.
 *
 * Total over the change candidates, so a sixth one fails to compile here
 * rather than quietly falling through to a link.
 *
 * ## Why this no longer carries a stage
 *
 * It used to: `validation_failed` mapped to `validate` and the other four to
 * `review`, and the block was mounted with that answer. But a candidate kind
 * cannot carry it. `review_required` and `awaiting_approval` are both
 * `review_change` here while being opposite states — the first is blocked with
 * `approval_preview_required`, meaning a preview is the founder's next move;
 * the second means everything needed in order to decide is already on screen.
 * Mapping the kind sent the first of those to the decision screen, which
 * refused and named a step that had no control on it. That is the dead end a
 * founder reached on a phone.
 *
 * `ReviewBlock` reads `change.progress.stage` instead, which is the derivation
 * that knew the difference all along. What is left here is the only question a
 * candidate kind can answer: whether this moment is about a change at all.
 */
const GATE_CANDIDATES = {
  validation_failed: true,
  merge_blocked: true,
  review_change: true,
  merge_ready: true,
  outcome_pending: true,
} as const satisfies Partial<Record<FocusCandidateKind, true>>;

function isGateCandidate(kind: FocusCandidateKind): boolean {
  return kind in GATE_CANDIDATES;
}

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

  /* A question is answered where it is asked. The candidate carries the id;
     the card that answers it takes the request and its action as props. */
  if (candidate.kind === "agent_question" || candidate.kind === "founder_input_required") {
    return { kind: "answer", founderInputRequestId: candidate.founderInputRequestId };
  }

  /* The choice is made from a list the surface reads, not from the candidate. */
  if (candidate.kind === "workspace_choice_required") return { kind: "choose" };

  /* The offer is two controls at two prices, and the block draws both. Falling
     through to `novaCandidateOption` would reach `nova.start_agent`, which is
     one of them — the half decision `ELSEWHERE` refused to make. */
  if (candidate.kind === "execution_offered") return { kind: "offer" };

  /* A change is decided through its own gates, and the candidate names it. */
  if (isGateCandidate(candidate.kind) && "preparedChangeId" in candidate) {
    return { kind: "gate", preparedChangeId: candidate.preparedChangeId };
  }

  const option = novaCandidateOption(candidate);
  if (option === null) return { kind: "none" };

  return option.control === "navigation"
    ? { kind: "navigation", option }
    : { kind: "server_action", option };
}

/**
 * What a control says, for a surface that needs one word rather than a control.
 *
 * A list of moments, a compact rail, a test that checks a screen offers what
 * the ranking said it would. Null where there is nothing to say: `none` has no
 * control, and `answer` *is* the control — the card carries its own submit, so
 * a label beside it would be a second verb for one act.
 *
 * Written once here because five surfaces were each branching on the union to
 * reach the same string, and a sixth case in the union means five files to
 * find.
 */
export function novaControlLabel(control: NovaHomeControl): string | null {
  switch (control.kind) {
    case "server_action":
    case "navigation":
      return control.option.label;
    case "elsewhere":
      return control.label;
    case "answer":
    case "gate":
    case "choose":
    case "offer":
    case "none":
      return null;
  }
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

/**
 * The working entry, from one operation reading.
 *
 * Exported because the strip polls: a client that re-read the operation and
 * then mapped it to a stage label itself would be a second projection of the
 * same facts, and the two would drift the first time a stage was renamed.
 */
export function novaWorkingEntry(working: NovaWorkingFact | null): NovaWorkingEntry | null {
  if (working === null) return null;

  const { type, view } = working;

  return {
    operationId: view.operationId,
    type,
    /*
     * The named stages, when this kind of run has them. Two of the fifteen
     * types do; the rest report a stage and no sequence, which is a true
     * answer rather than a missing one — and `progressSequenceFor` is the only
     * place that decides, so a caller cannot pick the wrong list.
     */
    sequence: progressSequenceFor(type),
    operation: view,
    stageLabel: OPERATION_STAGE_LABELS[view.stage],
    phase: operationPollPhase(view),
    shouldPoll: view.shouldPoll,
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

/**
 * Whether a candidate is about a prepared change.
 *
 * Read off the candidate's own shape rather than a second list of kinds to
 * keep in step with `ChangeCandidateKind`: every change candidate carries a
 * `preparedChangeId` and nothing else does.
 */
function isChange(candidate: FocusCandidate): boolean {
  return "preparedChangeId" in candidate;
}

export function buildNovaHomeView(focus: NovaFocus): NovaHomeView {
  /*
   * One change on screen, and a count of the rest.
   *
   * ## The pile this removes
   *
   * Nothing ages a change out of the ranking: `awaiting_approval` stays
   * `review_change` until somebody acts on it, and `merged` stays
   * `outcome_pending` until somebody runs the outcome check, which only a
   * person starts. So a month of agent runs put a month of changes in
   * `secondary`, and `secondary` renders as sentences with no controls — a
   * founder read *"There is a change waiting for you to look at."* five times
   * with nothing to say which change any of them meant. The cap at five did
   * not help: it hid the rest while still showing four sentences nobody could
   * tell apart.
   *
   * ## Why this is the view's decision and not the ranking's
   *
   * `focus.test.ts` holds a named invariant — *everything true is either
   * primary or secondary* — and it is right: the ranking must not silently
   * swallow something that is true. Collapsing there broke it. Here the same
   * decision is presentation, which is what this function already does one
   * line down by capping the list at five.
   *
   * ## What it keeps
   *
   * The domain's order, untouched: the changes arrive already sorted, so the
   * first one through is the ranking's own answer to which change matters, and
   * the non-change moments keep their positions around it. And a count, so a
   * founder with nine changes is told there are nine rather than shown one and
   * left to assume.
   */
  let changeShown = isChange(focus.primary);
  let changesWaiting = 0;
  const secondary: FocusCandidate[] = [];

  for (const candidate of focus.secondary) {
    if (!isChange(candidate)) {
      secondary.push(candidate);
      continue;
    }
    if (changeShown) {
      changesWaiting += 1;
      continue;
    }
    changeShown = true;
    secondary.push(candidate);
  }

  return {
    primary: entryFor(focus.primary),
    secondary: secondary.slice(0, NOVA_SECONDARY_LIMIT).map(entryFor),
    working: novaWorkingEntry(focus.working),
    changesWaiting,
  };
}
