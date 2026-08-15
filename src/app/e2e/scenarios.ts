import type { PreparedChangeCard } from "@/app/app/projects/[projectId]/prepared-changes-section";
import type { OutcomeCard, OutcomeCheckLine } from "@/modules/outcome-verification/view";

/**
 * The states the browser suite renders (Sprint 11C.1).
 *
 * Each is a complete `PreparedChangeCard` — the same object the real project
 * page assembles from its services — so the panels cannot tell the difference
 * between a fixture and a production render.
 *
 * The values are deliberately the **real** SHAs from the Vibe Business dogfood:
 * `2f05958` is the approved commit, `528d372` the base it was prepared on, and
 * `b8638ae` where `main` actually was when the first real merge attempt was
 * refused. A fixture that reuses the real numbers stays legible next to the
 * dogfood record instead of inventing a parallel universe.
 */

export const APPROVED_COMMIT = "2f05958e3410deaeb97029861abc05889139b4a7";
export const APPROVED_BASE = "528d372b81cf28786edcba7d6384f9f74e55ba33";
export const DRIFTED_HEAD = "b8638ae4a0c4a1e31288da4d6ef3300f04d1746a";

const APPROVAL_ID = "approval_e2e";
const APPROVED_AT = "2026-08-14T08:22:59.917Z";

/** Everything except the merge card, which is what each scenario varies. */
function baseChange(): Omit<PreparedChangeCard, "merge" | "outcome"> {
  return {
    id: "prepared_e2e",
    branchName: "vibe/seo-foundations-cc32273131c5",
    commitSha: APPROVED_COMMIT,
    baseBranch: "main",
    filePaths: ["src/app/robots.ts", "src/app/sitemap.ts"],
    createdAt: "2026-08-13T18:00:00.000Z",
    branchUrl: null,
    validation: {
      status: "passed",
      phases: [],
      failureMessage: null,
      sandboxDurationMs: 285_000,
      underCurrentPolicy: true,
    },
    preview: {
      state: "stopped",
      previewSessionId: null,
      operationRunId: null,
      stage: null,
      failureCode: null,
      failureMessage: null,
      expiresAt: null,
      readyAt: null,
      revalidationRequired: false,
    },
    validatedArtifactId: null,
    review: {
      state: "ready",
      reviewArtifactId: "review_e2e",
      operationRunId: null,
      failureCode: null,
      failureMessage: null,
      route: "/",
      beforeOrigin: "https://vibe-business-fawn.vercel.app/",
      beforeCapturedAt: "2026-08-13T23:55:03.196Z",
      afterCapturedAt: "2026-08-13T23:55:03.848Z",
      width: 1440,
      height: 1000,
      expiresAt: "2026-08-20T23:54:50.383Z",
    },
    // Null on purpose: signed URLs are minted per render and a fixture must
    // never carry one. The review panel's "images unavailable" branch is not
    // what this suite is about.
    reviewImages: null,
    previewSessionId: null,
    previewOrigin: null,
    approval: {
      state: "approved",
      approvalId: APPROVAL_ID,
      approvedAt: APPROVED_AT,
      revokedAt: null,
      approvedCommitSha: APPROVED_COMMIT,
      invalidationReason: null,
      blockReason: null,
      blockMessage: null,
      canApprove: false,
      currentCommitSha: APPROVED_COMMIT,
    },
  };
}

function mergeCard(overrides: Partial<PreparedChangeCard["merge"]>): PreparedChangeCard["merge"] {
  return {
    state: "not_eligible",
    changeMergeId: null,
    changeApprovalId: APPROVAL_ID,
    defaultBranch: "main",
    currentDefaultHeadSha: null,
    targetCommitSha: APPROVED_COMMIT,
    resultingDefaultHeadSha: null,
    mergedAt: null,
    failureCode: null,
    failureMessage: null,
    canMerge: false,
    deploymentVerified: false,
    ...overrides,
  };
}

/**
 * The real merge this sprint verifies (Sprint 12A §46).
 *
 * `78cbdac` is the commit Vibe's first successful merge moved `main` to, and
 * `vibe-business-fawn.vercel.app` is the origin those fixtures describe. Reusing
 * the real numbers keeps the browser suite legible next to the dogfood record
 * instead of inventing a parallel universe.
 */
export const MERGED_COMMIT = "78cbdac32ea660edd20af4a9dfcc74be6c388700";
export const MERGED_BASE = "246ac362610aac828f35fc5dbfa8f67dde5ebbdd";
export const PUBLIC_ORIGIN = "https://vibe-business-fawn.vercel.app";

