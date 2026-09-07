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
import type { BusinessOpportunity } from "@/modules/opportunities/schema";

import { buildNovaBriefing, type NovaBriefing } from "./briefing";
import { buildNovaSituation, type NovaSituation } from "./situation";

/**
 * The briefing, read from the database — once, by everything that needs it.
 *
 * ## Why this is shared rather than done per caller
 *
 * Because the briefing reaches a model as part of a voice payload, and the
 * payload is hashed into the reuse identity a render then recomputes. A field
 * assembled slightly differently on two sides is not a bug that shows up as a
 * wrong answer — it is a permanent miss that shows up as nothing at all, and
 * every founder quietly getting the template forever.
 *
 * So there is one assembly, here. The only thing that legitimately differs
 * between callers is the clock, which is why `now` is an argument.
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
  briefing: NovaBriefing;
  /**
   * The block that travels with a voice payload, composed here so that a
   * surface reading a stored message back computes the same identity the
   * durable step wrote it under.
   */
  situation: NovaSituation;
  /**
   * The engine's rank-1 Move, whole.
   *
   * The briefing reduces it to a title and a reason; a surface that wants to
   * *draw* it — or to look up what Nova said about it — needs the object, and
   * it was read a line above either way.
   */
  topMove: BusinessOpportunity | null;
  /** Handed back so a caller that also needs the audit does not re-read it. */
  evidence: AuditEvidence;
  /** Handed back for the same reason: the ranking is decided once. */
  focus: NovaFocus;
};

export async function readBriefing(
  supabase: SupabaseClient,
  params: {
    projectId: string;
    userId: string;
    /**
     * The project's own label.
     *
     * Optional because nothing that consumes a briefing needs it any more: the
     * situation block is built from the evidence chain, and the panel that once
     * put a name in a header is gone. Kept on `NovaBriefing` because that type
     * is the whole of what Nova knows, and a caller that wants to address a
     * founder by product should not have to read the row again.
     */
    projectName?: string;
    /** Injected so a briefing is a function of its inputs and one clock. */
    now?: Date;
  },
): Promise<BriefingRead> {
  const evidence = await readAuditEvidence(supabase, params.projectId);

  const [focus, currency, readiness, opportunities, founderName] = await Promise.all([
    readNovaFocus(supabase, params.projectId, params.userId),
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

  /* One chain and one clock, so the briefing and the situation cannot come to
     describe different moments of the same project. */
  const chain = buildProvenanceChain(
    provenanceInputsFrom({ evidence, readiness, currency, opportunities }),
  );
  const now = params.now ?? new Date();

  const briefing = buildNovaBriefing({
    founderName,
    projectName: params.projectName ?? "",
    primaryGoal: evidence.founderIntent.intent.primaryGoal,
    chain,
    focus,
    topMove: topMove ? { title: topMove.title, whyNow: topMove.whyNow } : null,
    now,
  });

  return {
    briefing,
    situation: buildNovaSituation(chain, now),
    topMove,
    evidence,
    focus,
  };
}
