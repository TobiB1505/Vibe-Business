import { describe, expect, it } from "vitest";
import { OPERATION_FAILURE_MESSAGES } from "@/modules/operations/messages";
import type { OpportunityBlockReason } from "./service";
import {
  EXECUTION_READINESS,
  EXECUTION_READINESS_LABELS,
  type BusinessOpportunity,
} from "./schema";
import {
  BUSINESS_AUDIT_ANCHOR,
  MOVE_BAND_LABELS,
  buildOpportunityBlockNotice,
  moveBand,
  moveHeadline,
  moveLensLabel,
  moveSummaryCounts,
} from "./view";

/**
 * The blocked state of the Opportunities section (Sprint 8 §34).
 *
 * One invariant carries the whole file: **a block always offers a way out.**
 * Deep Scan shipped a dead end twice — a heading, a sentence, a disabled
 * button, nothing to click — and both times it was reported as the feature
 * being broken. This is the test that stops the third time.
 */

const ALL_REASONS: OpportunityBlockReason[] = ["audit_missing", "audit_stale"];

describe("buildOpportunityBlockNotice", () => {
  it("says nothing when generation is available", () => {
    expect(buildOpportunityBlockNotice(null)).toBeNull();
  });

  it.each(ALL_REASONS)("gives %s an action and somewhere to go", (reason) => {
    const notice = buildOpportunityBlockNotice(reason);

    expect(notice).not.toBeNull();
    expect(notice?.actionLabel.length).toBeGreaterThan(0);
    expect(notice?.anchor).toBe(BUSINESS_AUDIT_ANCHOR);
  });

  it.each(ALL_REASONS)("has user-facing copy for %s", (reason) => {
    // The panel renders this message beside the action. A reason with an
    // action but no explanation is only half a way out.
    expect(OPERATION_FAILURE_MESSAGES[reason]).toBeTruthy();
  });

  it("asks for a first audit rather than an update when none exists", () => {
    expect(buildOpportunityBlockNotice("audit_missing")?.actionLabel).toContain("Run");
    expect(buildOpportunityBlockNotice("audit_stale")?.actionLabel).toContain("Update");
  });
});

/**
 * The Action Plan workspace's derived reading (ACTION PLAN UI-2).
 *
 * These four functions exist because the workspace shows a band, a headline, a
 * business area and three counts — and none of them may be a guess. So each
 * test below is really the same test: *does this say only what the stored Move
 * already said?*
 */

function move(overrides: Partial<BusinessOpportunity> = {}): BusinessOpportunity {
  return {
    id: "move_1",
    sourceConclusionKey: null,
    rank: 1,
    title: "Make your pricing visible",
    problem: "Customers cannot see or buy it yet.",
    whyNow: "Revenue depends on it.",
    impact: "high",
    effort: "medium",
    confidence: "high",
    category: "monetization",
    primaryLens: "revenue_economics",
    secondaryLenses: [],
    evidenceIds: [],
    executionType: "code_change",
    executionReadiness: "ready",
    dependencies: [],
    ...overrides,
  };
}

describe("moveBand", () => {
  it("reads the engine's own order rather than a second one", () => {
    expect(moveBand(1)).toBe("now");
    expect(moveBand(2)).toBe("next");
    expect(moveBand(3)).toBe("later");
    expect(moveBand(5)).toBe("later");
  });

  it("has a label for every band", () => {
    for (const band of ["now", "next", "later"] as const) {
      expect(MOVE_BAND_LABELS[band].length).toBeGreaterThan(0);
    }
  });
});

describe("moveHeadline", () => {
  it("leads with readiness", () => {
    expect(moveHeadline(move({ executionReadiness: "ready" }))).toEqual({
      kind: "ready",
      label: "Ready for Vibe",
    });
    expect(moveHeadline(move({ executionReadiness: "needs_user_input" }))).toEqual({
      kind: "needs_input",
      label: "Needs your input",
    });
    expect(moveHeadline(move({ executionReadiness: "not_supported_yet" }))).toEqual({
      kind: "not_automated",
      label: "Not automated yet",
    });
  });

  it("says what a low-impact Move is instead of inviting a start on it", () => {
    const headline = moveHeadline(move({ impact: "low", executionReadiness: "ready" }));

    expect(headline).toEqual({ kind: "low_priority", label: "Low priority" });
  });

  it("never invents a label outside the readiness vocabulary", () => {
    const labels = Object.values(EXECUTION_READINESS_LABELS);

    for (const readiness of EXECUTION_READINESS) {
      expect(labels).toContain(moveHeadline(move({ executionReadiness: readiness })).label);
    }
  });
});

describe("moveLensLabel", () => {
  it("names the primary business area", () => {
    expect(moveLensLabel(move({ primaryLens: "revenue_economics" }))).toBe("Revenue & Economics");
  });

  it("adds at most one secondary area", () => {
    expect(
      moveLensLabel(
        move({ primaryLens: "acquisition", secondaryLenses: ["measurement", "conversion"] }),
      ),
    ).toBe("Acquisition & Measurement");
  });

  it("is absent rather than a placeholder on a legacy Move", () => {
    expect(moveLensLabel(move({ primaryLens: null }))).toBeNull();
  });
});

describe("moveSummaryCounts", () => {
  it("counts the set that is on screen", () => {
    const counts = moveSummaryCounts([
      move({ id: "a", executionReadiness: "ready" }),
      move({ id: "b", executionReadiness: "needs_user_input" }),
      move({ id: "c", executionReadiness: "needs_user_input" }),
      move({ id: "d", executionReadiness: "not_supported_yet" }),
    ]);

    expect(counts).toEqual({ total: 4, readyForVibe: 1, needsInput: 2 });
  });

  it("reports an empty set as zeroes, so the screen can choose to show a dash", () => {
    expect(moveSummaryCounts([])).toEqual({ total: 0, readyForVibe: 0, needsInput: 0 });
  });
});
