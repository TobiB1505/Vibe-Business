import { isSourcePath, pathBasename } from "./path-policy";
import { parsePackageJson, type ParsedPackageJson } from "./parsers/package-json";
import type { TreeEntry } from "./reader";
import type { Warning } from "./schema";

/**
 * The read-only input every detector works from. Assembled once, then
 * passed to pure functions — so detectors are testable with a plain
 * object and never touch GitHub, the database, or the network.
 */
export type DetectionContext = {
  /** Every path in the tree, including generated output. */
  allPaths: string[];
  /** Paths eligible to be treated as first-party source. */
  sourcePaths: string[];
  /** Fast membership test over `allPaths`. */
  hasPath: (path: string) => boolean;
  /** True when any source path's basename matches. */
  hasBasename: (basename: string) => boolean;
  /** All source paths whose basename matches (case-insensitive). */
  findByBasename: (pattern: RegExp) => string[];
  /** Parsed package.json files, keyed by their repository path. */
  packageJsons: { path: string; parsed: ParsedPackageJson }[];
  /** The repository-root package.json, when present and parseable. */
  rootPackageJson: ParsedPackageJson | null;
  /** Union of dependency names across every parsed package.json. */
  allNodeDependencies: Set<string>;
  /** Lowercased text of parsed Python/other dependency manifests, by path. */
  textManifests: { path: string; content: string }[];
  /**
   * Stylesheet and theme-config text, by path (CORE-1 §12).
   *
   * Kept case-sensitive, unlike `textManifests`: a font family name is a
   * proper noun and "space grotesk" is not what the product calls itself.
   */
  styleSheets: { path: string; content: string }[];
};

export type FetchedFile = { path: string; content: string };

const PYTHON_MANIFESTS = new Set(["requirements.txt", "pyproject.toml", "Pipfile"]);

/** Files whose text is read for design tokens rather than dependencies. */
const STYLE_EXTENSIONS = /\.css$|^tailwind\.config\.(js|cjs|mjs|ts|mts)$/i;

export function buildDetectionContext(
  entries: TreeEntry[],
  files: FetchedFile[],
): { context: DetectionContext; warnings: Warning[] } {
  const warnings: Warning[] = [];

  const allPaths = entries.map((entry) => entry.path);
  const allPathSet = new Set(allPaths);
  const sourcePaths = entries
    .filter((entry) => entry.type === "blob" && isSourcePath(entry.path))
    .map((entry) => entry.path);

  const packageJsons: { path: string; parsed: ParsedPackageJson }[] = [];
  const textManifests: { path: string; content: string }[] = [];
  const styleSheets: { path: string; content: string }[] = [];

  for (const file of files) {
    const basename = pathBasename(file.path);

    if (STYLE_EXTENSIONS.test(basename)) {
      styleSheets.push({ path: file.path, content: file.content });
      continue;
    }

    if (basename === "package.json") {
      const parsed = parsePackageJson(file.content);
      if (parsed) {
        packageJsons.push({ path: file.path, parsed });
      } else {
        warnings.push({
          code: "manifest_unparseable",
          message: "package.json could not be parsed as JSON.",
          path: file.path,
        });
      }
      continue;
    }

    // Other manifests are matched textually rather than fully parsed:
    // detecting a declared dependency does not require a TOML/INI parser,
    // and avoiding one keeps the dependency surface small.
    if (
      PYTHON_MANIFESTS.has(basename) ||
      ["composer.json", "Gemfile", "go.mod", "Cargo.toml"].includes(basename)
    ) {
      textManifests.push({ path: file.path, content: file.content.toLowerCase() });
    }
  }

  const rootPackageJson =
    packageJsons.find((entry) => entry.path === "package.json")?.parsed ?? null;

  const allNodeDependencies = new Set<string>();
  for (const { parsed } of packageJsons) {
    for (const dependency of parsed.allDependencies) allNodeDependencies.add(dependency);
  }

  const context: DetectionContext = {
    allPaths,
    sourcePaths,
    hasPath: (path) => allPathSet.has(path),
    hasBasename: (basename) =>
      sourcePaths.some((path) => pathBasename(path).toLowerCase() === basename.toLowerCase()),
    findByBasename: (pattern) => sourcePaths.filter((path) => pattern.test(pathBasename(path))),
    packageJsons,
    rootPackageJson,
    allNodeDependencies,
    textManifests,
    styleSheets,
  };

  return { context, warnings };
}

/** True when any parsed package.json declares `name` as a dependency. */
export function hasNodeDependency(context: DetectionContext, name: string): boolean {
  return context.allNodeDependencies.has(name);
}

/** The path of the first package.json declaring `name`, for evidence. */
export function nodeDependencySource(context: DetectionContext, name: string): string | null {
  return (
    context.packageJsons.find((entry) => entry.parsed.allDependencies.includes(name))?.path ?? null
  );
}

/** True when a non-Node manifest mentions `token` (already lowercased). */
export function textManifestMentions(context: DetectionContext, token: string): string | null {
  const match = context.textManifests.find((manifest) =>
    manifest.content.includes(token.toLowerCase()),
  );
  return match ? match.path : null;
}
