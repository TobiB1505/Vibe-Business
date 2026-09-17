/**
 * How often a founder may ask, and what happens when they have asked enough.
 *
 * ## Why a bound at all, when the answer is free
 *
 * [ADR 0110](../../../../docs/decisions/0110-a-question-costs-nothing-and-is-bounded.md):
 * free and unbounded is the shape that ends in an incident. The unit cost of a
 * question is cents; an unbounded number of units is not. And a Credit price —
 * the mechanism that bounds every other metered inference in this product —
 * was deliberately not used, because a price on a question is a tax on
 * understanding. Something has to take its place, and this is it.
 *
 * ## Two windows, because they answer different questions
 *
 * The same shape `operations/start-limits.ts` uses and for the same reasons.
 * **Per thread** bounds one conversation becoming a chat client. **Per account
 * per day** bounds the same loop spread across many threads and many projects,
 * which the first window cannot see at all.
 *
 * ## Why the numbers are what they are
 *
 * Set well above what a founder talking to Nova produces in that window, and
 * well below what an unattended loop produces in a minute. Round rather than
 * measured, which is the honest description: this is a backstop, not a quota
 * anybody is expected to reach. When there are real conversations to measure,
 * these move — in a diff, with the reasoning beside them, which is why they are
 * constants in code and not an environment variable (ADR 0068 §7's argument,
 * asked of a different kind of limit).
 */

/**
 * Turns one thread may hold.
 *
 * A long conversation is a real thing and this is not meant to end one: forty
 * founder questions in a single thread is an afternoon of work, and the answer
 * when it is reached is *start a new one*, not *come back tomorrow*.
 */
export const MAX_QUESTIONS_PER_THREAD = 40;

/** Questions one account may ask across every project, in a day. */
export const MAX_QUESTIONS_PER_ACCOUNT_PER_DAY = 200;

/** The window the account limit is counted over. */
export const ACCOUNT_QUESTION_WINDOW_MS = 24 * 60 * 60 * 1000;

export type QuestionLimitRefusal =
  /** This thread is full. A new one is the remedy, and it is free. */
  | "thread_full"
  /** The account has asked a great many questions today. */
  | "account_window_full";

export type QuestionAllowance =
  | { allowed: true }
  | { allowed: false; reason: QuestionLimitRefusal; message: string };

/**
 * What the founder is told when a window is full.
 *
 * Vibe's own words, and they name the remedy. A limit a founder discovers by
 * being ignored is worse than a price — which is the sentence ADR 0110's
 * consequences section commits to, written here so it is one string rather than
 * a phrase each surface invents.
 */
const REFUSALS: Record<QuestionLimitRefusal, string> = {
  thread_full:
    "This conversation has got long enough that I would start losing the thread of it. Start a new one and I will pick up from where your product is now.",
  account_window_full:
    "You have asked me a lot today, which is good — but I am going to stop here until tomorrow. Everything I know is still on the screens themselves.",
};

export function allowQuestion(params: {
  /** Founder questions already in this thread. */
  turnsInThread: number;
  /** Founder questions across this account within the window. */
  questionsInWindow: number;
}): QuestionAllowance {
  if (params.turnsInThread >= MAX_QUESTIONS_PER_THREAD) {
    return { allowed: false, reason: "thread_full", message: REFUSALS.thread_full };
  }

  if (params.questionsInWindow >= MAX_QUESTIONS_PER_ACCOUNT_PER_DAY) {
    return {
      allowed: false,
      reason: "account_window_full",
      message: REFUSALS.account_window_full,
    };
  }

  return { allowed: true };
}
