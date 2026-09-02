import type {
  BuildTarget,
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
  packageManager: SupportedPackageManager;
  /** Framework ids from this application's own manifest. */
  frameworks: readonly string[];
};

export type ProfileResolution =
  | {
      supported: true;
      profile: ValidationProfile;
      packageManager: SupportedPackageManager;
      /** Repository-relative directory the commands run in. `.` for a single-app repo. */
      workspaceRoot: string;
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

/**
 * A directory is only installable if the lockfile is its own.
 *
 * An ancestor's lockfile means a workspace install, and that means something
 * different in every package manager: `npm ci` from a subdirectory fails
 * outright, and `pnpm install --frozen-lockfile` installs the *entire*
 * workspace — a larger promise than "this application builds", made without
 * saying so. Refusing is the honest answer until that promise is designed.
 */
function installerFor(target: BuildTarget): SupportedPackageManager | null {
  if (!target.lockfile?.inTargetDirectory) return null;

  const { packageManager } = target.lockfile;
  // `yarn_classic` is the one lockfile deliberately absent from the union: Yarn
  // 1 shares the lockfile name with Berry and does not share
  // `--frozen-lockfile`'s meaning. It is refused by name below rather than
  // installed with a flag that means something weaker than it looks.
  return (PACKAGE_MANAGERS as readonly string[]).includes(packageManager)
    ? (packageManager as SupportedPackageManager)
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

  const installable = buildable.flatMap((target) => {
    const packageManager = installerFor(target);
    return packageManager === null ? [] : [{ target, packageManager }];
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
    const unhonourable = buildable.some((target) => target.lockfile?.inTargetDirectory);
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
      candidates: installable.map(({ target, packageManager }) => ({
        workspaceRoot: target.directory,
        packageManager,
        frameworks: target.frameworks,
      })),
    };
  }

  const [{ target, packageManager }] = installable;

  return {
    supported: true,
    profile: CURRENT_VALIDATION_PROFILE,
    packageManager,
    workspaceRoot: target.directory,
    frameworks: target.frameworks,
    moduleLinker: target.moduleLinker,
  };
}
