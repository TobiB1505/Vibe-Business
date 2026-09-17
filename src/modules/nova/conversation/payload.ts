import { createHash } from "node:crypto";

import { ARTIFACT_KINDS, type ArtifactKind } from "../artifacts";
import { NOVA_ACTION_IDS, type NovaActionId } from "../actions";

/**
 * What Nova is given when a founder asks a question, and what she may return.
 *
 * ## The one-sentence contract
 *
 * **Vibe decides what the model may see; the model decides what to say about
 * it.** That is the difference from the voice tier, where Vibe also decides
 * every fact. This lane is allowed to *reason* over canonical project data —
 * *why is conversion the blocker*, *why Move 1 before Move 2*, *explain the
 * audit more simply* — because an eighteen-item action catalogue cannot express
 * those questions and refusing them is refusing the product
 * ([ADR 0109](../../../../docs/decisions/0109-nova-first-application-shell.md) §5).
 *
 * What it is *not* allowed is capability. No tool, no web access, no URL fetch,
 * no database handle, no service-role client, and **no say in what it reads**.
 * The pack below is assembled by deterministic Vibe code against a byte budget;
 * the model receives it and returns a shape. Removing capability, not prompt
 * wording, is what bounds prompt injection (rule 41).
 *
 * ## Why the output is a shape and not a string
 *
 * Because a reply that would be a wall of text should be a short reply and an
 * artifact beside it. So the model may point at *one* thing from a closed union
 * and propose *one* action from a closed catalogue — and both are ids, not
 * content. An id that does not resolve is dropped and the reply degrades; it
 * never becomes an unverifiable claim on screen, which is rule 45's shape
 * applied to a sentence instead of an evidence citation.
 *
 * ## Why the numbers travel twice
 *
 * The same defence the voice tier uses: `allowedNumericFacts` repeats every
 * numeral the reply may contain, and `checks.ts` rejects any digit run the
 * allowlist does not name. A model reasoning about a business is *more* tempted
 * to produce a figure than one rephrasing a sentence, not less.
 */

/**
 * One piece of canonical context, as the model sees it.
 *
 * `label` is Vibe's own word and is safe. `value` is frequently derived from a
 * customer's repository, their website or their own typing, so it reaches the
 * model inside a fenced, untrusted-labelled block and never in the system
 * prompt (rule 42).
 */
export type ConversationFact = { label: string; value: string };

/**
 * One section of the context pack.
 *
 * Sections rather than a flat list because a founder's question is usually
 * about one of them, and because the byte budget is spent section by section —
 * the audit's shape is worth more than the last three activity rows, and a flat
 * list has no way to say so.
 */
export type ConversationSection = {
  /** Vibe's own name for this part of the business. Never a table name. */
  title: string;
  facts: ConversationFact[];
};

/** One earlier turn, as context. Never as authority — see ADR 0109 §6. */
export type ConversationTurn = {
  author: "founder" | "nova";
  text: string;
};

export type NovaConversationPayload = {
  /** The founder's question. Untrusted throughout, fenced like everything else. */
  question: string;
  /** Untrusted: derived from the repository or the customer's own words. */
  productName: string | null;
  /**
   * The founder's stated goal, as a Vibe-authored label from the closed
   * `PRIMARY_GOALS` vocabulary — never their free text.
   */
  founderGoal: string | null;
  sections: ConversationSection[];
  /**
   * What happened earlier in this thread, oldest first and bounded.
   *
   * Context, so *"the second one"* and *"then let's do that"* resolve. Never
   * truth: a canonical fact is read from a canonical table on every turn, and
   * `context.ts` assembles the pack from those rather than from what was said
   * about them (ADR 0109 §6).
   */
  recentTurns: ConversationTurn[];
  /** Every numeral the reply may contain. Anything else is rejected. */
  allowedNumericFacts: string[];
  /**
   * Which artifacts exist for this project right now, as `kind` plus an
   * optional canonical row id.
   *
   * The model may point at one of these and nothing else. Offered explicitly
   * rather than left to the model to name, so *"the diff"* for a project with
   * no prepared change cannot be produced at all.
   */
  availableArtifacts: { kind: ArtifactKind; ref: string | null }[];
  /**
   * Which catalogue actions are currently offerable, with Vibe's own label.
   *
   * The same argument: a proposal is chosen from what is real now, so a model
   * cannot offer a merge on a project with nothing to merge.
   */
  availableActions: { actionId: NovaActionId; label: string }[];
};

