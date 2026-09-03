import type { ActionPlanStep } from "@/modules/action-plans/schema";
import { creditsToUnits } from "@/modules/credits/units";
import { fakeBuildIntelligence } from "@/modules/repository-intelligence/test-support";
import type {
  BuildIntelligence,
  RepositoryIntelligenceSnapshot,
} from "@/modules/repository-intelligence/schema";
import { uniformBudgetsByClass, type ExecutionBudget, type ExecutionBudgetPolicy } from "./budget";
import type { ExecutionWriteScope } from "./policy";
import type { PlanContext, RepositoryContext, ResolveExecutionInput } from "./resolver";
import type { ExecutionRepositoryBinding } from "./spec";

/**
 * Fixtures for the execution contract (EXECUTION CORE-3 §41–§53).
 *
 * The defaults describe a project and a step that **should** resolve to
 * `agentic` and be admissible — a Next.js repository with a current snapshot, a
 * live HEAD that matches it, an authorized budget, and a moderate-risk product
 * change with no prerequisites.
 *
 * That shape is deliberate and it is the same one `execution/test-support.ts`
 * uses: every test then changes exactly one thing and asserts the refusal. A
 * safety check is only proven by the case where it fires, and a fixture that
 * starts refused proves nothing when it stays refused.
 */

export const FIXTURE_BASE_SHA = "1f4b0c9d7a2e5f8b3c6d9e0a1b2c3d4e5f607182";
export const FIXTURE_OTHER_SHA = "9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a291807";
export const FIXTURE_SNAPSHOT_ID = "8b3d1e4f-2a6c-4d7e-9f01-2a3b4c5d6e7f";

/** A moderate-risk Vibe product change with nothing in front of it. */
export function fakePlanStep(overrides: Partial<ActionPlanStep> = {}): ActionPlanStep {
  return {
    id: "1-ship-the-thing",
    order: 1,
    title: "Ship the thing",
    description: "Make the product do the thing it promises.",
    purpose: "So a visitor can complete the job the product exists for.",
    actor: "vibe",
    changeKind: "product_change",
    completionCriteria: "A visitor can complete the flow end to end.",
    dependsOn: [],
    evidenceIds: ["live.surface.dashboard_app"],
    founderInputRequirement: null,
    // Planner-derived and deliberately ignored by the resolver. The defaults
    // are the *wrong* answer on purpose, so a test that passes cannot be
    // passing because the resolver read them (§6, §41).
    executionSupport: "not_yet_supported",
    capability: null,
    requiresApproval: true,
    ...overrides,
  };
}

export function fakeSnapshot(
  overrides: {
    frameworks?: { id: string; name: string }[];
    packageManager?: RepositoryIntelligenceSnapshot["packageManager"];
    monorepo?: boolean;
    robotsDetected?: boolean;
    sitemapDetected?: boolean;
    /** The build targets, for tests about which application Vibe would build. */
    build?: BuildIntelligence;
  } = {},
): RepositoryIntelligenceSnapshot {
  const frameworks = overrides.frameworks ?? [{ id: "nextjs", name: "Next.js" }];

  return {
    schemaVersion: "repository_intelligence.v1",
    source: {
      branch: "main",
      commitSha: FIXTURE_BASE_SHA,
      treeComplete: true,
      analyzerVersion: "repo-intelligence-v2",
    },
    repository: { private: false, fullName: "acme/product", defaultBranch: "main" },
    packageManager: overrides.packageManager ?? "pnpm",
    languages: [{ id: "typescript", name: "TypeScript", evidence: [], confidence: "high" }],
    frameworks: frameworks.map((framework) => ({
      ...framework,
      evidence: [],
      confidence: "high" as const,
    })),
    runtime: [],
    integrationSignals: [],
    businessSurfaces: [
      {
        id: "robots",
        name: "robots.txt",
        detected: overrides.robotsDetected ?? false,
        evidence: [],
        confidence: "high",
      },
      {
        id: "sitemap",
        name: "Sitemap",
        detected: overrides.sitemapDetected ?? false,
        evidence: [],
        confidence: "high",
      },
    ],
    routes: { mode: "app_router", truncated: false, routes: [] },
    projectStructure: {
      monorepo: {
        detected: overrides.monorepo ?? false,
        tool: null,
        apps: [],
        packages: [],
        evidence: [],
        ambiguous: false,
      },
      topLevelDirectories: ["src"],
      sourceFileCount: 40,
      totalTreeEntries: 60,
    },
    metrics: {
      durationMs: 400,
      bytesFetched: 1000,
      filesFetched: 1,
      candidatesSelected: 20,
      treeEntriesConsidered: 60,
    },
    completeness: { status: "complete", reasons: [] },
    build:
      overrides.build ??
      fakeBuildIntelligence({
        packageManager: overrides.packageManager,
        frameworks: frameworks.map((framework) => framework.id),
      }),
    warnings: [],
    // Cast for the same reason `execution/test-support.ts` casts: the snapshot
    // type carries detector sub-objects no test in this module reads, and
    // spelling them all out would be fixture noise that drifts.
  } as unknown as RepositoryIntelligenceSnapshot;
}

