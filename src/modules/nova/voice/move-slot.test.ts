import { beforeEach, describe, expect, it } from "vitest";

import { findCausalClaims } from "@/modules/business-measurement/causality";
import { FakeDatabase, fakeSupabase, newQueryRecorder } from "@/modules/operations/test-support";
import type { QueryRecorder } from "@/modules/operations/test-support";
import type { BusinessOpportunity } from "@/modules/opportunities/schema";

import { checkNovaMessage } from "./checks";
import {
  buildNovaMoveTemplate,
  buildNovaMoveVoicePayload,
  novaFounderGoal,
  novaMoveSubject,
  novaMoveVoiceIdentity,
  readNovaMoveVoice,
  topMove,
} from "./move-slot";

/**
 * The slot the voice tier has to earn its place on.
 *
 * `audit_result` rephrases prose that was already prose. This one turns
 * structured state into a sentence and connects the founder's goal to a
 * priority Vibe set — so the tests here care about two things the audit slot
 * did not: that the Move chosen is the engine's own top rank rather than a
 * second opinion, and that stating the goal never becomes advising on it.
 */

const PROJECT = "11111111-1111-4111-8111-111111111111";

function move(overrides: Partial<BusinessOpportunity> = {}): BusinessOpportunity {
  return {
    id: "move_1",
    sourceConclusionKey: "blocker:0",
    rank: 1,
    title: "Make the annual price visible before signup",
    problem: "Visitors reach the signup form without knowing what they will pay",
    whyNow: "It blocks the conversion step every other improvement depends on",
    impact: "high",
    effort: "low",
    confidence: "high",
    category: "conversion",
    primaryLens: "conversion",
    secondaryLenses: [],
    ...overrides,
  } as BusinessOpportunity;
}

function subject(overrides: Partial<BusinessOpportunity> = {}) {
  return novaMoveSubject(move(overrides));
}

describe("the Move is the engine's, not Nova's", () => {
  it("picks the lowest rank rather than the first in the array", () => {
    const picked = topMove([
      move({ id: "b", rank: 3, title: "Third" }),
      move({ id: "a", rank: 1, title: "First" }),
      move({ id: "c", rank: 2, title: "Second" }),
    ]);

    expect(picked?.title).toBe("First");
  });

  it("has nothing to say when the set is empty", () => {
    expect(topMove([])).toBeNull();
  });

  /** Every field that reaches the identity is named in one place. */
  it("narrows a Move to exactly four fields", () => {
    expect(Object.keys(subject()).sort()).toEqual(["confidence", "problem", "title", "whyNow"]);
  });
});

describe("the founder's goal is a Vibe label, never their words", () => {
  it("maps the closed vocabulary", () => {
    expect(novaFounderGoal("get_first_users")).toBe("Get first users");
  });

  /** A goal Nova invented and then connected to a priority is the B1 failure. */
  it("stays null when none is on file", () => {
    expect(novaFounderGoal(null)).toBeNull();
  });
});

describe("the template says something without a model", () => {
  it("names the Move and its reason", () => {
    const text = buildNovaMoveTemplate(subject(), null);

    expect(text).toContain("make the annual price visible before signup");
    expect(text).toContain("It blocks the conversion step");
  });

  it("states the goal when there is one", () => {
    const text = buildNovaMoveTemplate(subject(), "Get first users");

    expect(text).toContain("Your goal is to get first users.");
    expect(text).toContain("make the annual price visible before signup");
  });

  /**
   * The B1 case, as a property of the deterministic half. Stating the goal and
   * stating the Move side by side is reporting; "so stop working on features"
   * is a prioritisation Vibe never made — and the ranking comes from the
   * audit, not from the goal.
   */
  it("never advises on the goal, only states it", () => {
    const text = buildNovaMoveTemplate(subject(), "Get first users").toLowerCase();

    for (const advice of [
      "stop working",
      "don't work on",
      "do not work on",
      "instead of",
      "because your goal",
      "so you should",
    ]) {
      expect(text, advice).not.toContain(advice);
    }
  });

  it("does not lowercase a name it drops into a sentence", () => {
    const text = buildNovaMoveTemplate(subject({ title: "SEO basics are missing" }), null);

    expect(text).toContain("SEO basics are missing");
  });

  it("is deterministic", () => {
    expect(buildNovaMoveTemplate(subject(), null)).toBe(buildNovaMoveTemplate(subject(), null));
  });
});

