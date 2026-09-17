import { describe, expect, it } from "vitest";
import { NOVA_CONVERSATION_FLAG, isNovaConversationEnabled } from "./switch";

/**
 * Two levers, and both must allow it.
 *
 * The one that matters is the second. A conversation is paid inference, and a
 * spend-incident switch that stopped every other paid call and not this one
 * would not be the switch it says it is — which is the sentence
 * `isNovaVoiceEnabled` records, asked of the lane that reaches a provider on a
 * founder's keystroke rather than at the tail of a durable step.
 */

describe("whether Nova may answer with a model", () => {
  it("is off when nothing is set", () => {
    expect(isNovaConversationEnabled({})).toBe(false);
  });

  it("is on only for an exact 1", () => {
    expect(isNovaConversationEnabled({ [NOVA_CONVERSATION_FLAG]: "1" })).toBe(true);
    // A lever read from a loose truthiness check is one a stray `=false` turns on.
    expect(isNovaConversationEnabled({ [NOVA_CONVERSATION_FLAG]: "true" })).toBe(false);
    expect(isNovaConversationEnabled({ [NOVA_CONVERSATION_FLAG]: "false" })).toBe(false);
    expect(isNovaConversationEnabled({ [NOVA_CONVERSATION_FLAG]: "0" })).toBe(false);
  });

  it("stops when the spend-incident lever is thrown", () => {
    expect(
      isNovaConversationEnabled({
        [NOVA_CONVERSATION_FLAG]: "1",
        PAID_OPERATIONS_DISABLED: "1",
      }),
    ).toBe(false);
  });
});
