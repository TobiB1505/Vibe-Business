import { describe, expect, it } from "vitest";

import { LIVE_PRODUCT_ANALYZER_VERSION } from "@/modules/live-product-intelligence/schema";
import { buildNovaBriefing } from "@/modules/nova/briefing/briefing";
import { buildBriefingView } from "@/modules/nova/briefing/view";
import type { NovaFocus } from "@/modules/nova/focus";
import { buildProvenanceChain, type ProvenanceInputs } from "@/modules/provenance/chain";
import { ANALYZER_VERSION as REPOSITORY_ANALYZER_VERSION } from "@/modules/repository-intelligence/schema";

import {
  buildNovaBriefingTemplate,
  buildNovaBriefingVoicePayload,
  novaBriefingVoiceIdentity,
} from "./briefing-slot";
import { checkNovaMessage } from "./checks";

/**
 * What the model is given, and what it can never be given.
 *
 * The payload is the whole attack surface of this slot: it is the only thing
 * that reaches a model, and the identity it hashes into is the only thing that
 * decides whether a stored sentence is served. So the properties worth pinning
 * are the ones that are invisible when wrong — a field that drifts between
 * generation and render (a permanent cache miss nobody sees), a digit that
 * becomes storable (a sentence that goes false by the calendar), and the live
 * half leaking into the written one.
 */

const NOW = new Date("2026-09-06T12:00:00.000Z");

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

function chainInputs(overrides: Partial<ProvenanceInputs> = {}): ProvenanceInputs {
  return {
    repositoryScan: { producedAt: daysAgo(0), analyzerVersion: REPOSITORY_ANALYZER_VERSION },
    liveScan: { producedAt: daysAgo(0), analyzerVersion: LIVE_PRODUCT_ANALYZER_VERSION },
    productProfile: { producedAt: daysAgo(0), current: true },
    businessAudit: { producedAt: daysAgo(0), upToDate: true },
    opportunitySet: { producedAt: daysAgo(0), stale: false },
    ...overrides,
  };
}

const IDLE = { primary: { kind: "nothing_to_do" }, nextAction: null } as unknown as NovaFocus;
const BUSY = { primary: { kind: "merge_ready" }, nextAction: null } as unknown as NovaFocus;

function view(
  overrides: {
    chain?: ProvenanceInputs;
    topMove?: { title: string; whyNow: string } | null;
    focus?: NovaFocus;
    founderName?: string | null;
    projectName?: string;
  } = {},
) {
  return buildBriefingView(
    buildNovaBriefing({
      founderName: overrides.founderName ?? "Tobi",
      projectName: overrides.projectName ?? "Vibe Business",
      primaryGoal: "get_first_users",
      chain: buildProvenanceChain(overrides.chain ?? chainInputs()),
      focus: overrides.focus ?? IDLE,
      topMove: overrides.topMove ?? null,
      now: NOW,
    }),
  );
}

const CORRECTED = { liveScan: { producedAt: daysAgo(0), analyzerVersion: "live-product-analyzer-v3" } };
const AGEING = { businessAudit: { producedAt: daysAgo(8), upToDate: true } };
const MOVE = { title: "Put a price on the pricing page", whyNow: "It blocks the signup step." };

/** Every value the `move` read may put in front of a model. Vibe's own words. */
const VIBE_OWN = new Set(["all of it is current", "something is ranked at the top of it"]);

