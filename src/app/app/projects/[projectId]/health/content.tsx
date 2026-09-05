import { EmptyState, Notice } from "@/components/ui/states";
import { WorkspaceSection, projectSectionHref } from "@/components/layout/project-shell";
import {
  getAuditAccessStatus,
  getAuditCurrency,
  getAuditReadiness,
  readAuditEvidence,
  type AuditPrerequisite,
} from "@/modules/business-audit/service";
import {
  auditBlockedByCredits,
  resolveAuditCreditGate,
} from "@/modules/business-audit/entitlement";
import { getPausedAudit, getProjectAuditReadings } from "@/modules/business-audit/store";
import { buildAuditEvidenceNotice } from "@/modules/business-audit/evidence-notice";
import { getDeepScanAccessStatus } from "@/modules/authenticated-product-intelligence/service";
import { crossCheckIntelligence } from "@/modules/repository-intelligence/cross-check";
import { isBrowserProviderConfigured } from "@/modules/authenticated-product-intelligence/sandbox-browser/client";
import {
  getLatestSession,
  getLatestSuccessfulAuthenticatedSnapshot,
} from "@/modules/authenticated-product-intelligence/store";
import { detectAuthenticatedSurfaces } from "@/modules/authenticated-product-intelligence/surface-detection";
import { buildDeepScanViewModel } from "@/modules/authenticated-product-intelligence/view";
import { getActiveBusinessAuditOperation } from "@/modules/operations/service";
import { movesPerConclusion, resolveMoveLineage } from "@/modules/opportunities/lineage";
import { getLatestOpportunities } from "@/modules/opportunities/service";
import { buildNovaAuditEntry } from "@/modules/nova/feed";
import { readNovaAuditVoice } from "@/modules/nova/voice/audit-slot";
import { provenanceForAction } from "@/modules/provenance/actions";
import { buildProvenanceChain } from "@/modules/provenance/chain";
import { provenanceInputsFrom } from "@/modules/provenance/from-evidence";
import { buildBusinessBrainView } from "@/modules/projects/business-brain-view";

import { requireProjectAccess } from "@/modules/projects/workspace-context";
import { AuditCreditNotice } from "../audit-credit-notice";
import { AuditEvidenceNotice } from "../audit-evidence-notice";
import { AuditOverview } from "../audit-overview";
import { NovaAuditVoice } from "../nova-audit-voice";
import { AuditAnalyzing, AuditPreparing, AuditWaitingHeader } from "../audit-lifecycle";
import { NeedsUserPanel } from "../needs-user-panel";
import { ProvenancePanel } from "../provenance-panel";
import { RunAuditButton } from "../run-audit-button";

/**
 * How a missing prerequisite reads in the sentence "A business audit needs
 * … first." Phrased as things rather than as error codes, and the two
 * profile cases stay distinct because their remedies are (CORE-2 §8).
 */
