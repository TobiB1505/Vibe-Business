import type { BusinessBrainView } from "../../projects/business-brain-view";
import type { UnderstandingView } from "../../product-understanding/view";
import type { NovaHomeView } from "../home-view";
import { artifactForEntry, type ArtifactKind } from "../artifacts";
import { NOVA_ACTION_META, type NovaActionId } from "../actions";
import {
  CONVERSATION_CONTEXT_TURNS,
  type ConversationFact,
  type ConversationSection,
  type ConversationTurn,
  type NovaConversationPayload,
} from "./payload";
import { numeralsIn } from "../voice/checks";

/**
 * What the model may see, decided by Vibe and by nothing else.
 *
 * ## Why this is pure, and why that is the security property
 *
 * The model has **no say in what it reads**
 * ([ADR 0109](../../../../docs/decisions/0109-nova-first-application-shell.md) §5).
 * That claim is only worth something if context assembly is code a person can
 * read end to end — so this takes view models the caller already read and
 * returns a pack. It holds no database handle, makes no query, and cannot be
 * made to fetch anything by a sentence in a repository.
 *
 * The reads themselves are composed one layer up, in the feature, from the same
 * module functions every screen uses. Which means a founder's conversation sees
 * exactly what their screens see: no more, and never something assembled for
 * the model's benefit.
 *
 * ## Why the numeric allowlist is derived rather than curated
 *
 * Every numeral that appears in a fact the model was given is a numeral it may
 * repeat, and a numeral that appears nowhere in the pack is one it invented.
 * Deriving the list from the pack makes those two statements the same
 * statement — where a hand-written list would drift, and drift in the direction
 * of refusing true figures, which is how a validator gets switched off.
 *
 * The stronger version of the rule is still the UI one `voice/payload.ts`
 * records: a figure a founder acts on should be rendered from state beside the
 * prose rather than quoted inside it.
 *
 * ## The budget
 *
 * Sections are added in priority order and the pack stops when it is full.
 * "Full" is characters rather than tokens, because a token count needs the
 * provider and this runs before one is reached — `service.ts` counts properly
 * and refuses over budget, so this only has to make that refusal rare.
 */

/**
 * How many characters of facts travel with a question.
 *
 * `NOVA_CONVERSATION_CONFIG.maxInputTokens` is 12,000, and English runs about
 * four characters to the token — so 24,000 characters of facts leaves ample
 * room for the prompt, the turns and the lists beside them. A pack that hits
 * this is one the founder can still get an answer from; a pack that hits the
 * provider's own ceiling is a refusal.
 */
export const MAX_CONTEXT_CHARS = 24_000;

/** The longest one fact may be before it is cut. */
const MAX_FACT_CHARS = 400;

function fact(label: string, value: string | number | null | undefined): ConversationFact | null {
  if (value === null || value === undefined) return null;

  const text = String(value).trim();
  if (text.length === 0) return null;

  return { label, value: text.slice(0, MAX_FACT_CHARS) };
}

function section(title: string, facts: (ConversationFact | null)[]): ConversationSection | null {
  const kept = facts.filter((entry): entry is ConversationFact => entry !== null);
  return kept.length === 0 ? null : { title, facts: kept };
}

export type ConversationContextInput = {
  question: string;
  productName: string | null;
  founderGoal: string | null;
  /** The ranking, which is where the moments and their controls come from. */
  home: NovaHomeView;
  /** The business reading, when one has been made. */
  audit: BusinessBrainView | null;
  /** What Vibe understands the product to be, when it has read it. */
  understanding: UnderstandingView | null;
  /** The thread so far, oldest first. Bounded here, not by the caller. */
  turns: readonly ConversationTurn[];
};

export function buildConversationPayload(input: ConversationContextInput): NovaConversationPayload {
  const sections = [
    auditSection(input.audit),
    productSection(input.understanding),
    attentionSection(input.home),
  ].filter((entry): entry is ConversationSection => entry !== null);

  const bounded = withinBudget(sections);

  return {
    question: input.question,
    productName: input.productName,
    founderGoal: input.founderGoal,
    sections: bounded,
    recentTurns: input.turns.slice(-CONVERSATION_CONTEXT_TURNS),
    allowedNumericFacts: numeralsFrom(bounded),
    availableArtifacts: availableArtifacts(input.home),
    availableActions: availableActions(input.home),
  };
}

/**
 * The business reading, as the founder's own screens state it.
 *
 * `null` is carried as the word rather than omitted, because *"I have not been
 * able to score that"* is an answer and silence is not — and because `null` is
 * never zero (rule 44), which is the thing a model reasoning about a score is
 * most likely to get wrong.
 */
