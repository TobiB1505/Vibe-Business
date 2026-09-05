import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  novaPresenceState,
  statusForFocusTier,
  statusForOperationPhase,
  statusForScoreTone,
  statusPresentation,
  type StatusKey,
} from "./status-vocabulary";
import type { NovaFocusTier } from "@/modules/nova/focus";
import type { OperationPollPhase } from "@/modules/operations/view";
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
 * Nova's mark, and the one claim it must never make.
 *
 * The prototype this avatar comes from sets a presence per scene. In the
 * product that would be a mark a caller can point at `working`, which is
 * `DESIGN.md`'s one absolute: fabricated activity is a lie rather than a
 * style. So the state is derived, and these are the derivations.
 */
describe("Nova's presence state", () => {
  const TIERS: NovaFocusTier[] = ["blocked", "decision", "ready", "setup", "settled"];
  const PHASES: OperationPollPhase[] = ["idle", "working", "waiting_user", "stalled", "settled"];

  it("turns the frame only while an operation is genuinely running", () => {
    for (const tier of TIERS) {
      for (const phase of PHASES) {
        const state = novaPresenceState({ tier, phase });
        if (state === "working") {
          expect(phase, `tier ${tier} / phase ${phase} claimed work`).toBe("working");
        }
      }
    }
  });

  it("never treats a stall as working", () => {
    // A stall is inferred from a clock, not observed. A turning frame over a
    // run that may already be dead is the animated form of the same lie.
    for (const tier of TIERS) {
      expect(novaPresenceState({ tier, phase: "stalled" }), tier).not.toBe("working");
    }
  });

  it("listens when the work is with the founder", () => {
    expect(novaPresenceState({ tier: "ready", phase: "waiting_user" })).toBe("listening");
    expect(novaPresenceState({ tier: "decision", phase: "idle" })).toBe("listening");
  });

  it("settles only when there is genuinely nothing to do", () => {
    expect(novaPresenceState({ tier: "settled", phase: "idle" })).toBe("settled");
    // Blocked is not settled. Something is wrong and Nova is not acting on it.
    expect(novaPresenceState({ tier: "blocked", phase: "idle" })).toBe("idle");
  });

  it("prefers observed work over a tier's opinion", () => {
    // A running operation while the ranking's top item is a decision: the
    // machine is doing something, and that is the more specific fact.
    expect(novaPresenceState({ tier: "decision", phase: "working" })).toBe("working");
  });

  it("answers for every combination the domain can produce", () => {
    for (const tier of TIERS) {
      for (const phase of PHASES) {
        expect(["idle", "listening", "working", "settled"]).toContain(
          novaPresenceState({ tier, phase }),
        );
      }
    }
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

/**
 * Audit P3.20 — "remove duplicated `SCORE_TONE` maps".
 *
 * There were three, in the product card, the products-index row and the
 * dashboard's signal card, four identical lines each. None of them was wrong;
 * that is the point. A band renders in two colours on adjacent screens only
 * after somebody edits one copy, and nothing in this repository would have
 * failed when they did.
 *
 * The check is deliberately repo-wide rather than scoped to a directory: the
 * copies were spread across three, and a scoped check would have caught none
 * of them.
 */
describe("a score band has one tone table", () => {
  const ROOT = join(process.cwd(), "src");

  function sourcesUnder(dir: string): { path: string; body: string }[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return sourcesUnder(full);
      if (!entry.name.endsWith(".tsx") && !entry.name.endsWith(".ts")) return [];
      return [{ path: full, body: readFileSync(full, "utf8") }];
    });
  }

  const sources = sourcesUnder(ROOT);

  it("finds the sources it is supposed to be checking", () => {
    expect(sources.length).toBeGreaterThan(200);
  });

  it("maps ScoreTone to a StatusTone in exactly one place", () => {
    const declaring = sources
      .filter(({ body }) => /Record<ScoreTone,\s*StatusTone>/.test(body))
      .map(({ path }) => path.slice(ROOT.length + 1));

    expect(
      declaring,
      "Use `statusForScoreTone` from this module instead of a local table — " +
        "three copies is how one band starts rendering in two colours.",
    ).toEqual([]);
  });

  it("gives every band a tone, and never calls an unscored product a failure", () => {
    expect(statusForScoreTone("strong")).toBe("success");
    expect(statusForScoreTone("partial")).toBe("waiting");
    expect(statusForScoreTone("weak")).toBe("problem");
    // Rule 44 in pixels: nothing measurable is not a bad result.
    expect(statusForScoreTone("unscored")).toBe("neutral");
    expect(statusForScoreTone("unscored")).not.toBe("problem");
  });
});

/**
 * Audit P3.20 — "remove the local `formatDate`".
 *
 * Billing carried its own, built on `toLocaleDateString("en-GB")`. Two things
 * followed and both were live: it printed "15 Sept 2026" where every other
 * surface prints "15 Sep 2026", and it read the *runtime's* timezone, so a
 * balance expiring at `2026-09-01T00:00Z` renders as "31 Aug 2026" anywhere
 * west of UTC — a date a customer plans around, off by a day, on the one page
 * where that is money.
 */
describe("one date formatter", () => {
  const ROOT = join(process.cwd(), "src");

  function sourcesUnder(dir: string): { path: string; body: string }[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return sourcesUnder(full);
      if (!entry.name.endsWith(".tsx") && !entry.name.endsWith(".ts")) return [];
      return [{ path: full, body: readFileSync(full, "utf8") }];
    });
  }

  /**
   * Comments are stripped first. The first version of this matched the word
   * anywhere, and named two files whose docblocks *describe having removed*
   * exactly this call (PERF-021) — a check that fails on a record of the fix
   * is worse than no check, because the obvious way to quiet it is to delete
   * the explanation.
   */
  function code(body: string): string {
    return body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  }

  it("leaves no local date formatter to drift from the shared one", () => {
    const offenders = sourcesUnder(ROOT)
      .filter(({ path }) => !path.endsWith(join("lib", "utils", "format-datetime.ts")))
      .filter(({ body }) => /\.toLocale(Date|Time)String\s*\(/.test(code(body)))
      .map(({ path }) => path.slice(ROOT.length + 1));

    expect(
      offenders,
      "Use `formatDate`/`formatTimestamp` from lib/utils/format-datetime — they " +
        "are explicit about UTC, and a locale formatter reads the runtime's timezone.",
    ).toEqual([]);
  });
});
