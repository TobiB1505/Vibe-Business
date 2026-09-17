import type { TurnRefusal } from "./store";

/**
 * What a founder is told when the transcript refuses a turn.
 *
 * ## Why these are sentences and not error codes
 *
 * Every one of the four is reachable by an ordinary person doing an ordinary
 * thing — pressing send twice, coming back to a tab whose thread they archived
 * somewhere else, following a link to a conversation that has since been
 * deleted. None of them is a fault, so none of them is a 500, and a founder who
 * meets one is owed the same courtesy `limits.ts` gives a founder who meets a
 * bound: what happened, and what to do instead.
 *
 * ## Why they live in the domain and not in the command
 *
 * Because there will be a second caller. `askNovaAction` is the only one today;
 * *New chat* and the thread screen both write turns in the same shape, and a
 * sentence invented per surface is how two screens come to describe one refusal
 * differently. The same argument `THREAD_EVENT_WORDS` makes one file over.
 *
 * Nothing here says which *binding* failed in any more detail than the founder
 * needs — `thread_not_found` is deliberately the same sentence a deleted thread
 * gets, because from outside, "not yours" and "not there" are one answer.
 */
export const TURN_REFUSAL_MESSAGES: Record<TurnRefusal, string> = {
  thread_not_found:
    "I could not find that conversation. It may have been deleted — open your product and I will start a new one.",
  thread_archived:
    "That conversation is archived, so I have left it as it was. Start a new one and I will answer there.",
  turn_duplicate: "You have already asked me that one — my answer is just above.",
  turn_incomplete: "Ask me something and I will answer from what I know.",
};

export function turnRefusalMessage(reason: TurnRefusal): string {
  return TURN_REFUSAL_MESSAGES[reason];
}
