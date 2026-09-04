import { describe, expect, it } from "vitest";
import { fakeBuildIntelligence } from "@/modules/repository-intelligence/test-support";
import type { BuildIntelligence, BuildTarget } from "@/modules/repository-intelligence/schema";
import { resolveValidationProfile } from "./profile";
import { fakeValidatableSnapshot } from "./test-support";

/**
 * Validation eligibility (Sprint 10A §5, §33; Stufe 4).
 *
 * Almost every case is a refusal, deliberately. A profile is a promise about
 * which commands mean what, so the interesting behaviour is the set of
 * repositories Vibe declines to make that promise about.
 *
 * What Stufe 4 changed is not how often it refuses but *what it says*. Every
 * refusal below names the missing thing, because "Vibe cannot validate this
 * project yet" is true and leaves a founder with nothing to do.
 */

function target(overrides: Partial<BuildTarget> = {}): BuildTarget {
  return {
    directory: ".",
    manifestPath: "package.json",
    buildScript: true,
    frameworks: ["nextjs", "react"],
    lockfile: { path: "pnpm-lock.yaml", packageManager: "pnpm", inTargetDirectory: true },
    declaresWorkspaces: false,
    moduleLinker: null,
    ...overrides,
  };
}

function build(targets: BuildTarget[], truncated = false): BuildIntelligence {
  return { targets, truncated };
}

/** An application inside a workspace: its lockfile is the root's, not its own. */
function member(directory: string, overrides: Partial<BuildTarget> = {}): BuildTarget {
  return target({
    directory,
    manifestPath: `${directory}/package.json`,
    lockfile: { path: "pnpm-lock.yaml", packageManager: "pnpm", inTargetDirectory: false },
    ...overrides,
  });
}

/** The root of a declared workspace. Buildable only when it says so. */
function workspaceRoot(overrides: Partial<BuildTarget> = {}): BuildTarget {
  return target({ declaresWorkspaces: true, buildScript: false, ...overrides });
}

describe("a repository that can honour the contract", () => {
  it("accepts one application at the root, using pnpm", () => {
    expect(resolveValidationProfile(fakeValidatableSnapshot())).toEqual({
      supported: true,
      profile: "node_build_v1",
      packageManager: "pnpm",
      workspaceRoot: ".",
      // Its own lockfile, so the two directories are the same one — the shape
      // every repository admitted before workspaces were.
      installRoot: ".",
      // The fixture's own framework, carried through from its build target.
      frameworks: ["nextjs"],
      // No Yarn lockfile, so Yarn's module resolution is not a question here.
      moduleLinker: null,
    });
  });

  it("accepts the same repository using npm", () => {
    expect(
      resolveValidationProfile(fakeValidatableSnapshot({ packageManager: "npm" })),
    ).toMatchObject({ supported: true, packageManager: "npm" });
  });

  /*
   * The change this whole stage exists for.
   *
   * `planValidationSteps` takes no profile, and the commands it plans are the
   * repository's own `typecheck`, `test` and `build` scripts. Requiring `next`
   * in the dependency list narrowed who could be checked without sharpening
   * what the check claimed.
   */
  it("accepts a Vite application, which the framework gate refused", () => {
    const snapshot = fakeValidatableSnapshot({
      packageManager: "npm",
      build: fakeBuildIntelligence({ packageManager: "npm", frameworks: ["vite", "react"] }),
    });

    expect(resolveValidationProfile(snapshot)).toMatchObject({
      supported: true,
      profile: "node_build_v1",
      frameworks: ["vite", "react"],
    });
  });

  it("accepts an application in a subdirectory, and says which one", () => {
    // The shape that was falsely admitted at `.` — a repository whose only
    // manifest is in `frontend/`, alongside a service in another language.
    const snapshot = fakeValidatableSnapshot({
      build: build([
        target({
          directory: "frontend",
          manifestPath: "frontend/package.json",
          lockfile: {
            path: "frontend/package-lock.json",
            packageManager: "npm",
            inTargetDirectory: true,
          },
        }),
      ]),
    });

    expect(resolveValidationProfile(snapshot)).toMatchObject({
      supported: true,
      workspaceRoot: "frontend",
      packageManager: "npm",
    });
  });

  it("carries the application's own frameworks, not the repository's union", () => {
    // A Next.js app in `frontend/` and a Python service in `backend/` reports
    // `nextjs` repository-wide. Only the chosen target can say whether *this*
    // directory is the Next.js one, and the preview downstream depends on it.
    const snapshot = fakeValidatableSnapshot({
      frameworks: [
        { id: "nextjs", name: "Next.js" },
        { id: "fastapi", name: "FastAPI" },
      ],
      build: build([target({ frameworks: ["react"] })]),
    });

    expect(resolveValidationProfile(snapshot)).toMatchObject({ frameworks: ["react"] });
  });
});

