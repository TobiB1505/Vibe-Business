import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getLatestCompletedActionPlan } from "@/modules/action-plans/store";
import type { ActionPlanStep } from "@/modules/action-plans/schema";
import { benchmarkStep, fixtureForStepKey } from "./dogfood/fixtures";
import { buildExecutionSpec, type ExecutionSpec } from "@/modules/execution-contract/spec";
import {
  resolvePlanExecution,
  resolveStepExecution,
  type LiveEvidenceContext,
  type RepositoryContext,
} from "@/modules/execution-contract/resolver";
import {
  citedLiveEvidenceIds,
  evaluateLivePremise,
} from "@/modules/execution-contract/live-premise";
import { inspectLiveProduct } from "@/modules/live-product-intelligence/service";
import { getLatestSuccessfulLiveSnapshot } from "@/modules/live-product-intelligence/store";
import type { ExecutionResolution } from "@/modules/execution-contract/schema";
import { resolveExecutionValidation } from "@/modules/execution-contract/validation-requirements";
import { createGithubRepositoryReader } from "@/modules/github/repository-reader";
import { GithubDomainError } from "@/modules/github/errors";
import { getLatestSuccessfulSnapshot } from "@/modules/repository-intelligence/store";
import { resolveAgentEconomics, type AgentEconomicPolicy } from "./authorization";
import { CORE4_DOGFOOD_DISCOVERY } from "./budget";
import { runAgentPreflight, type AgentPreflight } from "./preflight";
import { completedStepsFromFounderResolutions } from "@/modules/founder-input/completion";
import { listActiveFounderResolutions } from "@/modules/founder-input/store";

