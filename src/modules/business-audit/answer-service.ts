import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { recordAuditEvent } from "@/modules/audit-log/events";
import { getCorrections, saveCorrections } from "@/modules/product-understanding/store";
import { saveFounderIntent } from "@/modules/projects/founder-intent-store";
import { getFounderIntent } from "@/modules/projects/founder-intent-store";
import { routeAnswer, validateAnswer } from "./answer-routing";
import { getPausedAudit, resumeAuditAfterAnswer } from "./store";
import type { FounderQuestionIntent } from "./founder-questions";

/**
 * Taking an answer and letting the audit continue (CORE-2a.4 §24, §38, §39).
 *
 * ## The order is the safety property
 *
 * The answer is written to its canonical store **before** the audit is
 * un-paused, and the audit is un-paused **before** the operation is re-queued.
 * Read backwards, every failure point leaves a recoverable state:
 *
 *  - crash before the write → nothing happened; the question is still pending
 *    and the founder can answer again.
 *  - crash after the write, before the un-pause → the answer is safe, the
 *    question is still pending; re-answering is idempotent because the stores
 *    accept the same value twice.
 *  - crash after the un-pause, before re-queue → the answer is safe and the
 *    audit is unblocked; the run can be restarted.
 *
 * The one ordering that must never happen is un-pausing first, because a crash
 * there loses the founder's answer while removing the only prompt that would
 * have collected it again (§39).
 *
 * ## Idempotence
 *
 * `resumeAuditAfterAnswer` matches on `status = needs_user`, so a second
 * submission of the same answer updates no rows and returns `resumed: false`.
 * The caller then skips re-queuing, which is what stops a double-click starting
 * two inferences (§38, §53).
 */

export type AnswerFailure =
  | "no_pending_question"
  | "question_mismatch"
  | "not_storable"
  | "value_not_permitted"
  | "value_empty"
  | "unknown_intent"
  | "save_failed";

export type AnswerResult =
  | { ok: true; auditId: string; resumed: boolean }
  | { ok: false; error: AnswerFailure };

export type SubmitAnswerParams = {
  projectId: string;
  userId: string;
  /** Which question the client believes it is answering. */
  intent: string;
  unsure: boolean;
  value: string | null;
};

export async function submitFounderAnswer(
  supabase: SupabaseClient,
  params: SubmitAnswerParams,
): Promise<AnswerResult> {
  const paused = await getPausedAudit(supabase, params.projectId);
  if (paused === null) return { ok: false, error: "no_pending_question" };

  /*
   * The client says which question it is answering, and it has to match.
   *
   * Without this, an answer submitted from a stale tab — the founder answered
   * on their phone, then hit submit on the laptop still showing the previous
   * question — would be written against whichever question happens to be
   * pending now. That is a wrong fact in a canonical store, which is worse
   * than a rejected submission.
   */
  if (paused.question.intent !== params.intent) {
    return { ok: false, error: "question_mismatch" };
  }

  const intent = paused.question.intent;
  const validation = validateAnswer(intent, { unsure: params.unsure, value: params.value });
  if (!validation.ok) return { ok: false, error: validation.reason };

  if (validation.answer.kind === "value") {
    const saved = await persistAnswer(supabase, {
      projectId: params.projectId,
      userId: params.userId,
      intent,
      value: validation.answer.value,
    });
    if (!saved) return { ok: false, error: "save_failed" };
  }

  const resumed = await resumeAuditAfterAnswer(supabase, paused.auditId);

  // Recorded once, on the transition that actually happened. A second
  // submission resumes nothing and must not add a second event, or the log
  // would show a founder answering twice when they clicked twice.
  if (resumed.resumed) {
    await recordAuditEvent(supabase, {
      userId: params.userId,
      eventType: "business_audit.question_answered",
      metadata: {
        projectId: params.projectId,
        auditId: paused.auditId,
        questionIntent: intent,
        // Whether they answered or said they had not decided — never what they
        // typed. An audit log is not the place for a founder's own words.
        answered: validation.answer.kind === "value" ? "value" : "unsure",
        affectedLenses: paused.question.affectedLenses,
      },
    });
  }

  return { ok: true, auditId: paused.auditId, resumed: resumed.resumed };
}

/**
 * Writes the answer where that kind of fact belongs (§18, §19, §51, §52).
 *
 * `saveFounderIntent` takes the whole intent, so the current values are read
 * first and only the answered field is replaced — answering "who is my first
 * customer" must not blank out a stage the founder set weeks ago.
 */
async function persistAnswer(
  supabase: SupabaseClient,
  params: { projectId: string; userId: string; intent: FounderQuestionIntent; value: string },
): Promise<boolean> {
  const destination = routeAnswer(params.intent);
  if (destination === null) return false;

  if (destination.store === "product_profile") {
    /*
     * Merged, never replaced.
     *
     * `saveCorrections` upserts the whole corrections object, so writing only
     * the answered field would silently delete every other correction the
     * founder has ever made — the product name, the description, the promise.
     * Reading first is the difference between recording an answer and
     * discarding the rest of someone's work.
     */
    const existing = await getCorrections(supabase, params.projectId);
    await saveCorrections(supabase, {
      projectId: params.projectId,
      corrections: { ...existing, [destination.field]: params.value },
    });
    return true;
  }

  const current = await getFounderIntent(supabase, params.projectId);
  const result = await saveFounderIntent(supabase, {
    projectId: params.projectId,
    userId: params.userId,
    input: {
      stage: current.intent.stage,
      monetizationModel: current.intent.monetizationModel,
      primaryGoal: current.intent.primaryGoal,
      [destination.field]: params.value,
    },
  });

  return result.ok;
}
