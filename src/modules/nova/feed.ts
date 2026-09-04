import type { AgentEconomicPolicy } from "../coding-agent/authorization";
import type { RetailOperationKind } from "../credits/retail";
import type { CreditUnits } from "../credits/units";
import type { ExecutionPricingClass } from "../economy/execution-class";
import type { OperationView } from "../operations/view";
import type { BusinessBrainView, BusinessStrength } from "../projects/business-brain-view";
import { strongestAreas } from "../projects/business-brain-view";
import { NOVA_ACTION_META, isOfferable } from "./actions";
import type { NovaActionControl } from "./actions";
import { novaCandidateAction } from "./focus";
import type { FocusCandidate, FocusCandidateKind, NovaActionId, NovaFocus } from "./focus";

/**
 * What Nova puts on the screen, as data.
 *
 * ## Why the words are here and not in the components
 *
 * §L's invariant for this slice is that an entry renders only from a
 * view-model value or from static copy. Holding that copy here — rather than
 * writing it into JSX — is what makes the product's language rules checkable:
 * `command-center-ui.test.ts` has to read its own source and strip comments to
 * assert that a screen never promises a deploy, because the sentences only
 * exist as markup. Nova's sentences are a table, so the same rules are
 * ordinary unit tests over values.
 *
 * ## What an entry may contain
 *
 * A value some other module derived, or a sentence written here. Never a
 * model's words: the voice layer rephrases an entry *after* it exists and is
 * refused by `checks.ts` if it says anything this table did not
 * (`voice/payload.ts`). An entry is complete without it — the template is the
 * product, and the voice is a nicety on top.
 *
 * ## What is not here yet
 *
 * §F names eleven entry types. Six are built: a message, a choice, a question,
 * progress, the audit reading and the execution offer. The other five — the
 * Move card, the product understanding, the agent's stages, the review and the
 * outcome — each render a view model that a later slice assembles, and there
 * is no caller for any of them today. Declaring them ahead of their data would
 * be five shapes nobody could fill (rule 15).
 */

/** What an action is about, so a control can be bound to the right thing. */
export type NovaActionSubject =
  | { kind: "prepared_change"; preparedChangeId: string }
  | { kind: "move"; opportunityId: string }
  | { kind: "founder_input_request"; founderInputRequestId: string }
  | { kind: "plan_step"; stepOrder: number }
  /** The whole project — a re-scan, a re-audit. */
  | { kind: "project" };

export type NovaChoiceOption = {
  actionId: NovaActionId;
  /**
   * Whether pressing this runs something or goes somewhere.
   *
   * Carried on the option because the renderer has to choose between a button
   * and a link, and guessing from the id would be a second copy of the
   * catalog's answer. `unbound` never reaches here — an option is not built
   * for one.
   */
  control: NovaActionControl;
  /** The catalog's word, never a candidate's and never a model's. */
  label: string;
  /**
   * The retail kind this charges under, for `CreditPrice` to render at
   * today's price. Null when pressing it costs nothing (rule 60).
   */
  price: RetailOperationKind | null;
  consequential: boolean;
  requiresConfirmation: boolean;
  /** What the founder is agreeing to. Present exactly when they confirm. */
  confirmationNote: string | null;
  subject: NovaActionSubject;
};

export type NovaEntry =
  /** A sentence. `aside` is something also true, not something to do. */
  | { kind: "nova.message"; id: string; text: string; emphasis: "primary" | "aside" }
  | { kind: "nova.choice"; id: string; prompt: string; options: NovaChoiceOption[] }
  /**
   * A question only the founder can answer, rendered by the existing card that
   * owns the answering. Nova carries the identity, never the answer.
   */
  | {
      kind: "nova.founder_question";
      id: string;
      founderInputRequestId: string;
      question: string;
      actionId: NovaActionId;
    }
  /** Work in flight. Named stages and no percentage, as everywhere else. */
  | { kind: "nova.progress"; id: string; operation: OperationView }
  /**
   * What the audit found, as the Business Brain already reads it.
   *
   * Carries a view model rather than prose: the score, its label and the
   * priority all come from `buildBusinessBrainView`, and Nova re-decides none
   * of them. A `null` score is `unscored` and never a zero (rule 44) — the
   * component renders it through `scoreDisplay`, which is the one function
   * that knows the difference.
   */
  | {
      kind: "nova.audit";
      id: string;
      score: number | null;
      stateLabel: string;
      summary: string | null;
      /** The first blocker, already ordered by the model that wrote it. */
      priority: { headline: string; whyItMatters: string | null } | null;
      /** How many more there are. A count, never a second list. */
      additionalPriorityCount: number;
      strengths: BusinessStrength[];
    }
  /**
   * A plan step Vibe can build, with what it would cost at most.
   *
   * The ceiling is `AgentEconomicPolicy.budget.maxCredits` and nothing else —
   * the same number `computeExecutionSpecIdentity` prices the run with. A
   * screen that showed an estimate beside a button that reserves a ceiling
   * would be showing a figure the founder is not charged, and a run that needs
   * more pauses for their decision rather than spending past it.
   */
  | {
      kind: "nova.execution_offer";
      id: string;
      stepOrder: number;
      stepTitle: string;
      /** Every step this one run would deliver, head first. Usually one. */
      memberCount: number;
      maxCredits: CreditUnits;
      pricingClass: ExecutionPricingClass;
      option: NovaChoiceOption;
    };

