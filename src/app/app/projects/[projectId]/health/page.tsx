import { EmptyState, Notice } from "@/components/ui/states";
import { WorkspaceSection, projectSectionHref } from "@/components/layout/project-shell";
import {
  getAuditAccessStatus,
  getAuditCurrency,
  getAuditReadiness,
  type AuditPrerequisite,
} from "@/modules/business-audit/service";
import {
  auditBlockedByCredits,
  resolveAuditCreditGate,
} from "@/modules/business-audit/entitlement";
import { getLatestSuccessfulAudit, getPausedAudit } from "@/modules/business-audit/store";
import { buildAuditEvidenceNotice } from "@/modules/business-audit/evidence-notice";
import { getDeepScanAccessStatus } from "@/modules/authenticated-product-intelligence/service";
import { isBrowserProviderConfigured } from "@/modules/authenticated-product-intelligence/browserbase/client";
import {
  getLatestSession,
  getLatestSuccessfulAuthenticatedSnapshot,
} from "@/modules/authenticated-product-intelligence/store";
import { detectAuthenticatedSurfaces } from "@/modules/authenticated-product-intelligence/surface-detection";
import { buildDeepScanViewModel } from "@/modules/authenticated-product-intelligence/view";
import { getLatestSuccessfulLiveSnapshot } from "@/modules/live-product-intelligence/store";
import { getActiveBusinessAuditOperation } from "@/modules/operations/service";
import { movesPerConclusion, resolveMoveLineage } from "@/modules/opportunities/lineage";
import { getLatestOpportunities } from "@/modules/opportunities/service";

import { requireProjectAccess } from "@/modules/projects/workspace-context";
import { getLatestSuccessfulSnapshot } from "@/modules/repository-intelligence/store";
import { AuditCreditNotice } from "../audit-credit-notice";
import { AuditEvidenceNotice } from "../audit-evidence-notice";
import { AuditOverview } from "../audit-overview";
import { BusinessHealth } from "../business-health";
import {
  AuditAnalyzing,
  AuditPreparing,
  AuditWaitingHeader,
} from "../audit-lifecycle";
import { NeedsUserPanel } from "../needs-user-panel";
import { RunAuditButton } from "../run-audit-button";

/**
 * How a missing prerequisite reads in the sentence "A business audit needs
 * … first." Phrased as things rather than as error codes, and the two
 * profile cases stay distinct because their remedies are (CORE-2 §8).
 */
const AUDIT_PREREQUISITE_LABELS: Record<AuditPrerequisite, string> = {
  repository_intelligence_missing: "repository intelligence",
  live_product_intelligence_missing: "live product intelligence",
  product_profile_missing: "Vibe to understand your product",
  product_profile_stale: "an up-to-date understanding of your product",
};

/**
 * Business score (Sprint UI-2 Part 2).
 *
 * ## What this route pays for
 *
 * The audit, its currency, the three evidence flags the prerequisite sentence
 * needs, and the Deep Scan model — the last only because the evidence notice
 * asks whether a Deep Scan is available and whether the audit predates it.
 *
 * What it no longer pays for, and used to: the prepared-change assembly. Before
 * the split, opening the score signed review-image URLs, asked the sandbox
 * provider for preview origins and ran the GitHub merge preflight. None of that
 * is reached from here now.
 */
