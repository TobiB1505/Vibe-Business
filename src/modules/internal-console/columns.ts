/**
 * What the operator console is allowed to read, column by column ([ADR 0088](../../../docs/decisions/0088-the-internal-operator-console.md) §4).
 *
 * ## Why this file exists rather than a `select("*")`
 *
 * The tables this console reads are safe *today*, and they are safe because
 * somebody kept them that way: `ai_usage_events` holds no prompt text because
 * rule 47 forbade it, and `operation_runs` holds no prose at all. Neither is a
 * guarantee about the next column somebody adds.
 *
 * `select("*")` would inherit whatever arrives. Naming the columns means a new
 * column is invisible here until a person adds it — which is the intended cost,
 * and the reason a leak through this surface has to be written rather than
 * merely forgotten.
 *
 * ## The columns deliberately absent, and what each would have leaked
 *
 * - `agent_tool_events.command` and `.path` — a customer's repository paths and
 *   the commands run inside their tree (rules 25, 26).
 * - `operation_runs.input_identity`, `.result_id`, `.subject_id` — content
 *   addresses. Not content, but they identify one customer's exact evidence
 *   and buy the console nothing.
 * - Every `*_snapshot` and evidence table. The console answers what happened,
 *   what broke and what it cost; none of those questions needs what was seen.
 * - Email addresses anywhere. `auth.users` is never joined.
 *
 * A test asserts that no query in this module names a column outside these
 * lists, and that `select("*")` appears nowhere in it.
 */

/** `operation_runs` — the feed, the in-flight view and the failure counts. */
export const OPERATION_RUN_COLUMNS = [
  "id",
  "project_id",
  "user_id",
  "operation_type",
  "status",
  "stage",
  "failure_code",
  "created_at",
  "started_at",
  "completed_at",
  "execution_provider",
] as const;

/** `ai_usage_events` — inference spend. Tokens and cost, never text. */
export const AI_USAGE_COLUMNS = [
  "id",
  "created_at",
  "operation",
  "model",
  "provider",
  "status",
  "failure_code",
  "input_tokens",
  "output_tokens",
  "provider_cost_usd",
  "latency_ms",
] as const;

/**
 * `sandbox_usage_events` — sandbox spend.
 *
 * Both cost columns, because they are different kinds of claim.
 * `provider_cost_usd` is null in every row ever written — Vercel reports no
 * per-sandbox figure — and `estimated_cost_nano_usd` is Vibe's own derivation
 * from quantities the provider did report, under its own pricing version.
 * `economy/sandbox-usage-estimate.ts` keeps them apart so an assumption is
 * never summed as a measurement; the console has to keep them apart too.
 */
export const SANDBOX_USAGE_COLUMNS = [
  "id",
  "created_at",
  "operation",
  "provider",
  "status",
  "failure_code",
  "sandbox_duration_ms",
  "provider_cost_usd",
  "estimated_cost_nano_usd",
] as const;

/** `deep_scan_provider_usage` — browser spend. Same two columns, same reason. */
export const DEEP_SCAN_USAGE_COLUMNS = [
  "id",
  "created_at",
  "operation",
  "provider",
  "status",
  "duration_ms",
  "provider_cost_usd",
  "estimated_cost_nano_usd",
] as const;

/**
 * `agent_tool_events` — what the agent asked for and what the gateway decided.
 *
 * `command` and `path` are the two columns this table has that carry a
 * customer's repository, and they are the two this list does not name.
 */
export const AGENT_TOOL_COLUMNS = [
  "id",
  "created_at",
  "tool",
  "decision",
  "denial_reason",
  "duration_ms",
  "success",
] as const;

/** `project_onboarding` — where projects stop, as states rather than names. */
export const ONBOARDING_COLUMNS = ["project_id", "state", "created_at", "completed_at"] as const;

/** Every column this module may name, for the test that enforces the list. */
export const ALL_CONSOLE_COLUMNS: readonly string[] = [
  ...OPERATION_RUN_COLUMNS,
  ...AI_USAGE_COLUMNS,
  ...SANDBOX_USAGE_COLUMNS,
  ...DEEP_SCAN_USAGE_COLUMNS,
  ...AGENT_TOOL_COLUMNS,
  ...ONBOARDING_COLUMNS,
];

/**
 * Column names that must never appear in a query in this module.
 *
 * Not the complement of the lists above — that would be every column in the
 * database. These are the specific ones a well-meaning change would reach for
 * first, named so the test fails with a reason rather than a diff.
 */
export const FORBIDDEN_COLUMNS: readonly string[] = [
  "command",
  "path",
  "email",
  "prompt",
  "response",
  "reasoning",
  "content",
  "body",
  "html",
  "url",
  "evidence",
  "input_identity",
];

/** Turns a column list into the string PostgREST wants. */
export function selection(columns: readonly string[]): string {
  return columns.join(", ");
}
