import { beforeEach, describe, expect, it } from "vitest";

import { NOVA_PRESENTATION_CONFIG } from "@/modules/ai/operations";
import type { AIProvider, StructuredResult } from "@/modules/ai/provider";
import { computeNovaVoiceIdentity } from "@/modules/nova/voice/payload";
import type { NovaVoicePayload } from "@/modules/nova/voice/payload";
import { readNovaVoiceMessage } from "@/modules/nova/voice/store";

import { FakeDatabase, fakeSupabase, newQueryRecorder } from "./test-support";
import type { QueryRecorder } from "./test-support";
import { speakAfterOperation } from "./nova-voice";

/**
 * The integration point, and the promise it makes to everything upstream.
 *
 * A durable operation has already written the thing the founder asked for by
 * the time this runs. So every test here is a variation on one question: can
 * the voice, failing in this particular way, reach back and damage that? The
 * answer has to be no for reasons that are structural rather than careful,
 * which is why the failures below include a provider that throws and a
 * database that refuses — not just the failures `speakNovaMessage` already
 * models.
 */

const OPERATION = {
  id: "33333333-3333-4333-8333-333333333333",
  userId: "44444444-4444-4444-8444-444444444444",
  projectId: "11111111-1111-4111-8111-111111111111",
};

const TEMPLATE = "Your audit is ready to look at.";
const GOOD = "Pricing clarity is the thing holding the business back right now.";

const PAYLOAD: NovaVoicePayload = {
  slot: "audit_result",
  productName: "Klinikplan",
  founderGoal: null,
  facts: [{ label: "biggest blocker", value: "Pricing clarity" }],
  allowedNumericFacts: [],
  confidence: "high",
  nextStep: "Look at the full breakdown below.",
};

const IDENTITY = computeNovaVoiceIdentity({
  projectId: OPERATION.projectId,
  payload: PAYLOAD,
  model: NOVA_PRESENTATION_CONFIG.model,
});

let db: FakeDatabase;
let recorder: QueryRecorder;
let generated: number;

beforeEach(() => {
  db = new FakeDatabase();
  recorder = newQueryRecorder();
  generated = 0;
});

function client() {
  return fakeSupabase(db, recorder);
}

function provider(overrides: Partial<AIProvider> = {}): AIProvider {
  return {
    name: "anthropic",
    countInputTokens: async () => ({ ok: true, inputTokens: 480 }),
    generateStructured: async (): Promise<StructuredResult> => {
      generated += 1;
      return {
        ok: true,
        data: { message: GOOD },
        usage: { inputTokens: 500, outputTokens: 40, thinkingTokens: 0 },
        model: NOVA_PRESENTATION_CONFIG.model,
        latencyMs: 900,
      };
    },
    ...overrides,
  };
}

function speak(overrides: Partial<Parameters<typeof speakAfterOperation>[0]> = {}) {
  return speakAfterOperation({
    supabase: client(),
    provider: provider(),
    operation: OPERATION,
    payload: PAYLOAD,
    template: TEMPLATE,
    enabled: true,
    ...overrides,
  });
}

function usageRows() {
  return db.rows("ai_usage_events") as unknown as Record<string, unknown>[];
}

function read() {
  return readNovaVoiceMessage(client(), { identity: IDENTITY, template: TEMPLATE });
}

/**
 * A stand-in for the tail of a durable step: persist the canonical result,
 * then let Nova speak. The assertion every test makes against it is that the
 * first line's effect and the returned outcome are identical whatever the
 * second line does.
 */
async function canonicalStepThenVoice(
  voice: () => Promise<void>,
): Promise<{ ok: true; resultId: string }> {
  db.seed("business_audits", {
    id: "audit_1",
    project_id: OPERATION.projectId,
    status: "completed",
  });
  await voice();
  return { ok: true, resultId: "audit_1" };
}

