import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getFounderName } from "@/modules/auth/founder-profile";
import {
  getAuditCurrency,
  getAuditReadiness,
  readAuditEvidence,
  type AuditEvidence,
} from "@/modules/business-audit/service";
import { getLatestOpportunities } from "@/modules/opportunities/service";
import { buildProvenanceChain } from "@/modules/provenance/chain";
import { provenanceInputsFrom } from "@/modules/provenance/from-evidence";

import { readNovaFocus } from "../read";
import type { NovaFocus } from "../focus";
import { buildNovaBriefing } from "./briefing";
import { buildBriefingView, type BriefingView } from "./view";

/**
 * The briefing, read from the database — once, by both sides.
 *
 * ## Why this is shared rather than done twice
 *
 * Two places build a briefing, and they must agree exactly: Nova Home renders
 * one, and the durable step that may generate a sentence about it computes its
 * reuse identity from one. The identity is a hash of the payload, so a field
 * assembled slightly differently on the two sides is not a bug that shows up
 * as a wrong answer — it is a permanent cache miss that shows up as nothing at
 * all, and every founder quietly getting the template forever.
 *
 * So there is one assembly, here, and both callers use it. The only thing that
 * legitimately differs between them is the clock, which is why `now` is an
 * argument.
 *
 * ## The reads
 *
 * One awaited `readAuditEvidence` — the six documents everything below shares
 * — then a single concurrent wave, none of which fans out. Currency and
 * readiness take the prefetched evidence and re-read nothing (VB-022). The
 * evidence and the focus are handed back rather than discarded, because Nova
 * Home needs both for surfaces beside the briefing and a second read of either
 * would be the thing this function exists to prevent.
 */
export type BriefingRead = {
  view: BriefingView;
  /** Handed back so a caller that also needs the audit does not re-read it. */
  evidence: AuditEvidence;
  /** Handed back for the same reason: the ranking is decided once. */
  focus: NovaFocus;
};

export async function readBriefingView(
  supabase: SupabaseClient,
  params: {
    projectId: string;
    userId: string;
    /**
     * The project's own label, for the panel's header.
     *
     * Display only: it never reaches the voice payload and therefore never
     * reaches the reuse identity, which is why the durable step that generates
     * a sentence omits it rather than making a query to fill a field the
     * payload discards. `briefing-slot.test.ts` asserts the payload is
     * identical whatever this is, so that stays checked rather than claimed.
     */
    projectName?: string;
    /** Injected so a briefing is a function of its inputs and one clock. */
    now?: Date;
  },
): Promise<BriefingRead> {
  const evidence = await readAuditEvidence(supabase, params.projectId);

  const [focus, currency, readiness, opportunities, founderName] = await Promise.all([
    readNovaFocus(supabase, params.projectId),
    getAuditCurrency(supabase, params.projectId, evidence),
    getAuditReadiness(supabase, params.projectId, evidence),
    getLatestOpportunities(supabase, params.projectId),
    getFounderName(supabase, params.userId),
  ]);

  /*
   * The engine's own rank-1 Move, never a re-ranking. Passed whenever a set
   * exists; whether it is worth *voicing* is the briefing's decision, and it
   * only reaches the read once the chain says the set is sound.
   */
  const topMove =
    opportunities?.set.opportunities.find((opportunity) => opportunity.rank === 1) ?? null;

  const briefing = buildNovaBriefing({
    founderName,
    projectName: params.projectName ?? "",
    primaryGoal: evidence.founderIntent.intent.primaryGoal,
    chain: buildProvenanceChain(
      provenanceInputsFrom({ evidence, readiness, currency, opportunities }),
    ),
    focus,
    topMove: topMove ? { title: topMove.title, whyNow: topMove.whyNow } : null,
    now: params.now ?? new Date(),
  });

  return { view: buildBriefingView(briefing), evidence, focus };
}
