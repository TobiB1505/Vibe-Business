import { describe, expect, it } from "vitest";
import type { OutcomeEligibility } from "./eligibility";
import { outcomeFailureMessage } from "./messages";
import { buildOutcomeCard } from "./view";
import type {
  ChangeOutcomeVerification,
  ExpectedOutcome,
  OutcomeCheckResult,
  OutcomeCheckStatus,
  OutcomeStatus,
} from "./schema";
import { OUTCOME_MERGED_COMMIT, OUTCOME_ORIGIN } from "./test-support";

/**
 * The card the panel renders (Sprint 12A §29–§34).
 *
 * ## The one thing this layer must never do
 *
 * Present a partial outcome as a verified one by omission. A card that showed
 * only its passing lines would do exactly that, and it is a one-line change —
 * which is why the check list is driven by the **frozen expectation** rather
 * than by whichever results happen to exist.
 */

const EXPECTED: ExpectedOutcome = {
  profile: "nextjs_seo_foundations_outcome_v1",
  profileVersion: "nextjs-seo-foundations-outcome-v1",
  publicOrigin: OUTCOME_ORIGIN,
  resources: ["robots_txt", "sitemap_xml"],
  checks: [
    { kind: "robots_reachable", target: null, resource: "robots_txt" },
    { kind: "sitemap_reachable", target: null, resource: "sitemap_xml" },
    { kind: "sitemap_includes_public_root", target: "/", resource: "sitemap_xml" },
    { kind: "sitemap_excludes_private_prefix", target: "/login", resource: "sitemap_xml" },
    { kind: "sitemap_excludes_private_prefix", target: "/signup", resource: "sitemap_xml" },
  ],
  truncated: false,
};

function result(checkId: string, status: OutcomeCheckStatus): OutcomeCheckResult {
  const [kind, target] = checkId.split(":");
  return {
    checkId,
    kind: kind as OutcomeCheckResult["kind"],
    target: target ?? null,
    status,
    observedValue: { httpStatus: 200 },
    observedAt: "2026-08-14T14:52:11.000Z",
  };
}

function verification(
  status: OutcomeStatus,
  checkResults: OutcomeCheckResult[] | null,
  overrides: Partial<ChangeOutcomeVerification> = {},
): ChangeOutcomeVerification {
  return {
    id: "verification_1",
    projectId: "project_1",
    userId: "user_1",
    changeMergeId: "merge_1",
    preparedChangeId: "prepared_1",
    changeApprovalId: "approval_1",
    mergedCommitSha: OUTCOME_MERGED_COMMIT,
    capability: "nextjs_seo_foundations_v2",
    capabilityVersion: "nextjs-seo-foundations-v2",
    outcomeProfile: "nextjs_seo_foundations_outcome_v1",
    outcomeProfileVersion: "nextjs-seo-foundations-outcome-v1",
    outcomePolicyVersion: "outcome-policy-v1",
    evidenceSchemaVersion: "outcome-evidence-v1",
    publicOrigin: OUTCOME_ORIGIN,
    effectiveOrigin: OUTCOME_ORIGIN,
    expectedOutcome: EXPECTED,
    checkResults,
    verificationIdentity: "v".repeat(64),
    operationRunId: "operation_1",
    status,
    failureCode: null,
    attemptCount: checkResults ? 1 : 0,
    startedAt: "2026-08-14T14:45:00.000Z",
    completedAt: null,
    observationStartedAt: "2026-08-14T14:45:00.000Z",
    observationCompletedAt: "2026-08-14T14:52:11.000Z",
    verificationWindowStartedAt: "2026-08-14T14:45:00.000Z",
    verificationWindowEndsAt: "2026-08-14T15:00:00.000Z",
    createdAt: "2026-08-14T14:44:00.000Z",
    updatedAt: "2026-08-14T14:52:11.000Z",
    ...overrides,
  };
}

const ELIGIBLE: OutcomeEligibility = {
  eligible: true,
  changeMergeId: "merge_1",
  preparedChangeId: "prepared_1",
  changeApprovalId: "approval_1",
  mergedCommitSha: OUTCOME_MERGED_COMMIT,
  capability: "nextjs_seo_foundations_v2",
  capabilityVersion: "nextjs-seo-foundations-v2",
  outcomeProfile: "nextjs_seo_foundations_outcome_v1",
  outcomeProfileVersion: "nextjs-seo-foundations-outcome-v1",
  publicOrigin: OUTCOME_ORIGIN,
  expected: EXPECTED,
  verificationIdentity: "v".repeat(64),
};

function card(latest: ChangeOutcomeVerification | null, eligibility: OutcomeEligibility = ELIGIBLE) {
  return buildOutcomeCard({ latest, eligibility, resolveFailureMessage: outcomeFailureMessage });
}

