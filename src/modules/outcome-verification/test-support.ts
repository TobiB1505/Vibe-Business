import { REPOSITORY_INTELLIGENCE_SCHEMA_VERSION } from "@/modules/repository-intelligence/schema";
import type { RepositoryIntelligenceSnapshot, RouteSummary } from "@/modules/repository-intelligence/schema";
import { FakeDatabase } from "@/modules/operations/test-support";
import {
  FakeTransport,
  fakeDns,
  textResponse,
  xmlResponse,
  type FakeResponse,
  type FakeSiteRoutes,
} from "@/modules/live-product-intelligence/test-support";
import type { SafeFetchDependencies } from "@/modules/live-product-intelligence/net/safe-fetch";

/**
 * Test doubles for outcome verification (Sprint 12A §39–§43).
 *
 * ## What is modelled honestly rather than approximately
 *
 * **The network doubles are the crawler's.** `FakeTransport` and `fakeDns` are
 * imported from live product intelligence rather than reimplemented, because
 * the property under test is that outcome verification goes through the *same*
 * outbound door. A private double here would let the module drift off the safe
 * path while its tests stayed green — which is the exact failure the shared
 * boundary exists to prevent.
 *
 * **Requests are counted.** "Zero outbound HTTP on page render" and "no crawl"
 * are properties this sprint rests on, and a double that cannot count cannot
 * prove either.
 *
 * Nothing here opens a socket or resolves a hostname.
 */

export const OUTCOME_ORIGIN = "https://product.test";
export const OUTCOME_HOSTNAME = "product.test";
export const OUTCOME_ADDRESS = "93.184.216.34";

export const OUTCOME_MERGED_COMMIT = "c".repeat(40);

/** A robots.txt of the shape the SEO capability generates. */
export function robotsBody(origin: string = OUTCOME_ORIGIN): string {
  return [
    "User-Agent: *",
    "Allow: /",
    "Disallow: /app/",
    "Disallow: /api/",
    "",
    `Sitemap: ${origin}/sitemap.xml`,
  ].join("\n");
}