describe("refusals that name the missing thing", () => {
  it("refuses a repository with no Node manifest at all", () => {
    expect(resolveValidationProfile(fakeValidatableSnapshot({ build: build([]) }))).toEqual({
      supported: false,
      reason: "not_a_node_project",
    });
  });

  it("refuses a manifest with no build script", () => {
    // Nothing to check a change against. The refusal already existed — it fired
    // in `buildSatisfiesProfile` after a VM had been paid for.
    const snapshot = fakeValidatableSnapshot({ build: build([target({ buildScript: false })]) });

    expect(resolveValidationProfile(snapshot)).toEqual({
      supported: false,
      reason: "no_build_script",
    });
  });

  it("refuses a buildable application with no lockfile, and says where", () => {
    const snapshot = fakeValidatableSnapshot({
      build: build([
        target({ directory: "frontend", manifestPath: "frontend/package.json", lockfile: null }),
      ]),
    });

    expect(resolveValidationProfile(snapshot)).toEqual({
      supported: false,
      reason: "lockfile_missing",
      detail: { workspaceRoot: "frontend" },
    });
  });

  it("names no directory when several applications are all missing one", () => {
    // A list of directories nobody asked for is worse copy than none.
    const snapshot = fakeValidatableSnapshot({
      build: build([
        target({ directory: "apps/a", lockfile: null }),
        target({ directory: "apps/b", lockfile: null }),
      ]),
    });

    expect(resolveValidationProfile(snapshot)).toEqual({
      supported: false,
      reason: "lockfile_missing",
    });
  });

  /*
   * A workspace install is a larger promise than "this application builds".
   *
   * `npm ci` from a subdirectory fails outright, and `pnpm install
   * --frozen-lockfile` installs the *entire* workspace. Either would be a
   * different claim made without saying so, which is why an ancestor's lockfile
   * does not count as this application's.
   */
  it("refuses an application whose lockfile belongs to an ancestor", () => {
    const snapshot = fakeValidatableSnapshot({
      build: build([
        target({
          directory: "apps/web",
          manifestPath: "apps/web/package.json",
          lockfile: { path: "pnpm-lock.yaml", packageManager: "pnpm", inTargetDirectory: false },
        }),
      ]),
    });

    expect(resolveValidationProfile(snapshot)).toMatchObject({
      supported: false,
      reason: "lockfile_missing",
    });
  });

  it("refuses Yarn 1 by name, rather than calling its lockfile missing", () => {
    /*
     * Yarn 1 and Yarn 3+ share a lockfile name and do not share
     * `--frozen-lockfile`'s meaning: Yarn 1's does not reliably fail when
     * `package.json` has gained a dependency the lockfile lacks, which is the
     * "validate a dependency tree nobody committed" failure a locked install
     * exists to prevent.
     *
     * The reason matters as much as the refusal. Telling someone with a
     * `yarn.lock` in front of them that there is no lockfile is both wrong and
     * unactionable; naming Yarn 1 points at the upgrade that fixes it.
     */
    const snapshot = fakeValidatableSnapshot({
      build: build([
        target({
          lockfile: { path: "yarn.lock", packageManager: "yarn_classic", inTargetDirectory: true },
        }),
      ]),
    });

    expect(resolveValidationProfile(snapshot)).toMatchObject({
      supported: false,
      reason: "package_manager_unsupported",
    });
  });

  it.each(["yarn_berry", "bun"] as const)("accepts a %s lockfile", (packageManager) => {
    const snapshot = fakeValidatableSnapshot({
      build: build([
        target({ lockfile: { path: "lock", packageManager, inTargetDirectory: true } }),
      ]),
    });

    expect(resolveValidationProfile(snapshot)).toMatchObject({ supported: true, packageManager });
  });

  it("refuses a snapshot taken before build targets were detected", () => {
    // Not the same as "no application here". Re-analysing is the founder's to
    // start, never Vibe's (rule 60), so the reason has to be distinguishable.
    expect(resolveValidationProfile(fakeValidatableSnapshot({ build: null }))).toEqual({
      supported: false,
      reason: "repository_analysis_outdated",
    });
  });
});

