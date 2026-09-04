import type {
  BuildTarget,
  BuildTargetLockfile,
  RepositoryIntelligenceSnapshot,
} from "@/modules/repository-intelligence/schema";
import {
  CURRENT_VALIDATION_PROFILE,
  PACKAGE_MANAGERS,
  type SupportedPackageManager,
  type ValidationBlockReason,
  type ValidationProfile,
} from "./schema";

/**
 * Which repositories Vibe is willing to validate (Sprint 10A §5; Stufe 4).
 *
 * ## Refusing is still the feature. Refusing *by name* is the new part.
 *
 * A validation profile is a promise: *these exact commands, in this exact
 * environment, mean this exact thing.* Supporting "most repositories" would
 * turn that into a guess, and a guessed command sequence produces a verdict
 * nobody should act on — a green tick that means "some commands exited zero"
 * is worse than no tick at all.
 *
 * What changed is what the promise is keyed on. It used to require `next` in
 * the dependency list, which narrowed who could be checked without sharpening
 * what the check claimed: `planValidationSteps` takes no profile, and the
 * commands it plans are the repository's own scripts either way. Now the
 * requirement is the contract those commands genuinely need — a manifest with a
 * `build` script, and a lockfile beside it that Vibe can install from exactly.
 *
 * And every refusal names the missing thing. "Vibe cannot validate this project
 * yet" is true and useless; "there is no lockfile in `frontend/`" is something
 * a founder can act on in a minute.
 *
 * ## Refusing early is worth money
 *
 * Two of these refusals already existed — `orchestrator.readPlan` fails a run
 * whose sandbox holds no manifest, and `buildSatisfiesProfile` fails one whose
 * build never ran. Both fire *after* a VM is provisioned and the source
 * verified: roughly $0.02–0.06 and five minutes to learn something the stored
 * snapshot already knew. Nothing here forbids more than those did. It only
 * says so before the meter starts.
 *
 * ## Structure only
 *
 * Resolution reads the deterministic repository snapshot — build targets, their
 * lockfiles, their own frameworks. It never reads an opportunity's title,
 * problem text or any other model output, for the same reason capability
 * resolution does not (Sprint 9 §7): **model wording is not a machine API.**
 * `profile.test.ts` asserts this function takes exactly one argument, so there
 * is no second input for such a thing to arrive through.
 */

/** One application a founder could be asked to pick. */
export type WorkspaceCandidate = {
  /** Repository-relative directory the commands would run in. */
  workspaceRoot: string;
  /**
   * Repository-relative directory the install would run in.
   *
   * Equal to `workspaceRoot` for an application with its own lockfile, and the
   * workspace root above it otherwise. Carried on the candidate rather than
   * re-derived after the choice, so the answer a founder gives resolves to the
   * exact pair Vibe computed when it offered it.
   */
  installRoot: string;
  packageManager: SupportedPackageManager;
  /** Framework ids from this application's own manifest. */
  frameworks: readonly string[];
  /** Yarn's module resolution, which decides whether a preview can start. */
  moduleLinker: BuildTarget["moduleLinker"];
};

export type ProfileResolution =
  | {
      supported: true;
      profile: ValidationProfile;
      packageManager: SupportedPackageManager;
      /** Repository-relative directory the commands run in. `.` for a single-app repo. */
      workspaceRoot: string;
      /**
       * Repository-relative directory the install runs in.
       *
       * The same directory for an application with its own lockfile — every
       * repository admitted before workspaces were — and an ancestor for an
       * application installed from a workspace root. Separate from
       * `workspaceRoot` because they are separate facts, and because a pass
       * that does not record where it installed does not say what it checked.
       */
      installRoot: string;
      /** This application's own frameworks — never the repository-wide union. */
      frameworks: readonly string[];
      /**
       * Yarn's module resolution, or null when no Yarn lockfile applies.
       *
       * Carried because a preview needs it: under Plug'n'Play there is no
       * `node_modules/.bin/`, so a framework binary cannot be invoked by path.
       * Validation is unaffected — `yarn run build` resolves through `.pnp.cjs`.
       */
      moduleLinker: BuildTarget["moduleLinker"];
    }
  | {
      supported: false;
      reason: ValidationBlockReason;
      /** Present only for `workspace_choice_required`, and never empty when present. */
      candidates?: readonly WorkspaceCandidate[];
      /**
       * Which directory the refusal is about, when there is exactly one.
       *
       * Structured rather than interpolated into a sentence: the copy layer
       * writes the sentence, and a message assembled here would be a string
       * built from repository-derived text (rule 25).
       */
      detail?: { workspaceRoot: string };
    };

