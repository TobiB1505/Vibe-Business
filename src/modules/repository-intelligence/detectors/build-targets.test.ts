import { describe, expect, it } from "vitest";
import { contextFrom, packageJson } from "../test-support";
import { MAX_BUILD_TARGETS, detectBuildTargets } from "./build-targets";

/**
 * Where a buildable application lives.
 *
 * The four named fixtures below are the four repositories actually connected
 * to this product, reconstructed from their stored snapshots. They are here
 * rather than in a generic shape because the whole reason this detector exists
 * is that three of the four are not what the repository-wide fields say they
 * are — and a fixture invented to exercise the code would have agreed with
 * those fields.
 */

const NEXT_DEPS = { next: "16.0.0", react: "19.0.0" };

describe("the repositories this product is actually connected to", () => {
  it("Vibe-Business — one app at the root, pnpm", () => {
    const build = detectBuildTargets(
      contextFrom([
        {
          path: "package.json",
          content: packageJson({ scripts: { build: "next build" }, dependencies: NEXT_DEPS }),
        },
        { path: "pnpm-lock.yaml" },
        { path: "next.config.ts" },
      ]),
    );

    expect(build.targets).toEqual([
      {
        directory: ".",
        manifestPath: "package.json",
        buildScript: true,
        frameworks: ["nextjs", "react"],
        lockfile: { path: "pnpm-lock.yaml", packageManager: "pnpm", inTargetDirectory: true },
        declaresWorkspaces: false,
        moduleLinker: null,
      },
    ]);
    expect(build.truncated).toBe(false);
  });

  it("Urlaubsplanung — a Vite app at the root, npm", () => {
    const build = detectBuildTargets(
      contextFrom([
        {
          path: "package.json",
          content: packageJson({
            scripts: { build: "vite build" },
            devDependencies: { vite: "6.0.0" },
            dependencies: { react: "19.0.0" },
          }),
        },
        { path: "package-lock.json" },
      ]),
    );

    expect(build.targets[0].frameworks).toEqual(["react", "vite"]);
    expect(build.targets[0].lockfile?.packageManager).toBe("npm");
    expect(build.targets[0].buildScript).toBe(true);
  });

  /*
   * The case this detector was written for.
   *
   * The repository-wide fields say `frameworks: [nextjs, fastapi, react]` and
   * `packageManager: npm`, both true. Read as though they described the root —
   * which is what the validation profile did — they say a Next.js app is at
   * `.`, and there is no manifest there at all.
   */
  it("planner-agent — the app is in frontend/, and nothing is at the root", () => {
    const build = detectBuildTargets(
      contextFrom([
        {
          path: "frontend/package.json",
          content: packageJson({ scripts: { build: "next build" }, dependencies: NEXT_DEPS }),
        },
        { path: "frontend/package-lock.json" },
        { path: "frontend/next.config.ts" },
        { path: "backend/requirements.txt", content: "fastapi==0.115.0\n" },
      ]),
    );

    expect(build.targets).toHaveLength(1);
    expect(build.targets[0].directory).toBe("frontend");
    expect(build.targets[0].manifestPath).toBe("frontend/package.json");
    expect(build.targets[0].lockfile?.inTargetDirectory).toBe(true);
  });

  it("Jandia-Arena — a frontend with no lockfile anywhere", () => {
    const build = detectBuildTargets(
      contextFrom([
        {
          path: "frontend/package.json",
          content: packageJson({
            scripts: { build: "craco build" },
            dependencies: { react: "18.0.0" },
          }),
        },
        { path: "backend/requirements.txt", content: "fastapi==0.110.0\n" },
      ]),
    );

    expect(build.targets[0].directory).toBe("frontend");
    // Buildable and not installable. Keeping those apart is what lets the
    // refusal name the missing thing instead of saying "not supported".
    expect(build.targets[0].buildScript).toBe(true);
    expect(build.targets[0].lockfile).toBeNull();
  });
});

