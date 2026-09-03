import { createHash } from "node:crypto";

/**
 * What Nova's voice is given, and what it may return.
 *
 * ## The one-sentence contract
 *
 * Vibe decides every fact; the model chooses the sentences that carry them.
 * The payload is therefore small on purpose — a few hundred tokens of already-
 * decided state — and the output is one string. There is no field on
 * `NovaPresentation` through which a model could name a control, a price, a
 * repository path, a Move, or an operation to start: those all live on the
 * Vibe-owned side of the feed entry and never pass through inference at all.
 *
 * ## Why the numbers travel twice
 *
 * `facts` carries values as text, and `allowedNumericFacts` repeats every
 * numeral the message is permitted to contain. That redundancy is the whole
 * defence against a fabricated figure: `checks.ts` rejects any digit run the
 * allowlist does not name, so "160 Credits" cannot survive a payload that says
 * 150. It is the same shape as the audit's evidence-id allowlist — a model may
 * cite what it was given and nothing else — rather than a heuristic that tries
 * to guess which numbers were invented.
 *
 * The stronger version of the rule is a UI decision rather than a validator
 * one: a figure a founder acts on (a score, a Credit ceiling, a changed-file
 * count) should be rendered from state beside the prose, not quoted inside it.
 * `allowedNumericFacts` then stays near-empty and the check has almost nothing
 * to catch.
 */

export const NOVA_VOICE_SLOTS = [
  /** "Here is what I understood about your product." */
  "product_reveal",
  /** "I finished your audit; here is what matters first." */
  "audit_result",
  /** "This is where I would start, and why." */
  "move_recommendation",
  /** "One thing only you can answer." */
  "founder_question",
  /** "I finished preparing the change." */
  "execution_result",
  /** "It is merged; here is what became observable." */
  "outcome_result",
] as const;

export type NovaVoiceSlot = (typeof NOVA_VOICE_SLOTS)[number];

/**
 * One already-decided fact.
 *
 * `label` is Vibe's own word for the fact and is safe. `value` is frequently
 * derived from a customer's repository, website, or their own typing, and is
 * therefore untrusted data that reaches the model inside a fenced block —
 * never in the system prompt (rule 42).
 */
export type NovaVoiceFact = { label: string; value: string };

export type NovaVoicePayload = {
  slot: NovaVoiceSlot;
  /** Untrusted: derived from the repository or the customer's own words. */
  productName: string | null;
  /**
   * The founder's stated goal, as a Vibe-authored label from the closed
   * `PRIMARY_GOALS` vocabulary — never their free text.
   */
  founderGoal: string | null;
  facts: NovaVoiceFact[];
  /** Every numeral the message may contain. Anything else is rejected. */
  allowedNumericFacts: string[];
  /**
   * How sure Vibe is of the facts, when that is a thing it knows.
   *
   * `low` obliges Nova to hedge; `null` means the question does not apply to
   * this slot rather than that confidence is high.
   */
  confidence: "high" | "low" | null;
  /**
   * What happens next, in Vibe's words.
   *
   * Nova may lead into it. Nova may not rename it, price it, or invent a
   * different one — the control itself is rendered from this string and its
   * action id, both of which stay outside the model's reach.
   */
  nextStep: string;
};

/** Everything the model is allowed to produce. */
export type NovaPresentation = { message: string };

export const NOVA_VOICE_PROMPT_VERSION = "nova-voice-prompt-v1";

/**
 * The version of everything *except* the prompt that decides what a message
 * means: the validator's rules, the payload shape, and the model policy.
 *
 * Separate from the prompt version because they move for different reasons and
 * a stored message has to be invalidated by either.
 */
export const NOVA_VOICE_POLICY_VERSION = "nova-voice-policy-v1";

/** The domain ceiling. The transport ceiling is `maxOutputTokens`. */
export const MAX_NOVA_MESSAGE_CHARS = 700;
export const MAX_NOVA_MESSAGE_PARAGRAPHS = 3;
/** Below this, a "message" is not one — see `empty_message` in `checks.ts`. */
export const MIN_NOVA_MESSAGE_CHARS = 20;

export const NOVA_PRESENTATION_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["message"],
  properties: {
    message: {
      type: "string",
      description:
        "One to three short paragraphs of plain prose addressed to the founder. No lists, no headings, no markdown.",
    },
  },
} as const;

/**
 * A stable serialization of the payload, for hashing.
 *
 * Key order is fixed here rather than left to `JSON.stringify` over an object
 * literal, because the cache identity below is only as reliable as this
 * function is deterministic — and a reordered object literal is exactly the
 * kind of edit that silently halves a cache hit rate.
 */
export function canonicalPayload(payload: NovaVoicePayload): string {
  return JSON.stringify([
    payload.slot,
    payload.productName,
    payload.founderGoal,
    payload.facts.map((fact) => [fact.label, fact.value]),
    [...payload.allowedNumericFacts],
    payload.confidence,
    payload.nextStep,
  ]);
}

/**
 * What makes two Nova messages the same message (rule 48).
 *
 * Four things, and the last three are the reason this is not just a payload
 * hash. The prompt version is in it so that improving Nova's personality does
 * not silently keep serving her old sentences; the policy version so that a
 * validator or payload change does the same; the model so that a model swap
 * is a new message rather than a reused one. Exactly the shape the audit and
 * the plan already hash their own inputs with — nothing new is being invented
 * here, it is the same rule applied to a cheaper call.
 *
 * A message stored under a superseded identity is history, not a cache miss:
 * it stays readable, and whether it is regenerated is a decision, not an
 * accident.
 */
export function computeNovaVoiceIdentity(params: {
  payload: NovaVoicePayload;
  model: string;
  promptVersion?: string;
  policyVersion?: string;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        canonicalPayload(params.payload),
        params.promptVersion ?? NOVA_VOICE_PROMPT_VERSION,
        params.policyVersion ?? NOVA_VOICE_POLICY_VERSION,
        params.model,
      ]),
    )
    .digest("hex");
}
