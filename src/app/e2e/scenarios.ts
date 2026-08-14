import type { PreparedChangeCard } from "@/app/app/projects/[projectId]/prepared-changes-section";

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
function baseChange(): Omit<PreparedChangeCard, "merge"> {
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

export const E2E_SCENARIOS = {
  /** A fresh preflight says this could merge now. The confirmation path. */
  merge_ready: (): PreparedChangeCard => ({
    ...baseChange(),
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
    merge: mergeCard({
      state: "merged",
      changeMergeId: "merge_e2e",
      currentDefaultHeadSha: APPROVED_BASE,
      resultingDefaultHeadSha: APPROVED_COMMIT,
      mergedAt: "2026-08-14T12:30:00.000Z",
      canMerge: false,
    }),
  }),
} as const;

export type E2eScenario = keyof typeof E2E_SCENARIOS;

export function isE2eScenario(value: string): value is E2eScenario {
  return Object.hasOwn(E2E_SCENARIOS, value);
}