/**
 * One sentence per candidate, and the rules they are held to.
 *
 * Written as observations rather than promises, in the same voice the rest of
 * the product uses: what Vibe found, never what it will achieve. None of them
 * may say a change is live, safe, correct or finished, and none may explain
 * why something happened — Nova reports facts other modules established and
 * has no standing to add a cause (rules 66, 74; the same line `checks.ts`
 * holds the voice model to).
 *
 * They carry no figures for the same reason the labels do not: a number in a
 * sentence is a second copy of a fact the interface is already rendering, and
 * the two go out of step.
 */
const MESSAGE_FOR_CANDIDATE: Record<FocusCandidateKind, string> = {
  source_disconnected:
    "I have lost access to your repository, so I cannot read or change anything.",
  agent_failed: "My last attempt at building something stopped before it finished.",
  scan_failed: "My last read of your product did not finish.",
  audit_failed: "My last audit did not finish.",
  /*
   * "Has been running for" rather than "is stuck" or "has crashed": the run
   * is presumed lost from a clock, not observed to have died, and Nova says
   * only what it knows. Starting again is offered because it is the only
   * thing that can be offered — not because the first run is known to be over.
   */
  agent_stalled: "My attempt at building something has been running far longer than it should.",
  scan_stalled: "My read of your product has been running far longer than it should.",
  audit_stalled: "My audit has been running far longer than it should.",
  validation_failed: "A check on one of your changes did not pass.",
  merge_blocked: "One of your changes cannot go any further as it stands.",
  repository_read_outdated: "What I know about your code is older than your code.",
  agent_question: "I stopped part-way and need something from you.",
  founder_input_required: "The plan needs a decision only you can make.",
  workspace_choice_required:
    "There is more than one app here, and I do not know which one to work on.",
  review_change: "There is a change waiting for you to look at.",
  merge_ready: "You approved a change, and it is ready to go onto your default branch.",
  execution_offered: "There is a step here I can build.",
  outcome_pending: "A change reached your default branch. I have not looked at what changed yet.",
  plan_offered: "There is a move here without a plan behind it.",
  next_move_available: "This plan has nothing left in it that I can act on.",
  audit_outdated: "The audit behind what I am showing you is older than your product.",
  nothing_to_do: "Nothing needs you right now.",
};

/** What the control above the options asks. */
const PROMPT_FOR_CANDIDATE: Partial<Record<FocusCandidateKind, string>> = {
  merge_ready: "Move it onto your default branch?",
  execution_offered: "Want me to build it?",
  plan_offered: "Want a plan for it?",
  audit_outdated: "Run the audit again?",
};

function subjectFor(candidate: FocusCandidate): NovaActionSubject {
  switch (candidate.kind) {
    case "validation_failed":
    case "merge_blocked":
    case "review_change":
    case "merge_ready":
    case "outcome_pending":
      return { kind: "prepared_change", preparedChangeId: candidate.preparedChangeId };
    case "agent_question":
    case "founder_input_required":
      return {
        kind: "founder_input_request",
        founderInputRequestId: candidate.founderInputRequestId,
      };
    case "plan_offered":
    case "next_move_available":
      return { kind: "move", opportunityId: candidate.move.id };
    case "execution_offered":
      return { kind: "plan_step", stepOrder: candidate.stepOrder };
    case "repository_read_outdated":
    case "workspace_choice_required":
    case "audit_outdated":
    case "source_disconnected":
    case "agent_failed":
    case "scan_failed":
    case "audit_failed":
    case "agent_stalled":
    case "scan_stalled":
    case "audit_stalled":
    case "nothing_to_do":
      return { kind: "project" };
  }
}

/**
 * The control a candidate carries, or nothing.
 *
 * Nothing happens for two reasons, and both are deliberate: `nothing_to_do`
 * has no control because inventing one would be Nova manufacturing work, and
 * an id the catalog calls `unbound` has none because there is no action behind
 * it at all. Rendering a button that cannot be pressed is worse than rendering
 * no button — the founder would be left pressing it.
 */
function optionFor(candidate: FocusCandidate): NovaChoiceOption | null {
  const actionId = novaCandidateAction(candidate.kind);
  if (actionId === null || !isOfferable(actionId)) return null;

  const meta = NOVA_ACTION_META[actionId];
  return {
    actionId,
    control: meta.control,
    label: meta.label,
    price: meta.price,
    consequential: meta.consequential,
    requiresConfirmation: meta.requiresConfirmation,
    confirmationNote: meta.confirmationNote ?? null,
    subject: subjectFor(candidate),
  };
}