describe("the voice cannot damage what the operation already did", () => {
  it("leaves a completed operation completed when the voice succeeds", async () => {
    const outcome = await canonicalStepThenVoice(() => speak());

    expect(outcome).toEqual({ ok: true, resultId: "audit_1" });
    expect(db.rows("business_audits")).toHaveLength(1);
  });

  /**
   * A provider that throws rather than returning a typed failure. The adapter
   * is supposed to prevent this; the operation must survive it being wrong.
   */
  it("survives a provider that throws", async () => {
    const outcome = await canonicalStepThenVoice(() =>
      speak({
        provider: provider({
          generateStructured: async () => {
            throw new Error("socket hang up");
          },
        }),
      }),
    );

    expect(outcome).toEqual({ ok: true, resultId: "audit_1" });
  });

  it("survives a token count that throws", async () => {
    const outcome = await canonicalStepThenVoice(() =>
      speak({
        provider: provider({
          countInputTokens: async () => {
            throw new Error("no route to host");
          },
        }),
      }),
    );

    expect(outcome).toEqual({ ok: true, resultId: "audit_1" });
  });

  /** The claim itself failing — the database, not the model. */
  it("survives a store that refuses the claim", async () => {
    db.failNextWriteWith = {
      table: "nova_voice_messages",
      code: "42501",
      message: "permission denied",
    };

    const outcome = await canonicalStepThenVoice(() => speak());

    expect(outcome).toEqual({ ok: true, resultId: "audit_1" });
  });

  it("returns nothing at all, so no caller can branch on it", async () => {
    expect(await speak()).toBeUndefined();
  });

  /**
   * The crash window ADR 0085 names: claimed, then the process (here, the
   * provider) died before an outcome existed. The identity stays claimed and
   * unresolved forever, which costs the founder a rephrasing and never a
   * second charge. Asserted rather than described, because "never retried" is
   * the property that makes the whole design safe to ship.
   */
  it("leaves a died-mid-attempt identity on the template, permanently", async () => {
    const dying = provider({
      generateStructured: async () => {
        generated += 1;
        throw new Error("socket hang up");
      },
    });

    await speak({ provider: dying });

    expect(await read()).toMatchObject({ message: TEMPLATE, resolved: false });
    expect(usageRows()).toEqual([]);

    await speak({ provider: dying });
    await speak();

    expect(generated).toBe(1);
  });
});

describe("a founder still gets a sentence", () => {
  it("stores the model's words when they pass", async () => {
    await speak();

    expect(await read()).toMatchObject({ message: GOOD, source: "voice" });
  });

  it.each([
    ["the switch is off", { enabled: false }, {}],
    [
      "the provider refuses",
      {},
      {
        generateStructured: async (): Promise<StructuredResult> => {
          generated += 1;
          return {
            ok: false,
            error: "provider_timeout" as const,
            model: NOVA_PRESENTATION_CONFIG.model,
            latencyMs: 20_000,
          };
        },
      },
    ],
    [
      "the validator refuses the message",
      {},
      {
        generateStructured: async (): Promise<StructuredResult> => {
          generated += 1;
          return {
            ok: true,
            data: { message: "Your change is live and your score is 68." },
            usage: { inputTokens: 500, outputTokens: 30, thinkingTokens: 0 },
            model: NOVA_PRESENTATION_CONFIG.model,
            latencyMs: 700,
          };
        },
      },
    ],
  ])("degrades to the template when %s", async (_label, options, providerOverrides) => {
    await speak({ ...options, provider: provider(providerOverrides) });

    expect(await read()).toMatchObject({ message: TEMPLATE, source: "template" });
  });

  /** A read is what a render does, and a render must never be able to spend. */
  it("never reaches the provider from a read", async () => {
    await speak();
    const before = generated;

    await read();
    await read();

    expect(generated).toBe(before);
  });
});

describe("one identity, one attempt, one ledger row", () => {
  it("generates once however often the operation completes", async () => {
    await speak();
    await speak();
    await speak();

    expect(generated).toBe(1);
    expect(usageRows()).toHaveLength(1);
  });

  it("generates once when two steps run together", async () => {
    await Promise.all([speak(), speak()]);

    expect(generated).toBe(1);
    expect(db.rows("nova_voice_messages")).toHaveLength(1);
    expect(usageRows()).toHaveLength(1);
  });
});

