import type { SupabaseClient } from "@supabase/supabase-js";
import { getLatestCompletedActionPlan } from "@/modules/action-plans/store";
import { getLatestSuccessfulSnapshot } from "@/modules/repository-intelligence/store";
import {
  loadAgentVerificationPlan,
  loadExecutionBrief,
  completionBudgetFor,
} from "@/modules/execution-context/service";
import { renderExecutionBrief } from "@/modules/execution-context/render";
import { assertPolicyConsistency } from "@/modules/execution-context/policy";
import { AGENTIC_EXECUTION_CONFIG } from "@/modules/ai/operations";
import { AGENT_PROMPT_COMPILER_VERSION } from "../schema";
import { resolveExecutableStep, type DogfoodStepPreview } from "../website-preflight";
import { benchmarkStep, benchmarkStepKey, findBenchmarkFixture, type BenchmarkFixture } from "./fixtures";

/**
 * The internal benchmark harness (Sprint 0045).
 *
 * ## What it replaces, and what it must not
 *
 * ```
 * Audit → Opportunity → Move → Action Plan      ← replaced by a Vibe-authored fixture
 * ─────────────────────────────────────────
 * Action Step → ExecutionSpec → Context →       ← production code, called directly
 * Surface → Verification → Completion →
 * Prompt → Sandbox → Billing → Candidate →
 * Prepared Change → Independent Validation
 * ```
 *
 * There is no benchmark-specific compiler, resolver, policy, budget or prompt
 * anywhere below the fixture. `resolveExecutableStep` is the same function the
 * website's Run button reaches, and everything it produces is produced by the
 * same code for a customer's plan step. That is the whole point: a benchmark
 * that ran through a parallel implementation would measure the implementation.
 *
 * ## Why it cannot start a paid run by itself
 *
 * `prepareBenchmark` reads, compiles and reports. It writes nothing and calls
 * no provider — every function it invokes is deterministic, which is exactly
 * why a preflight of it is free. Starting a run is a separate, explicit act
 * through `startAgentExecution`, and this module deliberately does not import
 * it. A typo cannot spend money because there is no code path from here to
 * Anthropic.
 */

export type BenchmarkPreparation =
  | { ok: false; reason: "unknown_fixture" | "no_action_plan" | "no_snapshot" | "base_sha_mismatch"; detail: string }
  | { ok: false; reason: "not_executable"; preview: Extract<DogfoodStepPreview, { eligible: false }> }
  | {
      ok: true;
      fixture: BenchmarkFixture;
      stepKey: string;
      preview: Extract<DogfoodStepPreview, { eligible: true }>;
      /** What the agent would actually be given, compiled by production code. */
      compiled: BenchmarkCompilation;
    };

export type BenchmarkCompilation = {
  model: string;
  promptCompilerVersion: string;
  baseSha: string;
  riskClass: string;

  surfaceScopes: readonly string[];
  surfaceBusinessSurfaces: readonly string[];
  surfaceDerivedFrom: readonly string[];
  surfaceUnrecognised: readonly string[];
  publicPagesResolved: number;
  publicPagesIncluded: number;
  authenticatedPagesResolved: number;
  authenticatedPagesIncluded: number;

  contextFreshness: string;
  contextBytes: number;
  contextFacts: number;
  contextCandidates: number;
  factsOmitted: number;
  candidatesOmitted: number;
  candidatePaths: readonly { path: string; reason: string; confidence: string; note: string | null }[];
  factSummaries: readonly string[];

  verificationMode: string | null;
  verificationPlanVersion: string | null;
  requiredChecks: readonly string[];
  allowedChecks: readonly string[];
  forbiddenChecks: readonly string[];

  completionBudgetVersion: string | null;
  completionBudget: Record<string, number> | null;

  /** Set when the two trusted policies contradict each other (PART M). */
  policyContradiction: string | null;
};

