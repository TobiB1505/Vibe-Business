import { NOVA_ACTION_META, type NovaActionId } from "../actions";
import { ARTIFACT_KINDS, type ArtifactKind } from "../artifacts";

/**
 * What a founder's sentence means, decided without a model.
 *
 * ## Why deterministic, and why first
 *
 * The restructure audit's §E.3: *"Deterministic resolution over the
 * catalogue's own labels and subjects ships first; a classifier is an
 * `ai/operations.ts` entry or it does not exist."* Two reasons, and the second
 * is the one that matters.
 *
 * It is **cheap and instant**, so *"merge it"* does not wait on a provider. And
 * it is **inspectable**: when it resolves, a person can say exactly why, which
 * is a property no classifier has and which matters most for the sentences that
 * end in a press.
 *
 * ## What it is not
 *
 * A parser, a grammar or an NLU layer. It matches a founder's words against
 * **the product's own vocabulary** — the labels `NOVA_ACTION_META` already
 * carries and the artifact kinds `artifacts.ts` already names — because those
 * are the words the interface has been showing them. A founder who reads a
 * button called *"Merge it"* and types *"merge it"* is not being understood by
 * a language model; they are being taken at their word.
 *
 * ## `cannot` is a real answer
 *
 * Most sentences are questions, and a question resolves to nothing here and
 * goes to the conversation lane. That is the common case and it is not a
 * failure. What this must never do is guess: an unclear sentence that resolved
 * to `nova.merge_change` would put a consequential control in front of somebody
 * who asked something else.
 */

export type NovaIntent =
  /** One catalogue action. The surface renders its existing control. */
  | { kind: "action"; actionId: NovaActionId }
  /** Show something. A read, so it may follow a resolved intent directly. */
  | { kind: "artifact"; artifact: ArtifactKind }
  /** Nothing matched. The conversation lane answers. */
  | { kind: "none" };

/**
 * The phrases each action answers to, beyond its own label.
 *
 * Deliberately short lists of things a founder actually types, not synonym
 * expansion. Every entry is either the control's own label or a phrase a
 * founder would use having read it — and an entry that is a *question* is
 * wrong here, because a question belongs to the conversation lane.
 *
 * Total over the catalogue, so a nineteenth action has to decide whether it can
 * be asked for in words. `[]` is a real answer: the four onboarding controls
 * are beats in a choreography rather than things a founder asks for, and
 * `nova.answer_plan_question` is answered in the card that asks it.
 */
const PHRASES: Record<NovaActionId, readonly string[]> = {
  "nova.continue_introduction": [],
  "nova.explain_workflow": [],
  "nova.skip_workflow": [],
  "nova.begin_setup": [],
  "nova.confirm_product": [],
  "nova.confirm_product_and_audit": [],
  "nova.reconnect_source": ["reconnect", "reconnect github", "connect github again"],
  "nova.validate_again": ["validate again", "run the checks again", "re-run the checks"],
  "nova.review_change": ["review the change", "show me the change", "look at the change"],
  "nova.merge_change": ["merge it", "merge the change", "ship it", "apply the change"],
  "nova.answer_plan_question": [],
  "nova.answer_agent_question": [],
  "nova.choose_workspace": ["choose the app", "pick the application"],
  "nova.rescan_product": [
    "scan again",
    "rescan",
    "re-scan the product",
    "look at my product again",
  ],
  "nova.start_agent": ["build it", "start building", "let the agent do it", "run the agent"],
  "nova.verify_outcome": ["check the outcome", "verify the outcome", "did it work"],
  "nova.plan_move": ["plan it", "plan this move", "make a plan for it"],
  "nova.view_move": ["show me the move", "open the move"],
  "nova.refresh_audit": [
    "run the audit again",
    "re-run the audit",
    "audit again",
    "refresh the audit",
  ],
};

/**
 * The phrases each artifact answers to.
 *
 * Opening something is a **read** and has no consequence, which is why it may
 * follow a resolved intent directly rather than waiting for a press (ADR 0109
 * §5). Total over the union for the same reason as above.
 */
const ARTIFACT_PHRASES: Record<ArtifactKind, readonly string[]> = {
  business_health: ["show me the audit", "open the audit", "business health", "show the diagnosis"],
  product: ["show me my product", "open my product", "what do you know about my product"],
  opportunity: ["show me the move", "open the move"],
  action_plan: ["show me the plan", "open the plan", "the action plan"],
  agent_execution: ["show me the run", "open the agent", "what is the agent doing"],
  prepared_change: ["show me the change", "open the change", "the diff"],
  experiment: ["show me the results", "open experiments", "what changed"],
  founder_input: ["show me the question", "open the question"],
};