const ALL_PASSED = EXPECTED.checks.map((check) =>
  result(check.target === null ? check.kind : `${check.kind}:${check.target}`, "passed"),
);

describe("failed checks are never hidden (§31)", () => {
  it("renders every expected check, including the ones that did not pass", () => {
    const mixed = ALL_PASSED.map((entry) =>
      entry.checkId === "sitemap_excludes_private_prefix:/signup"
        ? { ...entry, status: "failed" as const }
        : entry,
    );

    const built = card(verification("partial", mixed));

    expect(built.checks).toHaveLength(EXPECTED.checks.length);
    expect(built.checks.find((line) => line.checkId.endsWith("/signup"))?.status).toBe("failed");
  });

  it("is driven by the frozen expectation, not by whichever results exist (§9)", () => {
    // A result set missing three of its five checks must still show five lines.
    // Driving the list off the results would let a truncated observation read
    // as a complete one.
    const partialResults = ALL_PASSED.slice(0, 2);

    const built = card(verification("partial", partialResults));

    expect(built.checks).toHaveLength(EXPECTED.checks.length);
    expect(built.checks.filter((line) => line.status === "not_observed")).toHaveLength(3);
  });

  it("labels each check the way a person would describe it (§30)", () => {
    const built = card(verification("verified", ALL_PASSED));

    expect(built.checks.map((line) => line.label)).toEqual([
      "robots.txt reachable",
      "sitemap.xml reachable",
      "homepage included in sitemap",
      "/login excluded from sitemap",
      "/signup excluded from sitemap",
    ]);
  });
});

describe("each state maps to its own card (§29–§32)", () => {
  it.each([
    ["queued", "observing"],
    ["observing", "observing"],
    ["verified", "verified"],
    ["partial", "partial"],
    ["not_observed", "not_observed"],
  ] as const)("renders a %s verification as %s", (status, state) => {
    expect(card(verification(status, ALL_PASSED)).state).toBe(state);
  });

  it("renders a failed verification with its safe copy (§23)", () => {
    const built = card(
      verification("failed", null, { failureCode: "outcome_origin_unreachable" }),
    );

    expect(built.state).toBe("failed");
    expect(built.failureMessage).toContain("could not reach your public product");
    // Never characterises the customer's product.
    expect(built.failureMessage).not.toContain("deployment failed");
  });

  it("offers the action only when nothing has been asked yet", () => {
    expect(card(null).state).toBe("not_started");
    expect(card(null).canVerify).toBe(true);

    for (const status of ["queued", "observing", "verified", "partial", "not_observed", "failed"] as const) {
      expect(card(verification(status, ALL_PASSED)).canVerify).toBe(false);
    }
  });

  it("stays silent for a change that was never merged (§29)", () => {
    const built = card(null, { eligible: false, reason: "outcome_merge_required" });

    expect(built.state).toBe("unavailable");
    // The merge panel above already explains this gate.
    expect(built.failureMessage).toBeNull();
  });

  it("explains every other refusal", () => {
    for (const reason of [
      "outcome_not_supported",
      "outcome_public_origin_unavailable",
      "outcome_expectation_unavailable",
      "outcome_merge_unverified",
    ] as const) {
      const built = card(null, { eligible: false, reason });
      expect(built.state).toBe("unavailable");
      expect(built.failureMessage).toBeTruthy();
    }
  });
});

describe("the three levels are data, not copy (§33, §34)", () => {
  it("never claims a deployment, in any state", () => {
    const states: (ChangeOutcomeVerification | null)[] = [
      null,
      verification("observing", null),
      verification("verified", ALL_PASSED),
      verification("partial", ALL_PASSED),
      verification("not_observed", ALL_PASSED),
      verification("failed", null, { failureCode: "outcome_origin_unreachable" }),
    ];

    for (const latest of states) {
      expect(card(latest).deploymentVerified).toBe(false);
    }
  });

  it("never claims a business result, in any state", () => {
    for (const status of ["verified", "partial", "not_observed"] as const) {
      expect(card(verification(status, ALL_PASSED)).businessImpactMeasured).toBe(false);
    }
  });

  it("carries the origin the server resolved, never one a client could pick (§11)", () => {
    expect(card(verification("verified", ALL_PASSED)).publicOrigin).toBe(OUTCOME_ORIGIN);
    expect(card(null).publicOrigin).toBe(OUTCOME_ORIGIN);
  });

  it("says which commit was observed against", () => {
    expect(card(verification("verified", ALL_PASSED)).mergedCommitSha).toBe(OUTCOME_MERGED_COMMIT);
  });
});