describe("what Vibe says without a model", () => {
  /**
   * Condition 4 of ADR 0086, at its narrowest: the fallback must be the string
   * Vibe would have shown anyway, produced the same way. Anything else and the
   * template is a second wording nobody reviewed.
   */
  it("is exactly the view's own situation, never a second wording", () => {
    for (const built of [view(), view({ chain: chainInputs(CORRECTED) }), view({ topMove: MOVE })]) {
      expect(buildNovaBriefingTemplate(built)).toBe(built.situation);
    }
  });

  /** And it passes the validator every model sentence has to pass. */
  it("would survive the check a written one is held to", () => {
    for (const built of [view(), view({ chain: chainInputs(AGEING) }), view({ topMove: MOVE })]) {
      const check = checkNovaMessage({
        message: buildNovaBriefingTemplate(built),
        allowedNumericFacts: buildNovaBriefingVoicePayload(built).allowedNumericFacts,
      });

      const why = check.failures.map((failure) => failure.code).join(", ");
      expect(check.ok, `${built.situation} → ${why}`).toBe(true);
    }
  });
});

describe("the payload, and what it deliberately leaves out", () => {
  it("names the slot it is written for", () => {
    expect(buildNovaBriefingVoicePayload(view()).slot).toBe("briefing");
  });

  /**
   * The identity is a hash of the payload and the render recomputes it from
   * persisted state. A profile can be corrected at any time, so a product name
   * in here would be a cache miss waiting to happen.
   */
  it("names no product", () => {
    expect(buildNovaBriefingVoicePayload(view()).productName).toBeNull();
  });

  /**
   * The live half must never be written down. `standing` comes from the
   * ranking, which moves when an agent run starts — a stored sentence about it
   * would be wrong within the hour.
   */
  it("says nothing about what is waiting", () => {
    const idle = buildNovaBriefingVoicePayload(view({ focus: IDLE }));
    const busy = buildNovaBriefingVoicePayload(view({ focus: BUSY }));

    expect(busy).toEqual(idle);
    expect(JSON.stringify(idle)).not.toContain("waiting");
  });

  /**
   * The name is a display field, which is why the durable step that generates
   * omits it rather than making a query to fill it. Asserted rather than
   * claimed in a comment.
   */
  it("is identical whatever the project is called or the founder is named", () => {
    expect(buildNovaBriefingVoicePayload(view({ projectName: "", founderName: null }))).toEqual(
      buildNovaBriefingVoicePayload(view({ projectName: "Vibe Business", founderName: "Tobi" })),
    );
  });

  /**
   * The rule `freshness.ts` exists to serve. With an empty allowlist the
   * validator rejects every digit, so "five days" cannot be written into a
   * sentence that is then stored and read a fortnight later.
   */
  it("permits no figure at all", () => {
    for (const built of [view(), view({ chain: chainInputs(AGEING) }), view({ topMove: MOVE })]) {
      expect(buildNovaBriefingVoicePayload(built).allowedNumericFacts).toEqual([]);
    }
  });

  it("carries no digits in its own facts either", () => {
    const payload = buildNovaBriefingVoicePayload(view({ chain: chainInputs(AGEING) }));

    for (const fact of payload.facts) expect(fact.value, fact.label).not.toMatch(/\d/);
  });

  it("states the goal as Vibe's own label", () => {
    expect(buildNovaBriefingVoicePayload(view()).founderGoal).toBe("Get first users");
  });
});