/** A merged change, so every outcome scenario sits on a real delivery state. */
function mergedCard(): PreparedChangeCard["merge"] {
  return mergeCard({
    state: "merged",
    changeMergeId: "merge_e2e",
    currentDefaultHeadSha: MERGED_BASE,
    targetCommitSha: MERGED_COMMIT,
    resultingDefaultHeadSha: MERGED_COMMIT,
    mergedAt: "2026-08-14T14:40:56.438Z",
    canMerge: false,
  });
}

/**
 * The checks the SEO outcome profile derives for this repository.
 *
 * `/login` and `/signup` are authentication surfaces the v2 sitemap capability
 * excludes, and `/app` and `/api` are the application and API subtrees — exactly
 * what `excludedSurfacePrefixes` returns for Vibe Business's own route list.
 */
function checkLines(
  overrides: Partial<Record<string, OutcomeCheckLine["status"]>> = {},
): OutcomeCheckLine[] {
  const lines: Array<[string, string]> = [
    ["robots_reachable", "robots.txt reachable"],
    ["robots_declares_sitemap", "robots.txt points at the sitemap"],
    ["sitemap_reachable", "sitemap.xml reachable"],
    ["sitemap_parsed", "sitemap.xml is a valid sitemap"],
    ["sitemap_includes_public_root:/", "homepage included in sitemap"],
    ["sitemap_excludes_private_prefix:/login", "/login excluded from sitemap"],
    ["sitemap_excludes_private_prefix:/signup", "/signup excluded from sitemap"],
  ];

  return lines.map(([checkId, label]) => ({
    checkId,
    label,
    status: overrides[checkId] ?? "passed",
  }));
}

function outcomeCard(overrides: Partial<OutcomeCard> = {}): OutcomeCard {
  return {
    state: "unavailable",
    verificationId: null,
    operationRunId: null,
    publicOrigin: null,
    mergedCommitSha: null,
    checks: [],
    observedAt: null,
    windowEndsAt: null,
    attemptCount: 0,
    failureCode: null,
    failureMessage: null,
    canVerify: false,
    deploymentVerified: false,
    businessImpactMeasured: false,
    ...overrides,
  };
}

/** A merged change with an outcome card in whatever state the scenario needs. */
function outcomeChange(outcome: OutcomeCard): PreparedChangeCard {
  return { ...baseChange(), merge: mergedCard(), outcome };
}