import { liveConnections } from "@/modules/projects/repository-connection";
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
      /**
       * The instruction package, **built and not yet persisted**.
       *
       * A preview renders it; only a start writes it. Handing back a row id
       * from a read path was what hid the fact that the row was never being
       * created — see `operations/agent-execution/spec.ts`.
       */
      spec: ExecutionSpec;
      /** Needed by the writer, and not derivable from the spec document. */
      repositoryConnectionId: string;
      resolution: ExecutionResolution;
      preflight: AgentPreflight;
      economics: AgentEconomicPolicy;
      /**
       * Whether the repository's live HEAD was read and matched.
       *
       * False only for a compilation preflight that deliberately resolved
       * against the analysed commit. A run must never be started from one: it
       * says nothing about whether the default branch has moved.
       */
      revisionVerified: boolean;
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
  const { data: connection } = await liveConnections(supabase, "id, owner, name, full_name, default_branch, github_installation_id")
    .eq("project_id", params.projectId)
    .maybeSingle();

  if (!connection) return null;

  const row = connection as unknown as {
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

/**
 * Every step of the project's current plan, routed against **real** repository
 * state.
 *
 * ## Why this exists rather than the index page resolving inline
 *
 * Because the index page did resolve inline, and it passed a repository
 * context of all nulls — no connection, no snapshot — with a comment saying the
 * list "only needs the route each step would take". A route is not independent
 * of the repository. `classifyIntrinsic` needs a connection and a snapshot to
 * reach `agentic` at all, so resolving against nulls does not show the route
 * ignoring live state: it shows the route for a project that has no repository,
 * which is `unsupported` for every product change, always.
 *
 * The visible consequence was that no step could *ever* be offered. Every
 * implementation step read "waiting on an earlier step", the "Review this step"
 * link was unreachable by construction, and the whole dogfood surface was a
 * list of refusals for a project whose repository was connected, snapshotted
 * and supported.
 *
 * ## What it deliberately does not read
 *
 * The live GitHub HEAD. That is one network call per page load to answer a
 * question this page does not ask — admission, not classification — and
 * `previewDogfoodStep` probes it for real on the step a founder actually
 * opens. An unread HEAD is modelled honestly as `null`, which refuses
 * admission; the index renders `mode` and `reason`, neither of which it
 * touches.
 */
export type DogfoodPlanRoutes =
  | { available: false; reason: Extract<DogfoodStepReason, "not_dogfood_eligible" | "no_action_plan"> }
  | {
      available: true;
      plan: NonNullable<Awaited<ReturnType<typeof getLatestCompletedActionPlan>>>;
      resolutions: readonly ExecutionResolution[];
      /** The server-resolved Credit ceiling behind any offered Agent route. */
      economics: AgentEconomicPolicy | null;
    };

export async function resolveDogfoodPlanRoutes(
  supabase: SupabaseClient,
  params: { projectId: string; userId: string; env?: Record<string, string | undefined> },
): Promise<DogfoodPlanRoutes> {
  // The allowlist gate first, before anything is read (§26, §27).
  if (!isDogfoodEligibleProject(params.projectId, params.env)) {
    return { available: false, reason: "not_dogfood_eligible" };
  }

  const plan = await getLatestCompletedActionPlan(supabase, params.projectId);
  if (!plan) return { available: false, reason: "no_action_plan" };

  // All three may legitimately be absent, and the resolver says so per step
  // with its own reasons. What it must not do is invent repository state or
  // treat a founder-owned prerequisite as completed without its resolution.
  const [connection, snapshot, founderResolutions] = await Promise.all([
    loadOwnedRepositoryConnection(supabase, {
      projectId: params.projectId,
      userId: params.userId,
    }),
    getLatestSuccessfulSnapshot(supabase, params.projectId),
    listActiveFounderResolutions(supabase, params.projectId),
  ]);
  const completedSteps = completedStepsFromFounderResolutions(plan.steps, founderResolutions);

  const repository: RepositoryContext = {
    connection: connection
      ? { id: connection.id, fullName: connection.fullName, defaultBranch: connection.defaultBranch }
      : null,
    snapshot: snapshot?.result ?? null,
    snapshotId: snapshot?.id ?? null,
    snapshotCommitSha: snapshot?.result?.source.commitSha ?? null,
    // It is the newest successful one by construction — that is what the store
    // function returns.
    snapshotIsLatest: Boolean(snapshot?.result),
    liveHead: null,
  };

  const economics = resolveAgentEconomics({ projectId: params.projectId, env: params.env });

  return {
    available: true,
    plan,
    economics,
    resolutions: resolvePlanExecution({
      plan: { steps: plan.steps, completedSteps, isCurrent: true },
      repository,
      agenticBudgetAuthorized: economics !== null,
    }),
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

  /*
   * An internal benchmark step is resolved from Vibe's own fixture registry
   * (Sprint 0045).
   *
   * Recognised by its namespaced key, which a Planner step id can never carry.
   * This is what lets a controlled benchmark be started through the *existing*
   * Run button — the same allowlist gate, the same ownership re-resolution, the
   * same idempotent `startAgentExecution` — instead of through a second start
   * path that would have to be audited again.
   */
  const fixture = fixtureForStepKey(params.stepKey);
  if (fixture) {
    const snapshot = await getLatestSuccessfulSnapshot(supabase, params.projectId);
    if (!snapshot?.result) return { eligible: false, reason: "repository_snapshot_missing" };

    const step = benchmarkStep(fixture, snapshot.result);
    return resolveExecutableStep(supabase, {
      projectId: params.projectId,
      userId: params.userId,
      env: params.env,
      step,
      planSteps: [step],
      lineage: {
        id: plan.id,
        goal: fixture.goal,
        expectedOutcome: fixture.expectedChangedState,
        assumptions: [],
        opportunityId: plan.opportunityId,
        businessAuditId: plan.businessAuditId,
      },
      planGeneratedAt: plan.createdAt,
    });
  }

  const step = plan.steps.find((candidate) => candidate.id === params.stepKey);
  if (!step) return { eligible: false, reason: "step_not_found" };

  return resolveExecutableStep(supabase, {
    projectId: params.projectId,
    userId: params.userId,
    env: params.env,
    step,
    /*
     * Every step of the plan, because the resolver decides what to absorb.
     *
     * A caller that handed it only the step being run would be answering the
     * resolver's question for it — which preparation steps this execution
     * boundary carries — and `buildExecutionSpec` refuses when the two disagree.
     */
    planSteps: plan.steps,
    lineage: {
      id: plan.id,
      goal: plan.goal,
      expectedOutcome: plan.expectedOutcome,
      assumptions: plan.assumptions,
      opportunityId: plan.opportunityId,
      businessAuditId: plan.businessAuditId,
    },
    planGeneratedAt: plan.createdAt,
  });
}

/**
 * Everything between a resolved `(step, lineage)` pair and an admissible spec.
 *
 * ## Why this is a seam
 *
 * Because it is the exact span the internal benchmark harness replaces, and
 * nothing else. `previewDogfoodStep` reaches it by reading the project's real
 * Action Plan; `coding-agent/dogfood/benchmark.ts` reaches it with a
 * Vibe-authored fixture step. From here down the two are the same code —
 * the same live HEAD read, the same resolver, the same risk classification, the
 * same validation profile, the same write scope, the same preflight — which is
 * what makes a benchmark representative of a real execution rather than a
 * parallel implementation that resembles one.
 *
 * The lineage fields are supplied rather than looked up because a benchmark's
 * business lineage is the project's own: it runs against the same audit and the
 * same opportunity set a customer execution would, and only the *step* is
 * authored by Vibe.
 */
export type ExecutableStepLineage = {
  id: string;
  goal: string | null;
  expectedOutcome: string | null;
  assumptions: readonly string[];
  opportunityId: string | null;
  businessAuditId: string | null;
};

/**
 * Establishes whether the live defects a step cites are still real (Rule 55).
 *
 * The I/O half of the live-premise check; `execution-contract/live-premise.ts`
 * holds the pure decision and `resolver.ts` does the refusing. Split that way
 * for the same reason `liveHead` is: the resolver is a pure function, and a
 * crawl is not.
 *
 * ## When it re-scans, and why not always
 *
 * A snapshot taken *after* the plan was generated already reflects a site the
 * plan could not have been written against, so it answers the question without
 * spending anything. Only a snapshot older than the plan is uninformative —
 * the site may have changed in exactly the window that matters — and only then
 * is a fresh crawl worth the seconds it costs a user waiting on a click.
 *
 * ## Why re-crawling is allowed at all
 *
 * Rule 60 forbids triggering a *paid* refresh on the user's behalf. This is not
 * one: `live-product-intelligence` imports no `AIProvider` and touches no
 * billable provider — it is bounded static HTTP through the safe-fetch boundary
 * (Rules 35, 39). The rule's target is re-running the Business Audit, which
 * does synthesize with a model. Observing costs nothing; concluding costs money.
 *
 * A refusal is always safe here and a false pass never is, so every failure —
 * no production URL, a crawl error, another inspection already running —
 * resolves to `unverified` rather than to an assumption.
 */
async function establishLivePremise(
  supabase: SupabaseClient,
  params: {
    projectId: string;
    userId: string;
    evidenceIds: readonly string[];
    /** When the plan was generated, or null where a caller cannot say. */
    planGeneratedAt: string | null;
  },
): Promise<LiveEvidenceContext> {
  // Nothing cited, nothing to establish — and no crawl for a step that would
  // not be judged by one either way.
  if (citedLiveEvidenceIds(params.evidenceIds).length === 0) {
    return { status: "not_applicable" };
  }

  const latest = await getLatestSuccessfulLiveSnapshot(supabase, params.projectId);

  const observedAfterPlan =
    latest?.completedAt != null &&
    params.planGeneratedAt != null &&
    Date.parse(latest.completedAt) > Date.parse(params.planGeneratedAt);

  if (latest?.result && observedAfterPlan) {
    return evaluateLivePremise({
      evidenceIds: params.evidenceIds,
      snapshot: latest.result,
      completeness: latest.completeness === "complete" ? "complete" : "partial",
    });
  }

  const inspected = await inspectLiveProduct(
    supabase,
    { projectId: params.projectId, userId: params.userId },
    // The stored snapshot is older than the plan, so reuse would answer with
    // the very observation whose age is the problem.
    { force: true },
  );

  if (!inspected.ok) {
    return {
      status: "unverified",
      reason: `the live site could not be re-checked (${inspected.error})`,
    };
  }

  return evaluateLivePremise({
    evidenceIds: params.evidenceIds,
    snapshot: inspected.snapshot.result,
    completeness: inspected.snapshot.completeness === "complete" ? "complete" : "partial",
  });
}

export async function resolveExecutableStep(
  supabase: SupabaseClient,
  params: {
    projectId: string;
    userId: string;
    env?: Record<string, string | undefined>;
    step: ActionPlanStep;
    planSteps: readonly ActionPlanStep[];
    lineage: ExecutableStepLineage;
    /**
     * When the plan was generated, so the live premise can tell an observation
     * that postdates the plan from one that cannot speak to it. Null where a
     * caller genuinely cannot say, which forces a fresh crawl rather than an
     * assumption.
     */
    planGeneratedAt: string | null;
    /**
     * Resolve against the **analysed** commit instead of the live one.
     *
     * A compilation preflight only, and never a route to a run. Admission
     * requires the default branch to be read *now* and to still point at the
     * commit the snapshot describes (Rule 55, ADR 0014) — an unread HEAD is
     * `source_revision_unverified`, and that is correct and stays correct.
     *
     * But "what would the Context Compiler, the surface resolver and the
     * verification classifier produce for this step?" is a different question,
     * and it is answerable without a network at all. The internal benchmark
     * harness asks that one, in environments that hold no GitHub App
     * credentials, and every preview produced this way is stamped
     * `revisionVerified: false` so it cannot be mistaken for admission.
     *
     * Nothing in the product sets this. The website's Run button reaches this
     * function without it and reads the live HEAD for real.
     */
    resolveAgainstAnalysedCommit?: boolean;
  },
): Promise<DogfoodStepPreview> {
  // §26, §27: the gate, again, because this is now an entry point of its own.
  if (!isDogfoodEligibleProject(params.projectId, params.env)) {
    return { eligible: false, reason: "not_dogfood_eligible" };
  }

  const { step, planSteps, lineage } = params;
  const plan = lineage;

  const founderResolutions = await listActiveFounderResolutions(supabase, params.projectId);
  const completedSteps = completedStepsFromFounderResolutions(planSteps, founderResolutions);

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
  const revisionVerified = params.resolveAgainstAnalysedCommit !== true;
  let liveHead: RepositoryContext["liveHead"] = revisionVerified
    ? null
    : { commitSha: snapshot.result.source.commitSha, defaultBranch: connection.defaultBranch };

  if (revisionVerified) {
    try {
      const reader = createGithubRepositoryReader(connection.installationId, connection.owner, connection.name);
      liveHead = await reader.getHead();
    } catch (error) {
      if (!(error instanceof GithubDomainError)) throw error;
    }
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

  const liveEvidence = await establishLivePremise(supabase, {
    projectId: params.projectId,
    userId: params.userId,
    evidenceIds: step.evidenceIds,
    planGeneratedAt: params.planGeneratedAt,
  });

  const resolution = resolveStepExecution({
    step,
    plan: {
      steps: planSteps,
      completedSteps,
      isCurrent: true,
    },
    repository,
    agenticBudgetAuthorized: economics !== null,
    liveEvidence,
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

  /*
   * Built, not persisted.
   *
   * A preview is a read. Persisting on render would write an immutable,
   * permanently auditable row every time somebody opened this page — and, more
   * bluntly, it never worked: `execution_specs` has no insert policy, so the
   * caller's cookie-scoped client was silently refused and this function
   * reported `not_agentic` for a step it had just resolved as agentic.
   *
   * `startDogfoodRunAction` persists it, once, through
   * `operations/agent-execution/spec.ts`, which holds the only client that may.
   */
  const spec = buildExecutionSpec({
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
    approvedDecisions: founderResolutions
      .map((founderResolution) => {
        const sourceStep = planSteps.find(
          (candidate) =>
            candidate.founderInputRequirement?.kind === founderResolution.kind &&
            candidate.founderInputRequirement.subjectKey === founderResolution.subjectKey,
        );
        return {
          key: `${founderResolution.kind}:${founderResolution.subjectKey}`,
          stepOrder: sourceStep?.order ?? null,
          decision: founderResolution.resolvedStatement,
        };
      })
      .sort((left, right) => left.key.localeCompare(right.key)),
    validation,
    budget,
    credit: { quoteId: null, maxAuthorizedCredits: budget?.maxCredits ?? null },
    writeScope,
    /*
     * Preparation the resolver folded into this execution boundary
     * (semantics fix §12, §13).
     *
     * Taken from `resolution.absorbedPreparation` rather than chosen here: the
     * resolver decides which prerequisites are Vibe's own preparation, and a
     * surface that picked its own set would be compiling a different execution
     * than the one it classified. `buildExecutionSpec` refuses if the two
     * disagree, so this cannot drift silently.
     *
     * The non-null assertion is safe by construction — every absorbed order
     * came from a step in `plan.steps` a moment ago — and if that ever stopped
     * being true the spec builder would throw rather than build something
     * partial.
     */
    preparationSteps: resolution.absorbedPreparation.map(
      (order) => planSteps.find((candidate) => candidate.order === order)!,
    ),
    createdAt: new Date().toISOString(),
  });

  const preflight = runAgentPreflight({ resolution, spec, economics });

  if (!preflight.passed || !economics) {
    return { eligible: false, reason: "preflight_refused", resolution, preflight };
  }

  return {
    eligible: true,
    stepTitle: step.title,
    spec,
    repositoryConnectionId: connection.id,
    resolution,
    preflight,
    economics,
    revisionVerified,
  };
}
