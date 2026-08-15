import { MERGE_FAILURE_MESSAGES } from "@/modules/merge/messages";
import { OUTCOME_FAILURE_MESSAGES } from "@/modules/outcome-verification/messages";
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

  // Isolated validation (Sprint 10A). "Not supported" is a statement about
  // Vibe's coverage, never about the customer's repository being wrong — the
  // copy says so, because a tool telling you your project is unsupported
  // should not also imply it is bad.
  validation_not_supported: "Vibe cannot validate this project yet. Validation currently supports single-app Next.js repositories using npm or pnpm.",
  prepared_change_not_ready: "This change is not ready to validate.",
  ambiguous_workspace: "Vibe could not tell which app to validate. Workspaces and monorepos are not supported yet.",
  lockfile_missing: "No lockfile was found, so dependencies cannot be installed exactly as committed.",
  repository_connection_invalid: "Vibe could not reach this repository. Check the GitHub connection.",
  source_integrity_failed: "The code in the isolated environment did not match the prepared change, so nothing was run.",
  sandbox_unavailable: "The isolated environment could not be started. Nothing was run.",
  sandbox_timeout: "Validation ran out of time and was stopped.",
  // Says what was lost, not just that something was. "The environment
  // disappeared" invites the reasonable question "so start another one?" — and
  // the answer is that the installed dependencies went with it, so a fresh
  // machine would be answering a different question.
  sandbox_lost:
    "The isolated environment stopped being available part-way through, taking its installed dependencies with it. Vibe stopped rather than finishing on a different machine. Validating again starts a fresh environment.",
  credential_scrub_failed: "Vibe could not confirm the environment was safe to run code in, so it stopped.",
  validation_checks_failed: "Validation failed. See which step failed below.",
  build_failed_missing_environment: "The build needs environment variables that Vibe does not have. Validation cannot supply them yet.",
  validation_run_failed: "Validation could not be completed.",

  // Temporary preview (Sprint 10B-2 §26). Every one of these says what happened
  // and, where it is true, what the user can do about it. None of them implies
  // a preview means the change is approved, correct or safe.
  validation_required: "Validate this change first — a preview runs the exact validated build.",
  preview_not_supported: "Vibe cannot preview this project yet. Previews currently support single-app Next.js repositories.",
  // The confirmation is a server-side requirement, not a UI courtesy, so this
  // is reachable and has to read as a sentence rather than an internal state.
  preview_exposure_not_confirmed: "A preview publishes an unlisted public URL, so Vibe needs you to confirm before starting one.",
  // Says why it is gone, because "unavailable" alone reads like a fault.
  preview_artifact_unavailable:
    "The validated build Vibe kept for this change is no longer available. Validate again to create a fresh one.",
  preview_artifact_expired:
    "The validated build Vibe kept for this change expired. Validate again to create a fresh one.",
  preview_artifact_integrity_failed:
    "The restored build did not match the validated change, so Vibe did not start it.",
  // A Vibe-side defect, and the copy does not pretend otherwise.
  preview_privileged_environment:
    "Vibe stopped the preview because its environment was not clean. This is a bug — please report it.",
  preview_missing_environment:
    "The application needs environment variables that Vibe does not have. Previews cannot supply them yet.",
  preview_start_failed: "The preview server could not be started.",
  preview_process_exited: "The application started and then stopped. See the output below.",
  preview_health_check_failed: "The preview started but never answered, so Vibe stopped it.",
  preview_provider_unavailable: "The preview environment could not be reached. Try again in a moment.",
  preview_cleanup_failed: "Vibe could not confirm the preview environment was fully cleaned up.",
  preview_failed: "The preview could not be started.",

  // Visual review (Sprint 11A §31). Each says what happened and, where it is
  // true, what the user can do. None implies the comparison is a judgement.
  review_preview_required:
    "Start a temporary preview first — a comparison photographs the running preview.",
  review_before_unavailable:
    "Vibe needs a verified production URL before it can capture a \"before\" image.",
  review_not_supported: "This change cannot be compared visually yet.",
  review_auth_required_not_supported:
    "This page needs a sign-in. Vibe only compares public pages for now, and it will not move your login between environments.",
  review_browser_unavailable: "The browser environment could not be reached. Try again in a moment.",
  review_before_capture_failed: "Vibe could not capture your current live page.",
  review_after_capture_failed: "Vibe could not capture the preview page.",
  review_storage_failed: "The comparison images could not be saved.",
  review_expired: "This comparison has expired and its images were removed.",
  review_failed: "The comparison could not be created.",

  // Safe merge (Sprint 11C §28). Spread rather than restated: the merge module
  // owns the wording of its own refusals, and two copies of "the default branch
  // changed" is two chances for one of them to grow a sentence the other does
  // not have — on the one screen where the wrong sentence is about a write to
  // somebody's repository.
  ...MERGE_FAILURE_MESSAGES,

  // Production outcome verification (Sprint 12A §22, §23). Spread for the same
  // reason as the merge's: the module owns the wording of its own refusals, and
  // two copies of "Vibe could not reach your public product" is two chances for
  // one of them to grow into a claim about the customer's product being broken.
  ...OUTCOME_FAILURE_MESSAGES,
};