const AUDIT_PREREQUISITE_LABELS: Record<AuditPrerequisite, string> = {
  repository_intelligence_missing: "a scan of your code",
  live_product_intelligence_missing: "a scan of your website",
  repository_scan_outdated: "a fresh scan of your code",
  live_scan_outdated: "a fresh scan of your website",
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
type ProjectAccess = Awaited<ReturnType<typeof requireProjectAccess>>;

/**
 * The shared, server-rendered Business Health command surface.
 *
 * Both the canonical project Home and the legacy `/health` compatibility
 * route authorize independently, then hand the already-proven project context
 * here. Keeping the expensive read model in one place prevents the two URLs
 * from drifting while avoiding a second authorization query on Home.
 */
export async function ProjectBusinessHealth({ access }: { access: ProjectAccess }) {
  const { supabase, userId, project } = access;
  const projectId = project.id;

  /*
   * The evidence every read model below shares, fetched once (VB-022).
   *
   * The audit document, the repository snapshot, the live snapshot, the
   * authenticated snapshot, the product profile and the founder intent were
   * each fetched by this page *and* re-fetched inside `getAuditCurrency`,
   * `getAuditReadiness` and the profile-currency check within it — measured at
   * four fetches of the repository snapshot and four of the live snapshot per
   * render of the most-visited route in the product, on documents that are
   * hundreds of kilobytes of JSONB.
   *
   * Genuinely first, so it is awaited before the wave rather than inside it.
   * One extra round trip's worth of latency buys back eight.
   */
  const evidence = await readAuditEvidence(supabase, projectId);
  const { latestAudit, repository: latestSnapshot, live: latestLiveSnapshot } = evidence;

  const [
    auditCurrency,
    activeAuditOperation,
    auditReadiness,
    auditAccess,
    deepScanAccess,
    latestDeepScanSnapshot,
    latestDeepScanSession,
    opportunities,
    pausedAudit,
    auditReadings,
  ] = await Promise.all([
    getAuditCurrency(supabase, projectId, evidence),
    // Discovered on the server so returning here shows a running audit rather
    // than an inviting button (Sprint 7 §19).
    getActiveBusinessAuditOperation(supabase, projectId),
    getAuditReadiness(supabase, projectId, evidence),
    getAuditAccessStatus(supabase, { projectId, userId }, evidence),
    getDeepScanAccessStatus(supabase, {
      projectId,
      userId,
      owned: { productionUrl: project.productionUrl },
    }),
    getLatestSuccessfulAuthenticatedSnapshot(supabase, projectId),
    getLatestSession(supabase, projectId),
    // CORE-2 §18: "Where I'd start" links to the existing Opportunity Engine's
    // output. The audit never produces moves of its own.
    getLatestOpportunities(supabase, projectId),
    // Read server-side so the question survives a reload, a navigation away,
    // and a different device: browser state is never authoritative here
    // (§33, §34, §35).
    getPausedAudit(supabase, projectId),
    getProjectAuditReadings(supabase, projectId),
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
  const contextualLineage =
    latestAudit?.result && opportunities && opportunities.set.businessAuditId === latestAudit.id
      ? resolveMoveLineage({
          sourceAudit: latestAudit.result,
          opportunities: opportunities.set.opportunities,
        })
      : {};
  const contextualMoves = movesPerConclusion(contextualLineage);
  const contextualMoveDetails = Object.fromEntries(
    (opportunities?.set.opportunities ?? [])
      .slice()
      .sort((a, b) => a.rank - b.rank)
      .flatMap((move) => {
        const key = contextualLineage[move.id]?.conclusionKey;
        return key
          ? [[key, { title: move.title, impact: move.impact, effort: move.effort }] as const]
          : [];
      })
      .filter(
        ([key], index, entries) => entries.findIndex(([candidate]) => candidate === key) === index,
      ),
  );

  const usedSignedInEvidence =
    Boolean(latestDeepScanSnapshot?.result) && !auditCurrency.newDeepScanEvidence;
  const businessBrainView = latestAudit?.result
    ? buildBusinessBrainView({
        audit: latestAudit.result,
        lastScanAt: latestAudit.completedAt ?? latestAudit.createdAt,
        auditReadings,
        movesByConclusion: contextualMoves,
        moveByConclusion: contextualMoveDetails,
        usedSignedInEvidence,
      })
    : null;

  /*
   * What Nova says above the audit, if she has said anything about *this* one.
   *
   * A read and nothing else: `readNovaAuditVoice` takes no provider, and the
   * message it resolves was written by the durable step that completed the
   * audit (ADR 0086). A render that could generate would be the per-visit
   * spend §M of the Nova audit refuses — so the only thing this page can do is
   * look up an identity and find a sentence or not.
   *
   * The identity is a hash of the `nova.audit` entry, and this page builds
   * that entry from the *full* view — history, moves, a scan timestamp —
   * where the durable step built it from a bare one. They agree because none
   * of those inputs reach the five fields `buildNovaAuditEntry` reads, which
   * `audit-slot.test.ts` asserts against the real builder rather than assuming.
   */
  const novaAuditVoice =
    businessBrainView && latestAudit?.result?.synthesis
      ? await readNovaAuditVoice(supabase, {
          projectId,
          entry: buildNovaAuditEntry(businessBrainView, latestAudit.result.synthesis),
        })
      : null;

  /*
   * The same comparison My Product renders, read here as evidence about the
   * business rather than about the code: a capability the audit scored on the
   * strength of the repository, which no visitor can reach, is a finding the
   * Brain has to carry too.
   */
  const crossCheck = latestSnapshot?.result
    ? crossCheckIntelligence(
        latestSnapshot.result,
        latestLiveSnapshot?.result ?? null,
        latestDeepScanSnapshot?.result ?? null,
      )
    : null;

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
   * What this audit would be built on, before it is bought (rule 47's spirit,
   * applied to evidence rather than to tokens).
   *
   * Derived from what this page has already read — the same evidence, the same
   * readiness and the same currency the button gate uses — so the panel and the
   * button cannot disagree, and nothing is fetched twice for it (VB-022).
   *
   * Narrowed to `business_audit`: the Move set below is a real link in the
   * chain and is not this button's business, and a wall built out of an
   * unrelated fact is how a surface like this stops being read.
   */
  const auditProvenance = provenanceForAction(
    buildProvenanceChain(
      provenanceInputsFrom({
        evidence,
        readiness: auditReadiness,
        currency: auditCurrency,
        opportunities,
      }),
    ),
    "business_audit",
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
      eyebrow="Business intelligence"
      variant="intelligence"
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
      headerStatus={
        creditGate.kind === "not_applicable" ? undefined : <AuditCreditNotice gate={creditGate} />
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
          The chain itself, under the sentence that summarises it. A founder who
          has been handed a wrong answer once needs to see the dates and the
          reader versions, not be told again that everything is fine — see
          `provenance-panel.tsx` on why this is not a badge.
        */}
        <ProvenancePanel provenance={auditProvenance} projectId={project.id} />

        {/*
          CORE-2 §16: the first qualified audit is free, and the entitlement is
          decided server-side. This one states the decision and nothing else —
          the price and the balance belong to the state *after* it is spent, and
          `AuditCreditNotice` in the command header is where they are said.
        */}
        {auditReady && !latestAudit?.result && auditAccess.freeAuditAvailable && (
          <Notice tone="info" label="Included">
            Your first business audit is free.
          </Notice>
        )}

        {systemRefresh && (
          <Notice tone="info" label="Vibe has improved">
            Vibe has since improved how it reads a business, so this check is out of date. Updating
            it is on us — it won&rsquo;t use up anything of yours.
          </Notice>
        )}

        {/*
          The lifecycle drawn as its own states rather than one completed map
          with different headlines (AUDIT UI-1 §28). Each says something
          different about what Vibe is doing, and only `completed` shows
          judgments — nothing above it may imply a health or a priority that
          has not been decided yet (§31, §35, §36).
        */}
        {auditStage === "preparing" && <AuditPreparing />}
        {auditStage === "analyzing" && <AuditAnalyzing />}

        {/*
          Nova speaks only about an audit she was actually asked about.
          `resolved` is false for every audit that completed before this
          existed, and for every one completed with the switch off — and for
          those the page is exactly what it was, rather than carrying a
          sentence about a moment that never happened.
        */}
        {novaAuditVoice?.resolved && <NovaAuditVoice read={novaAuditVoice} />}

        {businessBrainView ? (
          <AuditOverview
            view={businessBrainView}
            movesHref={projectSectionHref(project.id, "action-plan")}
            hasMoves={hasMoves}
            contradictions={crossCheck?.compared ? crossCheck.checks : []}
          />
        ) : latestAudit?.result ? (
          <Notice tone="info" label="Older audit">
            This audit predates the nine-area Business Brain. Re-scan when you want Vibe to build
            the connected view from the current audit contract.
          </Notice>
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