function entryId(prefix: string, candidate: FocusCandidate): string {
  const subject = subjectFor(candidate);
  const suffix =
    subject.kind === "prepared_change"
      ? subject.preparedChangeId
      : subject.kind === "move"
        ? subject.opportunityId
        : subject.kind === "founder_input_request"
          ? subject.founderInputRequestId
          : subject.kind === "plan_step"
            ? String(subject.stepOrder)
            : "project";

  return `${prefix}:${candidate.kind}:${suffix}`;
}

/**
 * The primary candidate, as the one to two entries that say it and offer it.
 *
 * A question is its own entry type rather than a choice, because answering one
 * is not picking an option — the existing card renders the recommendation, the
 * alternatives and the bounded free-text field, and Nova has no business
 * restating any of them.
 */
function leadEntries(candidate: FocusCandidate): NovaEntry[] {
  const message: NovaEntry = {
    kind: "nova.message",
    id: entryId("message", candidate),
    text: MESSAGE_FOR_CANDIDATE[candidate.kind],
    emphasis: "primary",
  };

  if (candidate.kind === "agent_question" || candidate.kind === "founder_input_required") {
    const actionId = novaCandidateAction(candidate.kind);
    if (actionId === null) return [message];
    return [
      message,
      {
        kind: "nova.founder_question",
        id: entryId("question", candidate),
        founderInputRequestId: candidate.founderInputRequestId,
        question: candidate.question,
        actionId,
      },
    ];
  }

  const option = optionFor(candidate);
  if (option === null) return [message];

  return [
    message,
    {
      kind: "nova.choice",
      id: entryId("choice", candidate),
      prompt: PROMPT_FOR_CANDIDATE[candidate.kind] ?? "",
      options: [option],
    },
  ];
}

/**
 * The audit, as one entry.
 *
 * Every field is lifted from a view model that already exists. The one
 * decision here is what to leave out: the nine lens nodes, the relationship
 * graph and the evidence trails are the Business Health surface\'s job, and
 * repeating them in a feed would make Nova a second, smaller version of the
 * page she is supposed to send a founder to.
 */
export function buildNovaAuditEntry(
  view: BusinessBrainView,
  synthesis: Parameters<typeof strongestAreas>[0],
): Extract<NovaEntry, { kind: "nova.audit" }> {
  return {
    kind: "nova.audit",
    id: "audit",
    score: view.overall.score,
    stateLabel: view.overall.stateLabel,
    summary: view.overall.summary,
    priority: view.primaryPriority
      ? {
          headline: view.primaryPriority.headline,
          whyItMatters: view.primaryPriority.whyItMatters,
        }
      : null,
    additionalPriorityCount: view.additionalPriorityCount,
    strengths: strongestAreas(synthesis),
  };
}

/**
 * The offer to build one step, priced by the function that will charge for it.
 *
 * §L\'s invariant for this slice, and the reason the ceiling is passed in
 * rather than recomputed: `resolveRouteAgentEconomics` is what the spec
 * builder uses, so taking `budget.maxCredits` from its result is the only way
 * the number on the button and the number reserved are the same number. A
 * second calculation here would be a second price.
 *
 * Returns null when the economics do not resolve — a step with no pricing
 * class is one Vibe cannot price, and an offer with no ceiling is a button
 * whose cost nobody can state (rule 60).
 */
export function buildNovaExecutionOffer(params: {
  stepOrder: number;
  stepTitle: string;
  memberCount: number;
  pricingClass: ExecutionPricingClass;
  economics: AgentEconomicPolicy | null;
}): Extract<NovaEntry, { kind: "nova.execution_offer" }> | null {
  if (params.economics === null) return null;

  const meta = NOVA_ACTION_META["nova.start_agent"];
  return {
    kind: "nova.execution_offer",
    id: `execution-offer:${params.stepOrder}`,
    stepOrder: params.stepOrder,
    stepTitle: params.stepTitle,
    memberCount: params.memberCount,
    maxCredits: params.economics.budget.maxCredits,
    pricingClass: params.pricingClass,
    option: {
      actionId: "nova.start_agent",
      control: meta.control,
      label: meta.label,
      price: meta.price,
      consequential: meta.consequential,
      requiresConfirmation: meta.requiresConfirmation,
      confirmationNote: meta.confirmationNote ?? null,
      subject: { kind: "plan_step", stepOrder: params.stepOrder },
    },
  };
}

/**
 * The whole feed, in the order it is read.
 *
 * What needs the founder first, then the control for it, then whatever is
 * running, then the things that are also true. The asides carry no controls:
 * they exist so that a second true thing is not silently unreachable — which
 * is the entire reason the focus is a ranking — and giving each one a button
 * would recreate the wall of choices Nova exists to replace.
 */
export function buildNovaFeed(focus: NovaFocus): NovaEntry[] {
  const entries: NovaEntry[] = [...leadEntries(focus.primary)];

  if (focus.working !== null) {
    entries.push({
      kind: "nova.progress",
      id: `progress:${focus.working.operationId}`,
      operation: focus.working,
    });
  }

  for (const candidate of focus.secondary) {
    entries.push({
      kind: "nova.message",
      id: entryId("aside", candidate),
      text: MESSAGE_FOR_CANDIDATE[candidate.kind],
      emphasis: "aside",
    });
  }

  return entries;
}