/** The directory a repository-relative path sits in. `"."` for the root. */
function directoryOf(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "." : path.slice(0, index);
}

/** Whether `ancestor` contains `directory`, itself included. */
function contains(ancestor: string, directory: string): boolean {
  if (ancestor === ".") return true;
  return directory === ancestor || directory.startsWith(`${ancestor}/`);
}

/**
 * Which directories are workspace roots an install may run from.
 *
 * Just the declaration — and the reason that is enough is worth writing down,
 * because a second condition was written here first and turned out to be dead.
 * It required a further manifest below the declaring directory, on the
 * argument that a declaration alone over-claims. It does over-claim, but not
 * *here*: this set is consulted only for an application whose lockfile is an
 * ancestor's, and such an application is itself a manifest below that
 * ancestor. The condition was true every time it was evaluated.
 *
 * So the over-claim is fixed where it lives instead. `declaresWorkspaces` now
 * reads `pnpm-workspace.yaml`'s `packages:` key rather than the file's
 * existence (`ANALYZER_VERSION` v7), which is what makes this one line an
 * honest test rather than a hopeful one.
 */
function workspaceRootsIn(targets: readonly BuildTarget[]): ReadonlySet<string> {
  return new Set(
    targets.filter((target) => target.declaresWorkspaces).map((target) => target.directory),
  );
}

/**
 * Where this application would be installed from, or null if nowhere.
 *
 * Two shapes resolve. A lockfile in the application's own directory installs
 * there, which is every repository admitted before this existed. A lockfile at
 * a **declared workspace root above it** installs there instead, and the
 * application's own directory is where everything after install runs.
 *
 * ADR 0078 refused the second shape, on the argument that `npm ci` from a
 * subdirectory fails and `pnpm install --frozen-lockfile` installs the whole
 * workspace — a larger promise made without saying so. Both halves are still
 * true; what changed is that the promise is now *said*, because the two
 * directories are separate values that reach the transcript, the identity and
 * the database. Install happens at the workspace root because that is where a
 * workspace install happens; nothing pretends otherwise.
 */
function applicableLockfile(
  target: BuildTarget,
  workspaceRoots: ReadonlySet<string>,
): { lockfile: BuildTargetLockfile; installRoot: string } | null {
  const lockfile = target.lockfile;
  if (!lockfile) return null;

  if (lockfile.inTargetDirectory) return { lockfile, installRoot: target.directory };

  const installRoot = directoryOf(lockfile.path);

  // Checked here as well as on the target's own directory. `installRoot` is
  // derived from a stored path and becomes a sandbox working directory, so it
  // gets the same treatment `workspaceRoot` gets (rule 25).
  if (!isSafeDirectory(installRoot)) return null;
  if (!workspaceRoots.has(installRoot)) return null;
  if (!contains(installRoot, target.directory)) return null;

  return { lockfile, installRoot };
}

/**
 * The installer for an applicable lockfile, or null when none can honour it.
 *
 * `yarn_classic` is the one lockfile deliberately absent from the union: Yarn 1
 * shares the lockfile name with Berry and does not share `--frozen-lockfile`'s
 * meaning. It is refused by name rather than installed with a flag that means
 * something weaker than it looks.
 */
function installerFor(lockfile: BuildTargetLockfile): SupportedPackageManager | null {
  return (PACKAGE_MANAGERS as readonly string[]).includes(lockfile.packageManager)
    ? (lockfile.packageManager as SupportedPackageManager)
    : null;
}