describe("the frameworks belong to the manifest, not the repository", () => {
  it("attributes each app's own dependencies and nothing else", () => {
    const build = detectBuildTargets(
      contextFrom([
        { path: "apps/site/package.json", content: packageJson({ dependencies: NEXT_DEPS }) },
        {
          path: "apps/docs/package.json",
          content: packageJson({ devDependencies: { astro: "5.0.0" } }),
        },
      ]),
    );

    const [docs, site] = build.targets;
    expect(docs.directory).toBe("apps/docs");
    expect(docs.frameworks).toEqual(["astro"]);
    expect(site.frameworks).toEqual(["nextjs", "react"]);
  });

  it("reads a config file as nothing, because a config file is not a manifest's dependency", () => {
    // `detectFrameworks` corroborates with `vite.config.ts`; this must not,
    // or a directory would inherit a framework from a file beside it.
    const build = detectBuildTargets(
      contextFrom([
        { path: "package.json", content: packageJson({ dependencies: { react: "19.0.0" } }) },
        { path: "vite.config.ts" },
      ]),
    );

    expect(build.targets[0].frameworks).toEqual(["react"]);
  });
});

describe("which installer could honour the lockfile", () => {
  function lockfileFor(files: { path: string; content?: string }[]) {
    return detectBuildTargets(contextFrom(files)).targets[0].lockfile;
  }

  const manifest = { path: "package.json", content: packageJson({ scripts: { build: "x" } }) };

  it.each([
    ["pnpm-lock.yaml", "pnpm"],
    ["package-lock.json", "npm"],
    ["npm-shrinkwrap.json", "npm"],
    ["bun.lock", "bun"],
    ["bun.lockb", "bun"],
  ])("reads %s as %s", (basename, packageManager) => {
    expect(lockfileFor([manifest, { path: basename }])?.packageManager).toBe(packageManager);
  });

  /*
   * Yarn 1 and Yarn 3+ share a lockfile name and do not share
   * `--frozen-lockfile`'s meaning, so the distinction has to exist before
   * anything decides how to install. `.yarnrc.yml` is Berry's marker, and its
   * *existence* is the whole signal — the file may carry an `npmAuthToken`,
   * and rule 28 permits observing that it exists and forbids reading it.
   */
  it("separates Yarn Berry from Yarn 1 by the presence of .yarnrc.yml", () => {
    expect(lockfileFor([manifest, { path: "yarn.lock" }])?.packageManager).toBe("yarn_classic");
    expect(
      lockfileFor([manifest, { path: "yarn.lock" }, { path: ".yarnrc.yml" }])?.packageManager,
    ).toBe("yarn_berry");
  });

  it("records an ancestor's lockfile as not being the target's own", () => {
    const build = detectBuildTargets(
      contextFrom([
        { path: "pnpm-lock.yaml" },
        { path: "pnpm-workspace.yaml" },
        { path: "apps/web/package.json", content: packageJson({ scripts: { build: "x" } }) },
      ]),
    );

    const web = build.targets.find((target) => target.directory === "apps/web");
    expect(web?.lockfile).toEqual({
      path: "pnpm-lock.yaml",
      packageManager: "pnpm",
      inTargetDirectory: false,
    });
  });

  it("prefers the nearest lockfile over an ancestor's", () => {
    const build = detectBuildTargets(
      contextFrom([
        { path: "package-lock.json" },
        { path: "apps/web/package.json", content: packageJson({ name: "app" }) },
        { path: "apps/web/pnpm-lock.yaml" },
      ]),
    );

    const web = build.targets.find((target) => target.directory === "apps/web");
    expect(web?.lockfile).toEqual({
      path: "apps/web/pnpm-lock.yaml",
      packageManager: "pnpm",
      inTargetDirectory: true,
    });
  });
});

describe("Yarn's module resolution", () => {
  const berry = [
    { path: "package.json", content: packageJson({ scripts: { build: "x" } }) },
    { path: "yarn.lock" },
    { path: ".yarnrc.yml" },
  ];

  it("is Plug'n'Play when .pnp.cjs is in the tree", () => {
    // Under PnP there is no node_modules/.bin/, so a framework binary cannot be
    // invoked by path — validation still works, a preview does not.
    expect(
      detectBuildTargets(contextFrom([...berry, { path: ".pnp.cjs" }])).targets[0].moduleLinker,
    ).toBe("pnp");
  });

  it("is node_modules for a Berry repository without one", () => {
    expect(detectBuildTargets(contextFrom(berry)).targets[0].moduleLinker).toBe("node_modules");
  });

  it("is null when no Yarn lockfile applies, rather than a guess", () => {
    const build = detectBuildTargets(
      contextFrom([
        { path: "package.json", content: packageJson({ name: "app" }) },
        { path: "pnpm-lock.yaml" },
      ]),
    );
    expect(build.targets[0].moduleLinker).toBeNull();
  });
});

