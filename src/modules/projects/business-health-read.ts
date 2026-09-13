import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getAuditCurrency,
  readAuditEvidence,
  type AuditCurrency,
  type AuditEvidence,
} from "@/modules/business-audit/service";
import { getProjectAuditReadings } from "@/modules/business-audit/store";
import { getLatestSuccessfulAuthenticatedSnapshot } from "@/modules/authenticated-product-intelligence/store";
import { movesPerConclusion, resolveMoveLineage } from "@/modules/opportunities/lineage";
import { getLatestOpportunities } from "@/modules/opportunities/service";
import type { OpportunitySetView } from "@/modules/opportunities/service";
import {
  buildBusinessBrainView,
  strongestAreas,
  type BusinessBrainMove,
  type BusinessBrainView,
  type BusinessStrength,
} from "@/modules/projects/business-brain-view";

/**
 * The Business Health reading, as a function rather than as a screen.
 *
 * ## Why this file exists
 *
 * Because the assembly lived inside `health/content.tsx` — ten reads, a
 * lineage join and a view build, in an async server component — and the
 * Business Agent needs the same reading to answer a question about it. Two
 * copies of a ten-read assembly is two things to keep in step and one of them
 * silently wrong; the tool adapter and the page now call this, so what Nova
 * says about Business Health and what the Business Health page shows come from
 * one place by construction (the task's rule, and the audit's §D).
 *
 * ## What was extracted and what was left
 *
 * Extracted: the evidence read, the currency check, the reading history, the
 * Moves and their lineage against *this* audit, the brain view and the
 * strengths. Left on the page: the credit gate, the Deep Scan panel, the paused
 * question, the provenance panel and the run button — screen concerns, none of
 * which a tool answers. The page passes the evidence it already holds so the
 * extraction costs it no extra round trip.
 *
 * ## The lineage guard is load-bearing and came across verbatim
 *
 * Moves are bound to conclusion keys inside one immutable audit document. Read
 * a set's keys against a *newer* audit and every Move silently rebinds to
 * whatever finding now sits at that position — a link a founder would read as
 * causal and that nothing ever asserted. Hence the `businessAuditId` equality
 * before any lineage is resolved.
 */

export type BusinessHealthReading = {
  /** False when no audit has ever completed. Never the same as a zero score. */
  hasAudit: boolean;
  /** Null when no audit completed, and also when one did but produced no synthesis. */
  view: BusinessBrainView | null;
  strengths: readonly BusinessStrength[];
  currency: AuditCurrency;
  opportunities: OpportunitySetView | null;
  auditId: string | null;
  /** When the reading was produced. Null when there is none. */
  producedAt: string | null;
  movesByConclusion: Record<string, number>;
  moveByConclusion: Record<string, BusinessBrainMove>;
  usedSignedInEvidence: boolean;
};

export async function readBusinessHealth(
  supabase: SupabaseClient,
  params: {
    projectId: string;
    /** Passed by callers that already read it, so the page pays for it once. */
    evidence?: AuditEvidence;
    /** Same: the page already knows whether a Deep Scan result exists. */
    deepScanResultPresent?: boolean;
    opportunities?: OpportunitySetView | null;
  },
): Promise<BusinessHealthReading> {
  const { projectId } = params;
  const evidence = params.evidence ?? (await readAuditEvidence(supabase, projectId));
  const latestAudit = evidence.latestAudit;

  const [currency, auditReadings, opportunities, deepScanResultPresent] = await Promise.all([
    getAuditCurrency(supabase, projectId, evidence),
    getProjectAuditReadings(supabase, projectId),
    params.opportunities !== undefined
      ? Promise.resolve(params.opportunities)
      : getLatestOpportunities(supabase, projectId),
    params.deepScanResultPresent !== undefined
      ? Promise.resolve(params.deepScanResultPresent)
      : getLatestSuccessfulAuthenticatedSnapshot(supabase, projectId).then((snapshot) =>
          Boolean(snapshot?.result),
        ),
  ]);

  const sameAudit =
    latestAudit?.result != null &&
    opportunities != null &&
    opportunities.set.businessAuditId === latestAudit.id;

  const lineage = sameAudit
    ? resolveMoveLineage({
        sourceAudit: latestAudit.result,
        opportunities: opportunities.set.opportunities,
      })
    : {};
  const movesByConclusion = movesPerConclusion(lineage);
  const moveByConclusion = Object.fromEntries(
    (opportunities?.set.opportunities ?? [])
      .slice()
      .sort((a, b) => a.rank - b.rank)
      .flatMap((move) => {
        const key = lineage[move.id]?.conclusionKey;
        return key
          ? [[key, { title: move.title, impact: move.impact, effort: move.effort }] as const]
          : [];
      })
      .filter(
        ([key], index, entries) => entries.findIndex(([candidate]) => candidate === key) === index,
      ),
  );

  const usedSignedInEvidence = deepScanResultPresent && !currency.newDeepScanEvidence;
  const producedAt = latestAudit ? (latestAudit.completedAt ?? latestAudit.createdAt) : null;

  const view = latestAudit?.result
    ? buildBusinessBrainView({
        audit: latestAudit.result,
        lastScanAt: producedAt,
        auditReadings,
        movesByConclusion,
        moveByConclusion,
        usedSignedInEvidence,
      })
    : null;

  return {
    hasAudit: latestAudit?.result != null,
    view,
    strengths: latestAudit?.result ? strongestAreas(latestAudit.result.synthesis) : [],
    currency,
    opportunities,
    auditId: latestAudit?.id ?? null,
    producedAt,
    movesByConclusion,
    moveByConclusion,
    usedSignedInEvidence,
  };
}
