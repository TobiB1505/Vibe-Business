/**
 * What the founder reads when the model's answer cannot be used.
 *
 * ## Never a blank turn
 *
 * The seam pilot's worst measured outcome was not a wrong answer — it was two
 * turns out of thirty-six that ended at a ceiling with **nothing said at all**
 * (ADR 0109). A founder who waited and received silence got less than one who
 * received "I could not finish this". Every path out of a turn therefore ends
 * in a sentence, and the sentences are here, written by Vibe.
 *
 * ## The model does not write these
 *
 * That is the point of them. They are reached exactly when the model's own
 * output is absent, refused or cut off, so a generated fallback would be the
 * same failure wearing an apology. They carry no number, name no internal
 * machinery, claim nothing has run, and each one says what is still available
 * rather than stopping at the bad news.
 *
 * ## One sentence about cost, deliberately absent
 *
 * None of these says "you were not charged", because a turn is unpriced and
 * saying so would teach a founder that turns are sometimes charged. When that
 * changes, this comment is where the change gets argued.
 */

export const AGENT_FALLBACK_REASONS = [
  /** A ceiling stopped the turn: model calls, tool calls, output, or the clock. */
  "budget_exhausted",
  /** The provider failed, refused, or the request was rejected. */
  "provider_failed",
  /** The model answered and the reply validator refused it. */
  "validation_rejected",
  /** The model stopped without saying anything. */
  "no_reply",
] as const;

export type AgentFallbackReason = (typeof AGENT_FALLBACK_REASONS)[number];

const FALLBACK_REPLIES: Record<AgentFallbackReason, string> = {
  budget_exhausted:
    "I could not finish working through this one, and I stopped rather than guess at a recommendation the evidence would not carry. Your Business Health and your Action Plan are both still there to look at, and asking me again is a fair thing to do.",
  provider_failed:
    "I could not get through to think this one over. Nothing about your project changed. Your Business Health and your Action Plan are both still there to look at, and asking me again in a moment usually works.",
  validation_rejected:
    "I had an answer and I was not confident enough in it to show it to you, so I am not going to. Your Business Health and your Action Plan are both still there to look at, and asking me again, or asking more narrowly, will usually get further.",
  no_reply:
    "I worked through this and did not come back with anything useful to say, which is my failing rather than a finding about your product. Your Business Health and your Action Plan are both still there to look at.",
};

export function agentFallbackReply(reason: AgentFallbackReason): string {
  return FALLBACK_REPLIES[reason];
}