describe("more than one application", () => {
  it("asks which, and offers only the ones it could actually install", () => {
    const snapshot = fakeValidatableSnapshot({
      build: build([
        target({
          directory: "apps/api",
          manifestPath: "apps/api/package.json",
          frameworks: ["express"],
        }),
        target({
          directory: "apps/web",
          manifestPath: "apps/web/package.json",
          frameworks: ["vite"],
        }),
        // Buildable but not installable — never offered as a choice.
        target({ directory: "apps/docs", manifestPath: "apps/docs/package.json", lockfile: null }),
      ]),
    });

    expect(resolveValidationProfile(snapshot)).toEqual({
      supported: false,
      reason: "workspace_choice_required",
      candidates: [
        {
          workspaceRoot: "apps/api",
          installRoot: "apps/api",
          packageManager: "pnpm",
          frameworks: ["express"],
          moduleLinker: null,
        },
        {
          workspaceRoot: "apps/web",
          installRoot: "apps/web",
          packageManager: "pnpm",
          frameworks: ["vite"],
          moduleLinker: null,
        },
      ],
    });
  });

  /*
   * A monorepo stopped being a refusal on its own.
   *
   * The honest question was never "is this a monorepo" but "how many
   * independently installable applications are there" — and one, with its own
   * lockfile, has a single answer whatever the layout is called.
   */
  it("accepts one installable application inside a declared workspace", () => {
    const snapshot = fakeValidatableSnapshot({
      monorepo: { detected: true },
      build: build([
        target({
          directory: "apps/web",
          manifestPath: "apps/web/package.json",
          lockfile: {
            path: "apps/web/pnpm-lock.yaml",
            packageManager: "pnpm",
            inTargetDirectory: true,
          },
        }),
      ]),
    });

    expect(resolveValidationProfile(snapshot)).toMatchObject({
      supported: true,
      workspaceRoot: "apps/web",
    });
  });

  it("refuses to call one target an answer when the read was incomplete", () => {
    // A repository whose manifests were not all fetched can present exactly one
    // installable application and not be one. Admitting it would run against an
    // app the founder never meant.
    const snapshot = fakeValidatableSnapshot({ build: build([target()], true) });

    expect(resolveValidationProfile(snapshot)).toMatchObject({
      supported: false,
      reason: "workspace_choice_required",
    });
  });
});

describe("a workspace root becomes a working directory", () => {
  /*
   * The detector cannot emit any of these — every directory it reports came
   * from a tree entry — and they are refused here anyway. A snapshot is stored
   * JSONB read back from the database, so by the time it arrives it is data of
   * uncertain provenance (rule 25), and the next thing that happens to
   * `workspaceRoot` is that a sandbox runs commands in it.
   */
  it.each(["../etc", "apps/../..", "/etc", "apps//web", "..", "apps/../secrets"])(
    "never resolves %s as supported",
    (directory) => {
      const snapshot = fakeValidatableSnapshot({
        build: build([target({ directory, manifestPath: `${directory}/package.json` })]),
      });

      const resolution = resolveValidationProfile(snapshot);

      expect(resolution.supported).toBe(false);
      // Discarded before it can be counted, so the answer is "no application",
      // never "one application at a path we refuse to name".
      expect(resolution).toEqual({ supported: false, reason: "not_a_node_project" });
    },
  );

  it("keeps a safe sibling when an unsafe target sits beside it", () => {
    const snapshot = fakeValidatableSnapshot({
      build: build([
        target({ directory: "../evil", manifestPath: "../evil/package.json" }),
        target({ directory: "web", manifestPath: "web/package.json" }),
      ]),
    });

    expect(resolveValidationProfile(snapshot)).toMatchObject({
      supported: true,
      workspaceRoot: "web",
    });
  });
});

