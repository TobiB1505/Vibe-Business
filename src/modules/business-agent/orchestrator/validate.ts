import { findCausalClaims } from "@/modules/business-measurement/causality";
import {
  ALWAYS_BANNED_CLAIMS,
  BANNED_MODULE_NAMES,
  findUnnegated,
  numeralsIn,
} from "@/modules/nova/voice/checks";
import {
  MAX_AGENT_REPLY_CHARS,
  MAX_AGENT_REPLY_PARAGRAPHS,
  MIN_AGENT_REPLY_CHARS,
} from "./budgets";

/**
 * What Vibe refuses to show a founder, whatever the model wrote.
 *
 * ## Why this exists beside an evaluation
 *
 * The same argument `nova/voice/checks.ts` makes, and for the same reason: a
 * passing eval says the prompt is good enough to ship, and says nothing at all
 * about the next reply. Ten cases cannot bound a rate. This file is what makes
 * the guarantee on every turn, forever, and it is the third leg of rule 41's
 * triple — the tool set is absent, the identifiers are resolved server-side,
 * and the reply is refused here before anyone reads it.
 *
 * ## Why it is not `checkNovaMessage`
 *
 * Most of it is, and the shared halves are imported rather than copied: the
 * banned-claim list, the module vocabulary, the numeral scan, the negation
 * window, the causal detector. What differs is everything the voice operation
 * does not have. A voice message answers from a payload Vibe assembled, so its
 * allowed numerals are known before the call. A turn answers from tool results
 * the model chose to fetch, so the allowed numerals are whatever *this turn*
 * actually read — which means the validator has to be handed the turn, not a
 * payload. The same is true of artifacts: a reply may point at a Move only if a
 * tool returned that Move's id in this turn.
 *
 * ## Precision over recall, deliberately
 *
 * Every rule here is one a correct reply cannot trip, because the cost is
 * asymmetric: a false refusal costs a better sentence, and a false acceptance
 * costs a false statement to a founder. The fallback is always a Vibe-authored
 * template, never silence.
 */

export const AGENT_REPLY_FAILURES = [
  "empty_reply",
  "too_long",
  "too_many_paragraphs",
  /** Lists, headings, code fences — the thread renders prose. */
  "markdown_structure",
  /** A numeral no tool result and no founder message supplied. */
  "unallowed_number",
  /** A claim this product is never in a position to make. */
  "banned_claim",
  /** "caused", "led to", "thanks to" — reuses the measurement detector. */
  "causal_claim",
  /** Vibe's own module vocabulary reached the founder. */
  "module_name",
  /** "I started it", "I merged it" — an act no tool in this registry can perform. */
  "claimed_action",
  /** A Move or plan this turn never read. */
  "unreferenced_artifact",
  /** The injected instruction's own words came back out. */
  "forbidden_content",
] as const;

export type AgentReplyFailureCode = (typeof AGENT_REPLY_FAILURES)[number];

export type AgentReplyFinding = { code: AgentReplyFailureCode; detail: string };

export type AgentReplyCheck = { ok: boolean; failures: AgentReplyFinding[] };

/**
 * Sentences that claim Vibe did something no tool can do.
 *
 * These are not in `ALWAYS_BANNED_CLAIMS` because they are not always false of
 * the *product* — Vibe genuinely starts runs and merges branches. They are
 * always false of a **turn**, because the turn's registry holds no tool that
 * acts. The founder presses; the agent describes. A reply that says otherwise
 * has told a founder their work is underway when nothing is.
 */
export const CLAIMED_ACTION_PHRASES = [
  "i've started",
  "i have started",
  "i started",
  "i've kicked off",
  "i kicked off",
  "i've run",
  "i ran",
  "i've merged",
  "i merged",
  "i've deployed",
  "i deployed",
  "i've approved",
  "i approved",
  "is now running",
  "has been started",
  "is running now",
  "i've begun",
  "i began",
] as const;

export type AgentReplyContext = {
  reply: string;
  /**
   * Every numeral this turn is entitled to write: those the tool results
   * carried, plus those the founder used in their own question. A founder who
   * asks about "step 2" must be answerable about step 2.
   */
  allowedNumericFacts: readonly string[];
  /** Subject ids any tool returned this turn. A reference outside this set is refused. */
  referencedSubjectIds: readonly string[];
  /** Subject ids the reply's artifact references claim. */
  claimedSubjectIds: readonly string[];
  /** Strings that would be false in this exact state, including an injection's payload. */
  forbiddenSubstrings?: readonly string[];
};

function paragraphsOf(message: string): string[] {
  return message
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
}

export function checkAgentReply(context: AgentReplyContext): AgentReplyCheck {
  const failures: AgentReplyFinding[] = [];
  const trimmed = (context.reply ?? "").trim();
  const normalized = trimmed.toLowerCase().replace(/\s+/g, " ");

  if (trimmed.length < MIN_AGENT_REPLY_CHARS) {
    failures.push({
      code: "empty_reply",
      detail: `${trimmed.length} characters, minimum ${MIN_AGENT_REPLY_CHARS}`,
    });
    // Everything below reads the reply as prose. There is none.
    return { ok: false, failures };
  }

  if (trimmed.length > MAX_AGENT_REPLY_CHARS) {
    failures.push({
      code: "too_long",
      detail: `${trimmed.length} characters, maximum ${MAX_AGENT_REPLY_CHARS}`,
    });
  }

  const paragraphs = paragraphsOf(trimmed);
  if (paragraphs.length > MAX_AGENT_REPLY_PARAGRAPHS) {
    failures.push({
      code: "too_many_paragraphs",
      detail: `${paragraphs.length} paragraphs, maximum ${MAX_AGENT_REPLY_PARAGRAPHS}`,
    });
  }

  if (/^\s*[-*+]\s/m.test(trimmed) || /^#{1,6}\s/m.test(trimmed) || trimmed.includes("```")) {
    failures.push({ code: "markdown_structure", detail: "list, heading or code fence" });
  }

  const allowed = new Set(context.allowedNumericFacts);
  for (const numeral of numeralsIn(trimmed)) {
    if (!allowed.has(numeral)) failures.push({ code: "unallowed_number", detail: numeral });
  }

  for (const claim of findUnnegated(normalized, ALWAYS_BANNED_CLAIMS)) {
    failures.push({ code: "banned_claim", detail: claim });
  }

  for (const claim of findUnnegated(normalized, CLAIMED_ACTION_PHRASES)) {
    failures.push({ code: "claimed_action", detail: claim });
  }

  for (const claim of findCausalClaims(trimmed)) {
    failures.push({ code: "causal_claim", detail: claim });
  }

  for (const name of BANNED_MODULE_NAMES) {
    if (normalized.includes(name)) failures.push({ code: "module_name", detail: name });
  }

  const readThisTurn = new Set(context.referencedSubjectIds);
  for (const claimed of context.claimedSubjectIds) {
    if (!readThisTurn.has(claimed)) {
      failures.push({ code: "unreferenced_artifact", detail: claimed });
    }
  }

  for (const forbidden of context.forbiddenSubstrings ?? []) {
    if (normalized.includes(forbidden.toLowerCase().replace(/\s+/g, " "))) {
      failures.push({ code: "forbidden_content", detail: forbidden });
    }
  }

  return { ok: failures.length === 0, failures };
}
