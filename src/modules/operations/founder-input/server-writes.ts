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
        | "execution_not_settled"
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
/**
 * The text of a PL/pgSQL `raise exception`, however supabase-js hands it over.
 *
 * `error instanceof Error` was the obvious way to write this and it is wrong:
 * on its default path (no `throwOnError`) postgrest-js returns the parsed body
 * — a **plain object** — and only constructs a real `PostgrestError` when
 * throwing is enabled (`PostgrestBuilder.ts:548` versus `:506`/`:536`). The
 * store re-throws that object as-is, so the `instanceof` arm never matched,
 * `String(error)` produced `"[object Object]"`, and every classification below
 * fell through to `resolution_failed`.
 *
 * What that cost: `runtime_founder_input_reservation_still_active` — the guard
 * that stops a resolution committing against an unreleased Credit hold — told
 * the founder "try again", when waiting is the only thing that works.
 *
 * Reading the property directly covers both shapes, and the string arm keeps
 * a genuinely thrown non-object readable.
 */
function postgresErrorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  const message = (error as { message?: unknown } | null | undefined)?.message;
  return typeof message === "string" ? message : "";
}

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
    const message = postgresErrorMessage(error);
    if (message.includes("founder_input_request_not_found")) {
      return { ok: false, error: "request_not_found" };
    }
    if (message.includes("founder_input_request_not_open")) {
      return { ok: false, error: "request_not_open" };
    }
    if (message.includes("stale_founder_input_request")) {
      return { ok: false, error: "stale_request" };
    }
    if (message.includes("runtime_founder_input_reservation_still_active")) {
      return { ok: false, error: "execution_not_settled" };
    }
    if (message.includes("founder_input_") || message.includes("founder input")) {
      return { ok: false, error: "invalid_response" };
    }
    return { ok: false, error: "resolution_failed" };
  }
}