describe("resolution reads structure only (§5)", () => {
  it("ignores everything except the deterministic snapshot", () => {
    // The resolver's whole signature is the snapshot. There is no opportunity,
    // no title, no evidence text and no client input to influence it — the
    // same property capability resolution has in Sprint 9.
    expect(resolveValidationProfile.length).toBe(1);
  });
});

/*
 * The narrowing ADR 0078 recorded, and the conditions under which it is lifted.
 *
 * It refused a workspace monorepo outright: one lockfile at the root,
 * applications in `apps/*`, zero installable targets, `lockfile_missing`. The
 * argument was that installing from an ancestor is a larger promise than "this
 * application builds" — which is still true, and is now made explicitly by
 * carrying the two directories separately rather than by refusing.
 */
describe("an application inside a workspace", () => {
  it("installs from the workspace root and builds in its own directory", () => {
    const snapshot = fakeValidatableSnapshot({
      build: build([workspaceRoot(), member("apps/web", { frameworks: ["nextjs"] })]),
    });

    expect(resolveValidationProfile(snapshot)).toEqual({
      supported: true,
      profile: "node_build_v1",
      packageManager: "pnpm",
      workspaceRoot: "apps/web",
      // The whole change in one field. Under ADR 0078 this repository was
      // `lockfile_missing`, because the only lockfile was somebody else's.
      installRoot: ".",
      frameworks: ["nextjs"],
      moduleLinker: null,
    });
  });

  it("offers the workspace root beside its applications when the root builds too", () => {
    /*
     * Both are honest answers and they are different promises: the root's
     * `build` orchestrates every package, an application's builds one. Vibe
     * cannot know which the founder means, and a repository that silently
     * validated the whole workspace now asks once instead — the first real
     * cases the choice screen has ever had.
     */
    const snapshot = fakeValidatableSnapshot({
      build: build([workspaceRoot({ buildScript: true }), member("apps/web")]),
    });

    const result = resolveValidationProfile(snapshot);

    expect(result).toMatchObject({ supported: false, reason: "workspace_choice_required" });
    expect(result.supported === false ? result.candidates : []).toEqual([
      expect.objectContaining({ workspaceRoot: ".", installRoot: "." }),
      expect.objectContaining({ workspaceRoot: "apps/web", installRoot: "." }),
    ]);
  });

  it("refuses an ancestor lockfile that no declaration covers", () => {
    // A lockfile above an application is not a workspace by itself. Without a
    // declaration the install would be a guess, and a guessed install produces
    // a dependency tree nobody committed.
    const snapshot = fakeValidatableSnapshot({
      build: build([workspaceRoot({ declaresWorkspaces: false }), member("apps/web")]),
    });

    expect(resolveValidationProfile(snapshot)).toMatchObject({
      supported: false,
      reason: "lockfile_missing",
    });
  });

  it("says Yarn 1 rather than a missing lockfile when the root carries one", () => {
    /*
     * The refusal that had to change with this. `unhonourable` used to read
     * `inTargetDirectory`, so a workspace whose root carries a `yarn.lock`
     * reported `lockfile_missing` — advice about committing a file that is
     * committed, to a founder looking straight at it.
     */
    const snapshot = fakeValidatableSnapshot({
      build: build([
        workspaceRoot(),
        member("apps/web", {
          lockfile: { path: "yarn.lock", packageManager: "yarn_classic", inTargetDirectory: false },
        }),
      ]),
    });

    expect(resolveValidationProfile(snapshot)).toMatchObject({
      supported: false,
      reason: "package_manager_unsupported",
    });
  });

  it("never installs from a directory outside the repository", () => {
    /*
     * The snapshot is stored JSONB by the time it is read, so it is data of
     * uncertain provenance (rule 25) even though Vibe wrote it. `installRoot`
     * becomes a sandbox working directory, so it is checked with the same
     * pattern `workspaceRoot` is — and the assertion is that the escape is not
     * a candidate, not that it was sanitized into one.
     */
    const snapshot = fakeValidatableSnapshot({
      build: build([
        workspaceRoot({ directory: "../etc", manifestPath: "../etc/package.json" }),
        member("apps/web", {
          lockfile: {
            path: "../etc/pnpm-lock.yaml",
            packageManager: "pnpm",
            inTargetDirectory: false,
          },
        }),
      ]),
    });

    expect(resolveValidationProfile(snapshot)).toMatchObject({ supported: false });
  });
});