/**
 * Labels to actions, with every ambiguous one removed.
 *
 * A label is not a unique key across the catalogue, and this repository has
 * already been bitten by treating one as one — `migration-test-support.ts`
 * records the same lesson about a column name. Two actions are labelled
 * **Answer**: `nova.answer_plan_question` and `nova.answer_agent_question`,
 * which are different questions on different screens.
 *
 * So a shared label resolves to **nothing**. Picking either would be the
 * resolver guessing, which is the one thing it must not do — and both of those
 * are answered in the card that asks them, where the founder has the question
 * in front of them, so nothing is lost.
 */
function unambiguousLabels(offerable: readonly NovaActionId[]): Map<string, NovaActionId> {
  const seen = new Map<string, NovaActionId | null>();

  for (const actionId of offerable) {
    if (!(actionId in NOVA_ACTION_META)) continue;

    const label = normalize(NOVA_ACTION_META[actionId].label);
    if (label.length === 0) continue;

    seen.set(label, seen.has(label) ? null : actionId);
  }

  return new Map(
    [...seen].flatMap(([label, actionId]) => (actionId === null ? [] : [[label, actionId]])),
  );
}

/** Collapsed to what a comparison can be about: words, lowercase, no punctuation. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * How long a sentence may be and still be read as an instruction.
 *
 * A founder telling Nova to do something is short — *"merge it"*, *"run the
 * audit again"*. Past this, they are explaining, comparing or asking, and a
 * phrase match inside a paragraph is a coincidence rather than an instruction.
 * *"I don't want to merge it until I understand why the checks flagged that
 * file"* contains "merge it" and means the opposite.
 */
const MAX_INSTRUCTION_WORDS = 8;

/**
 * Sentences that contain a phrase and are not instructions.
 *
 * A question about an action is a question. This is the cheap half of that
 * rule; the length cap above is the other half, and neither alone is enough —
 * *"should I merge it?"* is four words.
 */
const QUESTION_OPENERS = [
  "what",
  "why",
  "how",
  "when",
  "who",
  "which",
  "where",
  "should",
  "could",
  "would",
  "can",
  "is",
  "are",
  "do",
  "does",
  "did",
  "explain",
  "tell me",
  "help me understand",
] as const;

function isQuestion(normalized: string, raw: string): boolean {
  if (raw.trim().endsWith("?")) return true;
  return QUESTION_OPENERS.some(
    (opener) => normalized === opener || normalized.startsWith(`${opener} `),
  );
}

/**
 * Resolve a founder's sentence, or decline to.
 *
 * `offerable` is what the project can actually do right now — the same list the
 * ranking builds its controls from. Matching against the whole catalogue would
 * resolve *"merge it"* on a project with nothing prepared, and put a control in
 * front of a founder that the server would refuse: the dead end `home-view.ts`
 * records reaching twice.
 */
export function resolveNovaIntent(params: {
  text: string;
  offerable: readonly NovaActionId[];
  available: readonly ArtifactKind[];
}): NovaIntent {
  const normalized = normalize(params.text);
  if (normalized.length === 0) return { kind: "none" };

  if (isQuestion(normalized, params.text)) return { kind: "none" };
  if (normalized.split(" ").length > MAX_INSTRUCTION_WORDS) return { kind: "none" };

  /*
   * Actions before artifacts. "show me the change" is an artifact and "merge
   * it" is an action, and where a phrase could be read either way — "show me
   * the move" is in both tables — the founder is asking to look, so the
   * artifact list is checked against the *exact* sentence and the action list
   * against a contained phrase. Doing actions first with containment would let
   * a longer sentence about looking resolve to something that spends money.
   */
  const byLabel = unambiguousLabels(params.offerable);

  const labelled = byLabel.get(normalized);
  if (labelled !== undefined) return { kind: "action", actionId: labelled };

  for (const actionId of params.offerable) {
    if (!(actionId in NOVA_ACTION_META)) continue;

    if (PHRASES[actionId].some((phrase) => normalized === normalize(phrase))) {
      return { kind: "action", actionId };
    }
  }

  for (const artifact of params.available) {
    if (!(ARTIFACT_KINDS as readonly string[]).includes(artifact)) continue;

    if (ARTIFACT_PHRASES[artifact].some((phrase) => normalized === normalize(phrase))) {
      return { kind: "artifact", artifact };
    }
  }

  return { kind: "none" };
}
