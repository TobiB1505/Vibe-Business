import { BudgetTracker, DEFAULT_ANALYSIS_BUDGETS, type AnalysisBudgets } from "./budgets";
import { selectCandidates } from "./candidates";
import { buildDetectionContext, type FetchedFile } from "./context";
import { isGeneratedPath, pathSegments } from "./path-policy";
import { detectBusinessSurfaces } from "./detectors/business-surfaces";
import { detectIntegrationSignals } from "./detectors/integrations";
import { detectMonorepo } from "./detectors/monorepo";
import { detectRoutes } from "./detectors/routes";
import { detectFrameworks, detectLanguages, detectPackageManager, detectRuntime } from "./detectors/stack";
import {
  ANALYZER_VERSION,
  REPOSITORY_INTELLIGENCE_SCHEMA_VERSION,
  type ProjectStructure,
  type RepositoryFacts,
  type RepositoryIntelligenceSnapshot,
  type Warning,
} from "./schema";
import type { RepositoryReader, TreeEntry } from "./reader";

/**
 * Deterministic analysis pipeline (Sprint 2 §29):
 *
 *   reader → tree → candidate selection → manifest fetch/parse
 *          → detectors → snapshot
 *
 * Every stage is a pure function over plain data except the two reader
 * calls, which makes the whole pipeline testable with an in-memory fake
 * reader and no GitHub access.
 *
 * No repository content is executed, imported, evaluated, or interpreted
 * as instructions at any point — manifests are parsed as data only
 * (ADR 0006, Sprint 2 §2).
 */

export type AnalyzeOptions = {
  budgets?: AnalysisBudgets;
};

export type AnalyzeInput = {
  reader: RepositoryReader;
  repository: RepositoryFacts;
};

export type AnalysisResult = {
  snapshot: RepositoryIntelligenceSnapshot;
  /** Head commit analysed — the caller persists this for reuse checks. */
  commitSha: string;
  branch: string;
};

function topLevelDirectories(entries: TreeEntry[]): string[] {
  const directories = new Set<string>();
  for (const entry of entries) {
    if (isGeneratedPath(entry.path)) continue;
    const segments = pathSegments(entry.path);
    if (segments.length >= 2) directories.add(segments[0]);
  }
  return [...directories].sort();
}

export async function analyzeRepository(
  input: AnalyzeInput,
  options: AnalyzeOptions = {},
): Promise<AnalysisResult> {
  const budgets = options.budgets ?? DEFAULT_ANALYSIS_BUDGETS;
  const tracker = new BudgetTracker(budgets);
  const warnings: Warning[] = [];

  const head = await input.reader.getHead();
  const tree = await input.reader.getTree(head.commitSha);

  if (tree.truncated) tracker.note("tree_truncated");

  let entries = tree.entries;
  if (entries.length > budgets.maxTreeEntries) {
    entries = entries.slice(0, budgets.maxTreeEntries);
    tracker.note("tree_entry_budget_reached");
  }

  const selection = selectCandidates(entries, budgets);
  if (selection.truncatedByBudget) tracker.note("file_budget_reached");

  // The only place repository file content enters the process.
  const files: FetchedFile[] = [];
  for (const candidate of selection.toFetch) {
    if (!tracker.canFetchFile()) break;

    const content = await input.reader.getTextFile(candidate.path, head.commitSha, budgets.maxBytesPerFile);
    if (content === null) continue;

    tracker.recordFetch(Buffer.byteLength(content, "utf8"));
    files.push({ path: candidate.path, content });
  }

  const { context, warnings: contextWarnings } = buildDetectionContext(entries, files);
  warnings.push(...contextWarnings);

  const frameworks = detectFrameworks(context);
  const integrationSignals = detectIntegrationSignals(context);
  const routes = detectRoutes(context, frameworks);
  const monorepo = detectMonorepo(context);

  if (monorepo.ambiguous) {
    warnings.push({
      code: "monorepo_apps_unresolved",
      message: "Workspace tooling was detected but no application directories could be resolved.",
    });
    tracker.note("unsupported_structure");
  }

  const projectStructure: ProjectStructure = {
    totalTreeEntries: tree.entries.length,
    sourceFileCount: context.sourcePaths.length,
    topLevelDirectories: topLevelDirectories(entries),
    monorepo,
  };

  const stats = tracker.stats;

  const snapshot: RepositoryIntelligenceSnapshot = {
    schemaVersion: REPOSITORY_INTELLIGENCE_SCHEMA_VERSION,
    source: {
      commitSha: head.commitSha,
      branch: head.defaultBranch,
      analyzerVersion: ANALYZER_VERSION,
      treeComplete: !tree.truncated,
    },
    repository: input.repository,
    completeness: {
      status: tracker.completeness,
      reasons: tracker.completenessReasons,
    },
    projectStructure,
    languages: detectLanguages(context),
    frameworks,
    packageManager: detectPackageManager(context),
    runtime: detectRuntime(context),
    integrationSignals,
    routes,
    businessSurfaces: detectBusinessSurfaces(context, integrationSignals, routes),
    metrics: {
      treeEntriesConsidered: entries.length,
      candidatesSelected: selection.discovered.length,
      filesFetched: stats.filesFetched,
      bytesFetched: stats.bytesFetched,
      durationMs: stats.durationMs,
    },
    warnings,
  };

  return { snapshot, commitSha: head.commitSha, branch: head.defaultBranch };
}
