import { describe, expect, it } from "vitest";

import type { AIProvider, StructuredRequest, StructuredResult } from "@/modules/ai/provider";

import { CONVERSATION_TEMPLATE, answerNovaQuestion } from "./service";
import { MAX_QUESTION_CHARS, type NovaConversationPayload } from "./payload";

/**
 * The lane that must be safe to lose, and safe to be attacked through.
 *
 * Two halves. **Every way this breaks returns something a founder can read** —
 * the same claim `voice/service.test.ts` makes, and worth more here because a
 * founder is watching a composer rather than a page that already rendered. And
 * **the model is handed no capability**, which is the property rule 41 says
 * bounds prompt injection: not the wording of the prompt, the absence of a
 * tool.
 */

const PAYLOAD: NovaConversationPayload = {
  question: "why is conversion the blocker?",
  productName: "Payflow",
  founderGoal: "First paying customers",
  sections: [
    {
      title: "Business reading",
      facts: [{ label: "biggest blocker", value: "Pricing clarity" }],
    },
  ],
  recentTurns: [{ author: "nova", text: "I finished reading your business." }],
  allowedNumericFacts: [],
  availableArtifacts: [{ kind: "business_health", ref: null }],
  availableActions: [{ actionId: "nova.refresh_audit", label: "Run the audit again" }],
};

/** A reply that passes `checks.ts` — grounded, plain, no figures. */
const GOOD =
  "Your pricing is not stated before signup, so the people who would pay never see what it costs.";

function provider(overrides: Partial<AIProvider> = {}): AIProvider {
  return {
    name: "fake",
    countInputTokens: async () => ({ ok: true, inputTokens: 2_000 }),
    generateStructured: async (): Promise<StructuredResult> => ({
      ok: true,
      data: { message: GOOD, artifact: { kind: "business_health", ref: null }, actionId: null },
      usage: { inputTokens: 2_000, outputTokens: 60, thinkingTokens: 0 },
      model: "claude-sonnet-5",
      latencyMs: 1_400,
    }),
    ...overrides,
  };
}

async function ask(overrides: Partial<Parameters<typeof answerNovaQuestion>[0]> = {}) {
  return answerNovaQuestion({
    provider: provider(),
    payload: PAYLOAD,
    enabled: true,
    ...overrides,
  });
}

describe("an answer arrives", () => {
  it("keeps the model's words and its pointer", async () => {
    const outcome = await ask();

    expect(outcome.source).toBe("model");
    expect(outcome.reply.message).toBe(GOOD);
    expect(outcome.reply.artifact).toEqual({ kind: "business_health", ref: null });
    expect(outcome.providerInvoked).toBe(true);
    expect(outcome.usage).not.toBeNull();
  });
});

