import { describe, expect, it } from "vitest";

import { FOCUS_CANDIDATE_KINDS } from "../focus";
import type { FocusCandidateKind } from "../focus";
import { situationAside } from "./aside";
import type { NovaSituation } from "./situation";

/**
 * When the evidence is worth a word, and when saying it would be saying the
 * same thing twice.
 *
 * The failure this forecloses is the one `footnote.ts` already paid for once:
 * two tables that are each right on their own, printing one fact a bubble
 * apart. The other failure is the opposite and worse — an aside that silently
 * never appears, because nobody sees an absence to report it. So every branch
 * is pinned, in both directions.
 */

const STALE_SCAN: NovaSituation = {
  lines: [
    "Your website is the thing to repair first.",
    "Vibe has corrected how it reads this since the last run.",
  ],
  remedy: "Run a fresh Product Scan",
  subject: "live_scan",
};

const OLD_AUDIT: NovaSituation = {
  lines: ["Your business audit was last produced about a week ago."],
  remedy: "Run a new business audit",
  subject: "business_audit",
};

const ALL_CURRENT: NovaSituation = {
  lines: ["Everything Vibe reads from is current."],
  remedy: null,
  subject: null,
};

function aside(situation: NovaSituation, moment: FocusCandidateKind, spoken = false) {
  return situationAside({ situation, moment, spoken });
}

describe("when the evidence is worth a word", () => {
  it("says it beside a moment about something else", () => {
    expect(aside(STALE_SCAN, "merge_ready")).toBe(
      "Your website is the thing to repair first. Vibe has corrected how it reads this since the last run.",
    );
  });

  it("says it when nothing at all is open", () => {
    expect(aside(OLD_AUDIT, "nothing_to_do")).toContain("about a week ago");
  });
});

describe("when saying it would be saying it twice", () => {
  /**
   * The collision this exists for. `audit_outdated` already says the audit is
   * older than the product; a line underneath saying it was produced a week
   * ago is the same fact, one bubble apart.
   */
  it("yields to a moment already about the same document", () => {
    expect(aside(OLD_AUDIT, "audit_outdated")).toBeNull();
  });

  it("yields to the other currency claim, about its own link", () => {
    const staleCode: NovaSituation = {
      lines: ["Your code was last produced a few weeks ago."],
      remedy: "Run a fresh Product Scan",
      subject: "repository_scan",
    };

    expect(aside(staleCode, "repository_read_outdated")).toBeNull();
    /* A different link, so it still says something that moment does not. */
    expect(aside(STALE_SCAN, "repository_read_outdated")).not.toBeNull();
  });

  /**
   * The rule is about *saying the same thing*, not about the same document.
   *
   * A failed scan and a corrected analyzer are both about the scan, and the
   * second is the one worth reading: the run that failed is one problem, and
   * the older run that succeeded being untrustworthy is another.
   */
  it.each(["scan_failed", "scan_stalled"] as const)(
    "still speaks beside %s, which is about a run rather than about currency",
    (moment) => {
      expect(aside(STALE_SCAN, moment)).not.toBeNull();
    },
  );

  /** Offering to plan from a superseded set is the trap the chain exists for. */
  it("still speaks beside a Move moment when the set is stale", () => {
    const staleMoves: NovaSituation = {
      lines: ["Your Moves is the thing to repair first."],
      remedy: "Generate new Moves",
      subject: "opportunity_set",
    };

    expect(aside(staleMoves, "next_move_available")).not.toBeNull();
  });
});

describe("what it never does", () => {
  /**
   * "Everything is current" is news to nobody and would otherwise appear under
   * every moment forever — which is how a line stops being read at all.
   */
  it("stays quiet when nothing is due", () => {
    for (const moment of FOCUS_CANDIDATE_KINDS) {
      expect(aside(ALL_CURRENT, moment), moment).toBeNull();
    }
  });

  /**
   * Nova was given the same facts as background and decided for herself
   * whether to use them. Vibe's own version underneath would be second-guessing
   * her in public.
   */
  it("stays quiet when Nova wrote a sentence herself", () => {
    expect(aside(STALE_SCAN, "merge_ready", true)).toBeNull();
    expect(aside(STALE_SCAN, "merge_ready", false)).not.toBeNull();
  });

  /** Total over the union: a new moment cannot silently lose its aside. */
  it("has an answer for every moment the domain can raise", () => {
    for (const moment of FOCUS_CANDIDATE_KINDS) {
      expect(() => aside(STALE_SCAN, moment), moment).not.toThrow();
    }
  });

  /**
   * And a new moment does not silently *gain* a yield either. Exactly one
   * moment is a currency claim about the audit, and only it goes quiet under
   * an ageing audit; a corrected website scan collides with nothing at all.
   */
  it("yields for exactly the moment that already claims this", () => {
    expect(FOCUS_CANDIDATE_KINDS.filter((moment) => aside(OLD_AUDIT, moment) === null)).toEqual([
      "audit_outdated",
    ]);
    expect(FOCUS_CANDIDATE_KINDS.filter((moment) => aside(STALE_SCAN, moment) === null)).toEqual(
      [],
    );
  });
});
