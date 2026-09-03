import { describe, expect, it } from "vitest";
import type { ProfileResolution, WorkspaceCandidate } from "./profile";
import { selectValidationTarget } from "./workspace";

/**
 * Applying the founder's answer to "which application?".
 *
 * The safety claim here is narrow and worth stating exactly: an answer that is
 * not one of Vibe's own candidates changes nothing, **because it is not one of
 * them** — not because a pattern rejected it. Several tests below assert that
 * distinction rather than the outcome, because a future implementation that
 * sanitized a path and then used it would pass an outcome test and lose the
 * property.
 */

function candidate(overrides: Partial<WorkspaceCandidate> = {}): WorkspaceCandidate {
  return {
    workspaceRoot: "apps/web",
    packageManager: "pnpm",
    frameworks: ["nextjs"],
    moduleLinker: null,
    ...overrides,
  };
}

function choice(candidates: WorkspaceCandidate[]): ProfileResolution {
  return { supported: false, reason: "workspace_choice_required", candidates };
}

describe("the answer picks from Vibe's list", () => {
  it("resolves the candidate it names", () => {
    const resolution = choice([
      candidate({ workspaceRoot: "apps/api", frameworks: ["express"] }),
      candidate({ workspaceRoot: "apps/web", packageManager: "npm" }),
    ]);

    expect(selectValidationTarget(resolution, "apps/web")).toEqual({
      supported: true,
      profile: "node_build_v1",
      packageManager: "npm",
      workspaceRoot: "apps/web",
      frameworks: ["nextjs"],
      moduleLinker: null,
    });
  });

  it("carries that application's own package manager, not the other's", () => {
    const resolution = choice([
      candidate({ workspaceRoot: "apps/api", packageManager: "npm" }),
      candidate({ workspaceRoot: "apps/web", packageManager: "pnpm" }),
    ]);

    expect(selectValidationTarget(resolution, "apps/api")).toMatchObject({
      packageManager: "npm",
    });
  });

  it("keeps asking when no answer has been given", () => {
    const resolution = choice([candidate()]);
    expect(selectValidationTarget(resolution, null)).toBe(resolution);
  });
});

describe("an answer that is not a candidate changes nothing", () => {
  /*
   * The property, asserted as a mechanism.
   *
   * Each of these is refused because the candidate list does not contain it.
   * The path shape is checked too — in the resolver, and again by a database
   * constraint — and neither of those is what makes this safe. A test that only
   * asserted `supported: false` would still pass against an implementation that
   * sanitized the string and joined it, which is the implementation this
   * function exists not to be.
   */
  it.each([
    "../secrets",
    "/etc",
    "apps/../..",
    "apps/web/..",
    "apps//web",
    "APPS/WEB",
    "apps/web/",
    "./apps/web",
    "",
  ])("refuses %s", (chosen) => {
    const resolution = choice([candidate({ workspaceRoot: "apps/web" })]);

    expect(selectValidationTarget(resolution, chosen)).toBe(resolution);
  });

  it("refuses a directory that exists in the repository but was not offered", () => {
    // The strongest form of the claim: `apps/api` is a real directory with a
    // real manifest, and it is still refused — because this resolution's
    // candidates did not include it. Only Vibe's own list decides.
    const resolution = choice([candidate({ workspaceRoot: "apps/web" })]);

    expect(selectValidationTarget(resolution, "apps/api")).toBe(resolution);
  });

  it("returns the very same object, so nothing downstream can read a half-answer", () => {
    const resolution = choice([candidate()]);
    const result = selectValidationTarget(resolution, "../etc");

    expect(result).toBe(resolution);
    expect(result.supported).toBe(false);
  });
});

describe("it can only ever narrow", () => {
  const supported: ProfileResolution = {
    supported: true,
    profile: "node_build_v1",
    packageManager: "pnpm",
    workspaceRoot: ".",
    frameworks: ["nextjs"],
    moduleLinker: null,
  };

  it.each([".", "apps/web", "../etc", ""])(
    "leaves an already-resolved application alone when told %s",
    (chosen) => {
      // The founder's answer decides *between* candidates. There is nothing to
      // decide when Vibe found one application, and an answer that could move a
      // resolved root would be an answer that could move it anywhere.
      expect(selectValidationTarget(supported, chosen)).toBe(supported);
    },
  );

  it.each([
    "not_a_node_project",
    "no_build_script",
    "lockfile_missing",
    "package_manager_unsupported",
    "repository_analysis_outdated",
  ] as const)("leaves a %s refusal alone", (reason) => {
    // None of these is a question about which application. An answer must not
    // turn "there is no build script" into a run.
    const resolution: ProfileResolution = { supported: false, reason };

    expect(selectValidationTarget(resolution, "apps/web")).toBe(resolution);
  });

  it("refuses a choice-shaped refusal that carries no candidates", () => {
    // Cannot be produced by the resolver, and asserted anyway: an empty list
    // means Vibe named nothing, and an answer against nothing is an answer
    // nobody's list contains.
    const resolution: ProfileResolution = {
      supported: false,
      reason: "workspace_choice_required",
    };

    expect(selectValidationTarget(resolution, "apps/web")).toBe(resolution);
  });
});
