import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  statusForFocusTier,
  statusForOperationPhase,
  statusPresentation,
  type StatusKey,
} from "./status-vocabulary";
import { FOCUS_CANDIDATE_KINDS, novaCandidateTier } from "@/modules/nova/focus";

const ALL_KEYS: StatusKey[] = [
  "idle",
  "working",
  "waiting_user",
  "stalled",
  "settled",
  "blocked",
  "decision",
  "ready",
  "setup",
  "nothing_to_do",
  "completed",
  "failed",
  "could_not_check",
  "never_reached",
  "not_applicable",
];

describe("the shared status vocabulary", () => {
  it("gives every state a word, so nothing depends on colour alone", () => {
    for (const key of ALL_KEYS) {
      expect(statusPresentation(key).word.trim().length, key).toBeGreaterThan(0);
    }
  });

  it("never renders a raw enum member as the word", () => {
    for (const key of ALL_KEYS) {
      const { word } = statusPresentation(key);
      expect(word, key).not.toContain("_");
      // A founder reads a phrase, not a machine token: the first character is
      // capitalised and the rest is not screaming case.
      expect(word, key).toMatch(/^[A-Z]/);
      expect(word, key).not.toBe(word.toUpperCase());
    }
  });

  /**
   * The two distinctions the product's honesty rests on. Both were named in
   * the audit as places where one word had been made to carry two states.
   */
  it("never presents waiting as working", () => {
    const waiting = statusForOperationPhase("waiting_user");
    const working = statusForOperationPhase("working");

    expect(waiting.word).not.toBe(working.word);
    expect(waiting.tone).not.toBe(working.tone);
    // `active` is "Vibe is the subject". A paused run is not.
    expect(working.tone).toBe("active");
    expect(waiting.tone).toBe("waiting");
    expect(waiting.word.toLowerCase()).toContain("you");
  });

  it("keeps Vibe's failure apart from the product's", () => {
    const vibes = statusPresentation("could_not_check");
    const products = statusPresentation("failed");

    expect(vibes.word).not.toBe(products.word);
    // Vibe not being able to look is not bad news about the customer's
    // product, so it never takes the failure colour.
    expect(vibes.tone).toBe("waiting");
    expect(products.tone).toBe("problem");
  });

  it("treats a stall as inferred rather than observed", () => {
    // A stall comes from a clock, not from an observation, so it must not be
    // dressed as a failure the product cannot actually claim.
    expect(statusForOperationPhase("stalled").tone).toBe("waiting");
  });

  it("never presents an unmeasurable state as a problem", () => {
    for (const key of ["never_reached", "not_applicable", "idle"] as const) {
      expect(statusPresentation(key).tone, key).toBe("neutral");
    }
  });

  it("covers every tier Nova can rank a candidate into", () => {
    for (const kind of FOCUS_CANDIDATE_KINDS) {
      const presentation = statusForFocusTier(novaCandidateTier(kind));
      expect(presentation.word.trim().length, kind).toBeGreaterThan(0);
    }
  });

  it("says nothing rather than congratulating an empty queue", () => {
    const settled = statusForFocusTier("settled");
    expect(settled.tone).toBe("neutral");
    expect(settled.word).toBe("Nothing to do");
  });
});

/**
 * The rule the vocabulary exists to make enforceable.
 *
 * Four parallel `Record<State, colour>` tables are what the audit found. This
 * asserts Nova's own components grew none: a table keyed on a domain state and
 * valued on a Tailwind colour is the shape being kept out.
 */
describe("Nova components take their words from the vocabulary", () => {
  const NOVA_DIR = join(process.cwd(), "src/app/app/projects/[projectId]/nova");

  const sources = readdirSync(NOVA_DIR)
    .filter((name) => name.endsWith(".tsx"))
    .map((name) => ({ name, body: readFileSync(join(NOVA_DIR, name), "utf8") }));

  it("has components to check", () => {
    expect(sources.length).toBeGreaterThan(0);
  });

  it("declares no local state-to-colour table", () => {
    for (const { name, body } of sources) {
      // `Record<Something, string>` beside a colour literal is the pattern.
      // No `s` flag: the negated classes already cross newlines, and the flag
      // needs an ES2018 target this project does not set.
      const colourTable = /Record<[^>]+>\s*=\s*\{[^}]*text-(mint|amber|coral)/;
      expect(colourTable.test(body), `${name} declares a local tone table`).toBe(false);
    }
  });

  it("declares no local state word list", () => {
    for (const { name, body } of sources) {
      expect(body, name).not.toMatch(/STATE_WORDS|STATUS_TONE\b|TONE_CLASSES/);
    }
  });
});
