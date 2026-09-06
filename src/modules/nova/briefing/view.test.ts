import { describe, expect, it } from "vitest";

import { findCausalClaims } from "@/modules/business-measurement/causality";
import { LIVE_PRODUCT_ANALYZER_VERSION } from "@/modules/live-product-intelligence/schema";
import {
  buildProvenanceChain,
  LINK_REMEDY,
  type ProvenanceInputs,
} from "@/modules/provenance/chain";
import { ANALYZER_VERSION as REPOSITORY_ANALYZER_VERSION } from "@/modules/repository-intelligence/schema";

import type { NovaFocus } from "../focus";
import { buildNovaBriefing, type BriefingInputs } from "./briefing";
import {
  BRIEFING_EVIDENCE_LABEL,
  BRIEFING_GOAL_PREFIX,
  BRIEFING_HEADING,
  BRIEFING_SOURCE_NOTE,
  BRIEFING_STANDING,
  buildBriefingView,
} from "./view";

/**
 * What the briefing says out loud, and the line it must not cross.
 *
 * Nova may report and she may advise. She may not push: no urgency Vibe has
 * not measured, no figure she computed into a sentence, no promise about what
 * a re-run will produce. Those are the same rules `checks.ts` holds every Nova
 * message to and `provenance-copy.test.ts` holds the panel beside this one to,
 * applied here to the one surface that talks about *time*.
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

function view(overrides: Partial<BriefingInputs> = {}) {
  return buildBriefingView(
    buildNovaBriefing({
      founderName: "Tobi",
      projectName: "Vibe Business",
      primaryGoal: "get_first_users",
      chain: buildProvenanceChain(chainInputs()),
      focus: IDLE,
      topMove: null,
      now: NOW,
      ...overrides,
    }),
  );
}

describe("who it is addressed to", () => {
  it("carries the name and the product", () => {
    expect(view()).toMatchObject({ founderName: "Tobi", projectName: "Vibe Business" });
  });

  it("carries no name when none was given", () => {
    expect(view({ founderName: null }).founderName).toBeNull();
  });

  it("states the goal as Vibe's own label", () => {
    expect(view().goalLabel).toBe("Get first users");
  });

  it("states no goal when none is on file", () => {
    expect(view({ primaryGoal: null }).goalLabel).toBeNull();
  });
});

describe("what is waiting, said once", () => {
  it("says nothing is waiting when nothing is", () => {
    expect(view().standing).toBe(BRIEFING_STANDING.clear);
  });

  /**
   * Points at the card above rather than repeating its sentence. Two
   * components describing one open item in different words is how a founder
   * comes to believe there are two.
   */
  it("points at the card above when something is", () => {
    expect(view({ focus: BUSY }).standing).toBe(BRIEFING_STANDING.waiting);
  });
});

describe("the chain, with an age on every link", () => {
  it("lists every link the chain holds, in the chain's order", () => {
    expect(view().rows.map((row) => row.kind)).toEqual([
      "repository_scan",
      "live_scan",
      "product_profile",
      "business_audit",
      "opportunity_set",
    ]);
  });

  it("gives each row Vibe's own label and a real timestamp to render", () => {
    const row = view().rows[0];

    expect(row.label).toBe("Your code");
    expect(row.producedAt).toBe(daysAgo(0));
  });

  /** The bucket, in words. The exact figure stays the screen's job. */
  it("says an age in words and never in numbers", () => {
    const aged = view({
      chain: buildProvenanceChain(
        chainInputs({ businessAudit: { producedAt: daysAgo(8), upToDate: true } }),
      ),
    });

    const audit = aged.rows.find((row) => row.kind === "business_audit");
    expect(audit?.age).toBe("about a week ago");
  });

  it("gives a link that never ran no age at all", () => {
    const fresh = view({ chain: buildProvenanceChain(chainInputs({ opportunitySet: null })) });

    expect(fresh.rows.find((row) => row.kind === "opportunity_set")).toMatchObject({
      state: "missing",
      age: null,
      producedAt: null,
    });
  });

  /** Exactly one row is the subject, so the panel cannot mark two or none. */
  it("marks the row the read is about, and only that one", () => {
    const broken = view({
      chain: buildProvenanceChain(
        chainInputs({
          liveScan: { producedAt: daysAgo(0), analyzerVersion: "live-product-analyzer-v3" },
        }),
      ),
    });

    expect(broken.rows.filter((row) => row.subject).map((row) => row.kind)).toEqual(["live_scan"]);
  });

  it("marks no row when the read is not about one", () => {
    expect(view().rows.some((row) => row.subject)).toBe(false);
  });
});