describe("the provider-cost ledger, and only that", () => {
  it("records a successful generation against the existing usage ledger", async () => {
    await speak();

    expect(usageRows()).toHaveLength(1);
    expect(usageRows()[0]).toMatchObject({
      user_id: OPERATION.userId,
      project_id: OPERATION.projectId,
      operation: "nova_presentation",
      provider: "anthropic",
      model: NOVA_PRESENTATION_CONFIG.model,
      job_id: OPERATION.id,
      status: "succeeded",
      input_tokens: 500,
      output_tokens: 40,
      estimated_input_tokens: 480,
      latency_ms: 900,
      failure_code: null,
    });
  });

  it("prices what it recorded, so the row is worth having", async () => {
    await speak();

    expect(usageRows()[0].provider_cost_usd).toBeTruthy();
    expect(usageRows()[0].pricing_version).toBeTruthy();
  });

  /**
   * Requirement: usage returned alongside a failure is kept. A call that was
   * billed and then failed costs exactly as much as one that succeeded.
   */
  it("keeps the tokens a failed call was billed for", async () => {
    await speak({
      provider: provider({
        generateStructured: async (): Promise<StructuredResult> => {
          generated += 1;
          return {
            ok: false,
            error: "provider_overloaded",
            usage: { inputTokens: 500, outputTokens: 0, thinkingTokens: 0 },
            model: NOVA_PRESENTATION_CONFIG.model,
            latencyMs: 1_200,
          };
        },
      }),
    });

    expect(usageRows()[0]).toMatchObject({
      status: "failed",
      input_tokens: 500,
      output_tokens: 0,
      /* The provider's own code, not the collapsed `provider_failed`. */
      failure_code: "provider_overloaded",
      latency_ms: 1_200,
    });
  });

  /**
   * The other direction of the same rule: a call that died before billing
   * anything is still a call, and is recorded with no token counts rather than
   * with zeros that would read as a free success.
   */
  it("records a failure that was never billed without inventing counts", async () => {
    await speak({
      provider: provider({
        generateStructured: async (): Promise<StructuredResult> => {
          generated += 1;
          return {
            ok: false,
            error: "provider_unavailable",
            model: NOVA_PRESENTATION_CONFIG.model,
            latencyMs: 30,
          };
        },
      }),
    });

    expect(usageRows()[0]).toMatchObject({
      status: "failed",
      input_tokens: null,
      output_tokens: null,
      provider_cost_usd: null,
    });
  });

  it("records a rejected message as a failed call that still cost money", async () => {
    await speak({
      provider: provider({
        generateStructured: async (): Promise<StructuredResult> => {
          generated += 1;
          return {
            ok: true,
            data: { message: "Your change is live and your score is 68." },
            usage: { inputTokens: 500, outputTokens: 30, thinkingTokens: 0 },
            model: NOVA_PRESENTATION_CONFIG.model,
            latencyMs: 700,
          };
        },
      }),
    });

    expect(usageRows()[0]).toMatchObject({
      status: "failed",
      failure_code: "validation_rejected",
      input_tokens: 500,
    });
  });

  /**
   * The fabrication this guards against: a ledger row for a call nobody made.
   * `disabled` and `over_input_budget` never reach `generateStructured`, so a
   * row for either would put invented provider cost into unit economics.
   */
  it.each([
    ["the switch is off", { enabled: false }, {}],
    [
      "the payload is over budget",
      {},
      { countInputTokens: async () => ({ ok: true as const, inputTokens: 1_000_000 }) },
    ],
    [
      "the token count itself fails",
      {},
      {
        countInputTokens: async () => ({
          ok: false as const,
          error: "provider_unavailable" as const,
        }),
      },
    ],
  ])("writes no usage row when %s", async (_label, options, providerOverrides) => {
    await speak({ ...options, provider: provider(providerOverrides) });

    expect(generated).toBe(0);
    expect(usageRows()).toEqual([]);
  });

  /**
   * Presentation is Vibe's infrastructure cost. No product decision says a
   * founder buys it, so nothing here may touch the customer ledger — no hold,
   * no reservation, no posted entry (rule 47, PRODUCT.md §12).
   */
  it("charges the founder nothing", async () => {
    await speak();

    expect(db.rows("billing_credit_ledger")).toEqual([]);
    expect(db.rows("billing_credit_holds")).toEqual([]);
    expect(db.rows("billing_credit_accounts")).toEqual([]);
  });

  it("writes only the tables this boundary owns", async () => {
    await speak();

    expect([...new Set(recorder.writes)].sort()).toEqual([
      "ai_usage_events",
      "billing_usage_events",
      "nova_voice_messages",
    ]);
  });

  /**
   * The margin projection is not a charge. It is the same usage row read for
   * cost, one line per SKU that actually has a quantity — thinking tokens were
   * zero, so there is no row claiming they were not.
   */
  it("projects the provider cost without billing it", async () => {
    await speak();

    const skus = (db.rows("billing_usage_events") as unknown as { sku: string }[]).map(
      (row) => row.sku,
    );

    expect(skus.sort()).toEqual(["anthropic_input_tokens", "anthropic_output_tokens"]);
  });
});
