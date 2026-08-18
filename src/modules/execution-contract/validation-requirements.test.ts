import { describe, expect, it } from "vitest";
import { SANDBOX_POLICY_VERSION } from "@/modules/validation/schema";
import {
  EXECUTION_PRECONDITIONS,
  resolveExecutionValidation,
} from "./validation-requirements";
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
    expect(requirement.profile).toBe("nextjs_node_v1");
    expect(requirement.profileVersion).toBe("nextjs-node-v1");
    // Pinned to the same policy version a ValidationRun records, so a stored
    // spec can never be reinterpreted under rules it was not checked against.
    expect(requirement.sandboxPolicyVersion).toBe(SANDBOX_POLICY_VERSION);
    expect(requirement.sandboxSteps).toEqual(["install", "typecheck", "test", "build"]);
  });

  it("reports no profile for a framework Vibe cannot validate", () => {
    const requirement = resolveExecutionValidation(
      fakeSnapshot({ frameworks: [{ id: "fastapi", name: "FastAPI" }] }),
    );

    expect(requirement.supported).toBe(false);
    if (requirement.supported) return;
    expect(requirement.reason).toBe("validation_not_supported");
  });

  it("reports no profile when the package manager is unknown", () => {
    const requirement = resolveExecutionValidation(fakeSnapshot({ packageManager: "unknown" }));
    expect(requirement.supported).toBe(false);
  });

  it("reports an ambiguous workspace for a monorepo", () => {
    const requirement = resolveExecutionValidation(fakeSnapshot({ monorepo: true }));

    expect(requirement.supported).toBe(false);
    if (requirement.supported) return;
    expect(requirement.reason).toBe("ambiguous_workspace");
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