/** A sitemap listing exactly the given absolute URLs. */
export function sitemapBody(urls: string[]): string {
  const entries = urls.map((url) => `  <url><loc>${url}</loc></url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>`;
}

export type OutcomeSiteOptions = {
  origin?: string;
  /** Omit to serve no robots.txt — the "production has not updated" shape. */
  robots?: FakeResponse | null;
  sitemap?: FakeResponse | null;
  /** Extra routes, for redirect and content-type fixtures. */
  extra?: FakeSiteRoutes;
};

/** The routes of a product whose SEO foundations are live and correct. */
export function outcomeSite(options: OutcomeSiteOptions = {}): FakeSiteRoutes {
  const origin = options.origin ?? OUTCOME_ORIGIN;

  const routes: FakeSiteRoutes = { ...(options.extra ?? {}) };

  const robots = options.robots === undefined ? textResponse(robotsBody(origin)) : options.robots;
  const sitemap =
    options.sitemap === undefined ? xmlResponse(sitemapBody([origin])) : options.sitemap;

  if (robots) routes[`${origin}/robots.txt`] = robots;
  if (sitemap) routes[`${origin}/sitemap.xml`] = sitemap;

  return routes;
}

export function outcomeHttp(
  routes: FakeSiteRoutes,
  dns: Record<string, string[]> = { [OUTCOME_HOSTNAME]: [OUTCOME_ADDRESS] },
): SafeFetchDependencies & { transport: FakeTransport } {
  const transport = new FakeTransport(routes);
  return { transport, resolveDns: fakeDns(dns) };
}

/**
 * Structured route intelligence shaped like a real Next.js product.
 *
 * Deliberately includes `/login`, `/signup`, an `/app` subtree, an API route
 * and a dynamic route, so a contract derived from it exercises every branch of
 * the classification the generator itself uses.
 */
export const OUTCOME_ROUTES: RouteSummary[] = [
  { path: "/", kind: "page", dynamic: false, sourcePath: "src/app/page.tsx" },
  { path: "/login", kind: "page", dynamic: false, sourcePath: "src/app/login/page.tsx" },
  { path: "/signup", kind: "page", dynamic: false, sourcePath: "src/app/signup/page.tsx" },
  { path: "/app", kind: "page", dynamic: false, sourcePath: "src/app/app/(account)/page.tsx" },
  {
    path: "/app/projects/[projectId]",
    kind: "page",
    dynamic: true,
    sourcePath: "src/app/app/projects/[projectId]/page.tsx",
  },
  { path: "/api/hook", kind: "api", dynamic: false, sourcePath: "src/app/api/hook/route.ts" },
  { path: "/pricing", kind: "page", dynamic: false, sourcePath: "src/app/pricing/page.tsx" },
];

export function outcomeSnapshot(
  routes: RouteSummary[] = OUTCOME_ROUTES,
): RepositoryIntelligenceSnapshot {
  return {
    schemaVersion: REPOSITORY_INTELLIGENCE_SCHEMA_VERSION,
    source: {
      owner: "acme",
      repo: "product",
      ref: "main",
      commitSha: OUTCOME_MERGED_COMMIT,
      analyzedAt: "2026-08-14T14:40:56.438Z",
    },
    repository: {
      defaultBranch: "main",
      isPrivate: true,
      sizeKb: 1024,
      pushedAt: "2026-08-14T14:40:00.000Z",
    },
    completeness: { status: "complete", reasons: [] },
    projectStructure: { kind: "single_app", appRoot: "src/app", evidence: [] },
    languages: [],
    frameworks: [{ id: "nextjs", name: "Next.js", confidence: "high", evidence: [] }],
    packageManager: "pnpm",
    runtime: [],
    integrationSignals: [],
    routes: { framework: "nextjs", strategy: "app_router", routes, truncated: false },
    businessSurfaces: [],
    metrics: { filesInspected: 0, bytesInspected: 0, durationMs: 0, apiRequests: 0 },
    warnings: [],
  } as unknown as RepositoryIntelligenceSnapshot;
}

export const OUTCOME_FIXTURES = {
  project: "project_outcome",
  user: "user_outcome",
  preparedChange: "prepared_outcome",
  approval: "approval_outcome",
  merge: "merge_outcome",
  snapshot: "snapshot_outcome",
} as const;

export type SeedOutcomeOptions = {
  /** The merge's terminal state. Anything but `merged` is not verifiable (§10). */
  mergeStatus?: "merged" | "blocked" | "failed" | "preflight" | "merging";
  /** Defaults to the approved commit. Set differently to model a bad read-back. */
  resultingDefaultHeadSha?: string | null;
  capability?: string;
  /** Null models a project with no configured production website (§11). */
  productionUrl?: string | null;
  /** False models a repository snapshot that is no longer resolvable. */
  withSnapshot?: boolean;
  routes?: RouteSummary[];
  /**
   * The paths Vibe verified as changed by the commit.
   *
   * Ignored by the SEO contract and load-bearing for the agentic one, whose
   * expectations *are* the intersection of these with the route table
   * (ADR 0071).
   */
  changedPaths?: string[];
};

/**
 * A project whose SEO change was merged and read back — the eligible baseline.
 *
 * Every ineligibility test starts from this and removes exactly one thing, so a
 * refusal is always attributable to the fact that was taken away rather than to
 * a fixture that was never complete.
 */
export function seedMergedChange(db: FakeDatabase, options: SeedOutcomeOptions = {}): void {
  const status = options.mergeStatus ?? "merged";
  const resulting =
    options.resultingDefaultHeadSha === undefined
      ? status === "merged"
        ? OUTCOME_MERGED_COMMIT
        : null
      : options.resultingDefaultHeadSha;

  db.seed("projects", {
    id: OUTCOME_FIXTURES.project,
    user_id: OUTCOME_FIXTURES.user,
    production_url:
      options.productionUrl === undefined ? `${OUTCOME_ORIGIN}/` : options.productionUrl,
  });

  if (options.withSnapshot !== false) {
    db.seed("repository_intelligence_snapshots", {
      id: OUTCOME_FIXTURES.snapshot,
      project_id: OUTCOME_FIXTURES.project,
      status: "completed",
      commit_sha: OUTCOME_MERGED_COMMIT,
      analyzer_version: "repo-intel-v1",
      result: outcomeSnapshot(options.routes),
      created_at: "2026-08-14T10:00:00.000Z",
      completed_at: "2026-08-14T10:00:10.000Z",
    });
  }

  db.seed("prepared_changes", {
    id: OUTCOME_FIXTURES.preparedChange,
    project_id: OUTCOME_FIXTURES.project,
    user_id: OUTCOME_FIXTURES.user,
    status: "prepared",
    execution_capability: options.capability ?? "nextjs_seo_foundations_v2",
    execution_version: "nextjs-seo-foundations-v2",
    repository_snapshot_id: OUTCOME_FIXTURES.snapshot,
    commit_sha: OUTCOME_MERGED_COMMIT,
    base_sha: "b".repeat(40),
    base_branch: "main",
    branch_name: "vibe/seo-foundations",
    files: (options.changedPaths ?? ["src/app/sitemap.ts"]).map((path) => ({
      path,
      contentHash: "a".repeat(64),
      bytes: 512,
    })),
  });

  db.seed("change_approvals", {
    id: OUTCOME_FIXTURES.approval,
    project_id: OUTCOME_FIXTURES.project,
    user_id: OUTCOME_FIXTURES.user,
    prepared_change_id: OUTCOME_FIXTURES.preparedChange,
    prepared_commit_sha: OUTCOME_MERGED_COMMIT,
    prepared_base_sha: "b".repeat(40),
    status: "approved",
  });

  db.seed("change_merges", {
    id: OUTCOME_FIXTURES.merge,
    project_id: OUTCOME_FIXTURES.project,
    user_id: OUTCOME_FIXTURES.user,
    prepared_change_id: OUTCOME_FIXTURES.preparedChange,
    change_approval_id: OUTCOME_FIXTURES.approval,
    repository_connection_id: "connection_outcome",
    prepared_commit_sha: OUTCOME_MERGED_COMMIT,
    prepared_base_sha: "b".repeat(40),
    default_branch: "main",
    observed_default_head_before: "b".repeat(40),
    merge_policy_version: "merge-policy-v1",
    merge_strategy: "fast_forward_exact_commit",
    merge_identity: "m".repeat(64),
    status,
    resulting_default_head_sha: resulting,
    merged_at: status === "merged" ? "2026-08-14T14:40:56.438Z" : null,
    created_at: "2026-08-14T14:40:46.000Z",
  });
}

export { FakeDatabase };
