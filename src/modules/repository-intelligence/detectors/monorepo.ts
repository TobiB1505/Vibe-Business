import { pathSegments } from "../path-policy";
import type { DetectionContext } from "../context";
import type { Evidence, MonorepoIntelligence } from "../schema";

/**
 * Monorepo structure detection (Sprint 2 §16).
 *
 * Identifies the workspace tool and the directories that look like
 * independently deployable applications. It deliberately does not analyse
 * each package deeply — that would multiply cost against the budgets for
 * little Sprint 2 value. When the structure is recognisably a monorepo
 * but no app directories can be resolved, `ambiguous` is set rather than
 * inventing an answer.
 */

function evidence(kind: Evidence["kind"], path: string, detail?: string): Evidence {
  return detail === undefined ? { kind, path } : { kind, path, detail };
}

/** Immediate child directories of `parent` that contain at least one file. */
function childDirectories(context: DetectionContext, parent: string): string[] {
  const prefix = `${parent}/`;
  const children = new Set<string>();

  for (const path of context.sourcePaths) {
    if (!path.startsWith(prefix)) continue;
    const segments = pathSegments(path.slice(prefix.length));
    if (segments.length >= 2) children.add(`${parent}/${segments[0]}`);
  }

  return [...children].sort();
}

export function detectMonorepo(context: DetectionContext): MonorepoIntelligence {
  const items: Evidence[] = [];
  let tool: string | null = null;

  const pnpmWorkspace = context.findByBasename(/^pnpm-workspace\.yaml$/i)[0];
  if (pnpmWorkspace) {
    tool = "pnpm workspaces";
    items.push(evidence("config_file", pnpmWorkspace));
  }

  const rootWorkspaces = context.rootPackageJson?.workspaces ?? [];
  if (rootWorkspaces.length > 0) {
    tool = tool ?? "npm/yarn workspaces";
    items.push(evidence("manifest_field", "package.json", "workspaces"));
  }

  const turbo = context.findByBasename(/^turbo\.json$/i)[0];
  if (turbo) {
    tool = tool ?? "Turborepo";
    items.push(evidence("config_file", turbo));
  }

  const nx = context.findByBasename(/^nx\.json$/i)[0];
  if (nx) {
    tool = tool ?? "Nx";
    items.push(evidence("config_file", nx));
  }

  const lerna = context.findByBasename(/^lerna\.json$/i)[0];
  if (lerna) {
    tool = tool ?? "Lerna";
    items.push(evidence("config_file", lerna));
  }

  const apps = childDirectories(context, "apps");
  const packages = childDirectories(context, "packages");

  if (apps.length > 0) items.push(evidence("directory", "apps"));
  if (packages.length > 0) items.push(evidence("directory", "packages"));

  // Corroboration is required, because a workspace config file alone does
  // not mean a monorepo: `pnpm-workspace.yaml` is also used in ordinary
  // single-package repositories purely to carry pnpm settings such as
  // `allowBuilds`, with no `packages:` list at all. A real monorepo shows
  // up structurally — either a conventional apps//packages layout, or
  // simply more than one package.json.
  const packageManifestCount = context.findByBasename(/^package\.json$/i).length;
  const hasConventionalLayout = apps.length > 0 || packages.length > 0;
  const hasMultiplePackages = packageManifestCount > 1;

  if (!hasConventionalLayout && !hasMultiplePackages) {
    return { detected: false, tool: null, apps: [], packages: [], evidence: [], ambiguous: false };
  }

  if (hasMultiplePackages && !hasConventionalLayout) {
    items.push(evidence("manifest_field", "package.json", `${packageManifestCount} package manifests`));
  }

  // Structure says monorepo but no app/package directory could be
  // resolved — say so instead of guessing.
  const ambiguous = !hasConventionalLayout;

  return { detected: true, tool, apps, packages, evidence: items, ambiguous };
}
