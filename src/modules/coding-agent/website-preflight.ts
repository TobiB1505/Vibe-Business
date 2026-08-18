import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getLatestCompletedActionPlan } from "@/modules/action-plans/store";
import { createExecutionSpec } from "@/modules/execution-contract/service";
import { resolveStepExecution, type RepositoryContext } from "@/modules/execution-contract/resolver";
import type { ExecutionResolution } from "@/modules/execution-contract/schema";
import { resolveExecutionValidation } from "@/modules/execution-contract/validation-requirements";
import { createGithubRepositoryReader } from "@/modules/github/repository-reader";
import { GithubDomainError } from "@/modules/github/errors";
import { getLatestSuccessfulSnapshot } from "@/modules/repository-intelligence/store";
import { resolveAgentEconomics, type AgentEconomicPolicy } from "./authorization";
import { CORE4_DOGFOOD_DISCOVERY } from "./budget";
import { runAgentPreflight, type AgentPreflight } from "./preflight";

/**
 * The step preflight the internal dogfood website surface calls
 * (EXECUTION CORE-4 website gate, §7, §8, §9, §14).
 *
 * ## Why this exists, given `dogfood.probe.ts` already does almost this
 *
 * The probe is a read-only dev harness against the service-role client, and it
 * deliberately never probes the live GitHub HEAD (§ header of that file — no
 * installation token in a dev harness). A real founder clicking through the
 * website has exactly that token, through their own project's GitHub App
 * installation, so this function does what the probe cannot: read the live
 * default-branch HEAD and build a genuinely admissible spec.
 *
 * ## What the caller may decide
 *
 * A project id and a step key. That is the whole surface (§7). Everything
 * else — which plan, which repository, which commit, which policy, which
 * budget — is resolved from server state, exactly as `startAgentExecution`
 * itself re-derives everything from a project id and a spec id. This function
 * is what produces that spec id in the first place.
 *
 * ## Called twice on a real run, deliberately
 *
 * Once to render the preview, once more inside the start action before
 * `startAgentExecution` is called (§14: "do not trust the preflight rendered
 * seconds earlier"). Both calls run the identical chain against current state,
 * so the second call is not a re-validation bolted on top of the first — it is
 * the same function, called again, which is what makes source drift between
 * the two automatically visible as a different resolution.
 */

export const DOGFOOD_STEP_REASONS = [
  /** The project is not on the operator-managed allowlist. Checked first (§26, §27). */
  "not_dogfood_eligible",
  /** No completed Action Plan exists for this project yet — a founder action. */
  "no_action_plan",
  /** The step key does not name a step in the project's current plan. */
  "step_not_found",
  /** No repository is connected to this project. */
  "repository_not_connected",
  /** Vibe has never successfully read this repository. */
  "repository_snapshot_missing",
  /** The plan is missing a field a spec cannot be built without. */
  "plan_incomplete",
  /** The step did not resolve to an executable route Vibe controls (see `resolution`). */
  "not_agentic",
  /** Resolved agentic, but the preflight itself refused (see `preflight`). */
  "preflight_refused",
] as const;
export type DogfoodStepReason = (typeof DOGFOOD_STEP_REASONS)[number];

export type DogfoodStepPreview =
  | {
      eligible: true;
      stepTitle: string;
      executionSpecId: string;
      resolution: ExecutionResolution;
      preflight: AgentPreflight;
      economics: AgentEconomicPolicy;
    }
  | {
      eligible: false;
      reason: DogfoodStepReason;
      /** Present only when a step was found and resolved, for a fuller explanation. */
      resolution?: ExecutionResolution;
      preflight?: AgentPreflight;
    };

/**
 * Whether this project may see the dogfood surface at all (§26, §27).
 *
 * Server-derived and checked before anything else is even read — an
 * unauthorized project gets `not_dogfood_eligible` whether or not it has a
 * plan, a snapshot or a repository, so the allowlist is the actual gate rather
 * than a label on a response nothing else respects.
 */
export function isDogfoodEligibleProject(
  projectId: string,
  env: Record<string, string | undefined> = process.env,
): boolean {
  return resolveAgentEconomics({ projectId, env })?.nonProduction === true;
}

async function loadOwnedRepositoryConnection(
  supabase: SupabaseClient,
  params: { projectId: string; userId: string },
): Promise<{ id: string; owner: string; name: string; fullName: string; defaultBranch: string; installationId: number } | null> {
  const { data: connection } = await supabase
    .from("repository_connections")
    .select("id, owner, name, full_name, default_branch, github_installation_id")
    .eq("project_id", params.projectId)
    .maybeSingle();

  if (!connection) return null;

  const row = connection as {
    id: string;
    owner: string;
    name: string;
    full_name: string;
    default_branch: string;
    github_installation_id: string;
  };

  const { data: installation } = await supabase
    .from("github_installations")
    .select("installation_id")
    .eq("id", row.github_installation_id)
    .eq("user_id", params.userId)
    .maybeSingle();

  if (!installation) return null;

  return {
    id: row.id,
    owner: row.owner,
    name: row.name,
    fullName: row.full_name,
    defaultBranch: row.default_branch,
    installationId: (installation as { installation_id: number }).installation_id,
  };
}