describe("every way this breaks still answers", () => {
  it.each([
    ["the switch is off", { enabled: false }, { reason: "disabled", invoked: false }],
    [
      "the question is longer than the row it would be recorded in",
      { payload: { ...PAYLOAD, question: "x".repeat(MAX_QUESTION_CHARS + 1) } },
      { reason: "question_too_long", invoked: false },
    ],
  ])("%s", async (_name, overrides, expected) => {
    const outcome = await ask(overrides as Parameters<typeof ask>[0]);

    expect(outcome.reply.message).toBe(CONVERSATION_TEMPLATE);
    expect(outcome.fallbackReason).toBe(expected.reason);
    expect(outcome.providerInvoked).toBe(expected.invoked);
  });

  it("answers when the pack does not fit the budget, without spending", async () => {
    const outcome = await ask({
      provider: provider({ countInputTokens: async () => ({ ok: true, inputTokens: 500_000 }) }),
    });

    expect(outcome.reply.message).toBe(CONVERSATION_TEMPLATE);
    expect(outcome.fallbackReason).toBe("over_input_budget");
    expect(outcome.providerInvoked).toBe(false);
    expect(outcome.estimatedInputTokens).toBe(500_000);
  });

  it("answers when the provider fails, and still carries what was billed", async () => {
    const outcome = await ask({
      provider: provider({
        generateStructured: async () => ({
          ok: false,
          error: "provider_timeout",
          usage: { inputTokens: 2_000, outputTokens: 0, thinkingTokens: 0 },
          model: "claude-sonnet-5",
          latencyMs: 20_000,
        }),
      }),
    });

    expect(outcome.reply.message).toBe(CONVERSATION_TEMPLATE);
    expect(outcome.fallbackReason).toBe("provider_failed");
    // Rule 47: a failed call may still have been billed, so its usage travels
    // even though its words do not.
    expect(outcome.providerInvoked).toBe(true);
    expect(outcome.usage).not.toBeNull();
    expect(outcome.providerFailureCode).toBe("provider_timeout");
  });

  it("answers when the response has no message at all", async () => {
    const outcome = await ask({
      provider: provider({
        generateStructured: async () => ({
          ok: true,
          data: { artifact: null },
          usage: { inputTokens: 2_000, outputTokens: 5, thinkingTokens: 0 },
          model: "claude-sonnet-5",
          latencyMs: 300,
        }),
      }),
    });

    expect(outcome.reply.message).toBe(CONVERSATION_TEMPLATE);
    expect(outcome.fallbackReason).toBe("invalid_output");
  });

  it("answers with the template when the validator refuses the words", async () => {
    const outcome = await ask({
      provider: provider({
        generateStructured: async () => ({
          ok: true,
          data: { message: "I've started the audit — your change is live." },
          usage: { inputTokens: 2_000, outputTokens: 20, thinkingTokens: 0 },
          model: "claude-sonnet-5",
          latencyMs: 800,
        }),
      }),
    });

    expect(outcome.reply.message).toBe(CONVERSATION_TEMPLATE);
    expect(outcome.fallbackReason).toBe("validation_rejected");
    expect(outcome.check?.ok).toBe(false);
  });

  /**
   * The floor itself. It names what happened and points at the screens, rather
   * than apologising or offering a retry — because every screen in this product
   * answers without a model, and a founder who cannot get a sentence has not
   * lost access to their business.
   */
  it("says nothing about the product having changed", () => {
    expect(CONVERSATION_TEMPLATE).toContain("nothing about your product has changed");
    expect(CONVERSATION_TEMPLATE).not.toContain("sorry");
    expect(CONVERSATION_TEMPLATE).not.toContain("try again");
  });
});

describe("what the model is handed", () => {
  async function capture(): Promise<StructuredRequest> {
    let seen: StructuredRequest | null = null;
    await ask({
      provider: provider({
        countInputTokens: async (request) => {
          seen = request;
          return { ok: true, inputTokens: 2_000 };
        },
      }),
    });
    if (seen === null) throw new Error("the provider was never asked to count");
    return seen;
  }

  /**
   * Rule 41: removing capability, not prompt wording, is what bounds prompt
   * injection. A `StructuredRequest` has no field for a tool, a web search or a
   * URL, and this asserts that the shape sent is that shape — so granting one
   * would have to be a change to the provider boundary rather than to a caller.
   */
  it("carries no tool, no search and no fetch", async () => {
    const request = await capture();

    expect(Object.keys(request).sort()).toEqual(
      [
        "maxOutputTokens",
        "model",
        "operation",
        "outputSchema",
        "reasoning",
        "system",
        "timeoutMs",
        "userContent",
      ].sort(),
    );
  });

  /**
   * Rule 42: instructions come only from prompts we author. The founder's own
   * question is *their* text and therefore data — and it is the single most
   * likely place an injected instruction arrives.
   */
  it("keeps every word of the founder's out of the system prompt", async () => {
    const request = await capture();

    expect(request.system).not.toContain(PAYLOAD.question);
    expect(request.system).not.toContain("Payflow");
    expect(request.userContent).toContain(PAYLOAD.question);
    expect(request.userContent).toContain("<untrusted>");
  });

  it("fences the earlier turns too", async () => {
    const request = await capture();

    const fenced = request.userContent.slice(
      request.userContent.indexOf("<untrusted>"),
      request.userContent.indexOf("</untrusted>"),
    );

    expect(fenced).toContain("I finished reading your business.");
  });

  /**
   * Vibe's own lists sit outside the fence. Inside it, a crafted fact could
   * appear to extend them — which is the whole reason the fence is a boundary
   * and not a decoration.
   */
  it("keeps Vibe's own lists outside the fence", async () => {
    const request = await capture();

    const after = request.userContent.slice(request.userContent.indexOf("</untrusted>"));

    expect(after).toContain("ALLOWED NUMBERS");
    expect(after).toContain("AVAILABLE ARTIFACTS");
    expect(after).toContain("AVAILABLE ACTIONS");
  });

  it("names the operation the ledger keys on", async () => {
    const request = await capture();

    expect(request.operation).toBe("nova_conversation");
  });
});
