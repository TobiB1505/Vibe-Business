import { describe, expect, it } from "vitest";

import type { AIProvider, StructuredResult } from "@/modules/ai/provider";

import type { NovaVoicePayload } from "./payload";
import { speakNovaMessage } from "./service";

/**
 * The tier that must be safe to lose.
 *
 * Every test below is a failure. That is the point: the voice is a nicety on
 * top of a product that is complete without it, and the only way that claim is
 * worth anything is if every way it can break returns the sentence Vibe would
 * have shown anyway. A test suite for the happy path would prove the opposite
 * of what matters.
 */

const PAYLOAD: NovaVoicePayload = {
  slot: "audit_result",
  productName: "Klinikplan",
  founderGoal: null,
  facts: [
    { label: "biggest blocker", value: "Pricing clarity" },
    { label: "why it blocks", value: "The annual plan's price is not stated before signup" },
  ],
  allowedNumericFacts: [],
  confidence: "high",
  nextStep: "Look at the full breakdown below.",
};

const TEMPLATE = "There is a change waiting for you to look at.";

/** A message that passes `checks.ts` — plain, grounded, no figures. */
const GOOD = "Pricing clarity is the thing holding the business back right now.";

function provider(overrides: Partial<AIProvider> = {}): AIProvider {
  return {
    name: "fake",
    countInputTokens: async () => ({ ok: true, inputTokens: 500 }),
    generateStructured: async (): Promise<StructuredResult> => ({
      ok: true,
      data: { message: GOOD },
      usage: { inputTokens: 500, outputTokens: 40, thinkingTokens: 0 },
      model: "claude-sonnet-5",
      latencyMs: 900,
    }),
    ...overrides,
  };
}

type SpeakParams = Parameters<typeof speakNovaMessage>[0];

async function speak(overrides: Partial<SpeakParams> = {}) {
  return speakNovaMessage({
    provider: provider(),
    payload: PAYLOAD,
    template: TEMPLATE,
    enabled: true,
    ...overrides,
  });
}

describe("the voice never leaves a founder with nothing", () => {
  it("keeps the model's words when they pass", async () => {
    const outcome = await speak();

    expect(outcome).toMatchObject({ message: GOOD, source: "voice", fallbackReason: null });
  });

  it("is off unless switched on, and says nothing about it", async () => {
    const outcome = await speakNovaMessage({
      provider: provider(),
      payload: PAYLOAD,
      template: TEMPLATE,
    });

    expect(outcome).toMatchObject({
      message: TEMPLATE,
      source: "template",
      fallbackReason: "disabled",
      usage: null,
    });
  });

  /** Nothing is counted and nothing is called while the switch is off. */
  it("spends nothing when disabled", async () => {
    let called = 0;
    await speakNovaMessage({
      provider: provider({
        countInputTokens: async () => {
          called += 1;
          return { ok: true, inputTokens: 1 };
        },
        generateStructured: async () => {
          called += 1;
          throw new Error("must not be called");
        },
      }),
      payload: PAYLOAD,
      template: TEMPLATE,
    });

    expect(called).toBe(0);
  });

  it("falls back when the payload does not fit the budget", async () => {
    const outcome = await speak({
      provider: provider({ countInputTokens: async () => ({ ok: true, inputTokens: 1_000_000 }) }),
    });

    expect(outcome).toMatchObject({
      message: TEMPLATE,
      source: "template",
      fallbackReason: "over_input_budget",
    });
  });

  /** The gate is before the spend, so an over-budget payload is never billed. */
  it("makes no billable call when the budget is exceeded", async () => {
    let generated = 0;
    await speak({
      provider: provider({
        countInputTokens: async () => ({ ok: true, inputTokens: 1_000_000 }),
        generateStructured: async () => {
          generated += 1;
          throw new Error("must not be called");
        },
      }),
    });

    expect(generated).toBe(0);
  });

  it("falls back when the count itself fails", async () => {
    const outcome = await speak({
      provider: provider({
        countInputTokens: async () => ({ ok: false, error: "provider_unavailable" }),
      }),
    });

    expect(outcome.source).toBe("template");
    expect(outcome.fallbackReason).toBe("over_input_budget");
  });

  it("falls back when the provider fails, and keeps the usage it was billed", async () => {
    const outcome = await speak({
      provider: provider({
        generateStructured: async (): Promise<StructuredResult> => ({
          ok: false,
          error: "provider_timeout",
          usage: { inputTokens: 500, outputTokens: 0, thinkingTokens: 0 },
          model: "claude-sonnet-5",
          latencyMs: 20_000,
        }),
      }),
    });

    expect(outcome).toMatchObject({
      message: TEMPLATE,
      source: "template",
      fallbackReason: "provider_failed",
    });
    expect(outcome.usage).toEqual({ inputTokens: 500, outputTokens: 0, thinkingTokens: 0 });
  });

  /**
   * `StructuredSuccess.data` is `unknown` on purpose — a schema is a request,
   * not a guarantee, and the next thing that happens to this value is that a
   * founder reads it.
   */
  it.each([
    ["null", null],
    ["a string", "just a message"],
    ["an object with no message", { text: "hello" }],
    ["a non-string message", { message: 42 }],
  ])("falls back when the response is %s", async (_label, data) => {
    const outcome = await speak({
      provider: provider({
        generateStructured: async () => ({
          ok: true,
          data,
          usage: { inputTokens: 500, outputTokens: 10, thinkingTokens: 0 },
          model: "claude-sonnet-5",
          latencyMs: 500,
        }),
      }),
    });

    expect(outcome.source).toBe("template");
    expect(outcome.fallbackReason).toBe("invalid_output");
  });
});

describe("what the validator refuses never reaches a founder", () => {
  async function speakSaying(message: string, forbiddenSubstrings?: readonly string[]) {
    return speak({
      forbiddenSubstrings,
      provider: provider({
        generateStructured: async () => ({
          ok: true,
          data: { message },
          usage: { inputTokens: 500, outputTokens: 30, thinkingTokens: 0 },
          model: "claude-sonnet-5",
          latencyMs: 700,
        }),
      }),
    });
  }

  /** A figure the payload never authorized is the case the allowlist exists for. */
  it("refuses a fabricated number", async () => {
    const outcome = await speakSaying("Your score is 68 out of 100, which is solid.");

    expect(outcome.message).toBe(TEMPLATE);
    expect(outcome.fallbackReason).toBe("validation_rejected");
    expect(outcome.check?.ok).toBe(false);
  });

  it("refuses a claim Vibe cannot make", async () => {
    const outcome = await speakSaying("Your change is live and everything is working.");

    expect(outcome.message).toBe(TEMPLATE);
    expect(outcome.fallbackReason).toBe("validation_rejected");
  });

  /**
   * The state-dependent half. "Passed" is not always false — it is false while
   * the check is still running, which is why the caller supplies it rather
   * than the validator holding a list it cannot know the truth of.
   */
  it("refuses a sentence that is false in this exact state", async () => {
    const outcome = await speakSaying("The check passed, so you can merge it.", ["passed"]);

    expect(outcome.message).toBe(TEMPLATE);
    expect(outcome.fallbackReason).toBe("validation_rejected");
  });

  it("still records what the rejected call was billed", async () => {
    const outcome = await speakSaying("Your change is live.");

    expect(outcome.usage).toEqual({ inputTokens: 500, outputTokens: 30, thinkingTokens: 0 });
  });
});
