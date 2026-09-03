import type { BuildIntelligence, BuildTarget } from "@/modules/repository-intelligence/schema";
import { resolveValidationProfile, type WorkspaceCandidate } from "@/modules/validation/profile";
import { fakeValidatableSnapshot } from "@/modules/validation/test-support";

/**
 * Browser fixtures for "which app should Vibe work on?" (Stufe 4).
 *
 * ## Why these come from the real resolver
 *
 * The candidate list is produced by `resolveValidationProfile`, not written by
 * hand. A hand-written list would let the screen be tested against a shape the
 * resolver never emits — and the property this screen exists to make visible is
 * precisely that **the list is Vibe's, not the founder's**. A fixture that
 * invented its own options would be testing the opposite of the guarantee.
 *
 * If the resolver stops asking for a choice on this input, the fixture throws
 * rather than rendering an empty question, and the suite fails loudly.
 *
 * ## Why a browser at all
 *
 * Two things no unit test can see. Whether a founder can tell the applications
 * apart on a screen — a list that renders two directories identically passes
 * every assertion about its data. And whether there is a text field: the
 * absence of one is the rule-57 property made visible, and an absence is only
 * an absence in a rendered DOM.
 */

function target(overrides: Partial<BuildTarget>): BuildTarget {
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

function candidatesFor(build: BuildIntelligence): readonly WorkspaceCandidate[] {
  const resolution = resolveValidationProfile(fakeValidatableSnapshot({ build }));

  if (resolution.supported || resolution.reason !== "workspace_choice_required") {
    throw new Error(
      `the workspace-choice fixture expected a choice and the resolver returned ${
        resolution.supported ? "a supported application" : resolution.reason
      }`,
    );
  }

  const candidates = resolution.candidates ?? [];
  if (candidates.length < 2) {
    throw new Error("the workspace-choice fixture expected more than one application to choose");
  }

  return candidates;
}

export const E2E_WORKSPACE_CHOICE_SCENARIOS = {
  /** Two applications, each independently installable, in one repository. */
  "workspace-choice": () =>
    candidatesFor({
      targets: [
        target({
          directory: "apps/marketing",
          manifestPath: "apps/marketing/package.json",
          frameworks: ["astro"],
          lockfile: {
            path: "apps/marketing/pnpm-lock.yaml",
            packageManager: "pnpm",
            inTargetDirectory: true,
          },
        }),
        target({
          directory: "apps/web",
          manifestPath: "apps/web/package.json",
          frameworks: ["nextjs", "react"],
          lockfile: {
            path: "apps/web/package-lock.json",
            packageManager: "npm",
            inTargetDirectory: true,
          },
        }),
      ],
      truncated: false,
    }),

  /** The same repository, after somebody answered. */
  "workspace-choice-answered": () =>
    candidatesFor({
      targets: [
        target({
          directory: "apps/marketing",
          manifestPath: "apps/marketing/package.json",
          frameworks: ["astro"],
          lockfile: {
            path: "apps/marketing/pnpm-lock.yaml",
            packageManager: "pnpm",
            inTargetDirectory: true,
          },
        }),
        target({
          directory: "apps/web",
          manifestPath: "apps/web/package.json",
          frameworks: ["nextjs", "react"],
          lockfile: {
            path: "apps/web/package-lock.json",
            packageManager: "npm",
            inTargetDirectory: true,
          },
        }),
      ],
      truncated: false,
    }),
} as const;

export type E2eWorkspaceChoiceScenario = keyof typeof E2E_WORKSPACE_CHOICE_SCENARIOS;

export function isE2eWorkspaceChoiceScenario(
  scenario: string,
): scenario is E2eWorkspaceChoiceScenario {
  return scenario in E2E_WORKSPACE_CHOICE_SCENARIOS;
}

/** Which application the answered scenario says Vibe works on. */
export const ANSWERED_WORKSPACE_ROOT = "apps/web";
