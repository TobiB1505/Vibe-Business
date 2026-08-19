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
