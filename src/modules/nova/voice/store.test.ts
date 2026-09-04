import { readFileSync } from "node:fs";

import { beforeEach, describe, expect, it } from "vitest";

import type { AIProvider, StructuredResult } from "@/modules/ai/provider";
import {
  FakeDatabase,
  fakeSupabase,
  newQueryRecorder,
  type QueryRecorder,
} from "@/modules/operations/test-support";

import { NOVA_PRESENTATION_CONFIG } from "@/modules/ai/operations";

import { computeNovaVoiceIdentity } from "./payload";
import type { NovaVoicePayload } from "./payload";
import {
  claimNovaVoiceGeneration,
  ensureNovaVoiceMessage,
  readNovaVoiceMessage,
  resolveNovaVoiceGeneration,
} from "./store";
import type { NovaVoiceClaim } from "./store";

/**
 * One attempt per identity, and a read that cannot spend.
 *
 * Every test here is about the second time something happens: the second
 * render, the second tab, the refresh after a failure. The first call is
 * uninteresting — it is the one that is supposed to cost money. What ADR 0085
 * is for is everything after it.
 */

const PROJECT = "11111111-1111-4111-8111-111111111111";
const TEMPLATE = "There is a change waiting for you to look at.";
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
  projectId: PROJECT,
  payload: PAYLOAD,
  model: NOVA_PRESENTATION_CONFIG.model,
});

const CLAIM: NovaVoiceClaim = {
  identity: IDENTITY,
  projectId: PROJECT,
  slot: PAYLOAD.slot,
  model: NOVA_PRESENTATION_CONFIG.model,
};

let db: FakeDatabase;
let recorder: QueryRecorder;
/** How many billable calls were made across a whole test. */
let generated: number;

beforeEach(() => {
  db = new FakeDatabase();
  recorder = newQueryRecorder();
  generated = 0;
});

function client() {
  return fakeSupabase(db, recorder);
}

