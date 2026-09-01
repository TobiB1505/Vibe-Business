import type { PreparedChangeCard } from "@/app/app/projects/[projectId]/prepared-changes-section";
import type { OutcomeCard, OutcomeCheckLine } from "@/modules/outcome-verification/view";
import type { BusinessImpactCard } from "@/modules/business-measurement/view";
import { businessRationaleFor } from "@/modules/execution/business-rationale";
import { deriveChangeProgress } from "@/modules/execution/change-progress";
import { REVIEW_CLASSIFICATION_VERSION } from "@/modules/review/classification";
import { MERGE_FAILURE_MESSAGES } from "@/modules/merge/messages";
import { APPROVAL_BLOCK_MESSAGES } from "@/modules/approvals/messages";
import { OBSERVED_CHANGE_DISCLAIMER } from "@/modules/business-measurement/causality";

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
/** Where a person looks when the base moved under a prepared change. */
const COMPARE_URL = "https://github.com/vibe-e2e/example/compare/main...vibe/seo-foundations";
const APPROVED_AT = "2026-08-14T08:22:59.917Z";

/**
 * Completes a card by deriving its progress exactly as the server does.
 *
 * Deliberately the real function rather than a hand-written state per
 * scenario: a fixture that decided for itself where a change stood could
 * disagree with production and the browser suite would keep passing while the
 * product said something else.
 */
function withProgress(card: Omit<PreparedChangeCard, "progress">): PreparedChangeCard {
  return { ...card, progress: deriveChangeProgress(card) };
}

/** Everything except the merge card, which is what each scenario varies. */
function baseChange(): Omit<
  PreparedChangeCard,
  "progress" | "merge" | "outcome" | "businessImpact"