export function fakeRepositoryContext(
  overrides: Partial<RepositoryContext> = {},
): RepositoryContext {
  return {
    connection: { id: "conn-1", fullName: "acme/product", defaultBranch: "main" },
    snapshot: fakeSnapshot(),
    snapshotId: FIXTURE_SNAPSHOT_ID,
    snapshotCommitSha: FIXTURE_BASE_SHA,
    snapshotIsLatest: true,
    liveHead: { defaultBranch: "main", commitSha: FIXTURE_BASE_SHA },
    ...overrides,
  };
}

export function fakePlanContext(
  steps: ActionPlanStep[],
  overrides: Partial<PlanContext> = {},
): PlanContext {
  return {
    steps,
    completedSteps: new Set<number>(),
    isCurrent: true,
    ...overrides,
  };
}

export function fakeResolveInput(
  overrides: Partial<ResolveExecutionInput> = {},
): ResolveExecutionInput {
  const step = overrides.step ?? fakePlanStep();
  return {
    step,
    plan: overrides.plan ?? fakePlanContext([step]),
    repository: overrides.repository ?? fakeRepositoryContext(),
    agenticBudgetAuthorized: overrides.agenticBudgetAuthorized ?? true,
  };
}

/**
 * A fixture budget policy.
 *
 * Numbers with no production meaning, and that is the point: `budget.ts` ships
 * no approved policy, because Vibe has never run an agent and any number chosen
 * today would be a guess wearing a decision's clothes (§25). Tests need
 * *some* ceiling to prove the binding logic, so they bring their own.
 */
export function fakeBudget(
  overrides: Partial<Omit<ExecutionBudget, "budgetPolicyVersion">> = {},
): Omit<ExecutionBudget, "budgetPolicyVersion"> {
  return {
    maxCredits: creditsToUnits(200),
    maxAiCalls: 20,
    maxAgentTurns: 40,
    maxRepairAttempts: 3,
    maxWallClockMs: 900_000,
    maxSandboxMs: 600_000,
    maxChangedFiles: 15,
    maxChangedBytes: 200_000,
    maxNetworkRequests: 0,
    maxProviderSpendUsd: 5,
    ...overrides,
  };
}

/**
 * A fixture policy, uniform across the three execution pricing classes.
 *
 * Uniform on purpose: a fixture that varied by class would make every test
 * depend on which class its fake step happens to classify as, which is a fact
 * about `execution-class.ts` and not about the thing under test. Tests that
 * care about per-class ceilings build their own policy.
 */
export function fakeBudgetPolicy(
  overrides: Partial<Omit<ExecutionBudget, "budgetPolicyVersion">> = {},
): ExecutionBudgetPolicy {
  return {
    version: "execution-budget-fixture-v1",
    effectiveFrom: "2020-01-01T00:00:00.000Z",
    effectiveTo: null,
    budgetsByClass: uniformBudgetsByClass(fakeBudget(overrides)),
  };
}

/** A fixture write scope. Same reasoning as the budget: no production numbers. */
export function fakeWriteScope(): ExecutionWriteScope {
  return {
    discovery: { maxFilesRead: 200, maxBytesPerFile: 262_144 },
    mutation: { maxChangedFiles: 15, maxChangedBytes: 200_000, forbiddenPathClasses: [] },
  };
}

export function fakeRepositoryBinding(
  overrides: Partial<ExecutionRepositoryBinding> = {},
): ExecutionRepositoryBinding {
  return {
    repositoryConnectionId: "conn-1",
    fullName: "acme/product",
    defaultBranch: "main",
    baseSha: FIXTURE_BASE_SHA,
    repositorySnapshotId: FIXTURE_SNAPSHOT_ID,
    frameworks: ["nextjs"],
    packageManager: "pnpm",
    ...overrides,
  };
}

export const FIXTURE_PLAN = {
  id: "plan-1",
  goal: "Let staff sign in and reach the shared calendar.",
  expectedOutcome: "Staff can reach the calendar from the homepage.",
  assumptions: ["The calendar already exists behind an unlinked route."],
  opportunityId: "move-1",
  businessAuditId: "audit-1",
} as const;