/**
 * The last line of defence on a path that becomes a working directory.
 *
 * The detector cannot emit one of these — every directory it reports came from
 * a tree entry — and it is checked again here anyway. A snapshot is stored
 * JSONB that reached this process from the database, so by the time it is read
 * it is data of uncertain provenance (rule 25), and the next thing that happens
 * to `workspaceRoot` is that a sandbox runs commands in it.
 */
function isSafeDirectory(directory: string): boolean {
  if (directory === ".") return true;

  return (
    /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/.test(directory) && !directory.split("/").includes("..")
  );
}

export function resolveValidationProfile(
  snapshot: RepositoryIntelligenceSnapshot,
): ProfileResolution {
  // A snapshot taken before this check existed cannot answer it. Refusing is
  // right and re-analysing is the founder's to start, never Vibe's (rule 60).
  if (!snapshot.build) return { supported: false, reason: "repository_analysis_outdated" };

  const targets = snapshot.build.targets.filter((target) => isSafeDirectory(target.directory));
  if (targets.length === 0) return { supported: false, reason: "not_a_node_project" };

  const buildable = targets.filter((target) => target.buildScript);
  if (buildable.length === 0) return { supported: false, reason: "no_build_script" };

  const workspaceRoots = workspaceRootsIn(targets);

  const applicable = buildable.flatMap((target) => {
    const found = applicableLockfile(target, workspaceRoots);
    return found === null ? [] : [{ target, ...found }];
  });

  const installable = applicable.flatMap(({ target, lockfile, installRoot }) => {
    const packageManager = installerFor(lockfile);
    return packageManager === null ? [] : [{ target, packageManager, installRoot }];
  });

  if (installable.length === 0) {
    // One buildable application names its directory, so the refusal can say
    // where the lockfile is missing from. Several would be a list nobody asked
    // for, and the copy stays general.
    const only = buildable.length === 1 ? buildable[0] : null;

    /*
     * A lockfile that exists and cannot be honoured is a different sentence.
     *
     * "There is no lockfile" tells someone with a `yarn.lock` in front of them
     * that Vibe cannot see their file, which is both wrong and unactionable.
     * The reason has to distinguish "commit a lockfile" from "this is Yarn 1,
     * and Yarn 3+ works".
     */
    /*
     * A lockfile that applies and cannot be honoured — Yarn 1 — is a different
     * sentence from no lockfile at all, and `applicable` is what decides it now
     * rather than `inTargetDirectory`. A workspace whose root carries a
     * `yarn.lock` with no `.yarnrc.yml` is the case that made the difference
     * visible: every application under it has a lockfile, none is its own, and
     * "commit a lockfile" would be advice about a file already committed.
     */
    const unhonourable = applicable.length > 0;
    return {
      supported: false,
      reason: unhonourable ? "package_manager_unsupported" : "lockfile_missing",
      ...(only ? { detail: { workspaceRoot: only.directory } } : {}),
    };
  }

  /*
   * More than one, or an answer the analysis admits might be incomplete.
   *
   * `truncated` matters as much as the count: a repository whose manifests were
   * not all read could present exactly one installable application and not be
   * one. Treating that as an answer would admit an app the founder never meant.
   */
  if (installable.length > 1 || snapshot.build.truncated) {
    return {
      supported: false,
      reason: "workspace_choice_required",
      candidates: installable.map(({ target, packageManager, installRoot }) => ({
        workspaceRoot: target.directory,
        installRoot,
        packageManager,
        frameworks: target.frameworks,
        moduleLinker: target.moduleLinker,
      })),
    };
  }

  const [{ target, packageManager, installRoot }] = installable;

  return {
    supported: true,
    profile: CURRENT_VALIDATION_PROFILE,
    packageManager,
    workspaceRoot: target.directory,
    installRoot,
    frameworks: target.frameworks,
    moduleLinker: target.moduleLinker,
  };
}
