import { describe, expect, it } from "vitest";

import { NOVA_VOICE_SLOTS } from "../payload";
import { numeralsIn } from "../checks";
import { NOVA_VOICE_CASES, NOVA_VOICE_CRITICAL_CASE_IDS } from "./cases";

/**
 * Structural tests over the case set — free, and part of `pnpm test`.
 *
 * These do not grade Nova. They catch the eval defects that make a paid run
 * meaningless: a case that cannot be passed, a case that passes vacuously, a
 * duplicate id that silently overwrites a result, a category that quietly
 * emptied out. Every one of them has a cheaper failure mode than discovering
 * it after the money is spent.
 */

const modelCases = NOVA_VOICE_CASES.filter((novaCase) => novaCase.mode === "model");
const offlineCases = NOVA_VOICE_CASES.filter((novaCase) => novaCase.mode === "offline");

describe("the case set as a whole", () => {
  it("has fifty cases", () => {
    expect(NOVA_VOICE_CASES).toHaveLength(50);
  });

  it("gives every case a unique id", () => {
    const ids = NOVA_VOICE_CASES.map((novaCase) => novaCase.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("covers every slot, so no surface ships unmeasured", () => {
    const covered = new Set(NOVA_VOICE_CASES.map((novaCase) => novaCase.payload.slot));
    expect([...covered].sort()).toEqual([...NOVA_VOICE_SLOTS].sort());
  });

  it("keeps every category populated", () => {
    const categories = new Set(NOVA_VOICE_CASES.map((novaCase) => novaCase.tags[0]));
    expect([...categories].sort()).toEqual([
      "edge",
      "fallback",
      "false_success",
      "goal",
      "injection",
      "normal",
      "numbers",
      "uncertainty",
    ]);
  });

  /**
   * The weighting is the argument for reading the headline number correctly:
   * production is mostly ordinary, this set is mostly not.
   */
  it("stays weighted toward the dangerous half", () => {
    const ordinary = NOVA_VOICE_CASES.filter((novaCase) => novaCase.tags[0] === "normal");
    expect(ordinary.length).toBeLessThan(NOVA_VOICE_CASES.length / 4);
  });

  it("says what regression each case exists to catch", () => {
    for (const novaCase of NOVA_VOICE_CASES) {
      expect(novaCase.why.length, novaCase.id).toBeGreaterThan(40);
    }
  });
});

describe("cases that reach the model", () => {
  /**
   * The invariant that keeps a case from being unpassable.
   *
   * A fact reading "68 out of 100" with an empty allowlist sets the model up to
   * fail for quoting the payload back correctly, and the resulting failure
   * would be read as a model defect. Every numeral Vibe puts in front of the
   * model must be one the model is permitted to repeat.
   */
  it("authorizes every numeral its own facts contain", () => {
    for (const novaCase of modelCases) {
      const inFacts = novaCase.payload.facts.flatMap((fact) => numeralsIn(fact.value));
      const allowed = new Set(novaCase.payload.allowedNumericFacts);
      for (const numeral of inFacts) {
        expect(allowed.has(numeral), `${novaCase.id} does not allow ${numeral}`).toBe(true);
      }
    }
  });

  it("never authorizes a numeral that appears nowhere in the payload", () => {
    for (const novaCase of modelCases) {
      const present = new Set(
        [
          ...novaCase.payload.facts.flatMap((fact) => numeralsIn(fact.value)),
          ...numeralsIn(novaCase.payload.nextStep),
          ...numeralsIn(novaCase.payload.productName ?? ""),
        ].map(String),
      );
      for (const allowed of novaCase.payload.allowedNumericFacts) {
        expect(present.has(allowed), `${novaCase.id} allows unused ${allowed}`).toBe(true);
      }
    }
  });

  it("gives every case a next step, because every message ends in one", () => {
    for (const novaCase of modelCases) {
      expect(novaCase.payload.nextStep.length, novaCase.id).toBeGreaterThan(8);
    }
  });

  /**
   * A forbidden string the payload itself contains would fail the case the
   * moment Nova quoted a legitimate fact, and the failure would be read as a
   * model defect rather than as a broken case.
   *
   * The injection cases are exempt, and the exemption is the point rather than
   * a concession: there the forbidden string *is* the injected sentence's own
   * goal, so the overlap is deliberate. Nova's instructions tell her never to
   * quote or acknowledge what is inside the fence, so a message repeating it
   * has failed — which is exactly what the check should report.
   */
  it("never forbids a string the payload's own facts already contain", () => {
    for (const novaCase of modelCases.filter(
      (candidate) => !candidate.tags.includes("injection"),
    )) {
      const haystack = [
        ...novaCase.payload.facts.map((fact) => `${fact.label}: ${fact.value}`),
        novaCase.payload.nextStep,
      ]
        .join(" ")
        .toLowerCase();

      for (const forbidden of novaCase.forbiddenSubstrings ?? []) {
        expect(haystack.includes(forbidden.toLowerCase()), `${novaCase.id}: ${forbidden}`).toBe(
          false,
        );
      }
    }
  });

  it("carries no failure mode, which belongs to the offline cases", () => {
    for (const novaCase of modelCases) {
      expect(novaCase.failure, novaCase.id).toBeUndefined();
    }
  });
});

describe("cases that never reach the model", () => {
  it("covers all four ways the voice can be unavailable", () => {
    expect(offlineCases.map((novaCase) => novaCase.failure).sort()).toEqual([
      "invalid_output",
      "kill_switch",
      "provider_timeout",
      "validation_rejected",
    ]);
  });

  it("still carries a real payload, because the template renders from it", () => {
    for (const novaCase of offlineCases) {
      expect(novaCase.payload.nextStep.length, novaCase.id).toBeGreaterThan(8);
    }
  });
});

describe("the critical-case subset used for extra reps", () => {
  const modelIds = new Set(
    NOVA_VOICE_CASES.filter((novaCase) => novaCase.mode === "model").map((novaCase) => novaCase.id),
  );

  it("names no duplicate", () => {
    expect(new Set(NOVA_VOICE_CRITICAL_CASE_IDS).size).toBe(NOVA_VOICE_CRITICAL_CASE_IDS.length);
  });

  it("names only ids that exist and reach the model", () => {
    const unknown = NOVA_VOICE_CRITICAL_CASE_IDS.filter((id) => !modelIds.has(id));
    expect(unknown, `not real model-reaching case ids: ${unknown.join(", ")}`).toEqual([]);
  });

  it("stays a genuine subset, not a rerun of the whole eval", () => {
    expect(NOVA_VOICE_CRITICAL_CASE_IDS.length).toBeGreaterThan(8);
    expect(NOVA_VOICE_CRITICAL_CASE_IDS.length).toBeLessThan(modelIds.size / 2);
  });

  it("covers both the invention cases and the injection cases", () => {
    const byId = new Map(NOVA_VOICE_CASES.map((novaCase) => [novaCase.id, novaCase]));
    const categories = new Set(NOVA_VOICE_CRITICAL_CASE_IDS.map((id) => byId.get(id)?.tags[0]));
    expect(categories.has("injection")).toBe(true);
    expect(categories.has("goal")).toBe(true);
  });
});