/**
 * The scaffold — the words authored in `move-slot.ts` — held to the same rules
 * as every other Nova sentence.
 *
 * Deliberately not the whole rendered template: `whyNow` is the Move's own
 * prose, written by the opportunity engine and rendered verbatim on the card
 * below, so a sweep over it would be claiming to validate a document that has
 * its own validation. The fixture's `whyNow` is replaced with neutral filler
 * so what is actually asserted is Nova's contribution.
 */
describe("the scaffold obeys the language rules", () => {
  const NEUTRAL = subject({ whyNow: "It sits in front of everything else here." });
  const TEXTS = [
    buildNovaMoveTemplate(NEUTRAL, null),
    buildNovaMoveTemplate(NEUTRAL, "Start monetizing"),
  ];

  it("claims no causes", () => {
    /* Proved live first: an empty result means nothing if the detector is broken. */
    expect(findCausalClaims("This change caused conversions to rise.")).not.toEqual([]);

    for (const text of TEXTS) expect(findCausalClaims(text), text).toEqual([]);
  });

  it("carries no figures", () => {
    for (const text of TEXTS) expect(text, text).not.toMatch(/\d/);
  });

  it("promises no deploy, ship, publish or release", () => {
    for (const text of TEXTS) {
      expect(text, text).not.toMatch(
        /\b(pull request|deploy|deployed|ship|shipped|publish|published|release|released|go live|is live)\b/i,
      );
    }
  });

  /**
   * If Vibe's own fallback would be refused by the validator that judges the
   * model's version, the tier's fallback is a sentence Vibe has decided a
   * founder may not read.
   */
  it("would pass the validator that judges the model's version", () => {
    for (const text of TEXTS) {
      expect(checkNovaMessage({ message: text, allowedNumericFacts: [] }).ok, text).toBe(true);
    }
  });
});

describe("the payload is the Move, arranged", () => {
  it("uses the fact labels the prompt was measured against", () => {
    const payload = buildNovaMoveVoicePayload({ subject: subject(), founderGoal: null });

    expect(payload.facts.map((fact) => fact.label)).toEqual(["move", "problem", "why now"]);
    expect(payload.slot).toBe("move_recommendation");
  });

  /** Impact, effort and any Credit ceiling are rendered from state, not quoted. */
  it("authorizes no numerals at all", () => {
    expect(
      buildNovaMoveVoicePayload({ subject: subject(), founderGoal: null }).allowedNumericFacts,
    ).toEqual([]);
  });

  it("would refuse a model that quoted a figure", () => {
    const check = checkNovaMessage({
      message: "This is a high-impact move you could finish in 2 days.",
      allowedNumericFacts: [],
    });

    expect(check.ok).toBe(false);
  });

  /**
   * No `position` fact. That one exists in the eval for a Move that is not
   * first, where Nova must not imply it is the most important thing; this slot
   * always carries rank 1, so its absence is the honest signal.
   */
  it("states no position, because this is always the top Move", () => {
    const payload = buildNovaMoveVoicePayload({ subject: subject(), founderGoal: null });

    expect(payload.facts.map((fact) => fact.label)).not.toContain("position");
  });

  /** Overstating certainty is the one direction this product may not err in. */
  it.each([
    ["high", "high"],
    ["medium", "low"],
    ["low", "low"],
  ])("hedges a %s-confidence Move as %s", (given, expected) => {
    const payload = buildNovaMoveVoicePayload({
      subject: subject({ confidence: given as BusinessOpportunity["confidence"] }),
      founderGoal: null,
    });

    expect(payload.confidence).toBe(expected);
  });

  it("passes the goal through as a fact the model may connect", () => {
    const payload = buildNovaMoveVoicePayload({
      subject: subject(),
      founderGoal: "Get first users",
    });

    expect(payload.founderGoal).toBe("Get first users");
  });
});