/** Everything the model is allowed to produce. */
export type NovaConversationReply = {
  message: string;
  /** The thing worth looking at, or nothing. Validated against the payload. */
  artifact?: { kind: ArtifactKind; ref?: string | null } | null;
  /** One catalogue id, or nothing. Never an action — a control, which is pressed. */
  actionId?: NovaActionId | null;
};

/**
 * Version history.
 *
 * - v1 — the first conversation prompt. Written against the voice tier's
 *   measured failures (invented causes, invented effort judgements, invented
 *   claims of work) with the one rule that could not carry over removed: this
 *   lane **may** explain why, because that is what it is for. Unmeasured: there
 *   is no conversation eval yet, and ADR 0110 prices the operation at nothing
 *   partly because of that.
 */
export const NOVA_CONVERSATION_PROMPT_VERSION = "nova-conversation-prompt-v1";

/**
 * Everything except the prompt that decides what a reply means: the validator's
 * rules, the payload shape and the model policy. Separate from the prompt
 * version because they move for different reasons.
 */
export const NOVA_CONVERSATION_POLICY_VERSION = "nova-conversation-policy-v1";

/**
 * The domain ceiling on a reply.
 *
 * Longer than the voice tier's 700, because an explanation is longer than a
 * report and this lane exists to explain. Still a ceiling: `nova_messages.body`
 * caps at 1,200 and a reply that does not fit the row it is stored in is a
 * reply that would be truncated after being paid for.
 */
export const MAX_CONVERSATION_REPLY_CHARS = 1_200;
export const MAX_CONVERSATION_REPLY_PARAGRAPHS = 4;

/**
 * How many earlier turns travel with a question.
 *
 * Enough that a pronoun resolves — *"the second one"*, *"then let's do that"* —
 * and few enough that the pack does not grow without bound as a thread ages.
 * Six is three exchanges, which is the span a reference actually reaches back
 * over; beyond that a founder restates what they mean.
 */
export const CONVERSATION_CONTEXT_TURNS = 6;

/**
 * The longest question Vibe will send.
 *
 * `nova_messages.body`'s own ceiling, so a question that would not fit the row
 * it is recorded in is refused before it is paid for rather than after.
 */
export const MAX_QUESTION_CHARS = 1_200;

export const NOVA_CONVERSATION_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["message"],
  properties: {
    message: {
      type: "string",
      description:
        "Plain prose addressed to the founder, answering their question from the context given. No lists, no headings, no markdown.",
    },
    artifact: {
      type: ["object", "null"],
      additionalProperties: false,
      required: ["kind"],
      description:
        "The one thing from AVAILABLE ARTIFACTS worth looking at beside this answer, or null. Never something not listed there.",
      properties: {
        kind: { type: "string", enum: [...ARTIFACT_KINDS] },
        ref: { type: ["string", "null"] },
      },
    },
    actionId: {
      type: ["string", "null"],
      enum: [...NOVA_ACTION_IDS, null],
      description:
        "The one action from AVAILABLE ACTIONS the founder may want to take, or null. This proposes a control; it never runs anything.",
    },
  },
} as const;

/**
 * A stable serialization of the payload, for hashing.
 *
 * Key order is fixed here rather than left to `JSON.stringify` over an object
 * literal, for the reason `voice/payload.ts` gives: a reordered literal changes
 * the hash without changing the meaning.
 */
function canonicalPayload(payload: NovaConversationPayload): string {
  return JSON.stringify([
    payload.question,
    payload.productName,
    payload.founderGoal,
    payload.sections.map((section) => [
      section.title,
      section.facts.map((fact) => [fact.label, fact.value]),
    ]),
    payload.recentTurns.map((turn) => [turn.author, turn.text]),
    [...payload.allowedNumericFacts].sort(),
    payload.availableArtifacts.map((artifact) => [artifact.kind, artifact.ref]),
    payload.availableActions.map((action) => action.actionId),
  ]);
}

/**
 * What a turn was answered from — the **shape**, never the content.
 *
 * Stored on `nova_messages.context_hash` so a reply can be explained later
 * without putting repository or page text into a durable log (rule 43's line,
 * one layer down). It is not a reuse key: the same question asked twice is a
 * second question, because what Vibe knows has usually moved in between, which
 * is exactly why this operation has no equivalent of ADR 0086's claim.
 */
export function computeConversationContextHash(params: {
  projectId: string;
  payload: NovaConversationPayload;
  model: string;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        params.projectId,
        NOVA_CONVERSATION_PROMPT_VERSION,
        NOVA_CONVERSATION_POLICY_VERSION,
        params.model,
        canonicalPayload(params.payload),
      ]),
    )
    .digest("hex");
}
