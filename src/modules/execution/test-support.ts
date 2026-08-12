import type { BusinessOpportunity } from "@/modules/opportunities/schema";
import type { RepositoryIntelligenceSnapshot, RouteSummary } from "@/modules/repository-intelligence/schema";
import type { PreflightInput, PreflightProbe } from "./preflight";

/**
 * Fixtures for execution (Sprint 9 §39, §40).
 *
 * The defaults describe a project that *should* be executable, so every test
 * changes exactly one thing and asserts the refusal. That shape matters: a
 * safety check is only proven by the case where it fires.
 */

const SNAPSHOT_SHA = "0be0978c72665f84dd7a65e6a19c9415366d8f2b";

export function fakeSeoOpportunity(
  overrides: Partial<BusinessOpportunity> = {},
): BusinessOpportunity {
  return {
    id: "3-seo-fix-missing-technical-seo-foundations",
    rank: 3,
    title: "Fix missing technical SEO foundations",
    problem: "The live site is missing canonical URL, robots.txt, a sitemap and structured data.",
    whyNow: "These are low-effort fixes that do not depend on positioning or monetization.",
    impact: "medium",
    effort: "low",
    confidence: "high",
    category: "seo",
    primaryDimension: "distribution",
    secondaryDimensions: [],
    evidenceIds: [
      "live.seo.robots_txt_missing",
      "live.seo.sitemap_missing",
      "live.seo.canonical_missing",
      "repo.surface.sitemap",
    ],
    executionType: "code_change",
    executionReadiness: "ready",
    dependencies: [],
    ...overrides,
  };
}

export function fakeRepositorySnapshotFor(
  overrides: {
    frameworks?: { id: string; name: string }[];
    robotsDetected?: boolean;
    sitemapDetected?: boolean;
  } = {},
): RepositoryIntelligenceSnapshot {
  const frameworks = overrides.frameworks ?? [{ id: "nextjs", name: "Next.js" }];

  return {
    schemaVersion: "repository_intelligence.v1",
    source: { branch: "main", commitSha: SNAPSHOT_SHA, treeComplete: true, analyzerVersion: "repo-intelligence-v2" },
    repository: { private: false, fullName: "acme/product", defaultBranch: "main" },
    packageManager: "pnpm",
    languages: [{ id: "typescript", name: "TypeScript", evidence: [], confidence: "high" }],
    frameworks: frameworks.map((framework) => ({ ...framework, evidence: [], confidence: "high" as const })),
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
      monorepo: { detected: false, tool: null, apps: [], packages: [], evidence: [], ambiguous: false },
      sourceFileCount: 132,
      totalTreeEntries: 176,
      topLevelDirectories: ["docs", "src"],
    },
    metrics: { durationMs: 400, bytesFetched: 1000, filesFetched: 1, candidatesSelected: 20, treeEntriesConsidered: 176 },
    completeness: { status: "complete", reasons: [] },
    warnings: [],
  } as unknown as RepositoryIntelligenceSnapshot;
}

export function fakeProbe(overrides: Partial<PreflightProbe> = {}): PreflightProbe {
  return {
    head: { defaultBranch: "main", commitSha: SNAPSHOT_SHA },
    existingTargetPaths: [],
    liveRobotsServed: false,
    liveSitemapServed: false,
    hasWritePermission: true,
    ...overrides,
  };
}

/** A project where everything lines up. Each test breaks one thing. */
export function fakePreflightInput(overrides: Partial<PreflightInput> = {}): PreflightInput {
  return {
    opportunity: fakeSeoOpportunity(),
    repository: fakeRepositorySnapshotFor(),
    repositorySnapshotId: "snapshot_1",
    latestRepositorySnapshotId: "snapshot_1",
    snapshotCommitSha: SNAPSHOT_SHA,
    auditCurrent: true,
    opportunitySetCurrent: true,
    productionOrigin: "https://acme.com",
    appRoot: "src/app/",
    probe: fakeProbe(),
    ...overrides,
  };
}

export const FIXTURE_SNAPSHOT_SHA = SNAPSHOT_SHA;

/**
 * A route as the Sprint 2 detector would report it.
 *
 * Defaults to a static page, so a test that cares about `dynamic` or `kind`
 * sets exactly that and nothing else.
 */
export function fakeRoute(path: string, overrides: Partial<RouteSummary> = {}): RouteSummary {
  return {
    path,
    kind: "page",
    dynamic: false,
    sourcePath: `src/app${path === "/" ? "" : path}/page.tsx`,
    ...overrides,
  };
}

/**
 * The route shape of a typical SaaS product: a marketing root, real content
 * pages, and the authenticated/utility surfaces that must never be published.
 */
export const FIXTURE_ROUTES: RouteSummary[] = [
  fakeRoute("/"),
  fakeRoute("/pricing"),
  fakeRoute("/blog"),
  fakeRoute("/login"),
  fakeRoute("/signup"),
  fakeRoute("/app"),
  fakeRoute("/app/projects/[projectId]", { dynamic: true }),
  fakeRoute("/api/webhook", { kind: "api" }),
  fakeRoute("/blog/[slug]", { dynamic: true }),
];
