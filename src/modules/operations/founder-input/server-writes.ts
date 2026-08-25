import "server-only";

import { createServiceClient } from "@/lib/supabase/service";
import { assertNoSecretMaterial, SecretMaterialRejected } from "@/modules/execution-contract/secrets";
import {
  callResolveFounderInputRequest,
  getFounderInputRequest,
} from "@/modules/founder-input/store";
import type { FounderInputResponse } from "@/modules/founder-input/schema";
import { resolveFounderInputResponse } from "@/modules/founder-input/resolve";

export type ResolveFounderInputResult =
  | { ok: true; resolutionId: string }
  | {
      ok: false;
      error:
        | "project_not_found"
        | "request_not_found"
        | "request_not_open"
        | "stale_request"
        | "invalid_response"
        | "secret_rejected"
        | "resolution_failed";
    };

/**
 * The only service-role write for a founder response (ADR 0053).
 *
 * Ownership is re-established from the persisted project row before the RPC;
 * the database repeats the same check while holding the request lock. The RPC
 * then validates the selected path against the stored request and performs the
 * supersession/insert/close transition atomically.
 */
export async function resolveFounderInput(params: {
  projectId: string;
  userId: string;
  requestId: string;
  expectedContextHash: string;
  response: FounderInputResponse;
}): Promise<ResolveFounderInputResult> {
  const supabase = createServiceClient();
  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id")
    .eq("id", params.projectId)
    .eq("user_id", params.userId)
    .maybeSingle();
  if (projectError || !project) return { ok: false, error: "project_not_found" };

  const request = await getFounderInputRequest(supabase, params.requestId);
  if (!request || request.projectId !== params.projectId) {
    return { ok: false, error: "request_not_found" };
  }
  const resolved = resolveFounderInputResponse(request, params.response);
  if (!resolved) return { ok: false, error: "invalid_response" };

  if (resolved.source === "custom") {
    try {
      assertNoSecretMaterial("founderInput.rawAnswer", resolved.rawAnswer!);
    } catch (error) {
      if (error instanceof SecretMaterialRejected) return { ok: false, error: "secret_rejected" };
      throw error;
    }
  }

  try {
    const resolutionId = await callResolveFounderInputRequest(supabase, {
      requestId: params.requestId,
      userId: params.userId,
      source: resolved.source,
      selectedOptionId: resolved.selectedOptionId,
      rawAnswer: resolved.rawAnswer,
      expectedContextHash: params.expectedContextHash,
    });
    return { ok: true, resolutionId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("founder_input_request_not_found")) {
      return { ok: false, error: "request_not_found" };
    }
    if (message.includes("founder_input_request_not_open")) {
      return { ok: false, error: "request_not_open" };
    }
    if (message.includes("stale_founder_input_request")) {
      return { ok: false, error: "stale_request" };
    }
    if (message.includes("founder_input_") || message.includes("founder input")) {
      return { ok: false, error: "invalid_response" };
    }
    return { ok: false, error: "resolution_failed" };
  }
}
