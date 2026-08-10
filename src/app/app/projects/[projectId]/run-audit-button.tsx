"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import type { RunAuditFailureCode } from "@/modules/business-audit/service";
import { runAuditAction, type RunAuditActionState } from "./run-audit-action";

/**
 * User-facing copy for every typed failure (Sprint 4 §27).
 *
 * Raw provider errors never reach the browser. The prerequisite messages
 * say exactly what is missing rather than failing opaquely
 * (Sprint 4 §29).
 */
const ERROR_MESSAGES: Record<RunAuditFailureCode, string> = {
  project_not_found: "This project could not be found.",
  repository_intelligence_missing: "Inspect the repository first — the audit needs that evidence.",
  live_product_intelligence_missing: "Inspect the live product first — the audit needs that evidence.",
  business_context_missing: "Complete your business context first.",
  already_running: "An audit is already running for this project. Give it a moment.",
  audit_input_budget_exceeded: "There is too much evidence to analyze in one audit. This is a bug — please report it.",
  token_count_failed: "The audit could not be prepared. Try again in a moment.",
  provider_rate_limited: "The AI provider is rate limiting requests. Try again in a few minutes.",
  provider_auth_error: "Vibe Business is not correctly configured to reach the AI provider.",
  provider_billing_error: "The AI provider account has no available usage credit or has a billing issue.",
  provider_timeout: "The audit took too long to complete. Try again.",
  provider_unavailable: "The AI provider could not be reached. Try again in a moment.",
  provider_overloaded: "The AI provider is overloaded right now. Try again in a few minutes.",
  provider_refusal: "The AI provider declined to analyze this input. Nothing was saved.",
  // Four distinct stages, four distinct messages. They used to share one
  // line ("the audit result was not usable"), which told neither the user
  // nor us which stage had actually failed. None of them exposes a provider
  // detail; the diagnosable specifics stay server-side.
  provider_request_rejected: "The AI provider rejected the audit request. The integration needs adjustment.",
  structured_output_empty: "The AI provider returned no usable audit output.",
  structured_output_json_invalid: "The AI provider returned an invalid audit format.",
  structured_output_schema_invalid: "The audit response did not pass Vibe's validation.",
  output_truncated: "The audit result was cut short. Nothing was saved.",
  audit_failed: "The business audit could not be completed.",
};

const initialState: RunAuditActionState = null;

export function RunAuditButton({
  projectId,
  hasAudit,
  disabled,
}: {
  projectId: string;
  hasAudit: boolean;
  disabled: boolean;
}) {
  const action = runAuditAction.bind(null, projectId);
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <div className="space-y-3">
      <form action={formAction} className="flex items-center gap-3">
        {/* A re-run costs a fresh inference call, so it is only requested
            when the user deliberately asks to refresh an existing audit. */}
        <input type="hidden" name="force" value={hasAudit ? "true" : "false"} />
        <Button type="submit" disabled={pending || disabled}>
          {pending ? "Analyzing…" : hasAudit ? "Re-run business audit" : "Run business audit"}
        </Button>
      </form>

      {state && !state.ok && <p className="text-sm text-amber-400">{ERROR_MESSAGES[state.error]}</p>}

      {state?.ok && state.reused && (
        <p className="text-sm text-zinc-500">
          Nothing has changed since the last audit, so the existing result is shown.
        </p>
      )}
    </div>
  );
}
