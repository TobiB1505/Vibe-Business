import { describe, expect, it } from "vitest";
import { checkConversationReply } from "./checks";
import {
  MAX_CONVERSATION_REPLY_CHARS,
  type NovaConversationPayload,
  type NovaConversationReply,
} from "./payload";

/**
 * What Vibe refuses to show a founder, whatever the model wrote.
 *
 * Every case here is a sentence that would be fluent, plausible and wrong.
 * Prompt wording makes each of them rare; this is what makes them impossible,
 * and the difference matters because a prompt is advice and a validator is not.
 */

function payload(overrides: Partial<NovaConversationPayload> = {}): NovaConversationPayload {
  return {
    question: "why is conversion the blocker?",
    productName: "Payflow",
    founderGoal: "First paying customers",
    sections: [],
    recentTurns: [],
    allowedNumericFacts: [],
    availableArtifacts: [{ kind: "business_health", ref: null }],
    availableActions: [{ actionId: "nova.refresh_audit", label: "Run the audit again" }],
    ...overrides,
  };
}

function check(reply: Partial<NovaConversationReply>, context = payload()) {
  return checkConversationReply({
    reply: { message: "Your pricing page does not say what anything costs.", ...reply },
    payload: context,
  });
}

describe("a reply that would be false", () => {
  it("refuses a numeral the context did not authorize", () => {
    const result = check({ message: "Your score is 62, which is the thing holding you back." });

    expect(result.ok).toBe(false);
    expect(result.failures.map((failure) => failure.code)).toContain("unallowed_number");
    expect(result.reply).toBeNull();
  });

  it("allows the numerals the context did authorize", () => {
    const result = check(
      { message: "Two of your nine areas could not be scored, so 7 carried the reading." },
      payload({ allowedNumericFacts: ["7"] }),
    );

    expect(result.ok).toBe(true);
  });

  it.each(["Your change is live now.", "That one is deployed.", "The build is safe to ship."])(
    "refuses a claim this product can never make: %s",
    (message) => {
      const result = check({ message });

      expect(result.ok).toBe(false);
      expect(result.failures.map((failure) => failure.code)).toContain("banned_claim");
    },
  );

  /**
   * The difference from the voice lane, and the reason `findUnnegated` is
   * shared rather than copied. A founder may ask *"is it live yet?"*, and the
   * answer that says Vibe cannot know is the sentence this product exists to
   * say — it contains the phrase and must survive.
   */
  it("allows the honest denial of the same claim", () => {
    const result = check({
      message:
        "I cannot tell you whether it is live. Vibe moves the branch and never watches a deploy.",
    });

    expect(result.ok).toBe(true);
  });

  /**
   * The failure this lane invites and the voice lane does not. The founder
   * asks whether to re-run the audit, Nova agrees and writes "I've started
   * it", and the press that would actually start it sits there unpressed while
   * they wait for a result that is not coming.
   */
  it.each([
    "I've started the audit for you.",
    "I'm running it now.",
    "I'll start it right away.",
    "Queued it — I'll let you know.",
  ])("refuses a reply that claims to have acted: %s", (message) => {
    const result = check({ message });

    expect(result.ok).toBe(false);
    expect(result.failures.map((failure) => failure.code)).toContain("claimed_to_act");
  });

  it("allows describing what a control would do", () => {
    const result = check({
      message:
        "Running the audit again would tell you whether that has moved. The control is on this screen.",
    });

    expect(result.ok).toBe(true);
  });

  it("refuses Vibe's own vocabulary", () => {
    const result = check({ message: "Your product profile has not been rebuilt since then." });

    expect(result.ok).toBe(false);
    expect(result.failures.map((failure) => failure.code)).toContain("module_name");
  });

  it("refuses structure the thread does not render", () => {
    const result = check({ message: "Two things:\n- pricing\n- signup" });

    expect(result.ok).toBe(false);
    expect(result.failures.map((failure) => failure.code)).toContain("markdown_structure");
  });

  it("refuses a reply longer than the row it is stored in", () => {
    const result = check({ message: "x".repeat(MAX_CONVERSATION_REPLY_CHARS + 1) });

    expect(result.ok).toBe(false);
    expect(result.failures.map((failure) => failure.code)).toContain("too_long");
  });

  it("refuses an empty reply without reading it as prose", () => {
    const result = check({ message: "  " });

    expect(result.ok).toBe(false);
    expect(result.failures.map((failure) => failure.code)).toEqual(["empty_reply"]);
  });
});

describe("a pointer that does not resolve", () => {
  /**
   * A bad reference degrades the reply; a bad sentence replaces it. That
   * asymmetry is rule 45's shape — discard a citation that does not resolve,
   * never display an unverifiable one — applied to a pointer instead of an
   * evidence id.
   */
  it("drops an artifact this project does not have, and keeps the answer", () => {
    const result = check({ artifact: { kind: "prepared_change", ref: "change_7" } });

    expect(result.ok).toBe(true);
    expect(result.reply?.artifact).toBeNull();
    expect(result.drops.map((drop) => drop.code)).toEqual(["artifact_not_available"]);
  });

  it("drops an artifact kind that is not a kind at all", () => {
    const result = check({
      artifact: { kind: "diff" as never, ref: null },
    });

    expect(result.ok).toBe(true);
    expect(result.reply?.artifact).toBeNull();
  });

  it("keeps an artifact the project does have", () => {
    const result = check({ artifact: { kind: "business_health", ref: null } });

    expect(result.reply?.artifact).toEqual({ kind: "business_health", ref: null });
  });

  it("drops an action id that is not in the catalogue", () => {
    const result = check({ actionId: "nova.merge_everything" as never });

    expect(result.ok).toBe(true);
    expect(result.reply?.actionId).toBeNull();
    expect(result.drops.map((drop) => drop.code)).toEqual(["action_not_available"]);
  });

  /**
   * The second check, and the one the catalogue alone cannot make: a **real**
   * control offered in a state where pressing it would be refused. That is the
   * dead end `home-view.ts` records reaching twice.
   */
  it("drops a real action the project is not currently offering", () => {
    const result = check({ actionId: "nova.merge_change" });

    expect(result.ok).toBe(true);
    expect(result.reply?.actionId).toBeNull();
    expect(result.drops.map((drop) => drop.code)).toEqual(["action_not_available"]);
  });

  it("keeps an action the project is offering", () => {
    const result = check({ actionId: "nova.refresh_audit" });

    expect(result.reply?.actionId).toBe("nova.refresh_audit");
  });

  it("passes a reply that points at nothing", () => {
    const result = check({});

    expect(result.ok).toBe(true);
    expect(result.drops).toEqual([]);
    expect(result.reply?.artifact).toBeNull();
    expect(result.reply?.actionId).toBeNull();
  });
});
