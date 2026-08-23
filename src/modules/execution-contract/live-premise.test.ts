import { describe, expect, it } from "vitest";
import { fakeLiveSnapshot } from "@/modules/business-audit/test-support";
import { citedLiveEvidenceIds, evaluateLivePremise } from "./live-premise";

/**
 * The premise a paid run rests on, rechecked (Rule 55).
 *
 * `fakeLiveSnapshot` mints `canonical: present: false` and `sitemap:
 * present: false`, so `live.seo.canonical_missing` and
 * `live.seo.sitemap_missing` are in its pack and `live.seo.title_missing`
 * is not — `title` is present, so no `_missing` id is minted for it at all.
 * That asymmetry is the whole mechanism under test: a fixed defect does not
 * flip a value, its id stops existing.
 */

const STILL_BROKEN = "live.seo.canonical_missing";
/** Minted only while the title is absent, and the fixture's title is present. */
const ALREADY_FIXED = "live.seo.title_missing";

describe("citedLiveEvidenceIds", () => {
  it("takes only live defect ids, and keeps the step's order", () => {
    expect(
      citedLiveEvidenceIds([
        "repo.surface.pricing",
        STILL_BROKEN,
        // Positive live ids are deliberately out of scope: their absence is
        // ambiguous (renamed? behind auth? not reached?), and refusing a paid
        // run on a guess is worse than the failure this prevents.
        "live.surface.pricing",
        "live.seo.sitemap_missing",
        "repo.dep.next",
      ]),
    ).toEqual([STILL_BROKEN, "live.seo.sitemap_missing"]);
  });

  it("leaves a step citing only positive live evidence alone", () => {
    expect(
      evaluateLivePremise({
        evidenceIds: ["live.surface.dashboard_app"],
        snapshot: fakeLiveSnapshot(),
        completeness: "complete",
      }),
    ).toEqual({ status: "not_applicable" });
  });
});

describe("evaluateLivePremise", () => {
  it("says there was nothing to check when no live evidence is cited", () => {
    // Distinct from `verified` on purpose: "nothing to check" and "checked and
    // it holds" are different facts, and only one of them is reassuring.
    expect(
      evaluateLivePremise({
        evidenceIds: ["repo.surface.pricing"],
        snapshot: fakeLiveSnapshot(),
        completeness: "complete",
      }),
    ).toEqual({ status: "not_applicable" });
  });

  it("verifies a defect a complete scan still finds", () => {
    expect(
      evaluateLivePremise({
        evidenceIds: [STILL_BROKEN],
        snapshot: fakeLiveSnapshot(),
        completeness: "complete",
      }),
    ).toEqual({ status: "verified" });
  });

  /**
   * The calibration failure, in one assertion.
   *
   * Three of five fixtures cited a defect that had been fixed since the plan
   * was written and burned a paid run finding nothing to do. A complete scan
   * that no longer mints the id is the fix having happened.
   */
  it("calls a defect a complete scan no longer finds stale, and names it", () => {
    expect(
      evaluateLivePremise({
        evidenceIds: [STILL_BROKEN, ALREADY_FIXED],
        snapshot: fakeLiveSnapshot(),
        completeness: "complete",
      }),
    ).toEqual({ status: "stale", fixedEvidenceIds: [ALREADY_FIXED] });
  });

  /**
   * The sharp edge, and the reason this is not a two-state answer.
   *
   * A budget-degraded crawl (Rule 39) may simply not have reached the page the
   * cited defect is on. Absence then means unobserved, which is the opposite
   * of fixed — so it must not read as either "still broken" or "already done".
   */
  it("refuses to read absence from a partial scan as a fix", () => {
    const verdict = evaluateLivePremise({
      evidenceIds: [ALREADY_FIXED],
      snapshot: fakeLiveSnapshot(),
      completeness: "partial",
    });

    expect(verdict.status).toBe("unverified");
    if (verdict.status !== "unverified") throw new Error("expected unverified");
    // The message has to name what went unobserved, or the refusal is unactionable.
    expect(verdict.reason).toContain(ALREADY_FIXED);
  });

  it("still verifies a partial scan that did observe the cited defect", () => {
    // Partial is only fatal for ids that came back missing. One the scan
    // positively saw is as good a premise as a complete scan's.
    expect(
      evaluateLivePremise({
        evidenceIds: [STILL_BROKEN],
        snapshot: fakeLiveSnapshot(),
        completeness: "partial",
      }),
    ).toEqual({ status: "verified" });
  });

  it("treats a missing snapshot as unverified rather than assuming either way", () => {
    const verdict = evaluateLivePremise({
      evidenceIds: [STILL_BROKEN],
      snapshot: null,
      completeness: null,
    });

    expect(verdict.status).toBe("unverified");
  });
});
