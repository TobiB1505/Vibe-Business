import type { OperationFailureCode } from "./failures";

/**
 * User-facing copy for every typed operation failure (Sprint 7 §21, Sprint 8 §26).
 *
 * One exhaustive record, shared by every operation's UI. `Record<...>` over the
 * closed union is the point: adding a failure code that nobody wrote copy for
 * becomes a type error rather than a blank message in production.
 *
 * Raw provider errors, workflow internals and stack traces never appear here.
 * Each message says what happened and, where it is true, what the user can do.
 */
export const OPERATION_FAILURE_MESSAGES: Record<OperationFailureCode, string> = {
  project_not_found: "This project could not be found.",
  operation_not_found: "That analysis could not be found.",
  repository_intelligence_missing: "Inspect the repository first — this needs that evidence.",
  live_product_intelligence_missing: "Inspect the live product first — this needs that evidence.",
  business_context_missing: "Complete your business context first.",
  already_running: "This is already running for the project. Give it a moment.",
  // The evidence moved under the operation's feet — a Deep Scan finished, or
  // the context was edited. Starting again picks up the new evidence.
  inputs_changed: "Your evidence changed while this was starting. Run it again to use the latest.",
  execution_start_failed: "This could not be queued. Try again in a moment.",
  // Deliberately does not claim the call was free. We do not know.
  inference_interrupted:
    "This was interrupted while the AI was running, so Vibe stopped rather than risk analyzing twice.",

  audit_missing: "Run a business audit first — opportunities are prioritized from it.",
  audit_stale: "Your business audit is older than the evidence Vibe now has. Update it first.",
  stale_audit: "Your business audit is older than the evidence Vibe now has. Update it first.",

  audit_input_budget_exceeded: "There is too much evidence to analyze in one audit. This is a bug — please report it.",
  opportunity_input_budget_exceeded:
    "There is too much evidence to prioritize in one pass. This is a bug — please report it.",
  token_count_failed: "This could not be prepared. Try again in a moment.",
  provider_rate_limited: "The AI provider is rate limiting requests. Try again in a few minutes.",
  provider_auth_error: "Vibe Business is not correctly configured to reach the AI provider.",
  provider_billing_error: "The AI provider account has no available usage credit or has a billing issue.",
  provider_timeout: "This took too long to complete. Try again.",
  provider_unavailable: "The AI provider could not be reached. Try again in a moment.",
  provider_overloaded: "The AI provider is overloaded right now. Try again in a few minutes.",
  provider_refusal: "The AI provider declined to analyze this input. Nothing was saved.",
  provider_request_rejected: "The AI provider rejected the request. The integration needs adjustment.",
  structured_output_empty: "The AI provider returned no usable output.",
  structured_output_json_invalid: "The AI provider returned an invalid format.",
  structured_output_schema_invalid: "The response did not pass Vibe's validation.",
  output_truncated: "The result was cut short. Nothing was saved.",
  audit_failed: "The business audit could not be completed.",
  opportunity_generation_failed: "Vibe could not work out your next opportunities.",

  // Change preparation (Sprint 9B §21). Each says what happened and, where it
  // is true, what the user can do about it.
  stale_opportunity: "This opportunity is no longer current. Refresh your opportunities first.",
  stale_repository_intelligence: "Vibe's view of your code is out of date. Refresh repository intelligence first.",
  repository_changed:
    "Your code changed since Vibe analyzed it. Refresh product intelligence before preparing this change.",
  premise_no_longer_true: "This opportunity is no longer current — your product already has this.",
  unsupported_framework: "Vibe can't prepare this kind of change for your framework yet.",
  unsupported_repository_layout: "Vibe can't safely determine where this change belongs in your repository.",
  missing_required_context: "Vibe needs a verified production URL before it can prepare this change.",
  github_write_permission_required:
    "Vibe needs permission to create an isolated branch before it can prepare this change.",
  conflicting_files_exist: "Those files already exist in your repository, so Vibe left them alone.",
  unsupported_opportunity: "Vibe can't prepare this opportunity automatically yet.",
  execution_not_available: "Preparing changes isn't available for this project yet.",
  branch_conflict: "Vibe could not safely create the change branch.",
  write_verification_failed: "Vibe prepared the change but could not verify it, so nothing was recorded.",
  github_unavailable: "GitHub could not be reached. Try again in a moment.",
  change_preparation_failed: "Vibe could not prepare this change.",
};