export const E2E_SCENARIOS = {
  /** A fresh preflight says this could merge now. The confirmation path. */
  merge_ready: (): PreparedChangeCard => ({
    ...baseChange(),
    outcome: outcomeCard(),
    merge: mergeCard({
      state: "ready",
      currentDefaultHeadSha: APPROVED_BASE,
      canMerge: true,
    }),
  }),

  /**
   * **What the real dogfood produced**, and the distinction worth keeping.
   *
   * The default branch had moved, so the render-time preflight refused before
   * the action was ever offered. No attempt was made, so there is no
   * ChangeMerge row and no merge id — the panel is saying "this cannot be
   * merged", not "a merge was tried and stopped".
   */
  merge_not_eligible_repository_changed: (): PreparedChangeCard => ({
    ...baseChange(),
    outcome: outcomeCard(),
    merge: mergeCard({
      state: "not_eligible",
      failureCode: "merge_repository_changed",
      failureMessage:
        "The default branch changed after this change was prepared. Vibe did not modify the repository. Review the updated repository state before merging.",
      canMerge: false,
    }),
  }),

  /**
   * The other refusal: an attempt existed and was stopped before any write.
   *
   * Reached when the drift appears *between* the request and the durable
   * write, so the workflow's own revalidation catches it. There is a merge id
   * because a row exists; there is no resulting SHA because nothing was
   * written, which the `change_merges_blocked_wrote_nothing` CHECK guarantees.
   */
  merge_blocked_repository_changed: (): PreparedChangeCard => ({
    ...baseChange(),
    outcome: outcomeCard(),
    merge: mergeCard({
      state: "blocked",
      changeMergeId: "merge_blocked_e2e",
      failureCode: "merge_repository_changed",
      failureMessage:
        "The default branch changed after this change was prepared. Vibe did not modify the repository. Review the updated repository state before merging.",
      currentDefaultHeadSha: DRIFTED_HEAD,
      canMerge: false,
    }),
  }),

  /** The default branch was moved and the result independently read back. */
  merge_merged: (): PreparedChangeCard => ({
    ...baseChange(),
    outcome: outcomeCard(),
    merge: mergeCard({
      state: "merged",
      changeMergeId: "merge_e2e",
      currentDefaultHeadSha: APPROVED_BASE,
      resultingDefaultHeadSha: APPROVED_COMMIT,
      mergedAt: "2026-08-14T12:30:00.000Z",
      canMerge: false,
    }),
  }),

  /**
   * Merged, and nobody has asked yet (§29, §43).
   *
   * The state the real product lands in the moment a merge finishes: nothing
   * has been observed, nothing is running, and the check happens only when a
   * person asks for it.
   */
  outcome_not_started: (): PreparedChangeCard =>
    outcomeChange(
      outcomeCard({
        state: "not_started",
        publicOrigin: PUBLIC_ORIGIN,
        mergedCommitSha: MERGED_COMMIT,
        canVerify: true,
      }),
    ),

  /** The bounded window is open and Vibe is still looking (§29). */
  outcome_observing: (): PreparedChangeCard =>
    outcomeChange(
      outcomeCard({
        state: "observing",
        verificationId: "outcome_e2e",
        operationRunId: "operation_e2e",
        publicOrigin: PUBLIC_ORIGIN,
        mergedCommitSha: MERGED_COMMIT,
        checks: checkLines({
          robots_reachable: "not_observed",
          robots_declares_sitemap: "not_observed",
          sitemap_reachable: "not_observed",
          sitemap_parsed: "not_observed",
          "sitemap_includes_public_root:/": "not_observed",
          "sitemap_excludes_private_prefix:/login": "not_observed",
          "sitemap_excludes_private_prefix:/signup": "not_observed",
        }),
        windowEndsAt: "2026-08-14T15:00:00.000Z",
        attemptCount: 2,
      }),
    ),

  /** Every expectation held (§30). */
  outcome_verified: (): PreparedChangeCard =>
    outcomeChange(
      outcomeCard({
        state: "verified",
        verificationId: "outcome_e2e",
        publicOrigin: PUBLIC_ORIGIN,
        mergedCommitSha: MERGED_COMMIT,
        checks: checkLines(),
        observedAt: "2026-08-14T14:52:11.000Z",
        attemptCount: 1,
      }),
    ),

  /**
   * The Sprint 9 defect, caught in production (§31).
   *
   * `/signup` is being advertised to crawlers even though the capability's own
   * classification excludes it. Every other check passed — and the failing one
   * is on screen, not hidden behind a summary.
   */
  outcome_partial: (): PreparedChangeCard =>
    outcomeChange(
      outcomeCard({
        state: "partial",
        verificationId: "outcome_e2e",
        publicOrigin: PUBLIC_ORIGIN,
        mergedCommitSha: MERGED_COMMIT,
        checks: checkLines({ "sitemap_excludes_private_prefix:/signup": "failed" }),
        observedAt: "2026-08-14T14:56:00.000Z",
        attemptCount: 7,
      }),
    ),

  /** Nothing appeared before the deadline. Not a deployment claim (§32). */
  outcome_not_observed: (): PreparedChangeCard =>
    outcomeChange(
      outcomeCard({
        state: "not_observed",
        verificationId: "outcome_e2e",
        publicOrigin: PUBLIC_ORIGIN,
        mergedCommitSha: MERGED_COMMIT,
        checks: checkLines({
          robots_reachable: "not_observed",
          robots_declares_sitemap: "not_observed",
          sitemap_reachable: "not_observed",
          sitemap_parsed: "not_observed",
          "sitemap_includes_public_root:/": "not_observed",
          "sitemap_excludes_private_prefix:/login": "not_observed",
          "sitemap_excludes_private_prefix:/signup": "not_observed",
        }),
        observedAt: "2026-08-14T15:00:03.000Z",
        attemptCount: 7,
      }),
    ),

  /**
   * Vibe could not look (§23).
   *
   * Deliberately a separate scenario from `not_observed`, because the two must
   * never render the same way: one is about the customer's product, the other
   * is about Vibe.
   */
  outcome_failed: (): PreparedChangeCard =>
    outcomeChange(
      outcomeCard({
        state: "failed",
        verificationId: "outcome_e2e",
        publicOrigin: PUBLIC_ORIGIN,
        mergedCommitSha: MERGED_COMMIT,
        checks: checkLines({
          robots_reachable: "error",
          robots_declares_sitemap: "error",
          sitemap_reachable: "error",
          sitemap_parsed: "error",
          "sitemap_includes_public_root:/": "error",
          "sitemap_excludes_private_prefix:/login": "error",
          "sitemap_excludes_private_prefix:/signup": "error",
        }),
        failureCode: "outcome_origin_unreachable",
        failureMessage:
          "Vibe could not reach your public product while checking, so it could not verify the outcome.",
        attemptCount: 7,
      }),
    ),
} as const;

export type E2eScenario = keyof typeof E2E_SCENARIOS;

export function isE2eScenario(value: string): value is E2eScenario {
  return Object.hasOwn(E2E_SCENARIOS, value);
}
