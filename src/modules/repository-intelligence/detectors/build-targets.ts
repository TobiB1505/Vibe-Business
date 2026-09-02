import type { DetectionContext } from "../context";
import { pathSegments } from "../path-policy";
import type {
  BuildIntelligence,
  BuildTarget,
  BuildTargetLockfile,
  LockfilePackageManager,
} from "../schema";
import { frameworksForDependencies } from "./stack";

/**
 * Where a buildable application lives, and what could install it (Stufe 4).
 *
 * ## The question this answers
 *
 * Not *"what is this repository built with?"* — `stack.ts` answers that, as a
 * union over every manifest in the tree. This answers **"how many
 * independently installable applications does this repository contain, and
 * where are they?"**, which the union cannot express and which is the only
 * form of the question a validation profile can act on.
 *
 * The difference is not academic. A repository with a Next.js app in
 * `frontend/` and a Python service in `backend/` reports `frameworks: [nextjs,
 * fastapi, react]` and `packageManager: npm`, both true of the repository, and
 * both useless for deciding what to install in one directory. Read as though
 * they described the root, they say a Next.js app is at `.` — which is how a
 * repository with no root manifest at all came to be admitted for validation.
 *
 * ## Structure only, and existence wherever existence is enough
 *
 * Every field below comes from a parsed `package.json` Vibe already fetched or
 * from a path being present in the tree. No new file is downloaded.
 *
 * Two facts are deliberately taken from a file's *existence* rather than its
 * contents. `.yarnrc.yml` distinguishes Yarn Berry from Yarn 1 and may also
 * contain an `npmAuthToken`; rule 28 permits observing that such a file exists
 * and forbids reading it. `.pnp.cjs` is Plug'n'Play itself rather than a
 * statement about it, so it is the better signal as well as the safe one.
 *
 * ## This is not a command source
 *
 * `buildScript` says a manifest *declared* a `build` script at the analyzed
 * commit. It decides **admission** — whether Vibe should buy a sandbox for this
 * repository at all — and nothing else. What actually runs is still re-read
 * from the sandbox's own filesystem in every phase (`validation/orchestrator.ts`
 * `readPlan`), because a plan built from a snapshot is a belief about a
 * filesystem and a plan built from the filesystem is a fact about it. The two
 * are allowed to disagree: if they do, the run fails honestly at `readPlan`
 * rather than running something nobody predicted. `scripts.test.ts` records
 * which module may read this, and that list is the review.
 */

/**
 * The most targets one repository may report.
 *
 * A bound rather than a limit anyone will reach: the resolver refuses anything
 * with more than one installable target anyway, so this exists to keep an
 * enormous monorepo from writing an unbounded array into a JSONB column
 * (rule 27). Reaching it sets `truncated`, which the resolver treats as "the
 * answer might be incomplete" rather than as an answer.
 */
export const MAX_BUILD_TARGETS = 25;

/**
 * Lockfile basenames, in the order a directory holding two of them is read.
 *
 * The lockfile decides, and the manifest's `packageManager` field does not get
 * a vote. The contract is *install exactly what the lockfile says*, so the
 * authority on which installer can honour it is the lockfile that exists —
 * not a field claiming which one should have written it.
 */
const LOCKFILES: {
  basename: string;
  packageManager: Exclude<LockfilePackageManager, "yarn_berry" | "yarn_classic">;
}[] = [
  { basename: "pnpm-lock.yaml", packageManager: "pnpm" },
  { basename: "bun.lock", packageManager: "bun" },
  { basename: "bun.lockb", packageManager: "bun" },
  { basename: "package-lock.json", packageManager: "npm" },
  { basename: "npm-shrinkwrap.json", packageManager: "npm" },
];

/** The directory a repository-relative file path sits in. `"."` for the root. */
function directoryOf(path: string): string {
  const segments = pathSegments(path);
  return segments.length <= 1 ? "." : segments.slice(0, -1).join("/");
}

/** A path inside `directory`, written the way the tree writes it. */
function within(directory: string, basename: string): string {
  return directory === "." ? basename : `${directory}/${basename}`;
}