describe("each read reaches the model as its own facts", () => {
  it("gives a repair the link and Vibe's account of it", () => {
    const payload = buildNovaBriefingVoicePayload(view({ chain: chainInputs(CORRECTED) }));

    expect(payload.facts[0]).toEqual({ label: "what to look at first", value: "Your website" });
    expect(payload.facts.map((fact) => fact.value)).toContain(
      "Vibe has corrected how it reads this since the last run.",
    );
    expect(payload.nextStep).toBe("Run a fresh Product Scan");
    expect(payload.confidence).toBe("high");
  });

  it("gives an age the bucket in words, never a count", () => {
    const payload = buildNovaBriefingVoicePayload(view({ chain: chainInputs(AGEING) }));

    expect(payload.facts).toContainEqual({ label: "how long", value: "about a week ago" });
    expect(payload.nextStep).toBe("Run a new business audit");
  });

  /**
   * A rank is the opportunity engine's judgement, not something Vibe measured.
   * `high` here would have Nova vouch for a ranking she is only carrying.
   */
  it("does not vouch for a ranking it is only carrying", () => {
    expect(buildNovaBriefingVoicePayload(view({ topMove: MOVE })).confidence).toBeNull();
  });

  /**
   * The panel prints the Move directly beneath, so the model is never told
   * what it says. Absent rather than forbidden: rejecting a sentence for
   * quoting a fact it was handed would be a validator covering for a payload.
   */
  it("never shows the model the Move's own words", () => {
    const payload = buildNovaBriefingVoicePayload(view({ topMove: MOVE }));

    expect(JSON.stringify(payload)).not.toContain(MOVE.title);
    expect(JSON.stringify(payload)).not.toContain(MOVE.whyNow);
  });

  /** Which also means this read carries no customer content at all. */
  it("reaches the model with nothing a customer wrote", () => {
    const payload = buildNovaBriefingVoicePayload(view({ topMove: MOVE }));

    expect(payload.facts.every((fact) => VIBE_OWN.has(fact.value))).toBe(true);
  });

  it("has facts for every read a briefing can produce", () => {
    for (const built of [
      view({ chain: chainInputs(CORRECTED) }),
      view({ chain: chainInputs(AGEING) }),
      view({ topMove: MOVE }),
      view(),
    ]) {
      const payload = buildNovaBriefingVoicePayload(built);
      expect(payload.facts.length, built.read.kind).toBeGreaterThan(0);
      expect(payload.nextStep.length, built.read.kind).toBeGreaterThan(3);
    }
  });
});

describe("the reuse identity", () => {
  it("is stable for the same situation", () => {
    expect(novaBriefingVoiceIdentity("project_1", view())).toBe(
      novaBriefingVoiceIdentity("project_1", view()),
    );
  });

  /** Tenancy, not cache correctness: two projects can look identical. */
  it("is different for a different project", () => {
    expect(novaBriefingVoiceIdentity("project_1", view())).not.toBe(
      novaBriefingVoiceIdentity("project_2", view()),
    );
  });

  it("moves when the situation does", () => {
    const settled = novaBriefingVoiceIdentity("project_1", view());

    for (const other of [
      view({ chain: chainInputs(CORRECTED) }),
      view({ chain: chainInputs(AGEING) }),
      view({ topMove: MOVE }),
    ]) {
      expect(novaBriefingVoiceIdentity("project_1", other), other.read.kind).not.toBe(settled);
    }
  });

  /**
   * The property the whole freshness bucket exists for: nothing happened, the
   * clock moved, and the sentence Vibe holds is about a week that has ended.
   * A new identity is what stops it being served.
   */
  it("moves when time alone has passed", () => {
    const fresh = buildBriefingView(
      buildNovaBriefing({
        founderName: "Tobi",
        projectName: "Vibe Business",
        primaryGoal: null,
        chain: buildProvenanceChain(chainInputs()),
        focus: IDLE,
        topMove: null,
        now: NOW,
      }),
    );
    const later = buildBriefingView(
      buildNovaBriefing({
        founderName: "Tobi",
        projectName: "Vibe Business",
        primaryGoal: null,
        chain: buildProvenanceChain(chainInputs()),
        focus: IDLE,
        topMove: null,
        now: new Date(NOW.getTime() + 9 * 24 * 60 * 60 * 1000),
      }),
    );

    expect(novaBriefingVoiceIdentity("project_1", fresh)).not.toBe(
      novaBriefingVoiceIdentity("project_1", later),
    );
  });

  /** And not when only the live half did — that is never in a stored message. */
  it("does not move when only what is waiting changed", () => {
    expect(novaBriefingVoiceIdentity("project_1", view({ focus: IDLE }))).toBe(
      novaBriefingVoiceIdentity("project_1", view({ focus: BUSY })),
    );
  });
});
