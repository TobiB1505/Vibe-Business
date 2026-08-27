import { createServiceClient } from "@/lib/supabase/service";
import { createGithubMergePort } from "@/modules/merge/github/adapter";
import type { ChangeMerge, MergeFailureCode } from "@/modules/merge/schema";
import { liveConnections } from "@/modules/projects/repository-connection";
import {
  abortMergeStep,
  authorizeMergeStep,
  completeMergeStep,
  verifyMergeStep,
  writeMergeStep,
  type MergeDeps,
  type MergeStepOutcome,
} from "./execution";

/**
 * The durable merge (Sprint 11C §18).
 *
 * ```
 * authorize ─▶ write ─▶ verify ─▶ complete
 *     │          │         │
 *     └──────────┴─────────┴─────▶ abort (blocked / failed)
 * ```
 *
 * The eighth operation type on the Sprint 7 foundation, and the first that
 * writes to a branch somebody's production deploys from. Same shape as the
 * others: thin `"use step"` shims over plain functions, an operation id as the
 * only thing that crosses the durable boundary, and a terminal handler so an
 * operation always reaches a state the UI can explain.
 *
 * ## Retries
 *
 * `writeDefaultRef` is `maxRetries = 0`, for the same reason every billed
 * provider call in this codebase is — except here the thing that must not
 * happen twice is not a charge, it is a write to a customer's default branch.
 * A platform retry cannot distinguish "the request never arrived" from "it
 * arrived, succeeded, and the response was lost", and on a default branch that
 * ambiguity must resolve to *not doing it again* (§19).
 *
 * The step handles its own ambiguity by reading the branch, which is strictly
 * better than a retry: it turns "we do not know" into an observation instead of
 * a second attempt.
 *
 * The two read-only steps around it are safe to retry and are left at the
 * platform default. Nothing they do has an external effect.
 *
 * No model is called. No sandbox is created. No browser is opened. No
 * deployment provider is contacted — not before the merge, not after it.
 */

function deps(): MergeDeps {
  return {
    supabase: createServiceClient(),
    // Built per merge from the persisted repository connection, never from
    // anything a client sent. The installation token lives inside the adapter
    // for the lifetime of a step and never crosses this boundary (§34).
    resolvePort: async (merge: ChangeMerge) => {
      const supabase = createServiceClient();

      const { data } = await liveConnections(
        supabase,
        "id, owner, name, github_installation_id, project_id",
      )
        .eq("id", merge.repositoryConnectionId)
        // Ownership asserted in the query: the service-role client bypasses
        // RLS, so the merge row's own project is what scopes this read
        // (CLAUDE.md rule 53).
        .eq("project_id", merge.projectId)
        .maybeSingle();

      /**
       * **Live**, not merely the row this merge bound to (VB-001 M5).
       *
       * A merge writes to the customer's default branch, and a detached
       * connection is a repository the founder told Vibe to let go — so a
       * detached row must not resolve into a port that can push. The detach
       * gate makes this unreachable in practice by refusing to detach while a
       * merge is in flight; reading `live` here is what makes it fail closed
       * if that gate is ever bypassed, rather than writing anyway.
       *
       * The boundary widens the select string, so the shape is stated here.
       */
      const connection = data as {
        id: string;
        owner: string;
        name: string;
        github_installation_id: string;
        project_id: string;
      } | null;
      if (!connection) return null;

      const { data: installation } = await supabase
        .from("github_installations")
        .select("installation_id")
        .eq("id", connection.github_installation_id)
        .maybeSingle();

      if (!installation) return null;

      return createGithubMergePort({
        installationId: installation.installation_id,
        owner: connection.owner,
        repo: connection.name,
      });
    },
  };
}

async function authorizeMerge(operationId: string) {
  "use step";
  return authorizeMergeStep(deps(), operationId);
}

async function writeDefaultRef(operationId: string) {
  "use step";
  return writeMergeStep(deps(), operationId);
}
// The consequential external write. Never retried by the platform: recovery is
// the step's own read-before-anything logic, not another attempt (§19, §38).
writeDefaultRef.maxRetries = 0;

async function verifyDefaultRef(operationId: string) {
  "use step";
  return verifyMergeStep(deps(), operationId);
}

async function finishMerge(operationId: string) {
  "use step";
  await completeMergeStep(deps(), operationId);
}

async function abortMerge(
  operationId: string,
  failureCode: MergeFailureCode,
  observedHead: string | null,
) {
  "use step";
  await abortMergeStep(deps(), operationId, { failureCode, observedHead });
}

export async function changeMergeWorkflow(operationId: string) {
  "use workflow";

  let failure: { failureCode: MergeFailureCode; observedHead: string | null } | null = null;

  const record = (outcome: MergeStepOutcome) => {
    if (outcome.ok) return false;
    failure = {
      failureCode: outcome.failureCode,
      observedHead: outcome.kind === "failed" ? (outcome.observedHead ?? null) : null,
    };
    return true;
  };

  try {
    if (!record(await authorizeMerge(operationId))) {
      if (!record(await writeDefaultRef(operationId))) {
        record(await verifyDefaultRef(operationId));
      }
    }
  } catch {
    // A step exhausted its retries or threw outside the returned-failure
    // convention. The error value is untyped and may carry provider prose, so
    // it is deliberately not inspected — and the abort step decides `blocked`
    // versus `failed` from the persisted status rather than guessing here.
    failure = { failureCode: "merge_failed", observedHead: null };
  }

  if (failure !== null) {
    const { failureCode, observedHead } = failure;
    await abortMerge(operationId, failureCode, observedHead);
    return;
  }

  await finishMerge(operationId);
}
