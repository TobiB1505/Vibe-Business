import { describe, expect, it } from "vitest";
import {
  ACCOUNT_QUESTION_WINDOW_MS,
  MAX_QUESTIONS_PER_ACCOUNT_PER_DAY,
  MAX_QUESTIONS_PER_THREAD,
  allowQuestion,
} from "./limits";

/**
 * The bound that stands in for a price (ADR 0110 §2).
 *
 * A Credit price is what bounds every other metered inference in this product,
 * and it was deliberately not used here — so this is the whole of what stops a
 * free operation being unbounded. The tests that matter are the refusals, and
 * that each one says what to do next.
 */

describe("asking is allowed until it is not", () => {
  it("allows an ordinary question", () => {
    expect(allowQuestion({ turnsInThread: 3, questionsInWindow: 12 })).toEqual({ allowed: true });
  });

  it("refuses when this thread is full, and says to start another", () => {
    const answer = allowQuestion({
      turnsInThread: MAX_QUESTIONS_PER_THREAD,
      questionsInWindow: 0,
    });

    expect(answer.allowed).toBe(false);
    expect(answer.allowed === false && answer.reason).toBe("thread_full");
    expect(answer.allowed === false && answer.message).toContain("Start a new one");
  });

  it("refuses when the account has asked enough today", () => {
    const answer = allowQuestion({
      turnsInThread: 1,
      questionsInWindow: MAX_QUESTIONS_PER_ACCOUNT_PER_DAY,
    });

    expect(answer.allowed).toBe(false);
    expect(answer.allowed === false && answer.reason).toBe("account_window_full");
  });

  /**
   * The thread limit is checked first on purpose. Both are true for a founder
   * who has spent a day in one conversation, and *"start a new one"* is a
   * remedy they can act on now while *"come back tomorrow"* is not.
   */
  it("names the remedy a founder can act on when both are full", () => {
    const answer = allowQuestion({
      turnsInThread: MAX_QUESTIONS_PER_THREAD,
      questionsInWindow: MAX_QUESTIONS_PER_ACCOUNT_PER_DAY,
    });

    expect(answer.allowed === false && answer.reason).toBe("thread_full");
  });
});

describe("a refusal is a sentence, not a status", () => {
  it("never tells a founder they have lost access to anything", () => {
    for (const answer of [
      allowQuestion({ turnsInThread: MAX_QUESTIONS_PER_THREAD, questionsInWindow: 0 }),
      allowQuestion({ turnsInThread: 0, questionsInWindow: MAX_QUESTIONS_PER_ACCOUNT_PER_DAY }),
    ]) {
      const message = answer.allowed === false ? answer.message : "";

      expect(message.length).toBeGreaterThan(40);
      expect(message.toLowerCase()).not.toContain("error");
      expect(message.toLowerCase()).not.toContain("limit");
      expect(message.toLowerCase()).not.toContain("quota");
    }
  });
});

describe("the numbers are backstops rather than quotas", () => {
  it("leaves room for a long afternoon and refuses a loop", () => {
    // Well above what a founder talking produces in the window, and well below
    // what an unattended loop produces in a minute.
    expect(MAX_QUESTIONS_PER_THREAD).toBeGreaterThan(20);
    expect(MAX_QUESTIONS_PER_ACCOUNT_PER_DAY).toBeGreaterThan(MAX_QUESTIONS_PER_THREAD);
    expect(ACCOUNT_QUESTION_WINDOW_MS).toBe(24 * 60 * 60 * 1000);
  });
});
