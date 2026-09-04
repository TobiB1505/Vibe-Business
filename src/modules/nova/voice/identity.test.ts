import { describe, expect, it } from "vitest";

import {
  DEFAULT_NOVA_VOICE_LOCALE,
  NOVA_VOICE_LOCALES,
  NOVA_VOICE_POLICY_VERSION,
  NOVA_VOICE_PROMPT_VERSION,
  canonicalPayload,
  computeNovaVoiceIdentity,
} from "./payload";
import type { NovaVoicePayload } from "./payload";

/**
 * What makes two Nova messages the same message.
 *
 * The identity is the whole reuse contract (ADR 0085), and it fails in one
 * direction quietly: an input that changes the output but not the hash serves
 * a stale sentence forever, and nothing errors. So every input is asserted to
 * move it, one at a time, rather than trusted to because it appears in the
 * function body.
 */

const PROJECT = "11111111-1111-4111-8111-111111111111";
const OTHER_PROJECT = "22222222-2222-4222-8222-222222222222";
const MODEL = "claude-sonnet-5";

const PAYLOAD: NovaVoicePayload = {
  slot: "audit_result",
  productName: "Klinikplan",
  founderGoal: "more_signups",
  facts: [
    { label: "biggest blocker", value: "Pricing clarity" },
    { label: "why it blocks", value: "The annual plan's price is not stated before signup" },
  ],
  allowedNumericFacts: ["35"],
  confidence: "high",
  nextStep: "Look at the full breakdown below.",
};

function identity(overrides: Partial<Parameters<typeof computeNovaVoiceIdentity>[0]> = {}) {
  return computeNovaVoiceIdentity({
    projectId: PROJECT,
    payload: PAYLOAD,
    model: MODEL,
    ...overrides,
  });
}

const BASELINE = identity();

describe("the identity is stable", () => {
  it("is a sha256 hex digest", () => {
    expect(BASELINE).toMatch(/^[0-9a-f]{64}$/);
  });

  it("does not move when nothing does", () => {
    expect(identity()).toBe(BASELINE);
  });

  /**
   * A payload rebuilt from the same state produces the same identity even
   * though it is a different object. Without this, every render would be a
   * cache miss and the store would be a table that only ever grows.
   */
  it("does not move for an equal payload built again", () => {
    expect(
      identity({
        payload: {
          slot: "audit_result",
          productName: "Klinikplan",
          founderGoal: "more_signups",
          facts: [
            { label: "biggest blocker", value: "Pricing clarity" },
            {
              label: "why it blocks",
              value: "The annual plan's price is not stated before signup",
            },
          ],
          allowedNumericFacts: ["35"],
          confidence: "high",
          nextStep: "Look at the full breakdown below.",
        },
      }),
    ).toBe(BASELINE);
  });

  /** The default is explicit, so a caller that omits locale is not a third case. */
  it("treats an omitted locale as the default one", () => {
    expect(identity({ locale: DEFAULT_NOVA_VOICE_LOCALE })).toBe(BASELINE);
  });

  it("treats omitted versions as the ones in force", () => {
    expect(
      identity({
        promptVersion: NOVA_VOICE_PROMPT_VERSION,
        policyVersion: NOVA_VOICE_POLICY_VERSION,
      }),
    ).toBe(BASELINE);
  });
});

describe("every output-relevant input moves the identity", () => {
  /**
   * Tenancy, not correctness. Two projects can produce a byte-identical
   * payload — the generic slots make that likely rather than exotic — and a
   * row keyed on content alone would serve one customer's stored message to
   * another.
   */
  it("moves for a different project", () => {
    expect(identity({ projectId: OTHER_PROJECT })).not.toBe(BASELINE);
  });

  it("moves for a different model", () => {
    expect(identity({ model: "claude-haiku-4-5-20251001" })).not.toBe(BASELINE);
  });

  it("moves for a different prompt version", () => {
    expect(identity({ promptVersion: "nova-voice-prompt-v5" })).not.toBe(BASELINE);
  });

  it("moves for a different policy version", () => {
    expect(identity({ policyVersion: "nova-voice-policy-v2" })).not.toBe(BASELINE);
  });

  /**
   * There is one locale today, so this asks the question the type system
   * cannot: is `locale` actually hashed? A second locale is the moment the
   * answer matters and the wrong answer is invisible — every founder in the
   * new language served the English sentence from cache — so it is asked now,
   * with the value forced past the union.
   */
  it("moves for a different locale", () => {
    const de = computeNovaVoiceIdentity({
      projectId: PROJECT,
      payload: PAYLOAD,
      model: MODEL,
      locale: "de" as (typeof NOVA_VOICE_LOCALES)[number],
    });

    expect(de).not.toBe(BASELINE);
  });

  it.each([
    ["the slot", { slot: "move_recommendation" as const }],
    ["the product name", { productName: "Something else" }],
    ["the founder's goal", { founderGoal: "reduce_churn" }],
    ["a fact's value", { facts: [{ label: "biggest blocker", value: "Something else" }] }],
    ["a fact's label", { facts: [{ label: "smallest blocker", value: "Pricing clarity" }] }],
    ["the numeric allowlist", { allowedNumericFacts: ["36"] }],
    ["the confidence", { confidence: "low" as const }],
    ["the next step", { nextStep: "Something else entirely." }],
  ])("moves for a change to %s", (_label, patch) => {
    expect(identity({ payload: { ...PAYLOAD, ...patch } })).not.toBe(BASELINE);
  });

  /**
   * Dropping a fact must not collide with keeping it. A serialization that
   * joined values without their structure would let two different payloads
   * hash the same, which is the one failure mode a hash cannot report.
   */
  it("moves when a fact is removed", () => {
    expect(identity({ payload: { ...PAYLOAD, facts: [PAYLOAD.facts[0]] } })).not.toBe(BASELINE);
  });

  it("moves when two facts swap places", () => {
    expect(identity({ payload: { ...PAYLOAD, facts: [...PAYLOAD.facts].reverse() } })).not.toBe(
      BASELINE,
    );
  });
});

describe("the canonical payload is the one definition of a payload", () => {
  /**
   * Key order is fixed by hand rather than left to `JSON.stringify` over an
   * object literal, because a reordered literal is exactly the kind of edit
   * that silently halves a hit rate while every test still passes.
   */
  it("does not depend on the order the object's keys were written in", () => {
    const reordered: NovaVoicePayload = {
      nextStep: PAYLOAD.nextStep,
      confidence: PAYLOAD.confidence,
      allowedNumericFacts: PAYLOAD.allowedNumericFacts,
      facts: PAYLOAD.facts,
      founderGoal: PAYLOAD.founderGoal,
      productName: PAYLOAD.productName,
      slot: PAYLOAD.slot,
    };

    expect(canonicalPayload(reordered)).toBe(canonicalPayload(PAYLOAD));
  });

  /** Every field of the payload reaches the string, so nothing is silently unhashed. */
  it("carries every field the payload has", () => {
    const serialized = canonicalPayload(PAYLOAD);

    expect(serialized).toContain(PAYLOAD.slot);
    expect(serialized).toContain("Klinikplan");
    expect(serialized).toContain("more_signups");
    expect(serialized).toContain("biggest blocker");
    expect(serialized).toContain("Pricing clarity");
    expect(serialized).toContain("35");
    expect(serialized).toContain("high");
    expect(serialized).toContain(PAYLOAD.nextStep);
  });
});