describe("Nova's read, and what outranks what", () => {
  const corrected = {
    liveScan: { producedAt: daysAgo(0), analyzerVersion: "live-product-analyzer-v3" },
  };

  it("names the top of the chain when something is broken", () => {
    const read = view({ chain: buildProvenanceChain(chainInputs(corrected)) }).read;

    expect(read).toMatchObject({
      kind: "repair",
      subject: "live_scan",
      remedy: "product_scan",
      remedyLabel: "Run a fresh Product Scan",
      free: true,
    });
  });

  it("carries the chain's own account of what is wrong", () => {
    const read = view({ chain: buildProvenanceChain(chainInputs(corrected)) }).read;

    expect(read.sentences).toContain("Vibe has corrected how it reads this since the last run.");
  });

  /** The founder's own example: nothing wrong, and it has been sitting. */
  it("raises an old but unbroken link, and offers what produces it", () => {
    const read = view({
      chain: buildProvenanceChain(
        chainInputs({ businessAudit: { producedAt: daysAgo(8), upToDate: true } }),
      ),
    }).read;

    expect(read).toMatchObject({
      kind: "age",
      subject: "business_audit",
      remedy: "business_audit",
      free: false,
    });
    expect(read.sentences[0]).toBe("Your business audit was last produced about a week ago.");
  });

  /**
   * The offer after an age is conditional, because Nova cannot see whether the
   * product moved. That is advice; an imperative would be a push.
   */
  it("offers rather than instructs", () => {
    const paragraph = view({
      chain: buildProvenanceChain(
        chainInputs({ businessAudit: { producedAt: daysAgo(8), upToDate: true } }),
      ),
    }).paragraph;

    expect(paragraph).toContain("Nothing about it is wrong");
    expect(paragraph).toContain("if your product has moved since");
  });

  it("quotes the engine's Move when the evidence is sound", () => {
    const move = { title: "Make the price visible", whyNow: "It blocks the signup step." };

    expect(view({ topMove: move }).read).toMatchObject({
      kind: "move",
      title: move.title,
      whyNow: move.whyNow,
    });
  });

  /** A broken link outranks a Move built on it, however good the Move is. */
  it("repairs before it recommends", () => {
    const read = view({
      chain: buildProvenanceChain(chainInputs(corrected)),
      topMove: { title: "Make the price visible", whyNow: "It blocks the signup step." },
    }).read;

    expect(read.kind).toBe("repair");
  });

  it("says so plainly when there is nothing to say", () => {
    expect(view().read.kind).toBe("settled");
  });
});

describe("every remedy the read offers is the one that produces the link", () => {
  /**
   * The failure this forecloses is a second table. `LINK_REMEDY` is the chain's
   * own, and the read looks it up rather than keeping a copy — so an offer here
   * and the button on the provenance panel cannot come to disagree.
   */
  it.each([
    ["repository_scan", { repositoryScan: null }],
    ["live_scan", { liveScan: null }],
    ["product_profile", { productProfile: null }],
    ["business_audit", { businessAudit: null }],
    ["opportunity_set", { opportunitySet: null }],
  ] as const)("offers %s's own remedy", (link, missing) => {
    const read = view({ chain: buildProvenanceChain(chainInputs(missing)) }).read;

    expect(read).toMatchObject({ kind: "repair", subject: link, remedy: LINK_REMEDY[link] });
  });
});