function auditSection(audit: BusinessBrainView | null): ConversationSection | null {
  if (audit === null) return null;

  const lenses = audit.nodes.map((node) =>
    fact(
      node.label,
      node.score === null
        ? `not scored — ${node.healthLabel}`
        : `${node.score} (${node.healthLabel}, ${node.priorityLabel})`,
    ),
  );

  return section("Business reading", [
    fact(
      "overall",
      audit.overall.score === null
        ? `not scored — ${audit.overall.insufficientCoverageReason ?? audit.overall.stateLabel}`
        : `${audit.overall.score} (${audit.overall.stateLabel})`,
    ),
    fact("areas scored", `${audit.overall.scoredLenses} of ${audit.overall.eligibleLenses}`),
    fact("summary", audit.overall.summary),
    fact("biggest blocker", audit.primaryPriority?.headline),
    fact("why it blocks", audit.primaryPriority?.whyItMatters),
    ...audit.priorities.slice(1, 4).map((priority) => fact("also blocking", priority.headline)),
    ...lenses,
  ]);
}

function productSection(understanding: UnderstandingView | null): ConversationSection | null {
  if (understanding === null) return null;

  return section("What Vibe understands the product to be", [
    fact("name", understanding.headline.productName),
    fact("category", understanding.headline.category),
    fact("what it is", understanding.headline.understanding),
    ...understanding.audience.slice(0, 3).map((entry) => fact(entry.label, entry.value)),
    ...understanding.capabilities
      .slice(0, 6)
      .map((line, index) => fact(`can ${index + 1}`, line.label)),
    ...understanding.limitations
      .slice(0, 3)
      .map((line, index) => fact(`not seen ${index + 1}`, line)),
  ]);
}

/**
 * What is waiting on the founder, in the ranking's own words.
 *
 * The moments rather than the rows behind them: `buildNovaHomeView` has already
 * decided which of twenty-one situations lead, and a second opinion assembled
 * for the model would be a second ranking nobody could reconcile with the
 * screen.
 */
function attentionSection(home: NovaHomeView): ConversationSection | null {
  const entries = [home.primary, ...home.secondary];

  return section("What is waiting on you", [
    ...entries.flatMap((entry) => [
      fact("waiting", entry.message),
      entry.detail === null ? null : fact("about it", entry.detail),
    ]),
  ]);
}

/** Sections, in priority order, until the budget is spent. */
function withinBudget(sections: ConversationSection[]): ConversationSection[] {
  const kept: ConversationSection[] = [];
  let spent = 0;

  for (const entry of sections) {
    const size = entry.facts.reduce(
      (total, item) => total + item.label.length + item.value.length + 2,
      entry.title.length,
    );

    if (spent + size > MAX_CONTEXT_CHARS) continue;
    kept.push(entry);
    spent += size;
  }

  return kept;
}

/**
 * Every numeral in the pack, and therefore every numeral the reply may contain.
 *
 * Derived rather than curated — see the module docblock. `checks.ts` rejects
 * any digit run this does not name.
 */
function numeralsFrom(sections: readonly ConversationSection[]): string[] {
  /*
   * Values only. A label is Vibe's own word and is never a figure a founder
   * acts on, so a numeral in one would widen the allowlist without any fact
   * standing behind it — which is the direction that matters, because a wide
   * allowlist is a validator that has quietly stopped checking.
   */
  return [
    ...new Set(sections.flatMap((entry) => entry.facts.flatMap((item) => numeralsIn(item.value)))),
  ];
}

/**
 * The artifacts this project actually has, from the moments that name them.
 *
 * `artifactForEntry` is the same chain the thread's blocks use, so the things a
 * founder can be pointed at in conversation and the things they can open from a
 * block are the same set by construction rather than by agreement.
 */
function availableArtifacts(home: NovaHomeView): { kind: ArtifactKind; ref: string | null }[] {
  const seen = new Map<string, { kind: ArtifactKind; ref: string | null }>();

  for (const entry of [home.primary, ...home.secondary]) {
    const artifact = artifactForEntry(entry);
    if (artifact === null) continue;

    const ref =
      "preparedChangeId" in artifact
        ? artifact.preparedChangeId
        : "opportunityId" in artifact
          ? artifact.opportunityId
          : null;

    seen.set(`${artifact.kind}:${ref ?? ""}`, { kind: artifact.kind, ref });
  }

  return [...seen.values()];
}

/**
 * The controls the ranking is currently offering, with Vibe's own labels.
 *
 * Taken from the moments rather than from the whole catalogue, for the reason
 * `intent/resolve.ts` gives: a control offered in a state where pressing it
 * would be refused is the dead end `home-view.ts` records reaching twice.
 */
function availableActions(home: NovaHomeView): { actionId: NovaActionId; label: string }[] {
  const seen = new Map<NovaActionId, string>();

  for (const entry of [home.primary, ...home.secondary]) {
    const control = entry.control;
    if (control.kind !== "server_action" && control.kind !== "navigation") continue;

    const actionId = control.option.actionId;
    if (!(actionId in NOVA_ACTION_META)) continue;

    seen.set(actionId, NOVA_ACTION_META[actionId].label);
  }

  return [...seen].map(([actionId, label]) => ({ actionId, label }));
}