> {
  return {
    id: "prepared_e2e",
    branchName: "vibe/seo-foundations-cc32273131c5",
    commitSha: APPROVED_COMMIT,
    baseBranch: "main",
    filePaths: ["src/app/robots.ts", "src/app/sitemap.ts"],
    createdAt: "2026-08-13T18:00:00.000Z",
    branchUrl: null,
    compareUrl: null,
    // The real SEO capability's rationale, not invented copy: the browser
    // suite asserts against what the product would actually render.
    rationale: businessRationaleFor("nextjs_seo_foundations_v2"),
    /*
     * A deterministic change has both: the written rationale below and the Move
     * it answers. The card renders the rationale as its explanation and reduces
     * the Move to a one-line link back (UI-S3 §4) — which is production's own
     * shape, `changeOriginFrom` being independent of whether a rationale
     * exists. `change_agentic_review_required` is the scenario with no
     * rationale, where the full origin block renders instead.
     */
    origin: {
      title: "Fix missing technical SEO foundations",
      problem:
        "The live site is missing canonical URL, robots.txt, a sitemap and structured data.",
      whyNow:
        "These are low-effort fixes that do not depend on positioning or monetization.",
    },
    opportunityId: "3-seo-fix-missing-technical-seo-foundations",
    /*
     * `visual_and_code`: the SEO capability writes `src/app/robots.ts` and
     * `src/app/sitemap.ts`, neither of which renders — but the scenarios below
     * are the ones that exercise the *visual* path, so the fixture keeps the
     * comparison panels and adds the diff beside them. `change_code_review_ready`
     * is the scenario that classifies as `code`.
     */
    reviewClassification: {
      classification: "visual_and_code",
      policyVersion: REVIEW_CLASSIFICATION_VERSION,
      visualPaths: ["src/app/page.tsx"],
      codePaths: ["src/app/robots.ts", "src/app/sitemap.ts"],
      routes: ["/"],
      scopes: [],
      downgradedPaths: [],
    },
    validation: {
      status: "passed",
      phases: [],
      failureMessage: null,
      sandboxDurationMs: 285_000,
      // The deterministic SEO capability has no Action Step behind it, so the
      // depth resolver has nothing to classify and lands on its safe default.
      depth: {
        depth: "standard",
        label: "Standard",
        reason: "Change not classified; validated in full",
        notRun: [],
      },
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
  return withProgress({
    ...baseChange(),
    merge: mergedCard(),
    outcome,
    businessImpact: businessImpactCard(),
  });
}


/**
 * Business impact fixtures (Sprint 12B §40).
 *
 * The windows are the SEO profile's real shape — a 28-day baseline, a 14-day
 * settling gap and a 28-day measurement window — anchored on the real merge
 * date, so the dates on screen are the dates the product would actually
 * compute rather than round numbers invented for a screenshot.
 */
const BASELINE_WINDOW = {
  start: "2026-07-17T00:00:00.000Z",
  end: "2026-08-14T00:00:00.000Z",
  timezone: "UTC",
  days: 28,
};
const MEASUREMENT_WINDOW = {
  start: "2026-08-29T00:00:00.000Z",
  end: "2026-09-26T00:00:00.000Z",
  timezone: "UTC",
  days: 28,
};

function businessImpactCard(overrides: Partial<BusinessImpactCard> = {}): BusinessImpactCard {
  return {
    state: "unavailable",
    headline: "Not measured",
    ladderLabel: "Not measured",
    measurementPlanId: null,
    measurementId: null,
    metricLabel: null,
    businessGoal: null,
    baselineWindow: null,
    measurementWindow: null,
    resultAvailableAt: null,
    daysObserved: null,
    daysExpected: null,
    baselineValue: null,
    observedValue: null,
    observedRelativeChange: null,
    sampleSizeBefore: null,
    sampleSizeAfter: null,
    minimumObservations: null,
    dataQuality: null,
    failureCode: null,
    failureMessage: null,
    canStartMeasuring: false,
    canConnectSource: false,
    observedChangeDisclaimer: null,
    causalEvidence: false,
    ...overrides,
  };
}

/** A planned SEO measurement, before any state that varies. */
function plannedImpact(overrides: Partial<BusinessImpactCard> = {}): BusinessImpactCard {
  return businessImpactCard({
    measurementPlanId: "plan_e2e",
    metricLabel: "Search impressions",
    businessGoal: "Be findable by people searching for what you do",
    minimumObservations: 500,
    ...overrides,
  });
}

/** A merged change with an outcome verified and a business impact card. */
function impactChange(businessImpact: BusinessImpactCard): PreparedChangeCard {
  return withProgress({
    ...baseChange(),
    merge: mergedCard(),
    outcome: outcomeCard({
      state: "verified",
      verificationId: "outcome_e2e",
      publicOrigin: PUBLIC_ORIGIN,
      mergedCommitSha: MERGED_COMMIT,
      checks: checkLines(),
      observedAt: "2026-08-14T14:52:11.000Z",
      attemptCount: 1,
    }),
    businessImpact,
  });
}

export const E2E_SCENARIOS = {
  /**
   * **The moment the product asks for something** (UI-5 §3).
   *
   * Everything a person needs in order to decide exists — validation passed, a
   * comparison is ready — and nobody has decided. It is the one state where
   * the four early gates are the work rather than the history, so it is the
   * one that renders them expanded.
   *
   * Every other scenario here is approved, which is why this fixture had to be
   * written: without it the open form of the card would ship untested in a
   * browser, proven only by unit tests over the derivation.
   */
  change_awaiting_approval: (): PreparedChangeCard =>
    withProgress({
      ...baseChange(),
      outcome: outcomeCard(),
      businessImpact: businessImpactCard(),
      approval: {
        state: "not_approved",
        approvalId: null,
        approvedAt: null,
        revokedAt: null,
        approvedCommitSha: null,
        invalidationReason: null,
        blockReason: null,
        blockMessage: null,
        canApprove: true,
        currentCommitSha: APPROVED_COMMIT,
      },
      merge: mergeCard({
        state: "not_eligible",
        failureCode: "merge_approval_required",
        failureMessage: MERGE_FAILURE_MESSAGES.merge_approval_required,
        canMerge: false,
      }),
    }),

  /**
   * **The first real change this card ever carried** (UI-5 dogfood).
   *
   * A rebuild of the screen that found two defects at once, so the browser
   * suite holds the combination that produced them rather than an invented
   * one. Everything here is what the deployed card actually showed: an
   * agent-written change, validation passed, preview never started, review
   * waiting for one, nobody approving.
   *
   * The two things it proves. **The headline names whose turn it is** — that
   * screen said "Vibe is preparing what you need to review" while nothing was
   * running anywhere. And **an agent-written change has something to lead
   * with** — `agentic_execution_v1` has no capability rationale and cannot
   * have one, so the card opened with a status line and then a branch name.
   *
   * The branch and the short commit are the real ones off that card; a full
   * SHA is not, because the card only ever displayed seven characters of it.
   */
  change_agentic_review_required: (): PreparedChangeCard =>
    withProgress({
      ...baseChange(),
      outcome: outcomeCard(),
      businessImpact: businessImpactCard(),
      branchName: "vibe/agent-07d2308c197d",
      commitSha: "94c3165",
      filePaths: ["e2e/auth.spec.ts", "e2e/first-ten-minutes.spec.ts", "src/app/page.tsx"],
      // No written rationale, which is true of every agentic change there will
      // ever be — and the reason the origin below has to exist.
      rationale: null,
      origin: {
        title: "Give the landing page a proper social preview",
        problem:
          "The landing page has no canonical Open Graph metadata, so a link to it shared anywhere renders without a title, description or image.",
        whyNow:
          "Every link shared before this is fixed is a first impression the product does not get to make again.",
      },
      preview: {
        state: "ready_to_start",
        previewSessionId: null,
        operationRunId: null,
        stage: null,
        failureCode: null,
        failureMessage: null,
        expiresAt: null,
        readyAt: null,
        revalidationRequired: false,
      },
      validatedArtifactId: "validation_e2e",
      review: {
        state: "not_generated",
        reviewArtifactId: null,
        operationRunId: null,
        failureCode: null,
        failureMessage: null,
        route: null,
        beforeOrigin: null,
        beforeCapturedAt: null,
        afterCapturedAt: null,
        width: null,
        height: null,
        expiresAt: null,
      },
      reviewImages: null,
      approval: {
        state: "not_eligible",
        approvalId: null,
        approvedAt: null,
        revokedAt: null,
        approvedCommitSha: null,
        invalidationReason: null,
        blockReason: "approval_review_required",
        blockMessage: APPROVAL_BLOCK_MESSAGES.approval_review_required,
        canApprove: false,
        currentCommitSha: "94c3165",
      },
      merge: mergeCard({
        state: "not_eligible",
        failureCode: "merge_approval_required",
        failureMessage: MERGE_FAILURE_MESSAGES.merge_approval_required,
        canMerge: false,
      }),
    }),

  /**
   * The earliest gate, still open — a change nobody has checked yet.
   *
   * Deliberately `null` rather than a run in flight. The section hands the
   * validation panel `runningOperation={null}`, so a stored `running` summary
   * renders as "Not validated" while the card's headline says a check is
   * happening — a contradiction a fixture would then assert as correct. The
   * gap is real and recorded in the sprint doc; what this scenario proves is
   * the state the section can actually produce coherently.
   */
  change_not_validated: (): PreparedChangeCard =>
    withProgress({
      ...baseChange(),
      outcome: outcomeCard(),
      businessImpact: businessImpactCard(),
      validation: null,
      review: {
        state: "not_generated",
        reviewArtifactId: null,
        operationRunId: null,
        failureCode: null,
        failureMessage: null,
        route: null,
        beforeOrigin: null,
        beforeCapturedAt: null,
        afterCapturedAt: null,
        width: null,
        height: null,
        expiresAt: null,
      },
      reviewImages: null,
      approval: {
        state: "not_eligible",
        approvalId: null,
        approvedAt: null,
        revokedAt: null,
        approvedCommitSha: null,
        invalidationReason: null,
        blockReason: "approval_validation_required",
        blockMessage: APPROVAL_BLOCK_MESSAGES.approval_validation_required,
        canApprove: false,
        currentCommitSha: APPROVED_COMMIT,
      },
      merge: mergeCard({
        state: "not_eligible",
        failureCode: "merge_approval_required",
        failureMessage: MERGE_FAILURE_MESSAGES.merge_approval_required,
        canMerge: false,
      }),
    }),

  /** A fresh preflight says this could merge now. The confirmation path. */
  merge_ready: (): PreparedChangeCard =>
    withProgress({
      ...baseChange(),
      outcome: outcomeCard(),
      businessImpact: businessImpactCard(),
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
  merge_not_eligible_repository_changed: (): PreparedChangeCard =>
    withProgress({
      ...baseChange(),
      outcome: outcomeCard(),
      businessImpact: businessImpactCard(),
      compareUrl: COMPARE_URL,
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
  merge_blocked_repository_changed: (): PreparedChangeCard =>
    withProgress({
      ...baseChange(),
      outcome: outcomeCard(),
      businessImpact: businessImpactCard(),
      compareUrl: COMPARE_URL,
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
  merge_merged: (): PreparedChangeCard =>
    withProgress({
      ...baseChange(),
      outcome: outcomeCard(),
      businessImpact: businessImpactCard(),
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
        // The window a `not_observed` row always carries — the database
        // requires it to be bounded — so the dead-end copy renders the closing
        // time rather than its fallback. `outcome_failed` deliberately leaves
        // it null, which covers the other branch.
        windowEndsAt: "2026-08-14T15:00:00.000Z",
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

  /**
   * **The real dogfood state** (§48).
   *
   * Merged, production outcome verified, and Vibe has no analytics connector —
   * so it says what it would measure and why it cannot. Never "no impact".
   */
  business_impact_source_required: (): PreparedChangeCard =>
    impactChange(
      plannedImpact({
        state: "source_required",
        headline: "Measurement source required",
        ladderLabel: "Not measured — no source",
        failureCode: "metric_source_required",
        failureMessage:
          "Connect an analytics source so Vibe can measure whether this change affected the business metric it was intended to improve.",
      }),
    ),

  /** A merged change nobody has planned a measurement for yet. */
  business_impact_not_planned: (): PreparedChangeCard =>
    impactChange(businessImpactCard({ state: "not_planned", headline: "Not measured yet" })),

  /** The window has not elapsed. Dates visible, no conclusion (§22). */
  business_impact_scheduled: (): PreparedChangeCard =>
    impactChange(
      plannedImpact({
        state: "scheduled",
        headline: "Measurement scheduled",
        ladderLabel: "Measurement scheduled",
        measurementId: "measurement_e2e",
        baselineWindow: BASELINE_WINDOW,
        measurementWindow: MEASUREMENT_WINDOW,
        resultAvailableAt: MEASUREMENT_WINDOW.end,
        daysExpected: 28,
      }),
    ),

  /** Collecting. Factual day count, never a verdict (§23). */
  business_impact_measuring: (): PreparedChangeCard =>
    impactChange(
      plannedImpact({
        state: "measuring",
        headline: "Collecting post-change data",
        ladderLabel: "Measuring",
        measurementId: "measurement_e2e",
        baselineWindow: BASELINE_WINDOW,
        measurementWindow: MEASUREMENT_WINDOW,
        resultAvailableAt: MEASUREMENT_WINDOW.end,
        daysObserved: 3,
        daysExpected: 28,
      }),
    ),

  /** A positive observed movement, with the disclaimer that keeps it honest (§24). */
  business_impact_improved: (): PreparedChangeCard =>
    impactChange(
      plannedImpact({
        state: "improved",
        headline: "Improved",
        ladderLabel: "Improved",
        measurementId: "measurement_e2e",
        baselineWindow: BASELINE_WINDOW,
        measurementWindow: MEASUREMENT_WINDOW,
        resultAvailableAt: MEASUREMENT_WINDOW.end,
        daysObserved: 28,
        daysExpected: 28,
        baselineValue: 420,
        observedValue: 486,
        observedRelativeChange: 0.157,
        sampleSizeBefore: 420,
        sampleSizeAfter: 486,
        dataQuality: "complete",
        observedChangeDisclaimer: OBSERVED_CHANGE_DISCLAIMER,
      }),
    ),

  /**
   * A negative observed movement (§25).
   *
   * Shown exactly as prominently as the positive one. A product that only
   * reported its wins would be worth less than no measurement at all.
   */
  business_impact_degraded: (): PreparedChangeCard =>
    impactChange(
      plannedImpact({
        state: "degraded",
        headline: "Degraded",
        ladderLabel: "Degraded",
        measurementId: "measurement_e2e",
        baselineWindow: BASELINE_WINDOW,
        measurementWindow: MEASUREMENT_WINDOW,
        resultAvailableAt: MEASUREMENT_WINDOW.end,
        daysObserved: 28,
        daysExpected: 28,
        baselineValue: 1200,
        observedValue: 1062,
        observedRelativeChange: -0.115,
        sampleSizeBefore: 1200,
        sampleSizeAfter: 1062,
        dataQuality: "complete",
        observedChangeDisclaimer: OBSERVED_CHANGE_DISCLAIMER,
      }),
    ),

  /** There was data, and not enough of it. Never "no impact" (§26). */
  business_impact_insufficient: (): PreparedChangeCard =>
    impactChange(
      plannedImpact({
        state: "insufficient_data",
        headline: "Insufficient data",
        ladderLabel: "Insufficient data",
        measurementId: "measurement_e2e",
        baselineWindow: BASELINE_WINDOW,
        measurementWindow: MEASUREMENT_WINDOW,
        resultAvailableAt: MEASUREMENT_WINDOW.end,
        daysObserved: 28,
        daysExpected: 28,
        sampleSizeBefore: 10,
        sampleSizeAfter: 8,
        dataQuality: "insufficient",
      }),
    ),
} as const;

export type E2eScenario = keyof typeof E2E_SCENARIOS;

export function isE2eScenario(value: string): value is E2eScenario {
  return Object.hasOwn(E2E_SCENARIOS, value);
}