/** `["apps/web", "apps", "."]` — the directory and every ancestor, nearest first. */
function selfAndAncestors(directory: string): string[] {
  const segments = directory === "." ? [] : pathSegments(directory);
  const chain = segments.map((_, index) => segments.slice(0, segments.length - index).join("/"));
  return [...chain, "."];
}

/**
 * Yarn's flavour, from what is beside the lockfile rather than inside it.
 *
 * Berry keeps a `.yarnrc.yml`; Yarn 1 does not. The distinction has to be made
 * before anything decides how to install, because the two share a lockfile
 * name and do not share `--frozen-lockfile`'s meaning.
 */
function yarnFlavour(context: DetectionContext, lockfileDirectory: string): LockfilePackageManager {
  const berry = selfAndAncestors(lockfileDirectory).some((directory) =>
    context.hasPath(within(directory, ".yarnrc.yml")),
  );
  return berry ? "yarn_berry" : "yarn_classic";
}

/** The nearest lockfile at or above `directory`, or null when there is none. */
function nearestLockfile(context: DetectionContext, directory: string): BuildTargetLockfile | null {
  for (const candidate of selfAndAncestors(directory)) {
    for (const { basename, packageManager } of LOCKFILES) {
      const path = within(candidate, basename);
      if (context.hasPath(path)) {
        return { path, packageManager, inTargetDirectory: candidate === directory };
      }
    }

    const yarnPath = within(candidate, "yarn.lock");
    if (context.hasPath(yarnPath)) {
      return {
        path: yarnPath,
        packageManager: yarnFlavour(context, candidate),
        inTargetDirectory: candidate === directory,
      };
    }
  }

  return null;
}

/**
 * Yarn's module resolution, or null when no Yarn lockfile applies.
 *
 * Under Plug'n'Play there is no `node_modules/.bin/`, so a framework binary
 * cannot be invoked by path. Validation is unaffected — `yarn run build`
 * resolves through `.pnp.cjs` — but a preview, which invokes the binary
 * directly, is not.
 */
function moduleLinkerFor(
  context: DetectionContext,
  directory: string,
  lockfile: BuildTargetLockfile | null,
): BuildTarget["moduleLinker"] {
  if (lockfile?.packageManager !== "yarn_berry") return null;

  const pnp = selfAndAncestors(directory).some((candidate) =>
    context.hasPath(within(candidate, ".pnp.cjs")),
  );
  return pnp ? "pnp" : "node_modules";
}

/**
 * Shallowest first, then alphabetically.
 *
 * Deterministic because the order reaches a founder: when more than one target
 * is installable the resolver offers them as a list to choose from, and a list
 * that reorders itself between two reads of the same commit is a list nobody
 * can act on.
 */
function compareTargets(left: BuildTarget, right: BuildTarget): number {
  const depth = pathSegments(left.directory).length - pathSegments(right.directory).length;
  return depth !== 0 ? depth : left.directory.localeCompare(right.directory);
}

/**
 * @param manifestsTruncated whether the analysis wanted to fetch more manifests
 * than its budget allowed. It has to be passed in because the context cannot
 * tell "this repository has three manifests" from "this repository has forty
 * and we read three" — and the difference decides whether *"exactly one
 * installable application"* is an answer or an artefact of the budget.
 */
export function detectBuildTargets(
  context: DetectionContext,
  { manifestsTruncated = false }: { manifestsTruncated?: boolean } = {},
): BuildIntelligence {
  const targets = context.packageJsons.map(({ path, parsed }): BuildTarget => {
    const directory = directoryOf(path);
    const lockfile = nearestLockfile(context, directory);

    return {
      directory,
      manifestPath: path,
      buildScript: parsed.scriptNames.includes("build"),
      frameworks: frameworksForDependencies(parsed.allDependencies),
      lockfile,
      declaresWorkspaces:
        parsed.workspaces.length > 0 || context.hasPath(within(directory, "pnpm-workspace.yaml")),
      moduleLinker: moduleLinkerFor(context, directory, lockfile),
    };
  });

  targets.sort(compareTargets);

  return {
    targets: targets.slice(0, MAX_BUILD_TARGETS),
    truncated: manifestsTruncated || targets.length > MAX_BUILD_TARGETS,
  };
}