/**
 * Compiles one benchmark fixture against a real project, spending nothing.
 *
 * ## Where the lineage comes from
 *
 * The project's own newest completed Action Plan, and only for the fields the
 * spec needs to be a real audit record: the plan id (which
 * `execution_specs.action_plan_id` references), the opportunity and the audit
 * it traces to. The *work* — goal, expected changed state, the step itself —
 * comes from the fixture. So a benchmark run is honestly described as "an
 * internal step executed in this project's real business context", and
 * `execution_origin` on the run says which half was authored by Vibe.
 *
 * No plan row, step row, Move or audit is fabricated. Durable execution
 * re-resolves the step from the fixture registry by its namespaced key, which
 * is why none needs to be.
 */
export async function prepareBenchmark(
  supabase: SupabaseClient,
  params: {
    fixtureId: string;
    projectId: string;
    userId: string;
    /** Refuses unless the pinned base matches. Reproducibility, not selection. */
    expectedBaseSha?: string | null;
    /**
     * Compile against the analysed commit instead of reading the live HEAD.
     *
     * What makes a dry run possible in an environment holding no GitHub App
     * credentials. It answers "what would the pipeline compile?" and explicitly
     * not "may this run start?" — the resulting preparation is stamped
     * `revisionVerified: false` and the report says so in full.
     */
    resolveAgainstAnalysedCommit?: boolean;
    env?: Record<string, string | undefined>;
  },
): Promise<BenchmarkPreparation> {
  const fixture = findBenchmarkFixture(params.fixtureId);
  if (!fixture) {
    return { ok: false, reason: "unknown_fixture", detail: params.fixtureId };
  }

  const [plan, snapshot] = await Promise.all([
    getLatestCompletedActionPlan(supabase, params.projectId),
    getLatestSuccessfulSnapshot(supabase, params.projectId),
  ]);

  /*
   * A plan is required even though its steps are not used.
   *
   * `execution_specs.action_plan_id` is a foreign key, so a spec cannot exist
   * without one — and rather than fabricate a plan to satisfy it, the benchmark
   * anchors to the project's real one. That also means a project with no plan
   * is refused here rather than quietly given a synthetic lineage.
   */
  if (!plan) {
    return { ok: false, reason: "no_action_plan", detail: params.projectId };
  }
  if (!snapshot?.result) {
    return { ok: false, reason: "no_snapshot", detail: params.projectId };
  }

  if (params.expectedBaseSha && params.expectedBaseSha !== snapshot.result.source.commitSha) {
    return {
      ok: false,
      reason: "base_sha_mismatch",
      detail: `requested ${params.expectedBaseSha}, the project's analysed commit is ${snapshot.result.source.commitSha}`,
    };
  }

  const step = benchmarkStep(fixture, snapshot.result);

  const preview = await resolveExecutableStep(supabase, {
    projectId: params.projectId,
    userId: params.userId,
    env: params.env,
    step,
    planSteps: [step],
    resolveAgainstAnalysedCommit: params.resolveAgainstAnalysedCommit,
    lineage: {
      id: plan.id,
      goal: fixture.goal,
      expectedOutcome: fixture.expectedChangedState,
      // The plan's own assumptions do not describe this step, and carrying them
      // would put sentences in front of the agent that were written about
      // different work.
      assumptions: [],
      opportunityId: plan.opportunityId,
      businessAuditId: plan.businessAuditId,
    },
  });

  if (!preview.eligible) return { ok: false, reason: "not_executable", preview };

  return {
    ok: true,
    fixture,
    stepKey: benchmarkStepKey(fixture),
    preview,
    compiled: await compileBenchmark(supabase, params.projectId, preview),
  };
}

/**
 * Everything the run would be given, compiled by the production loaders.
 *
 * `loadExecutionBrief` and `loadAgentVerificationPlan` are the exact functions
 * the durable workflow calls — including their own step lookup, which resolves
 * this fixture from the registry by its namespaced key. So the numbers a
 * dry-run prints are the numbers a real run would compile, not an estimate of
 * them.
 */
