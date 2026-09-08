import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  getAuditCurrency,
  getAuditReadiness,
  readAuditEvidence,
} from "@/modules/business-audit/service";
import { novaSituationFrom } from "@/modules/nova/briefing/situation";
import type { PrimaryGoal } from "@/modules/projects/founder-intent";
import type { NovaSituation } from "@/modules/nova/briefing/situation";
import { getLatestOpportunities } from "@/modules/opportunities/service";

/**
 * Where the founder stands, read at the tail of the operation that changed it.
 *
 * ## Why a durable step reads this at all
 *
 * Because the message it is about to generate is stored, and a render will
 * later recompute its reuse identity from persisted state. The situation is
 * part of that identity, so the step has to compose it from the same evidence
 * the page will — through `novaSituationFrom`, which both call. A step that
 * assembled the chain slightly differently would resolve to nothing on every
 * render, permanently, and look exactly like never having spoken.
 *
 * ## Why a failure here is not a failure
 *
 * A message with no situation is a message with less context. It is still
 * Nova's sentence, it still beats the template, and the operation it follows
 * has already completed and been settled. So the read degrades to null rather
 * than throwing past a completion nothing can take back — which is the same
 * standing `speakAfterOperation` itself has.
 */
export type SituationRead = {
  situation: NovaSituation;
  /** The founder's stated goal, which the evidence read already carries. */
  primaryGoal: PrimaryGoal | null;
};

export async function readSituation(
  /**
   * A client, not an `ExecutionDeps`. This never reaches a provider — it reads
   * persisted state and composes Vibe's own sentences from it — so taking the
   * provider would be handing a read something it has no business holding, and
   * would put a render one refactor away from being able to generate.
   */
  supabase: SupabaseClient,
  projectId: string,
): Promise<SituationRead | null> {
  try {
    const evidence = await readAuditEvidence(supabase, projectId);

    const [readiness, currency, opportunities] = await Promise.all([
      getAuditReadiness(supabase, projectId, evidence),
      getAuditCurrency(supabase, projectId, evidence),
      getLatestOpportunities(supabase, projectId),
    ]);

    return {
      situation: novaSituationFrom({ evidence, readiness, currency, opportunities }, new Date()),
      /* Free: `readAuditEvidence` reads the founder intent either way, and a
         caller that wants the goal would otherwise make a second query for a
         row this function already has in hand. */
      primaryGoal: evidence.founderIntent.intent.primaryGoal,
    };
  } catch (error) {
    console.error("[nova-voice] could not read the situation to speak from", {
      projectId,
      message: error instanceof Error ? error.message : "unknown",
    });
    return null;
  }
}
