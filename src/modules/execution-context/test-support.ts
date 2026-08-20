import type {
  BusinessSurfaceId,
  RepositoryIntelligenceSnapshot,
  RouteSummary,
} from "@/modules/repository-intelligence/schema";
import { fakeSnapshot } from "@/modules/execution-contract/test-support";

/**
 * Fixtures for the Execution Context compiler.
 *
 * Built on top of `execution-contract/test-support`'s snapshot rather than
 * beside it, so a change to the analyzer's shape breaks one fixture and not two
 * — and so a compiler test cannot pass against a repository shape the rest of
 * the product no longer produces.
 */

export type FixtureSurface = {
  id: BusinessSurfaceId;
  name: string;
  detected: boolean;
  confidence?: "high" | "medium" | "low";
  evidencePaths?: readonly string[];
};

/**
 * A snapshot with routes and surfaces — the two things a brief is compiled from.
 *
 * `fakeSnapshot` deliberately ships neither: it exists to prove the execution
 * contract's refusals, which do not read them. Everything a brief needs is
 * therefore layered on here, explicitly, so a reader of a compiler test can see
 * exactly which repository fact produced which line of the brief.
 */
export function fakeBriefSnapshot(overrides: {
  commitSha?: string;
  routes?: readonly RouteSummary[];
  routeMode?: RepositoryIntelligenceSnapshot["routes"]["mode"];
  routesTruncated?: boolean;
  surfaces?: readonly FixtureSurface[];
  topLevelDirectories?: readonly string[];
  frameworkEvidence?: readonly string[];
} = {}): RepositoryIntelligenceSnapshot {
  const base = fakeSnapshot();

  const surfaces = (overrides.surfaces ?? []).map((surface) => ({
    id: surface.id,
    name: surface.name,
    detected: surface.detected,
    confidence: surface.confidence ?? "high",
    evidence: (surface.evidencePaths ?? []).map((path) => ({
      kind: "file_path" as const,
      path,
    })),
  }));

  return {
    ...base,
    source: { ...base.source, commitSha: overrides.commitSha ?? base.source.commitSha },
    frameworks: base.frameworks.map((framework) => ({
      ...framework,
      evidence: (overrides.frameworkEvidence ?? []).map((path) => ({
        kind: "manifest_dependency" as const,
        path,
      })),
    })),
    routes: {
      mode: overrides.routeMode ?? "app_router",
      truncated: overrides.routesTruncated ?? false,
      routes: [...(overrides.routes ?? [])],
    },
    businessSurfaces: surfaces.length > 0 ? surfaces : base.businessSurfaces,
    projectStructure: {
      ...base.projectStructure,
      topLevelDirectories: [...(overrides.topLevelDirectories ?? base.projectStructure.topLevelDirectories)],
    },
  };
}

export function fakeRoute(overrides: Partial<RouteSummary> & { path: string }): RouteSummary {
  return {
    kind: "page",
    dynamic: false,
    sourcePath: `src/app${overrides.path === "/" ? "" : overrides.path}/page.tsx`,
    ...overrides,
  };
}

/**
 * A repository shaped like Vibe Business itself at the run #7 commit.
 *
 * Seven public pages, a signed-in application area behind `/app`, a root layout
 * and an app layout, plus the two SEO surfaces the analyzer detected. This is
 * the fixture PART N, PART O and PART P are all measured against — one
 * repository, three different task shapes, and no task-specific code anywhere
 * between them.
 */
export function fakePublicSiteSnapshot(
  overrides: Parameters<typeof fakeBriefSnapshot>[0] = {},
): RepositoryIntelligenceSnapshot {
  return fakeBriefSnapshot({
    frameworkEvidence: ["package.json"],
    routes: [
      fakeRoute({ path: "/", kind: "layout", sourcePath: "src/app/layout.tsx" }),
      fakeRoute({ path: "/app", kind: "layout", sourcePath: "src/app/app/layout.tsx" }),
      fakeRoute({ path: "/", sourcePath: "src/app/page.tsx" }),
      fakeRoute({ path: "/login" }),
      fakeRoute({ path: "/signup" }),
      fakeRoute({ path: "/forgot-password" }),
      fakeRoute({ path: "/reset-password" }),
      fakeRoute({ path: "/privacy" }),
      fakeRoute({ path: "/terms" }),
      fakeRoute({ path: "/app", sourcePath: "src/app/app/page.tsx" }),
      fakeRoute({ path: "/app/billing", sourcePath: "src/app/app/billing/page.tsx" }),
      fakeRoute({
        path: "/app/projects/[projectId]",
        dynamic: true,
        sourcePath: "src/app/app/projects/[projectId]/page.tsx",
      }),
      fakeRoute({
        path: "/api/github/webhook",
        kind: "api",
        sourcePath: "src/app/api/github/webhook/route.ts",
      }),
    ],
    surfaces: [
      { id: "robots", name: "robots.txt", detected: true, evidencePaths: ["src/app/robots.ts"] },
      {
        id: "seo_metadata",
        name: "SEO metadata",
        detected: true,
        evidencePaths: ["src/app/layout.tsx"],
      },
      {
        id: "legal",
        name: "Legal pages",
        detected: true,
        evidencePaths: ["src/app/privacy/page.tsx", "src/app/terms/page.tsx"],
      },
      {
        id: "dashboard_app",
        name: "Dashboard / app area",
        detected: true,
        evidencePaths: ["src/app/app/layout.tsx", "src/app/app/page.tsx"],
      },
    ],
    topLevelDirectories: ["src", "public", "supabase", "docs", "scripts"],
    ...overrides,
  });
}
