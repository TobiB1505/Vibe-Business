import { describe, expect, it } from "vitest";
import {
  AGENTIC_FRESHNESS_CHECKS,
  DETERMINISTIC_FRESHNESS_CHECKS,
  evaluateFreshness,
  type FreshnessObservation,
} from "./freshness";
import { FIXTURE_BASE_SHA, FIXTURE_OTHER_SHA, FIXTURE_SNAPSHOT_ID } from "./test-support";

/**
 * Premise revalidation (EXECUTION CORE-3 §29, §52).
 */

const SPEC = { baseSha: FIXTURE_BASE_SHA, repositorySnapshotId: FIXTURE_SNAPSHOT_ID };

function observed(overrides: Partial<FreshnessObservation> = {}): FreshnessObservation {
  return {
    observedHeadSha: FIXTURE_BASE_SHA,
    latestRepositorySnapshotId: FIXTURE_SNAPSHOT_ID,
    actionPlanIsCurrent: true,
    dependenciesSatisfied: true,
    capabilityStillMatches: true,
    projectOwnerUnchanged: true,
    ...overrides,
  };
}

describe("freshness (§29)", () => {
  it("passes when every premise still holds", () => {
    expect(evaluateFreshness(AGENTIC_FRESHNESS_CHECKS, SPEC, observed())).toEqual({ fresh: true });
  });

  it("marks a spec stale when the repository moved to another commit (§52)", () => {
    const result = evaluateFreshness(
      AGENTIC_FRESHNESS_CHECKS,
      SPEC,
      observed({ observedHeadSha: FIXTURE_OTHER_SHA }),
    );

    expect(result).toEqual({ fresh: false, stale: ["repository_head_unchanged"] });
  });

  it("treats an unread HEAD as stale rather than unchanged", () => {
    // The distinction the whole nullable-boolean shape exists for: "not
    // observed" is never "fine".
    const result = evaluateFreshness(
      AGENTIC_FRESHNESS_CHECKS,
      SPEC,
      observed({ observedHeadSha: null }),
    );

    expect(result.fresh).toBe(false);
  });

  it("marks a spec stale when a newer snapshot exists", () => {
    const result = evaluateFreshness(
      AGENTIC_FRESHNESS_CHECKS,
      SPEC,
      observed({ latestRepositorySnapshotId: "another-snapshot" }),
    );

    expect(result).toEqual({ fresh: false, stale: ["repository_snapshot_current"] });
  });

  it("marks a spec stale when a prerequisite stopped being satisfied", () => {
    const result = evaluateFreshness(
      AGENTIC_FRESHNESS_CHECKS,
      SPEC,
      observed({ dependenciesSatisfied: false }),
    );

    expect(result).toEqual({ fresh: false, stale: ["dependencies_still_satisfied"] });
  });

  it("reports every stale premise rather than the first", () => {
    const result = evaluateFreshness(
      AGENTIC_FRESHNESS_CHECKS,
      SPEC,
      observed({ observedHeadSha: FIXTURE_OTHER_SHA, actionPlanIsCurrent: false }),
    );

    expect(result.fresh).toBe(false);
    if (result.fresh) return;
    expect(result.stale).toEqual(["repository_head_unchanged", "action_plan_current"]);
  });

  it("additionally re-checks the capability for deterministic execution", () => {
    expect(DETERMINISTIC_FRESHNESS_CHECKS).toContain("deterministic_capability_still_matches");
    expect(AGENTIC_FRESHNESS_CHECKS).not.toContain("deterministic_capability_still_matches");

    const result = evaluateFreshness(
      DETERMINISTIC_FRESHNESS_CHECKS,
      SPEC,
      observed({ capabilityStillMatches: false }),
    );

    expect(result).toEqual({
      fresh: false,
      stale: ["deterministic_capability_still_matches"],
    });
  });
});
