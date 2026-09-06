import { describe, expect, it } from "vitest";

import { LIVE_PRODUCT_ANALYZER_VERSION } from "@/modules/live-product-intelligence/schema";
import { buildProvenanceChain, type ProvenanceInputs } from "@/modules/provenance/chain";
import { ANALYZER_VERSION as REPOSITORY_ANALYZER_VERSION } from "@/modules/repository-intelligence/schema";

import type { NovaFocus } from "../focus";
import { buildNovaBriefing, type BriefingInputs } from "./briefing";

/**
 * The handover, and the three things it must not get wrong.
 *
 * It joins decisions other modules made, so most of it is plumbing — and
 * plumbing is where a briefing comes to describe a different project than the
 * screen beside it. What is actually decided here is small and worth pinning:
 * that a broken link outranks an old one, that the recommendation is the
 * engine's, and that "never produced" is not an age.
 */

const NOW = new Date("2026-09-06T12:00:00.000Z");

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

/** Everything current and produced today, so each test spoils one thing. */
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

const FOCUS: NovaFocus = {
  primary: { kind: "nothing_to_do" },
  secondary: [],
  working: null,
  nextAction: null,
} as unknown as NovaFocus;

function briefing(overrides: Partial<BriefingInputs> = {}) {
  return buildNovaBriefing({
    founderName: "Tobi",
    projectName: "Vibe Business",
    primaryGoal: "get_first_users",
    chain: buildProvenanceChain(chainInputs()),
    focus: FOCUS,
    topMove: null,
    now: NOW,
    ...overrides,
  });
}

describe("who Nova is writing to, and about what", () => {
  it("carries the name the founder gave", () => {
    expect(briefing().founder.name).toBe("Tobi");
  });

  /** No name is a real state, and it is not a placeholder. */
  it("carries null when they have not said", () => {
    expect(briefing({ founderName: null }).founder.name).toBeNull();
  });

  it("states the goal as Vibe's own label, never the founder's words", () => {
    expect(briefing().goal).toEqual({ id: "get_first_users", label: "Get first users" });
  });

  it("has no goal when none is on file", () => {
    expect(briefing({ primaryGoal: null }).goal).toBeNull();
  });
});

describe("the recommendation is the engine's", () => {
  it("passes the top Move through untouched", () => {
    const move = { title: "Make the price visible", whyNow: "It blocks the signup step." };

    expect(briefing({ topMove: move }).recommendation).toEqual(move);
  });

  /**
   * The failure this forecloses: a briefing with no Move that offers one
   * anyway. Nova may voice the engine's ranking; she may not supply one when
   * the engine has not ranked anything.
   */
  it("offers nothing when the engine has ranked nothing", () => {
    expect(briefing({ topMove: null }).recommendation).toBeNull();
  });
});

describe("what to repair first", () => {
  const stale = {
    liveScan: { producedAt: daysAgo(0), analyzerVersion: "live-product-analyzer-v3" },
  };

  it("names the top of the chain, not everything under it", () => {
    const result = briefing({ chain: buildProvenanceChain(chainInputs(stale)) });

    expect(result.firstFix).toEqual({
      link: "live_scan",
      remedy: "product_scan",
      reason: "analyzer_corrected",
    });
  });

  it("has nothing to repair when nothing is wrong", () => {
    expect(briefing().firstFix).toBeNull();
  });

  /**
   * The rule the founder's own example turns on: "your audit is five days old,
   * so let us re-read the product first" — the *order* comes from the chain,
   * not from Nova, and everything below the gap is replaced by fixing it.
   */
  it("points at the scan rather than the audit built on it", () => {
    const result = briefing({ chain: buildProvenanceChain(chainInputs(stale)) });

    expect(result.firstFix?.link).toBe("live_scan");
    expect(result.evidence.find((entry) => entry.kind === "business_audit")?.reason).toBe(
      "built_on_outdated",
    );
  });
});

describe("age, and when it is worth raising", () => {
  it("carries how old every link is", () => {
    const result = briefing({
      chain: buildProvenanceChain(
        chainInputs({
          liveScan: { producedAt: daysAgo(20), analyzerVersion: LIVE_PRODUCT_ANALYZER_VERSION },
        }),
      ),
    });

    expect(result.evidence.find((entry) => entry.kind === "live_scan")?.freshness).toBe(
      "a_few_weeks",
    );
  });

  /** The founder's example: nothing is broken, but it has been sitting. */
  it("raises an old but unbroken link", () => {
    const result = briefing({
      chain: buildProvenanceChain(
        chainInputs({
          businessAudit: { producedAt: daysAgo(8), upToDate: true },
        }),
      ),
    });

    expect(result.firstFix).toBeNull();
    expect(result.ageToRaise).toEqual({ link: "business_audit", freshness: "about_a_week" });
  });

  it("says nothing about an age below the line", () => {
    const result = briefing({
      chain: buildProvenanceChain(
        chainInputs({ businessAudit: { producedAt: daysAgo(2), upToDate: true } }),
      ),
    });

    expect(result.ageToRaise).toBeNull();
  });

  /**
   * One problem, not two. A broken link is a stronger thing to say than an old
   * one, and a briefing that reported both would have Nova open with a
   * complaint about a date and a complaint about a version.
   */
  it("stays quiet about age when something is actually wrong", () => {
    const result = briefing({
      chain: buildProvenanceChain(
        chainInputs({
          liveScan: { producedAt: daysAgo(0), analyzerVersion: "live-product-analyzer-v3" },
          businessAudit: { producedAt: daysAgo(90), upToDate: true },
        }),
      ),
    });

    expect(result.firstFix).not.toBeNull();
    expect(result.ageToRaise).toBeNull();
  });

  /** Absence is reported as absence by the chain, never as an age. */
  it("gives a link that never ran no age at all", () => {
    const result = briefing({
      chain: buildProvenanceChain(chainInputs({ opportunitySet: null })),
    });

    const moves = result.evidence.find((entry) => entry.kind === "opportunity_set");
    expect(moves).toMatchObject({ state: "missing", freshness: null, producedAt: null });
  });
});

/**
 * The property that answers "does it update itself": the same project, the
 * same inputs, a later clock — and a different briefing. Nothing happened; the
 * situation still aged.
 */
describe("time alone changes the briefing", () => {
  it("starts saying an audit is old without anything having happened", () => {
    const inputs = chainInputs({ businessAudit: { producedAt: daysAgo(0), upToDate: true } });

    const today = buildNovaBriefing({
      founderName: "Tobi",
      projectName: "Vibe Business",
      primaryGoal: null,
      chain: buildProvenanceChain(inputs),
      focus: FOCUS,
      topMove: null,
      now: NOW,
    });

    const laterOn = buildNovaBriefing({
      founderName: "Tobi",
      projectName: "Vibe Business",
      primaryGoal: null,
      chain: buildProvenanceChain(inputs),
      focus: FOCUS,
      topMove: null,
      now: new Date(NOW.getTime() + 9 * 24 * 60 * 60 * 1000),
    });

    expect(today.ageToRaise).toBeNull();
    expect(laterOn.ageToRaise).toEqual({ link: "repository_scan", freshness: "about_a_week" });
  });

  /** Because it is derived rather than stored, there is nothing to refresh. */
  it("is a function of its inputs and the clock, and nothing else", () => {
    const once = briefing();
    const twice = briefing();

    expect(once).toEqual(twice);
  });
});