describe("the sentences claim nothing they cannot show", () => {
  /** Every fixed string, plus one composed read of each kind. */
  const composed = [
    view({ chain: buildProvenanceChain(chainInputs({ liveScan: null })) }).read,
    view({
      chain: buildProvenanceChain(
        chainInputs({ businessAudit: { producedAt: daysAgo(60), upToDate: true } }),
      ),
    }).read,
    view({ topMove: { title: "T", whyNow: "W" } }).read,
    view().read,
  ];

  const ALL_COPY = [
    BRIEFING_HEADING,
    BRIEFING_SOURCE_NOTE,
    BRIEFING_GOAL_PREFIX,
    BRIEFING_EVIDENCE_LABEL,
    ...Object.values(BRIEFING_STANDING),
    ...composed.flatMap((read) => [
      ...read.sentences,
      "remedyLabel" in read ? read.remedyLabel : null,
    ]),
  ].filter((text): text is string => typeof text === "string");

  it("leaves no sentence empty", () => {
    for (const text of ALL_COPY) expect(text.trim().length, text).toBeGreaterThan(3);
  });

  /**
   * The rule the whole freshness bucket exists to serve: a sentence Nova could
   * one day have written and stored must not carry a number, because the
   * number would keep being displayed after it stopped being true.
   */
  it("carries no figures", () => {
    for (const text of ALL_COPY) expect(text, text).not.toMatch(/\d/);
  });

  it("claims no causes", () => {
    /* Proved live first: an empty result means nothing if the detector is broken. */
    expect(findCausalClaims("This change caused signups to rise.")).not.toEqual([]);

    for (const text of ALL_COPY) expect(findCausalClaims(text), text).toEqual([]);
  });

  /** A fresh run may find exactly what the last one did. */
  it("promises no better result from a re-run", () => {
    for (const text of ALL_COPY) {
      expect(text, text).not.toMatch(/\b(will|guarantee[sd]?|ensures?|fixes|improves?)\b/i);
    }
  });

  /** Advice, never a command. "You must", "you need to", "make sure". */
  it("does not push", () => {
    for (const text of ALL_COPY) {
      expect(text, text).not.toMatch(
        /\b(you (must|need to|should)|make sure|right now, before|urgent|immediately)\b/i,
      );
    }
  });

  it("admits what Nova does not see", () => {
    expect(BRIEFING_SOURCE_NOTE).toContain("does not watch");
  });
});

/**
 * The paragraph is the surface.
 *
 * The first build of this panel rendered these fields as a table of labelled
 * rows, and the founder's answer settled what the module is for: the facts
 * were all there and none of them was being *said*. So the property worth
 * pinning is that the paragraph is one piece of prose carrying the standing
 * and the read together — and that it stays Vibe's own words, with the
 * founder's name left to the panel.
 */
describe("the paragraph Nova actually says", () => {
  it("opens with where things stand and continues with the read", () => {
    const built = view({
      chain: buildProvenanceChain(
        chainInputs({ businessAudit: { producedAt: daysAgo(8), upToDate: true } }),
      ),
    });

    expect(built.paragraph).toBe(
      "Nothing is waiting on you right now. " +
        "Your business audit was last produced about a week ago. " +
        "Nothing about it is wrong, but if your product has moved since, a fresh run would give Vibe something newer to read.",
    );
  });

  it("says every sentence the read carries, and only those", () => {
    for (const built of [
      view(),
      view({ topMove: { title: "T", whyNow: "W" } }),
      view({ chain: buildProvenanceChain(chainInputs({ liveScan: null })) }),
    ]) {
      expect(built.paragraph).toBe([built.standing, ...built.read.sentences].join(" "));
    }
  });

  /**
   * The name is the panel's to set as a lead-in. Keeping it out is what lets
   * every string the builder produces be swept for figures and claims — and
   * what will let a written paragraph be checked the same way.
   */
  it("carries no name, however the founder is addressed", () => {
    expect(view({ founderName: "Tobi" }).paragraph).not.toContain("Tobi");
    expect(view({ founderName: "Tobi" }).paragraph).toBe(view({ founderName: null }).paragraph);
  });

  /** The Move is quoted beside the paragraph, never folded into it. */
  it("points at the Move without restating it", () => {
    const move = { title: "Put a price on the pricing page", whyNow: "It blocks signup." };
    const built = view({ topMove: move });

    expect(built.paragraph).not.toContain(move.title);
    expect(built.paragraph).not.toContain(move.whyNow);
    expect(built.paragraph).toContain("the top of your list");
  });

  it("reads as sentences rather than fragments", () => {
    for (const built of [view(), view({ topMove: { title: "T", whyNow: "W" } })]) {
      expect(built.paragraph, built.paragraph).toMatch(/^[A-Z][^\n]*\.$/);
    }
  });
});
