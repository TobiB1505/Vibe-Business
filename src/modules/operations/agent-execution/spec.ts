import "server-only";

import { createServiceClient } from "@/lib/supabase/service";
import { recordExecutionSpec } from "@/modules/execution-contract/service";
import type { ExecutionSpec } from "@/modules/execution-contract/spec";

/**
 * Persisting an ExecutionSpec (Rule 53, and the `execution_specs` migration's
 * own stated contract).
 *
 * ## Why this is here rather than beside the preflight that builds the spec
 *
 * Because `execution_specs` has a select policy and **no insert policy at all**,
 * on purpose. The migration says why:
 *
 * > a client cannot forge a mode, a base SHA, a tool policy or a Credit
 * > ceiling; a client cannot raise its own Credit ceiling; a client cannot turn
 * > a blocked step into a ready one.
 *
 * RLS cannot tell a Server Action apart from a browser holding the public anon
 * key, so an owner insert policy would hand exactly those four forgeries to
 * anyone with a console open. The only sanctioned way to write server-owned
 * state is the service-role client, and Rule 53 confines that to
 * `src/modules/operations/`. So the write lives here, and the module that
 * *builds* the spec stays a pure read path.
 *
 * The same migration comment already specified this design — "specs are created
 * by the server-only service using the service-role client … with ownership
 * taken from the persisted project row rather than from a caller". The website
 * gate shipped pointing at the caller's own client instead, so every insert was
 * silently refused and the surface reported the step as not eligible while
 * simultaneously saying Vibe could build it. Nothing caught it because the
 * in-memory test double has no RLS: the write "succeeded" in every test and had
 * never once succeeded in production.
 *
 * ## The ownership check is the whole safety argument
 *
 * A service-role client bypasses RLS, so the check RLS would have made has to
 * be made here, explicitly, against the **persisted project row** — never
 * against anything the caller passed alongside it. A spec for a project the
 * session does not own is refused before a row exists.
 */

export type PersistExecutionSpecResult =
  | { ok: true; executionSpecId: string; alreadyExisted: boolean }
  | { ok: false; error: "project_not_found" | "spec_not_persisted" };

export async function persistAgentExecutionSpec(params: {
  spec: ExecutionSpec;
  userId: string;
  repositoryConnectionId: string;
  creditQuoteId?: string | null;
}): Promise<PersistExecutionSpecResult> {
  const supabase = createServiceClient();

  // Ownership is the query, and it runs against the stored row. Another user's
  // project is invisible rather than forbidden, exactly as `startAgentExecution`
  // establishes it one step later.
  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", params.spec.projectId)
    .eq("user_id", params.userId)
    .maybeSingle();

  if (!project) return { ok: false, error: "project_not_found" };

  const created = await recordExecutionSpec(supabase, {
    spec: params.spec,
    userId: params.userId,
    repositoryConnectionId: params.repositoryConnectionId,
    creditQuoteId: params.creditQuoteId ?? null,
  });

  if (!created.ok) {
    // Loud, because the silent version of this is what shipped: a swallowed
    // insert failure became "this step isn't the kind of change Vibe can
    // attempt", and no log line existed to contradict it.
    console.error("[agent-execution.spec] could not persist an ExecutionSpec", {
      projectId: params.spec.projectId,
      specIdentity: params.spec.identity,
      reason: created.error,
    });
    return { ok: false, error: "spec_not_persisted" };
  }

  return {
    ok: true,
    executionSpecId: created.stored.id,
    alreadyExisted: created.alreadyExisted,
  };
}
