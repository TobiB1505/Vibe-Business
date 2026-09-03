import { describe, expect, it } from "vitest";
import { SANDBOX_POLICY_VERSION } from "@/modules/validation/schema";
import { EXECUTION_PRECONDITIONS, resolveExecutionValidation } from "./validation-requirements";
import { fakeSnapshot } from "./test-support";

/**
 * Required validation is derived from the real profile (EXECUTION CORE-3 §30,
 * §31, §53).
 */

describe("validation requirements (§53)", () => {
  it("derives the real profile from the repository rather than declaring one", () => {
    const requirement = resolveExecutionValidation(fakeSnapshot());

    expect(requirement.supported).toBe(true);
    if (!requirement.supported) return;
    expect(requirement.profile).toBe("node_build_v1");
    expect(requirement.profileVersion).toBe("node-build-v1");
    // Pinned to the same policy version a ValidationRun records, so a stored
    // spec can never be reinterpreted under rules it was not checked against.
    expect(requirement.sandboxPolicyVersion).toBe(SANDBOX_POLICY_VERSION);
    expect(requirement.sandboxSteps).toEqual(["install", "typecheck", "test", "build"]);
  });

  it("reports no profile for a repository with nothing Vibe can build", () => {
    // A Python service has no `package.json`, so there is no build to check a
    // change against. The refusal is about the absent contract, not about the
    // framework's name: a framework Vibe has never heard of is validated fine
    // if its manifest declares a build script and its lockfile is beside it.
    const requirement = resolveExecutionValidation(
      fakeSnapshot({
        frameworks: [{ id: "fastapi", name: "FastAPI" }],
        build: { targets: [], truncated: false },
      }),
    );

    expect(requirement.supported).toBe(false);
    if (requirement.supported) return;
    expect(requirement.reason).toBe("not_a_node_project");
  });

  it("reports no profile when the package manager is unknown", () => {
    const requirement = resolveExecutionValidation(fakeSnapshot({ packageManager: "unknown" }));
    expect(requirement.supported).toBe(false);
  });

  it("asks which application when a repository holds more than one", () => {
    // A monorepo is no longer refused for being one. The honest question was
    // never "is this a monorepo" but "how many independently installable
    // applications are there", and only the second has more than one answer.
    const requirement = resolveExecutionValidation(
      fakeSnapshot({
        monorepo: true,
        build: {
          targets: [
            {
              directory: "apps/web",
              manifestPath: "apps/web/package.json",
              buildScript: true,
              frameworks: ["nextjs"],
              lockfile: {
                path: "apps/web/pnpm-lock.yaml",
                packageManager: "pnpm",
                inTargetDirectory: true,
              },
              declaresWorkspaces: false,
              moduleLinker: null,
            },
            {
              directory: "apps/admin",
              manifestPath: "apps/admin/package.json",
              buildScript: true,
              frameworks: ["vite"],
              lockfile: {
                path: "apps/admin/pnpm-lock.yaml",
                packageManager: "pnpm",
                inTargetDirectory: true,
              },
              declaresWorkspaces: false,
              moduleLinker: null,
            },
          ],
          truncated: false,
        },
      }),
    );

    expect(requirement.supported).toBe(false);
    if (requirement.supported) return;
    expect(requirement.reason).toBe("workspace_choice_required");
  });

  it("keeps the preconditions unconditional, whether or not a profile exists", () => {
    // A missing sandbox profile relaxes nothing about paths or secrets.
    const supported = resolveExecutionValidation(fakeSnapshot());
    const unsupported = resolveExecutionValidation(fakeSnapshot({ packageManager: "yarn" }));

    expect(supported.preconditions).toEqual(EXECUTION_PRECONDITIONS);
    expect(unsupported.preconditions).toEqual(EXECUTION_PRECONDITIONS);
    expect(supported.preconditions).toContain("no_forbidden_paths_changed");
    expect(supported.preconditions).toContain("no_secret_material_introduced");
    expect(supported.preconditions).toContain("source_revision_verified");
  });

  it("names Vibe as the only validation authority (§31)", () => {
    expect(resolveExecutionValidation(fakeSnapshot()).authority).toBe("vibe_observed");
  });
});