export async function previewDogfoodStep(
  supabase: SupabaseClient,
  params: {
    projectId: string;
    userId: string;
    stepKey: string;
    env?: Record<string, string | undefined>;
  },
): Promise<DogfoodStepPreview> {
  // §26, §27: the gate, before anything else is even read.
  if (!isDogfoodEligibleProject(params.projectId, params.env)) {
    return { eligible: false, reason: "not_dogfood_eligible" };
  }

  const plan = await getLatestCompletedActionPlan(supabase, params.projectId);
  if (!plan) return { eligible: false, reason: "no_action_plan" };

  const step = plan.steps.find((candidate) => candidate.id === params.stepKey);
  if (!step) return { eligible: false, reason: "step_not_found" };

  const connection = await loadOwnedRepositoryConnection(supabase, {
    projectId: params.projectId,
    userId: params.userId,
  });
  if (!connection) return { eligible: false, reason: "repository_not_connected" };

  const snapshot = await getLatestSuccessfulSnapshot(supabase, params.projectId);
  if (!snapshot?.result) return { eligible: false, reason: "repository_snapshot_missing" };

  // Live state, read now, for this session's own installation (§7, §16 of Core-3).
  // A failed read is not a crash — it is an unread HEAD, which the resolver
  // already treats as unknown rather than unchanged.
  let liveHead: RepositoryContext["liveHead"] = null;
  try {
    const reader = createGithubRepositoryReader(connection.installationId, connection.owner, connection.name);
    liveHead = await reader.getHead();
  } catch (error) {
    if (!(error instanceof GithubDomainError)) throw error;
  }

  const repository: RepositoryContext = {
    connection: {
      id: connection.id,
      fullName: connection.fullName,
      defaultBranch: connection.defaultBranch,
    },
    snapshot: snapshot.result,
    snapshotId: snapshot.id,
    snapshotCommitSha: snapshot.result.source.commitSha,
    snapshotIsLatest: true,
    liveHead,
  };

  const economics = resolveAgentEconomics({ projectId: params.projectId, env: params.env });

  const resolution = resolveStepExecution({
    step,
    plan: {
      steps: plan.steps,
      // Nothing in the product completes a step yet (Core-3 §sequence.ts).
      completedSteps: new Set<number>(),
      isCurrent: true,
    },
    repository,
    agenticBudgetAuthorized: economics !== null,
  });

  if (resolution.mode !== "agentic") {
    return { eligible: false, reason: "not_agentic", resolution };
  }

  // A spec needs the plan's own lineage. Asserted rather than defaulted — a
  // spec built from a placeholder would tell the agent to work toward an
  // empty string (dogfood.probe.ts states the same rule).
  if (!plan.goal || !plan.expectedOutcome || !plan.opportunityId || !plan.businessAuditId) {
    return { eligible: false, reason: "plan_incomplete", resolution };
  }

  const validation = resolveExecutionValidation(snapshot.result);
  const budget = economics?.budget ?? null;

  const writeScope = {
    discovery: { ...CORE4_DOGFOOD_DISCOVERY },
    mutation: {
      maxChangedFiles: budget?.maxChangedFiles ?? 0,
      maxChangedBytes: budget?.maxChangedBytes ?? 0,
      forbiddenPathClasses: [],
    },
  };

  const created = await createExecutionSpec(supabase, {
    resolution,
    step,
    plan: {
      id: plan.id,
      goal: plan.goal,
      expectedOutcome: plan.expectedOutcome,
      assumptions: plan.assumptions,
      opportunityId: plan.opportunityId,
      businessAuditId: plan.businessAuditId,
    },
    projectId: params.projectId,
    repository: {
      repositoryConnectionId: connection.id,
      fullName: connection.fullName,
      defaultBranch: connection.defaultBranch,
      baseSha: snapshot.result.source.commitSha,
      repositorySnapshotId: snapshot.id,
      frameworks: snapshot.result.frameworks.map((framework) => framework.id),
      packageManager: snapshot.result.packageManager ?? "unknown",
    },
    approvedDecisions: [],
    validation,
    budget,
    credit: { quoteId: null, maxAuthorizedCredits: budget?.maxCredits ?? null },
    writeScope,
    createdAt: new Date().toISOString(),
    userId: params.userId,
    repositoryConnectionId: connection.id,
  });

  if (!created.ok) return { eligible: false, reason: "not_agentic", resolution };

  const preflight = runAgentPreflight({
    resolution,
    spec: created.stored.spec,
    economics,
  });

  if (!preflight.passed || !economics) {
    return { eligible: false, reason: "preflight_refused", resolution, preflight };
  }

  return {
    eligible: true,
    stepTitle: step.title,
    executionSpecId: created.stored.id,
    resolution,
    preflight,
    economics,
  };
}
