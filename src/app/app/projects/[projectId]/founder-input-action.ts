"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getLatestActionPlan } from "@/modules/action-plans/service";
import { requireSession } from "@/modules/auth/session";
import { resolveFounderInput } from "@/modules/operations/founder-input/server-writes";
import type { FounderInputResponse } from "@/modules/founder-input/schema";

export type FounderInputActionState =
  | { ok: true }
  | { ok: false; message: string }
  | null;

const ERROR_COPY = {
  project_not_found: "This project is no longer available.",
  request_not_found: "This question is no longer available.",
  request_not_open: "This question has already been resolved or replaced.",
  stale_request: "Vibe's understanding changed. Reload before answering this question.",
  invalid_response: "Choose one of the available answers or provide a custom answer.",
  secret_rejected: "Do not paste passwords, API keys, tokens, or other credentials here.",
  execution_not_settled: "Vibe is still closing the previous attempt. Wait a moment, then try again.",
  resolution_failed: "Your answer could not be saved. Please try again.",
} as const;

export async function resolveFounderInputAction(
  projectId: string,
  requestId: string,
  contextHash: string,
  _previous: FounderInputActionState,
  formData: FormData,
): Promise<FounderInputActionState> {
  const session = await requireSession();
  const supabase = await createClient();
  const currentPlan = await getLatestActionPlan(supabase, projectId);
  if (
    !currentPlan ||
    currentPlan.staleness.length > 0 ||
    currentPlan.founderInputRequest?.id !== requestId ||
    currentPlan.founderInputRequest.contextHash !== contextHash
  ) {
    return { ok: false, message: ERROR_COPY.stale_request };
  }

  const choice = formData.get("choice");
  if (typeof choice !== "string") {
    return { ok: false, message: ERROR_COPY.invalid_response };
  }

  let response: FounderInputResponse;
  if (choice === "recommendation") {
    response = { source: "recommendation" };
  } else if (choice.startsWith("option:")) {
    response = { source: "option", selectedOptionId: choice.slice("option:".length) };
  } else if (choice === "custom") {
    const rawAnswer = formData.get("customAnswer");
    response = { source: "custom", rawAnswer: typeof rawAnswer === "string" ? rawAnswer : "" };
  } else {
    return { ok: false, message: ERROR_COPY.invalid_response };
  }

  const result = await resolveFounderInput({
    projectId,
    userId: session.userId,
    requestId,
    expectedContextHash: contextHash,
    response,
  });
  if (!result.ok) return { ok: false, message: ERROR_COPY[result.error] };

  revalidatePath(`/app/projects/${projectId}/plan`);
  return { ok: true };
}