async function compileBenchmark(
  supabase: SupabaseClient,
  projectId: string,
  preview: Extract<DogfoodStepPreview, { eligible: true }>,
): Promise<BenchmarkCompilation> {
  const input = { supabase, projectId, spec: preview.spec };

  const [brief, verification] = await Promise.all([
    loadExecutionBrief(input),
    loadAgentVerificationPlan(input),
  ]);
  const completion = completionBudgetFor(verification);

  let policyContradiction: string | null = null;
  if (verification && completion) {
    try {
      assertPolicyConsistency(verification, completion);
    } catch (error) {
      policyContradiction = error instanceof Error ? error.message : "unknown";
    }
  }

  const rendered = brief ? renderExecutionBrief(brief) : null;

  return {
    model: AGENTIC_EXECUTION_CONFIG.model,
    promptCompilerVersion: AGENT_PROMPT_COMPILER_VERSION,
    baseSha: preview.spec.repository.baseSha,
    riskClass: preview.spec.riskClass,

    surfaceScopes: brief?.surface.requirement.scopes ?? [],
    surfaceBusinessSurfaces: brief?.surface.requirement.surfaces ?? [],
    surfaceDerivedFrom: brief?.surface.requirement.derivedFrom ?? [],
    surfaceUnrecognised: brief?.surface.requirement.unrecognised ?? [],
    publicPagesResolved: brief?.surface.publicPagesResolved ?? 0,
    publicPagesIncluded: brief?.surface.publicPagesIncluded ?? 0,
    authenticatedPagesResolved: brief?.surface.authenticatedPagesResolved ?? 0,
    authenticatedPagesIncluded: brief?.surface.authenticatedPagesIncluded ?? 0,

    contextFreshness: brief?.freshness.state ?? "none",
    contextBytes: rendered?.bytes ?? 0,
    contextFacts: rendered?.factsRendered ?? 0,
    contextCandidates: rendered?.candidatesRendered ?? 0,
    factsOmitted: rendered?.factsOmitted ?? 0,
    candidatesOmitted: rendered?.candidatesOmitted ?? 0,
    candidatePaths: (brief?.fileCandidates ?? []).map((candidate) => ({
      path: candidate.path,
      reason: candidate.reason,
      confidence: candidate.confidence,
      note: candidate.note,
    })),
    factSummaries: (brief?.facts ?? []).map((fact) => `${fact.subject}: ${fact.value}`),

    verificationMode: verification?.mode ?? null,
    verificationPlanVersion: verification?.planVersion ?? null,
    requiredChecks: verification?.requiredChecks ?? [],
    allowedChecks: verification?.allowedChecks ?? [],
    forbiddenChecks: verification?.forbiddenChecks ?? [],

    completionBudgetVersion: completion?.budgetVersion ?? null,
    completionBudget: completion
      ? {
          implementationStabilisationCalls: completion.implementationStabilisationCalls,
          maxCompletionActions: completion.maxCompletionActions,
          maxOutsideBriefReads: completion.maxOutsideBriefReads,
          maxConvergenceWindows: completion.maxConvergenceWindows,
          maxRepairCycles: completion.maxRepairCycles,
          maxCompletionWallClockMs: completion.maxCompletionWallClockMs,
          maxDiffReviewReadsPerPath: completion.maxDiffReviewReadsPerPath,
        }
      : null,

    policyContradiction,
  };
}

