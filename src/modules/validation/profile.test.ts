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

describe("a repository that can honour the contract", () => {
  it("accepts one application at the root, using pnpm", () => {
    expect(resolveValidationProfile(fakeValidatableSnapshot())).toEqual({
      supported: true,
      profile: "node_build_v1",
      packageManager: "pnpm",
      workspaceRoot: ".",
      // The fixture's own framework, carried through from its build target.
      frameworks: ["nextjs"],
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

  it.each(["yarn", "bun"] as const)(
    "refuses a %s lockfile until its install is designed",
    (packageManager) => {
      // Each has its own locked-install flag, and Yarn 1 and Yarn 3+ do not share
      // theirs. Getting one subtly wrong would validate a dependency tree the
      // lockfile never described — a green tick for the wrong thing.
      expect(resolveValidationProfile(fakeValidatableSnapshot({ packageManager }))).toMatchObject({
        supported: false,
        reason: "lockfile_missing",
      });
    },
  );

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
        { workspaceRoot: "apps/api", packageManager: "pnpm", frameworks: ["express"] },
        { workspaceRoot: "apps/web", packageManager: "pnpm", frameworks: ["vite"] },
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
