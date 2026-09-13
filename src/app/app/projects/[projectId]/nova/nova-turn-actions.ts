"use server";

import { requireSession } from "@/modules/auth/session";
import { createClient } from "@/lib/supabase/server";
import {
  startAgentTurn,
  type StartAgentTurnOutcome,
} from "@/modules/operations/business-agent/service";
import { VercelWorkflowExecutor } from "@/modules/operations/vercel/executor";
import { revalidatePath } from "next/cache";

/**
 * Asking Nova something.
 *
 * ## What this action does and does not decide
 *
 * It proves a session, hands the text to the operations module, and maps the
 * outcome to copy. It does not bound the message, choose a conversation,
 * decide whether the turn may start, or touch a conversation table — all of
 * which belong behind `startAgentTurn`, because all of them are the same
 * decision whether the caller is this form, a test, or something later.
 *
 * ## Only two things arrive from the browser
 *
 * The project id, which the caller must own, and the founder's own text. There
 * is no model, no tool set, no skill and no conversation to choose from the
 * client (rule 46); the conversation is the project's current thread unless the
 * founder is reading an older one, and even then the id is checked against the
 * project's own rows before anything is written to it.
 */

export type AskNovaActionState =
  | { ok: true; conversationId: string }
  /**
   * The founder's own words come back with the refusal.
   *
   * React resets an uncontrolled form once its action resolves, which is the
   * right behaviour for the successful case and would silently throw away what
   * somebody typed in the failing one. Returning the text lets the composer put
   * it back, so a refusal costs a click rather than a paragraph.
   */
  | { ok: false; message: string; text: string }
  | null;

const REFUSALS: Record<Extract<StartAgentTurnOutcome, { kind: "failed" }>["error"], string> = {
  project_not_found: "That project could not be found.",
  message_rejected: "There was nothing to send.",
  start_refused:
    "Nova could not pick that up just now. Nothing changed, and trying again in a moment usually works.",
};

export async function askNovaAction(
  projectId: string,
  _prevState: AskNovaActionState,
  formData: FormData,
): Promise<AskNovaActionState> {
  const session = await requireSession();
  const supabase = await createClient();

  const text = String(formData.get("message") ?? "");
  const outcome = await startAgentTurn(supabase, new VercelWorkflowExecutor(), {
    projectId,
    userId: session.userId,
    conversationId: readOptional(formData, "conversationId"),
    text,
  });

  if (outcome.kind === "failed") {
    return { ok: false, message: REFUSALS[outcome.error], text };
  }

  /*
   * The thread is server-rendered, so the founder's own message only appears
   * once the page re-reads it. Revalidating on both outcomes is deliberate:
   * `active` means a turn is already running, and the question that started it
   * is in the thread whether or not this request started anything.
   */
  revalidatePath(`/app/projects/${projectId}`);
  return { ok: true, conversationId: outcome.conversationId };
}

function readOptional(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
