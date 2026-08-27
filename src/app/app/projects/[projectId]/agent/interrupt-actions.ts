"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/modules/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { FounderInputFormState } from "@/components/founder-input/founder-input-card";
import type { FounderInputResponse } from "@/modules/founder-input/schema";
import { getFounderInputRequest } from "@/modules/founder-input/store";
import { resolveFounderInput } from "@/modules/operations/founder-input/server-writes";

/**
 * Answering the question a run stopped on (UI-19, artboard 2f).
 *
 * ## What answering does, and what it deliberately does not
 *
 * It records the founder's decision through the canonical Founder Input
 * Resolution path. It does **not** resume the run, and that is the
 * architecture rather than an omission — `finalizeAgentRun` says it plainly:
 * a paused attempt "must neither charge nor invent a resume. Resolution later
 * cancels this run, and a fresh attempt goes through admission with its own
 * hold."
 *
 * So this action stops where the free part stops. Starting the next attempt is
 * a priced action and belongs where prices are disclosed and confirmed, not
 * inside a question card that a founder is answering for a different reason.
 * The screen says so in words rather than leaving them to discover it.
 *
 * ## Ownership is the query, three times over
 *
 * The request is read scoped to the project, checked to be the runtime blocker
 * it claims to be, and checked against the context hash the form was rendered
 * with. `resolveFounderInput` then re-checks ownership against the project row
 * on the service client before writing anything. A stale form resolves nothing.
 */
export async function resolveAgentInterruptAction(
  projectId: string,
  requestId: string,
  contextHash: string,
  _previous: FounderInputFormState,
  formData: FormData,
): Promise<FounderInputFormState> {
  const session = await requireSession();
  const supabase = await createClient();

  const request = await getFounderInputRequest(supabase, requestId);
  if (
    !request ||
    request.projectId !== projectId ||
    request.origin !== "execution_blocker" ||
    request.contextHash !== contextHash ||
    !request.executionInterruptId
  ) {
    return { ok: false, message: "This question is no longer available." };
  }

  const choice = formData.get("choice");
  let response: FounderInputResponse;
  if (choice === "recommendation") {
    response = { source: "recommendation" };
  } else if (typeof choice === "string" && choice.startsWith("option:")) {
    response = { source: "option", selectedOptionId: choice.slice("option:".length) };
  } else if (choice === "custom") {
    const rawAnswer = formData.get("customAnswer");
    response = { source: "custom", rawAnswer: typeof rawAnswer === "string" ? rawAnswer : "" };
  } else {
    return { ok: false, message: "Choose an answer or provide your own." };
  }

  const resolved = await resolveFounderInput({
    projectId,
    userId: session.userId,
    requestId,
    expectedContextHash: contextHash,
    response,
  });

  if (!resolved.ok) {
    /*
     * `execution_not_settled` is the one worth its own sentence: the guard that
     * stops a resolution committing while the paused run still holds Credits.
     * The generic message would say "try again", and waiting is the only thing
     * that works.
     */
    const message =
      resolved.error === "execution_not_settled"
        ? "Vibe is still releasing this run's Credits. That takes a moment — try again shortly."
        : resolved.error === "secret_rejected"
          ? "That answer looks like it contains a key or token, so Vibe did not store it."
          : resolved.error === "stale_request" || resolved.error === "request_not_open"
            ? "This question has already been answered."
            : "Vibe could not record that answer.";
    return { ok: false, message };
  }

  revalidatePath(`/app/projects/${projectId}/agent`);
  return { ok: true };
}
