import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import {
  AGENT_RUN_COLUMNS,
  AI_USAGE_COLUMNS,
  DEEP_SCAN_USAGE_COLUMNS,
  ONBOARDING_COLUMNS,
  OPERATION_RUN_COLUMNS,
  SANDBOX_USAGE_COLUMNS,
  selection,
} from "./columns";
import { FEED_LIMIT, SAMPLE_LIMIT } from "./schema";
import type { AgentRunRow, OnboardingRow, OperationRunRow, UsageRow } from "./shape";

/**
 * The console's reads. **This is the reviewed rule 53 exception** ([ADR 0088](../../../docs/decisions/0088-the-internal-operator-console.md) §2).
 *
 * ## Why there is no ownership filter, and why that is not the hole it looks like
 *
 * Rule 53 requires that a service-role query filter on ownership taken from a
 * persisted row or verified claims — never from a caller's arguments. The
 * console is cross-tenant by construction, so it cannot satisfy the letter of
 * that. It satisfies the *purpose*, which is what the rule is protecting:
 *
 * > **No function in this file accepts a project id, a user id, or any other
 * > selector from its caller.** There is nothing to forge, because there is no
 * > parameter to forge it in. The only inputs are a time window and a bound.
 *
 * What replaces the ownership filter is a gate that runs before any of this:
 * `service.ts` refuses unless the verified session's user id is named in
 * `VIBE_INTERNAL_OPERATOR_USER_IDS`, and it re-checks on every request rather
 * than trusting the render that produced the page.
 *
 * ## Why every query names its columns
 *
 * See `columns.ts`. Briefly: `select("*")` inherits whatever column is added
 * next, and this surface has no tenant boundary to catch it afterwards.
 *
 * Every query is also bounded and ordered, so a busy system returns a bounded
 * page rather than the whole ledger.
 */

/** Rows for the feed, the in-flight view and the outcome counts. */
export async function readOperationRuns(
  client: SupabaseClient,
  since: string,
): Promise<readonly OperationRunRow[]> {
  const { data, error } = await client
    .from("operation_runs")
    .select(selection(OPERATION_RUN_COLUMNS))
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(SAMPLE_LIMIT);

  if (error) throw new Error(`internal-console: operation_runs read failed (${error.code})`);
  return (data ?? []) as unknown as readonly OperationRunRow[];
}

/**
 * Operations that have not finished, whatever window is being viewed.
 *
 * A separate query rather than a filter over the window's rows: an operation
 * queued eight days ago and still running is exactly the one an operator needs
 * to see, and a window would hide it.
 */
export async function readUnfinishedOperations(
  client: SupabaseClient,
): Promise<readonly OperationRunRow[]> {
  const { data, error } = await client
    .from("operation_runs")
    .select(selection(OPERATION_RUN_COLUMNS))
    .in("status", ["queued", "running", "needs_user"])
    .order("created_at", { ascending: true })
    .limit(FEED_LIMIT);

  if (error) throw new Error(`internal-console: in-flight read failed (${error.code})`);
  return (data ?? []) as unknown as readonly OperationRunRow[];
}

async function readUsage(
  client: SupabaseClient,
  table: "ai_usage_events" | "sandbox_usage_events" | "deep_scan_provider_usage",
  columns: readonly string[],
  since: string,
): Promise<readonly UsageRow[]> {
  const { data, error } = await client
    .from(table)
    .select(selection(columns))
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(SAMPLE_LIMIT);

  if (error) throw new Error(`internal-console: ${table} read failed (${error.code})`);
  return (data ?? []) as unknown as readonly UsageRow[];
}

export function readInferenceUsage(client: SupabaseClient, since: string) {
  return readUsage(client, "ai_usage_events", AI_USAGE_COLUMNS, since);
}

export function readSandboxUsage(client: SupabaseClient, since: string) {
  return readUsage(client, "sandbox_usage_events", SANDBOX_USAGE_COLUMNS, since);
}

export function readBrowserUsage(client: SupabaseClient, since: string) {
  return readUsage(client, "deep_scan_provider_usage", DEEP_SCAN_USAGE_COLUMNS, since);
}

/** Where projects currently stand. Not windowed: the funnel is a standing view. */
export async function readOnboarding(client: SupabaseClient): Promise<readonly OnboardingRow[]> {
  const { data, error } = await client
    .from("project_onboarding")
    .select(selection(ONBOARDING_COLUMNS))
    .order("created_at", { ascending: false })
    .limit(SAMPLE_LIMIT);

  if (error) throw new Error(`internal-console: project_onboarding read failed (${error.code})`);
  return (data ?? []) as unknown as readonly OnboardingRow[];
}

export async function readAgentRuns(
  client: SupabaseClient,
  since: string,
): Promise<readonly AgentRunRow[]> {
  const { data, error } = await client
    .from("agent_execution_runs")
    .select(selection(AGENT_RUN_COLUMNS))
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(SAMPLE_LIMIT);

  if (error) throw new Error(`internal-console: agent_execution_runs read failed (${error.code})`);
  return (data ?? []) as unknown as readonly AgentRunRow[];
}

/**
 * The client this module reads with.
 *
 * Wrapped rather than imported at each call site so the boundary test has one
 * place to look, and so a test can pass a double without a network.
 */
export function consoleClient(): SupabaseClient {
  return createServiceClient();
}