describe("what a target always is", () => {
  it("never reports a directory that escapes the repository", () => {
    // The paths come from the tree, so this cannot happen today. It is asserted
    // anyway because `directory` becomes a sandbox working directory two
    // modules downstream, and the resolver asserts the same property again —
    // the snapshot is untrusted data even though Vibe wrote it (rule 25).
    const build = detectBuildTargets(
      contextFrom([
        { path: "package.json", content: packageJson({ name: "app" }) },
        { path: "apps/web/package.json", content: packageJson({ name: "app" }) },
        { path: "a/b/c/package.json", content: packageJson({ name: "app" }) },
      ]),
    );

    // The guard on the guard: an empty list would satisfy every assertion
    // below while covering none of them.
    expect(build.targets).toHaveLength(3);

    for (const target of build.targets) {
      expect(target.directory).not.toMatch(/(^|\/)\.\.(\/|$)/);
      expect(target.directory.startsWith("/")).toBe(false);
      expect(target.directory).not.toContain("//");
      expect(target.manifestPath.endsWith("package.json")).toBe(true);
    }
  });

  it("orders shallowest first, then alphabetically, whatever order the tree arrives in", () => {
    // The order reaches a founder as a list to choose from. One that reorders
    // itself between two reads of the same commit is a list nobody can act on.
    const files = [
      { path: "apps/web/package.json", content: packageJson({ name: "web" }) },
      { path: "package.json", content: packageJson({ name: "root" }) },
      { path: "apps/api/package.json", content: packageJson({ name: "api" }) },
    ];

    const forwards = detectBuildTargets(contextFrom(files));
    const backwards = detectBuildTargets(contextFrom([...files].reverse()));

    expect(forwards.targets.map((target) => target.directory)).toEqual([
      ".",
      "apps/api",
      "apps/web",
    ]);
    expect(backwards.targets.map((target) => target.directory)).toEqual(
      forwards.targets.map((target) => target.directory),
    );
  });

  it("declares workspaces from either the field or a pnpm-workspace.yaml beside it", () => {
    const field = detectBuildTargets(
      contextFrom([{ path: "package.json", content: packageJson({ workspaces: ["apps/*"] }) }]),
    );
    const file = detectBuildTargets(
      contextFrom([
        { path: "package.json", content: packageJson({ name: "app" }) },
        { path: "pnpm-workspace.yaml" },
      ]),
    );

    expect(field.targets[0].declaresWorkspaces).toBe(true);
    expect(file.targets[0].declaresWorkspaces).toBe(true);
  });

  it("is empty for a repository with no Node manifest at all", () => {
    const build = detectBuildTargets(
      contextFrom([{ path: "requirements.txt", content: "django==5.0\n" }, { path: "manage.py" }]),
    );

    expect(build).toEqual({ targets: [], truncated: false });
  });

  it("bounds the list and says so rather than writing an unbounded array", () => {
    const files = Array.from({ length: MAX_BUILD_TARGETS + 3 }, (_, index) => ({
      path: `packages/p${String(index).padStart(3, "0")}/package.json`,
      content: packageJson({ name: `p${index}` }),
    }));

    const build = detectBuildTargets(contextFrom(files));

    expect(build.targets).toHaveLength(MAX_BUILD_TARGETS);
    expect(build.truncated).toBe(true);
  });
});

describe("an incomplete read is not an answer", () => {
  it("is truncated when the analysis could not fetch every manifest", () => {
    /*
     * The context cannot tell "this repository has one manifest" from "it has
     * forty and we read one", and the difference is the whole answer: a
     * resolver reading an under-fetched snapshot would find exactly one
     * installable application and admit it, when the app it admitted might not
     * be the one the founder meant.
     */
    const files = [
      { path: "package.json", content: packageJson({ name: "root", scripts: { build: "x" } }) },
      { path: "pnpm-lock.yaml" },
    ];

    expect(detectBuildTargets(contextFrom(files)).truncated).toBe(false);
    expect(detectBuildTargets(contextFrom(files), { manifestsTruncated: true }).truncated).toBe(
      true,
    );
  });
});