/** The dry-run report. No secrets, no reasoning, no repository content. */
export function renderBenchmarkPreparation(prepared: Extract<BenchmarkPreparation, { ok: true }>): string {
  const { fixture, preview, compiled } = prepared;
  const lines: string[] = [];
  const section = (title: string) => lines.push("", `── ${title} ${"─".repeat(Math.max(0, 58 - title.length))}`);

  section("Benchmark");
  lines.push(`  Fixture          ${fixture.id} (${fixture.fixtureVersion})`);
  lines.push(`  Step key         ${prepared.stepKey}`);
  lines.push(`  Title            ${fixture.title}`);
  lines.push(`  Intent           ${fixture.benchmarkIntent}`);

  section("Execution");
  lines.push(`  Repository       ${preview.spec.repository.fullName}`);
  lines.push(`  Base SHA         ${compiled.baseSha}`);
  lines.push(`  Model            ${compiled.model}`);
  lines.push(`  Prompt compiler  ${compiled.promptCompilerVersion}`);
  lines.push(`  Change kind      ${fixture.changeKind}`);
  lines.push(`  Risk class       ${compiled.riskClass}   (derived, not fixture-set)`);
  lines.push(`  Evidence ids     ${fixture.evidenceIds.join(", ")}`);
  lines.push(`  Max provider $   ${preview.economics.budget.maxProviderSpendUsd}`);

  section("Execution surface");
  lines.push(`  Scopes           ${compiled.surfaceScopes.join(", ") || "(none)"}`);
  lines.push(`  Business surfaces ${compiled.surfaceBusinessSurfaces.join(", ") || "(none)"}`);
  lines.push(`  Derived from     ${compiled.surfaceDerivedFrom.join(", ") || "(none)"}`);
  lines.push(`  Unrecognised ids ${compiled.surfaceUnrecognised.join(", ") || "(none)"}`);
  lines.push(`  Public pages     ${compiled.publicPagesIncluded} included of ${compiled.publicPagesResolved} resolved`);
  lines.push(`  Signed-in pages  ${compiled.authenticatedPagesIncluded} included of ${compiled.authenticatedPagesResolved} resolved`);

  section("Execution context");
  lines.push(`  Freshness        ${compiled.contextFreshness}`);
  lines.push(`  Rendered bytes   ${compiled.contextBytes}`);
  lines.push(`  Facts            ${compiled.contextFacts} (${compiled.factsOmitted} omitted)`);
  lines.push(`  Candidates       ${compiled.contextCandidates} (${compiled.candidatesOmitted} omitted)`);
  for (const fact of compiled.factSummaries) lines.push(`    · ${fact}`);
  lines.push("  Candidate files");
  for (const candidate of compiled.candidatePaths) {
    lines.push(`    · ${candidate.path}  [${candidate.reason}, ${candidate.confidence}]${candidate.note ? ` (${candidate.note})` : ""}`);
  }

  section("Agent verification");
  lines.push(`  Mode             ${compiled.verificationMode ?? "(none)"} (${compiled.verificationPlanVersion ?? "-"})`);
  lines.push(`  Required         ${compiled.requiredChecks.join(", ") || "(none)"}`);
  lines.push(`  Allowed          ${compiled.allowedChecks.join(", ") || "(none)"}`);
  lines.push(`  Forbidden        ${compiled.forbiddenChecks.join(", ") || "(none)"}`);

  section("Completion control");
  lines.push(`  Budget version   ${compiled.completionBudgetVersion ?? "(none)"}`);
  for (const [key, value] of Object.entries(compiled.completionBudget ?? {})) {
    lines.push(`    ${key.padEnd(34)} ${value}`);
  }

  section("Policy consistency");
  lines.push(`  ${compiled.policyContradiction ?? "the verification plan and the completion budget agree"}`);

  section("Revision");
  lines.push(
    preview.revisionVerified
      ? `  The repository's live default branch was read and still points at ${compiled.baseSha}.`
      : "  NOT VERIFIED — compiled against the analysed commit without reading the live\n" +
        "  default branch. This preflight says what the pipeline would compile, and nothing\n" +
        "  about whether a run may start. Admission re-reads the live HEAD and refuses if it moved.",
  );

  section("Spend");
  lines.push("  Provider calls   0");
  lines.push("  Provider cost    $0.00");
  lines.push("  Rows written     0");

  return lines.join("\n");
}