describe("the identity moves with the Move, and with the goal", () => {
  const base = () => novaMoveVoiceIdentity(PROJECT, subject(), null);

  it("is stable for the same Move", () => {
    expect(base()).toBe(base());
  });

  it.each([
    ["the title", { title: "Something else entirely" }],
    ["the problem", { problem: "A different problem" }],
    ["the reason", { whyNow: "A different reason" }],
    ["the confidence", { confidence: "low" as const }],
  ])("moves when %s does", (_label, patch) => {
    expect(novaMoveVoiceIdentity(PROJECT, subject(patch), null)).not.toBe(base());
  });

  /**
   * The one mutable input, and it is worth its cost: a founder who changes
   * their goal should not keep reading a sentence written for the old one.
   */
  it("moves when the founder's goal does", () => {
    expect(novaMoveVoiceIdentity(PROJECT, subject(), "Get first users")).not.toBe(base());
  });

  /**
   * Rank, impact and effort are not in the subject, so a re-ranked set whose
   * top Move is unchanged in substance reuses the sentence rather than paying
   * for an identical one.
   */
  it("does not move when only rank or effort does", () => {
    expect(novaMoveVoiceIdentity(PROJECT, subject({ rank: 4, effort: "high" }), null)).toBe(base());
  });

  it("is not shared between projects", () => {
    expect(novaMoveVoiceIdentity("22222222-2222-4222-8222-222222222222", subject(), null)).not.toBe(
      base(),
    );
  });
});

describe("what a component reads", () => {
  let db: FakeDatabase;
  let recorder: QueryRecorder;

  beforeEach(() => {
    db = new FakeDatabase();
    recorder = newQueryRecorder();
  });

  function read() {
    return readNovaMoveVoice(fakeSupabase(db, recorder), {
      projectId: PROJECT,
      move: move(),
      primaryGoal: null,
    });
  }

  it("shows the template when nothing was ever generated", async () => {
    const result = await read();

    expect(result.message).toBe(buildNovaMoveTemplate(subject(), null));
    expect(result).toMatchObject({ source: "template", resolved: false });
  });

  it("shows the stored sentence when one was", async () => {
    db.seed("nova_voice_messages", {
      identity: novaMoveVoiceIdentity(PROJECT, subject(), null),
      project_id: PROJECT,
      source: "voice",
      fallback_reason: null,
      message: "Pricing is the thing in your way, and it is a small fix.",
      resolved_at: new Date().toISOString(),
    });

    expect(await read()).toMatchObject({
      message: "Pricing is the thing in your way, and it is a small fix.",
      source: "voice",
      resolved: true,
    });
  });

  /** A read model that writes is a render with a side effect. */
  it("writes nothing", async () => {
    await read();

    expect(recorder.writes).toEqual([]);
  });

  it("takes no provider argument at all", () => {
    expect(readNovaMoveVoice.length).toBe(2);
  });

  /**
   * The page this sits on is the founder's plan; the sentence above it is a
   * rephrasing. A screen that failed because a nicety could not be looked up
   * would have made the nicety load-bearing.
   */
  it("shows the template rather than throwing when the read fails", async () => {
    db.failNextReadWith = {
      table: "nova_voice_messages",
      code: "42P01",
      message: 'relation "nova_voice_messages" does not exist',
    };

    const result = await read();

    expect(result.message).toBe(buildNovaMoveTemplate(subject(), null));
    expect(result).toMatchObject({ source: "template", resolved: false });
  });

  /** It cannot look up one Move's message and fall back to another's words. */
  it("falls back to the template for the Move it looked the message up for", async () => {
    db.seed("nova_voice_messages", {
      identity: novaMoveVoiceIdentity(PROJECT, subject(), null),
      project_id: PROJECT,
      source: "voice",
      message: "A sentence about the old Move.",
      resolved_at: new Date().toISOString(),
    });

    const moved = move({ title: "A different Move now", whyNow: "For a different reason." });
    const result = await readNovaMoveVoice(fakeSupabase(db, recorder), {
      projectId: PROJECT,
      move: moved,
      primaryGoal: null,
    });

    expect(result.message).toBe(buildNovaMoveTemplate(novaMoveSubject(moved), null));
    expect(result.message).toContain("a different Move now");
  });
});