/** Counts every generation, so "at most one" is measured rather than assumed. */
function provider(overrides: Partial<AIProvider> = {}): AIProvider {
  return {
    name: "fake",
    countInputTokens: async () => ({ ok: true, inputTokens: 500 }),
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

function ensure(overrides: Partial<Parameters<typeof ensureNovaVoiceMessage>[0]> = {}) {
  return ensureNovaVoiceMessage({
    supabase: client(),
    provider: provider(),
    claim: CLAIM,
    payload: PAYLOAD,
    template: TEMPLATE,
    enabled: true,
    ...overrides,
  });
}

/** The row as stored, so the test asserts the record and not just the return. */
function storedRow() {
  return db.rows("nova_voice_messages")[0] as
    | undefined
    | { source: string | null; fallback_reason: string | null; message: string | null };
}

describe("a read resolves an identity and never spends", () => {
  it("returns the template when nothing is stored", async () => {
    const read = await readNovaVoiceMessage(client(), { identity: IDENTITY, template: TEMPLATE });

    expect(read).toEqual({
      message: TEMPLATE,
      source: "template",
      fallbackReason: null,
      resolved: false,
      attempt: null,
    });
  });

  /** A read model that writes is a render with a side effect. */
  it("writes nothing", async () => {
    await readNovaVoiceMessage(client(), { identity: IDENTITY, template: TEMPLATE });

    expect(recorder.writes).toEqual([]);
  });

  /**
   * The structural half of ADR 0085's fifth condition. A render cannot reach a
   * model from here because there is no model to reach: the read takes a
   * client and two strings, and this module's only provider import is a type.
   * Asserted against the source because a value import is the edit that would
   * quietly make a render billable.
   */
  it("cannot reach a provider, by construction", () => {
    const source = readFileSync(new URL("./store.ts", import.meta.url), "utf8");
    const providerImports = source
      .split("\n")
      .filter((line) => line.startsWith("import") && line.includes("@/modules/ai/provider"));

    expect(providerImports).not.toEqual([]);
    for (const line of providerImports) {
      expect(line, line).toContain("import type");
    }
  });

  it("takes no provider argument at all", () => {
    expect(readNovaVoiceMessage.length).toBe(2);
  });

  /** A claim in flight reads exactly like nothing stored: the template, unresolved. */
  it("returns the template while a claim is unresolved", async () => {
    await claimNovaVoiceGeneration(client(), CLAIM);

    const read = await readNovaVoiceMessage(client(), { identity: IDENTITY, template: TEMPLATE });

    expect(read).toMatchObject({ message: TEMPLATE, source: "template", resolved: false });
  });

  /**
   * A claim that was never resolved — a crash between the claim and the
   * outcome — falls through to the template forever rather than being paid for
   * again. That is the trade ADR 0085 makes on purpose: the failure mode of
   * releasing stale claims is a duplicate charge.
   */
  it("never regenerates an abandoned claim", async () => {
    await claimNovaVoiceGeneration(client(), CLAIM);

    const read = await ensure();

    expect(generated).toBe(0);
    expect(read.message).toBe(TEMPLATE);
  });
});

describe("one identity, one generation", () => {
  it("generates on the first call and reuses the result after", async () => {
    const first = await ensure();
    const second = await ensure();

    expect(generated).toBe(1);
    expect(first).toMatchObject({ message: GOOD, source: "voice", resolved: true });
    expect(second).toMatchObject({ message: GOOD, source: "voice", resolved: true });
  });

  it("stores the accepted sentence rather than recomputing it", async () => {
    await ensure();

    expect(storedRow()).toMatchObject({
      source: "voice",
      message: GOOD,
      fallback_reason: null,
    });
  });

  it("serves a stored sentence to a reader that never generates", async () => {
    await ensure();

    const read = await readNovaVoiceMessage(client(), { identity: IDENTITY, template: TEMPLATE });

    expect(read).toEqual({
      message: GOOD,
      source: "voice",
      fallbackReason: null,
      resolved: true,
      attempt: null,
    });
  });

  /**
   * Two tabs, or one page rendered twice. Both build the same payload, both
   * find nothing stored, and both would call the model if the claim were a
   * check-then-act in application code. The claim is an insert against a
   * primary key instead, so exactly one wins — and the loser returns the
   * template rather than waiting on a lock that could outlive the request.
   */
  it("generates once when two callers arrive together", async () => {
    const [first, second] = await Promise.all([ensure(), ensure()]);

    expect(generated).toBe(1);
    expect([first.source, second.source].sort()).toEqual(["template", "voice"]);
    expect(db.rows("nova_voice_messages")).toHaveLength(1);
  });

  it("generates once when eight callers arrive together", async () => {
    await Promise.all(Array.from({ length: 8 }, () => ensure()));

    expect(generated).toBe(1);
    expect(db.rows("nova_voice_messages")).toHaveLength(1);
  });

  /** After the winner resolves, every later caller reads the stored sentence. */
  it("settles a crowd onto one sentence", async () => {
    await Promise.all(Array.from({ length: 4 }, () => ensure()));

    const reads = await Promise.all(Array.from({ length: 4 }, () => ensure()));

    expect(generated).toBe(1);
    expect(reads.map((read) => read.message)).toEqual([GOOD, GOOD, GOOD, GOOD]);
  });

  it("lets exactly one of two concurrent claims win", async () => {
    const claims = await Promise.all([
      claimNovaVoiceGeneration(client(), CLAIM),
      claimNovaVoiceGeneration(client(), CLAIM),
    ]);

    expect(claims.filter(Boolean)).toHaveLength(1);
  });
});

describe("a fallback is as final as an accepted sentence", () => {
  /**
   * The refresh loop this closes: a provider failure, a render that retries
   * because nothing was stored, a second charge, and a founder who sees the
   * same template either way. Each case below asserts the same three things —
   * the template is shown, the reason is recorded, and a second call spends
   * nothing.
   */
  const CASES: {
    label: string;
    reason: string;
    provider: Partial<AIProvider>;
    enabled?: boolean;
    forbiddenSubstrings?: readonly string[];
    generations: number;
  }[] = [
    {
      label: "the switch is off",
      reason: "disabled",
      provider: {},
      enabled: false,
      /* Nothing is counted and nothing is called while the tier is off. */
      generations: 0,
    },
    {
      label: "the payload does not fit the budget",
      reason: "over_input_budget",
      provider: { countInputTokens: async () => ({ ok: true, inputTokens: 1_000_000 }) },
      generations: 0,
    },
    {
      label: "the provider fails",
      reason: "provider_failed",
      provider: {
        generateStructured: async (): Promise<StructuredResult> => {
          generated += 1;
          return {
            ok: false,
            error: "provider_timeout",
            usage: { inputTokens: 500, outputTokens: 0, thinkingTokens: 0 },
            model: NOVA_PRESENTATION_CONFIG.model,
            latencyMs: 20_000,
          };
        },
      },
      generations: 1,
    },
    {
      label: "the response has no message",
      reason: "invalid_output",
      provider: {
        generateStructured: async (): Promise<StructuredResult> => {
          generated += 1;
          return {
            ok: true,
            data: { text: "wrong field" },
            usage: { inputTokens: 500, outputTokens: 10, thinkingTokens: 0 },
            model: NOVA_PRESENTATION_CONFIG.model,
            latencyMs: 500,
          };
        },
      },
      generations: 1,
    },
    {
      label: "the validator refuses what the model wrote",
      reason: "validation_rejected",
      provider: {
        generateStructured: async (): Promise<StructuredResult> => {
          generated += 1;
          return {
            ok: true,
            data: { message: "Your score is 68 out of 100, and your change is live." },
            usage: { inputTokens: 500, outputTokens: 30, thinkingTokens: 0 },
            model: NOVA_PRESENTATION_CONFIG.model,
            latencyMs: 700,
          };
        },
      },
      generations: 1,
    },
  ];

  it.each(CASES)("shows the template when $label", async (testCase) => {
    const read = await ensure({
      provider: provider(testCase.provider),
      enabled: testCase.enabled ?? true,
      forbiddenSubstrings: testCase.forbiddenSubstrings,
    });

    expect(read).toMatchObject({
      message: TEMPLATE,
      source: "template",
      fallbackReason: testCase.reason,
      resolved: true,
    });
  });

  it.each(CASES)("records the reason when $label", async (testCase) => {
    await ensure({
      provider: provider(testCase.provider),
      enabled: testCase.enabled ?? true,
      forbiddenSubstrings: testCase.forbiddenSubstrings,
    });

    expect(storedRow()).toMatchObject({
      source: "template",
      fallback_reason: testCase.reason,
      /* Never a copy of the template: a reworded one must take effect. */
      message: null,
    });
  });

  it.each(CASES)("never attempts a second time after $label", async (testCase) => {
    const options = {
      provider: provider(testCase.provider),
      enabled: testCase.enabled ?? true,
      forbiddenSubstrings: testCase.forbiddenSubstrings,
    };

    await ensure(options);
    const second = await ensure(options);
    const third = await ensure(options);

    expect(generated).toBe(testCase.generations);
    expect(second.message).toBe(TEMPLATE);
    expect(third.message).toBe(TEMPLATE);
  });

  /**
   * The stored row says "template", and the read returns whatever the template
   * says *now*. That is why a fallback stores no text: today's wording would
   * otherwise outlive itself in a row nobody thinks to look at (rule 83).
   */
  it("follows the template when it is reworded", async () => {
    await ensure({ enabled: false });

    const read = await readNovaVoiceMessage(client(), {
      identity: IDENTITY,
      template: "A completely different sentence, written later.",
    });

    expect(read.message).toBe("A completely different sentence, written later.");
    expect(read.fallbackReason).toBe("disabled");
  });
});

describe("resolving is once, not last-write-wins", () => {
  it("keeps the first outcome when a resolve arrives twice", async () => {
    await claimNovaVoiceGeneration(client(), CLAIM);
    await resolveNovaVoiceGeneration(client(), {
      identity: IDENTITY,
      outcome: {
        message: GOOD,
        source: "voice",
        fallbackReason: null,
        providerInvoked: true,
        usage: null,
        providerFailureCode: null,
        latencyMs: 900,
        estimatedInputTokens: 500,
        check: null,
      },
    });

    await resolveNovaVoiceGeneration(client(), {
      identity: IDENTITY,
      outcome: {
        message: TEMPLATE,
        source: "template",
        fallbackReason: "provider_failed",
        providerInvoked: true,
        usage: null,
        providerFailureCode: "provider_timeout",
        latencyMs: 20_000,
        estimatedInputTokens: 500,
        check: null,
      },
    });

    expect(storedRow()).toMatchObject({ source: "voice", message: GOOD });
  });
});

describe("a different identity is a different message", () => {
  it("does not serve one project's sentence to another", async () => {
    await ensure();

    const other = computeNovaVoiceIdentity({
      projectId: "22222222-2222-4222-8222-222222222222",
      payload: PAYLOAD,
      model: NOVA_PRESENTATION_CONFIG.model,
    });

    const read = await readNovaVoiceMessage(client(), { identity: other, template: TEMPLATE });

    expect(read).toMatchObject({ message: TEMPLATE, source: "template", resolved: false });
  });

  it("generates again for a payload that changed", async () => {
    await ensure();

    const changed: NovaVoicePayload = { ...PAYLOAD, nextStep: "Something else entirely." };
    await ensure({
      payload: changed,
      claim: {
        ...CLAIM,
        identity: computeNovaVoiceIdentity({
          projectId: PROJECT,
          payload: changed,
          model: NOVA_PRESENTATION_CONFIG.model,
        }),
      },
    });

    expect(generated).toBe(2);
    expect(db.rows("nova_voice_messages")).toHaveLength(2);
  });
});