export default async function ProjectScorePage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const { supabase, userId, project } = await requireProjectAccess(projectId);

  const [
    latestAudit,
    auditCurrency,
    activeAuditOperation,
    latestSnapshot,
    latestLiveSnapshot,
    auditReadiness,
    auditAccess,
    deepScanAccess,
    latestDeepScanSnapshot,
    latestDeepScanSession,
    opportunities,
    pausedAudit,
  ] = await Promise.all([
    getLatestSuccessfulAudit(supabase, projectId),
    getAuditCurrency(supabase, projectId),
    // Discovered on the server so returning here shows a running audit rather
    // than an inviting button (Sprint 7 §19).
    getActiveBusinessAuditOperation(supabase, projectId),
    getLatestSuccessfulSnapshot(supabase, projectId),
    getLatestSuccessfulLiveSnapshot(supabase, projectId),
    getAuditReadiness(supabase, projectId),
    getAuditAccessStatus(supabase, { projectId, userId }),
    getDeepScanAccessStatus(supabase, { projectId, userId }),
    getLatestSuccessfulAuthenticatedSnapshot(supabase, projectId),
    getLatestSession(supabase, projectId),
    // CORE-2 §18: "Where I'd start" links to the existing Opportunity Engine's
    // output. The audit never produces moves of its own.
    getLatestOpportunities(supabase, projectId),
    // Read server-side so the question survives a reload, a navigation away,
    // and a different device: browser state is never authoritative here
    // (§33, §34, §35).
    getPausedAudit(supabase, projectId),
  ]);

  const hasMoves = (opportunities?.set.opportunities.length ?? 0) > 0;

  /*
   * Which of *this* audit's findings have Moves behind them (UI-S2 §7, §8).
   *
   * Guarded on the set's own audit id rather than computed unconditionally.
   * A conclusion key addresses a position inside one immutable audit document,
   * so reading a set's keys against a newer audit would silently rebind every
   * Move to whatever finding now sits at that position — a link the founder
   * would reasonably read as causal and that nothing ever asserted.
   *
   * Costs no extra query: both halves are already loaded above.
   */
  const contextualMoves =
    latestAudit?.result && opportunities && opportunities.set.businessAuditId === latestAudit.id
      ? movesPerConclusion(
          resolveMoveLineage({
            sourceAudit: latestAudit.result,
            opportunities: opportunities.set.opportunities,
          }),
        )
      : {};

  const deepScanModel = deepScanAccess
    ? buildDeepScanViewModel({
        accessStatus: deepScanAccess,
        latestSnapshot: latestDeepScanSnapshot
          ? {
              result: latestDeepScanSnapshot.result,
              accessMode: latestDeepScanSnapshot.accessMode,
              completedAt: latestDeepScanSnapshot.completedAt,
              createdAt: latestDeepScanSnapshot.createdAt,
              pagesInspected: latestDeepScanSnapshot.pagesInspected,
            }
          : null,
        latestSession: latestDeepScanSession
          ? { status: latestDeepScanSession.status, failureCode: latestDeepScanSession.failureCode }
          : null,
        surfaceDetection: detectAuthenticatedSurfaces({
          repository: latestSnapshot?.result ?? null,
          publicProduct: latestLiveSnapshot?.result ?? null,
        }),
        providerConfigured: isBrowserProviderConfigured(),
      })
    : null;

  // Deep Scan evidence notice (Sprint 6 §11, §14). Informational: it never
  // gates the audit, and a new Deep Scan never triggers an automatic AI call.
  const auditEvidenceNotice = buildAuditEvidenceNotice({
    hasSuccessfulDeepScan: Boolean(latestDeepScanSnapshot?.result),
    authenticatedSurfacesLikely: deepScanModel?.showRecommendation ?? false,
    canStartDeepScan: deepScanModel?.canStart ?? false,
    auditPredatesDeepScan: auditCurrency.newDeepScanEvidence,
  });

  /*
   * Prerequisites come from the audit service rather than being re-derived
   * here (CORE-2 §3), so the button and the server gate cannot disagree.
   *
   * The entitlement is a *separate* reason the button must be off, and it is
   * kept separate: the first dogfood showed a prominent, enabled "Re-run
   * business audit" directly beneath a notice saying the free audit was already
   * spent — and pressing it paid for a model call that then failed at
   * persistence. Nothing is missing in that state, so it gets its own notice
   * rather than being folded into the "needs … first" sentence.
   */
  const missingPrerequisites = auditReadiness.missing.map(
    (prerequisite) => AUDIT_PREREQUISITE_LABELS[prerequisite],
  );

  /*
   * A spent entitlement is a price, not a wall (BILLING CORE-2 §39).
   *
   * This screen used to disable the button on `credits_required` and say the
   * Credits "aren't available yet" — while rendering the 35-Credit price beside
   * it, on an account holding thousands. Two sentences on one screen that could
   * not both be true, and the one that mattered was wrong: Credits shipped, the
   * audit has an approved price, and `startBusinessAudit` has been routing this
   * exact refusal into a reservation ever since.
   *
   * So the refusal splits in two, on the *balance* rather than on the
   * entitlement. Affordable is a purchase and stays enabled; unaffordable is
   * the only remaining wall, and it can name both numbers.
   */
  const creditGate = resolveAuditCreditGate(auditAccess);
  const auditReady = auditReadiness.ready && !auditBlockedByCredits(creditGate);
  /*
   * Vibe owes a replacement because Vibe changed (CORE-2a.2 §32).
   *
   * Deliberately not auto-started on render. An automatic refresh in a server
   * component is one failing contract away from starting a paid audit on every
   * page load (§34); the server decides that a refresh is *permitted*, and the
   * existing button is what starts it.
   */
  const systemRefresh = auditAccess.systemRefreshAvailable;

  /*
   * Which lifecycle state this page is in (§28).
   *
   * Read from the operation the server already loaded, so a reload lands in the
   * same state and no polling is needed to discover it. `needs_user` is not
   * listed here because the pending question renders above and *is* that state;
   * showing a "preparing" panel beside it would say Vibe is busy when it is
   * waiting.
   */
  const auditStage: "preparing" | "analyzing" | null = pausedAudit
    ? null
    : activeAuditOperation?.stage === "running_ai"
      ? "analyzing"
      : activeAuditOperation
        ? "preparing"
        : null;

  return (
    // The section id stays `business-audit`: `BUSINESS_AUDIT_ANCHOR` is a tested
    // domain constant that a blocked opportunity set links at, and that link is
    // the only way out of that state. It now resolves on this route.
    <WorkspaceSection
      id="business-audit"
      title="Business Health"
      description="What Vibe makes of this product as a business, and what it would do about it."
      actions={
        <RunAuditButton
          projectId={project.id}
          hasAudit={Boolean(latestAudit?.result)}
          disabled={!auditReady}
          // Billable only once the included audit is spent and Vibe does not
          // owe a contract refresh — both server-side facts (§55).
          billable={!auditAccess.freeAuditAvailable && !auditAccess.systemRefreshAvailable}
          activeOperation={activeAuditOperation}
        />
      }
    >
      <div className="flex flex-col gap-4">
        {/*
          Above everything else, including the evidence notice. When Vibe is
          waiting on a person, that is the only thing on this screen worth
          reading — and a question below a wall of status would be a question
          nobody answers (§30, §31).
        */}
        {pausedAudit && (
          <div className="flex flex-col gap-4">
            <AuditWaitingHeader />
            <NeedsUserPanel projectId={project.id} question={pausedAudit.question} />
          </div>
        )}

        <AuditEvidenceNotice
          notice={auditEvidenceNotice}
          deepScanHref={projectSectionHref(project.id, "deep-scan")}
        />

        {missingPrerequisites.length > 0 && (
          <Notice tone="waiting" label="Why this is blocked">
            A business audit needs {missingPrerequisites.join(", ")} first.
          </Notice>
        )}

        {/*
          CORE-2 §16: the first qualified audit is free, and the entitlement is
          decided server-side. This one states the decision and nothing else —
          the price and the balance belong to the state *after* it is spent, and
          `AuditCreditNotice` below is where they are said.
        */}
        {auditReady && !latestAudit?.result && auditAccess.freeAuditAvailable && (
          <Notice tone="info" label="Included">
            Your first business audit is free.
          </Notice>
        )}

        {systemRefresh && (
          <Notice tone="info" label="Vibe has improved">
            Vibe has since improved how it reads a business, so this check is out of date.
            Updating it is on us — it won&rsquo;t use up anything of yours.
          </Notice>
        )}

        <AuditCreditNotice gate={creditGate} />

        {/*
          The lifecycle drawn as its own states rather than one completed map
          with different headlines (AUDIT UI-1 §28). Each says something
          different about what Vibe is doing, and only `completed` shows
          judgments — nothing above it may imply a health or a priority that
          has not been decided yet (§31, §35, §36).
        */}
        {auditStage === "preparing" && <AuditPreparing />}
        {auditStage === "analyzing" && <AuditAnalyzing />}

        {latestAudit?.result ? (
          <>
            {/* Answer first, evidence second, tech last — all three owned by
                the component, so the reading order cannot be reassembled here
                (§14). */}
            <AuditOverview
              audit={latestAudit.result}
              generatedAt={latestAudit.completedAt ?? latestAudit.createdAt}
              movesHref={projectSectionHref(project.id, "action-plan")}
              hasMoves={hasMoves}
              movesByConclusion={contextualMoves}
              // Provenance rather than a notice: a current Deep Scan is a fact
              // about what this audit was made from, not something to interrupt
              // the verdict with (UI-7 §4).
              usedSignedInEvidence={
                Boolean(latestDeepScanSnapshot?.result) && !auditCurrency.newDeepScanEvidence
              }
            />
            {/* Readings, under the conclusion and under the map — never a
                second verdict competing with them. See the component. */}
            <BusinessHealth audit={latestAudit.result} />
          </>
        ) : auditStage !== null ? null : (
          // Not scored is not a score of zero. No meter, no number.
          <EmptyState
            title="Not analyzed yet"
            description="Vibe reads what it understands about your product, your repository and your public site, and works out what that means for the business. Nothing is judged until that runs."
          />
        )}
      </div>
    </WorkspaceSection>
  );
}
