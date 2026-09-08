import { describe, expect, it } from "vitest";

import { findCausalClaims } from "@/modules/business-measurement/causality";
import { LIVE_PRODUCT_ANALYZER_VERSION } from "@/modules/live-product-intelligence/schema";
import { buildProvenanceChain, type ProvenanceInputs } from "@/modules/provenance/chain";
import { ANALYZER_VERSION as REPOSITORY_ANALYZER_VERSION } from "@/modules/repository-intelligence/schema";

import { buildNovaSituation } from "./situation";

/**
 * The block that travels with every Nova message.
 *
 * It is not a screen and nothing renders it — so what has to be right is not
 * how it reads but what it lets a model say. Three properties carry that: it
 * never contains a figure (a number in a stored sentence goes false by the
 * calendar), it never turns an age into a fault, and it says exactly one thing
 * — the top of the chain — rather than handing over a list a model would have
 * to choose from.
 */

const NOW = new Date("2026-09-06T12:00:00.000Z");

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

function chain(overrides: Partial<ProvenanceInputs> = {}) {
  return buildProvenanceChain({
    repositoryScan: { producedAt: daysAgo(0), analyzerVersion: REPOSITORY_ANALYZER_VERSION },
    liveScan: { producedAt: daysAgo(0), analyzerVersion: LIVE_PRODUCT_ANALYZER_VERSION },
    productProfile: { producedAt: daysAgo(0), current: true },
    businessAudit: { producedAt: daysAgo(0), upToDate: true },
    opportunitySet: { producedAt: daysAgo(0), stale: false },
    ...overrides,
  });
}

const CORRECTED = {
  liveScan: { producedAt: daysAgo(0), analyzerVersion: "live-product-analyzer-v3" },
};
const AGEING = { businessAudit: { producedAt: daysAgo(8), upToDate: true } };

describe("what Nova is told about the evidence", () => {
  it("names the top of the chain and Vibe's account of it", () => {
    expect(buildNovaSituation(chain(CORRECTED), NOW)).toEqual({
      lines: [
        "Your website is the thing to repair first.",
        "Vibe has corrected how it reads this since the last run.",
      ],
      remedy: "Run a fresh Product Scan",
      subject: "live_scan",
    });
  });

  it("names an age in words, and says nothing is wrong with it", () => {
    const situation = buildNovaSituation(chain(AGEING), NOW);

    expect(situation.lines[0]).toBe("Your business audit was last produced about a week ago.");
    expect(situation.lines[1]).toContain("Nothing about it is wrong");
    expect(situation.remedy).toBe("Run a new business audit");
  });

  /** A broken link outranks an old one, and offers the only thing to press. */
  it("says one thing, not two, when both are true", () => {
    const situation = buildNovaSituation(
      chain({ ...CORRECTED, businessAudit: { producedAt: daysAgo(90), upToDate: true } }),
      NOW,
    );

    expect(situation.lines.join(" ")).not.toContain("months ago");
    expect(situation.remedy).toBe("Run a fresh Product Scan");
  });

  it("still says something when nothing is due", () => {
    expect(buildNovaSituation(chain(), NOW)).toEqual({
      lines: ["Everything Vibe reads from is current."],
      remedy: null,
      subject: null,
    });
  });

  /** Absence reaches the model as absence, never as an age. */
  it("reports a link that never ran as the thing to repair", () => {
    const situation = buildNovaSituation(chain({ liveScan: null }), NOW);

    expect(situation.lines).toContain("Vibe has not produced this yet.");
  });
});

describe("time alone changes what Nova is told", () => {
  /**
   * The property `freshness.ts` exists for, seen from the model's side: nothing
   * happened, the clock moved, and the block is different — so the identity is
   * different, and a sentence about a week that has ended cannot be served.
   */
  it("starts mentioning an age without anything having happened", () => {
    const unchanged = chain();

    expect(buildNovaSituation(unchanged, NOW).remedy).toBeNull();
    expect(
      buildNovaSituation(unchanged, new Date(NOW.getTime() + 9 * 24 * 60 * 60 * 1000)).lines[0],
    ).toContain("about a week ago");
  });

  it("holds still inside a bucket", () => {
    const unchanged = chain();
    const day = (n: number) => new Date(NOW.getTime() + n * 24 * 60 * 60 * 1000);

    expect(buildNovaSituation(unchanged, day(4))).toEqual(buildNovaSituation(unchanged, day(10)));
  });
});

describe("what the block may never contain", () => {
  const every = [
    buildNovaSituation(chain(CORRECTED), NOW),
    buildNovaSituation(chain(AGEING), NOW),
    buildNovaSituation(chain({ liveScan: null }), NOW),
    buildNovaSituation(chain(), NOW),
    buildNovaSituation(chain(), new Date(NOW.getTime() + 400 * 24 * 60 * 60 * 1000)),
  ];

  const ALL_COPY = every.flatMap((situation) => [
    ...situation.lines,
    ...(situation.remedy === null ? [] : [situation.remedy]),
  ]);

  /**
   * The rule the buckets exist to serve. The validator rejects every digit a
   * model writes; this is the other half — Vibe must not hand it one either,
   * or the model would fail for repeating what it was told.
   */
  it("carries no figures", () => {
    for (const text of ALL_COPY) expect(text, text).not.toMatch(/\d/);
  });

  it("claims no causes", () => {
    /* Proved live first: an empty result means nothing if the detector is broken. */
    expect(findCausalClaims("This scan caused the audit to fail.")).not.toEqual([]);

    for (const text of ALL_COPY) expect(findCausalClaims(text), text).toEqual([]);
  });

  /** A fresh run may find exactly what the last one did. */
  it("promises no better result from a re-run", () => {
    for (const text of ALL_COPY) {
      expect(text, text).not.toMatch(/\b(will|guarantee[sd]?|ensures?|fixes|improves?)\b/i);
    }
  });

  /** Background, not an instruction. Nova decides whether to mention it. */
  it("does not push", () => {
    for (const text of ALL_COPY) {
      expect(text, text).not.toMatch(
        /\b(you (must|need to|should)|make sure|urgent|immediately)\b/i,
      );
    }
  });

  it("is never empty", () => {
    for (const situation of every) expect(situation.lines.length).toBeGreaterThan(0);
  });
});

/**
 * The claim that lets `subject` stay out of the reuse identity.
 *
 * It is excluded because it changes nothing a model sees or says, and hashing
 * it would invalidate every stored message for a field no model reads. That is
 * only safe while it is *derivable* from what is hashed — the lines, which
 * name the link. So: no two subjects ever share a line set.
 */
describe("the subject is derivable from the lines", () => {
  it("gives every link its own wording", () => {
    const byLines = new Map<string, string | null>();

    for (const [name, spoiled] of [
      ["repository_scan", { repositoryScan: null }],
      ["live_scan", { liveScan: null }],
      ["product_profile", { productProfile: null }],
      ["business_audit", { businessAudit: null }],
      ["opportunity_set", { opportunitySet: null }],
      ["none", {}],
    ] as const) {
      const situation = buildNovaSituation(chain(spoiled), NOW);
      const key = situation.lines.join(" ");

      expect(byLines.has(key), `${name} shares wording with ${byLines.get(key)}`).toBe(false);
      byLines.set(key, name);
    }
  });
});
