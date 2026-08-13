import { describe, expect, it } from "vitest";
import { buildValidationProgress, failedPhase, type ValidationProgressInput } from "./view";
import type { SourceIntegrity, ValidationStepResult } from "./schema";

/**
 * The progress model (Sprint 10A §15, §16, §24).
 *
 * This is the whole of what the panel knows, so it is tested exhaustively: a
 * bug here is a user watching a run that finished, or a green tick over a phase
 * that never ran.
 *
 * Every case below is built from *persisted* state — status, stage, steps,
 * source integrity, failure code. Nothing derives from a workflow's internal
 * step index, which is the property that keeps product copy independent of a
 * third-party execution detail (§4).
 */

const INTEGRITY: SourceIntegrity = {
  requestedRevision: "2f05958e3410deaeb97029861abc05889139b4a7",
  revisionMode: "provider_pinned",
  gitCommitObserved: true,
  changedFilesVerified: true,
  buildIdentityFilesVerified: ["package.json"],
  buildIdentityFilesUnverified: [],
};

function step(overrides: Partial<ValidationStepResult> = {}): ValidationStepResult {
  return {
    command: "pnpm run test",
    status: "passed",
    exitCode: 0,
    durationMs: 83_900,
    outputTail: "",
    outputTruncated: false,
    skipReason: null,
    ...overrides,
  };
}

function progress(overrides: Partial<ValidationProgressInput> = {}) {
  return buildValidationProgress({
    status: "running",
    stage: "provisioning",
    steps: {},
    sourceIntegrity: null,
    failureCode: null,
    ...overrides,
  });
}

function stateOf(phases: ReturnType<typeof progress>, name: string) {
  return phases.find((phase) => phase.phase === name)?.state;
}

describe("the phases a user sees", () => {
  it("always lists the six phases in pipeline order", () => {
    expect(progress().map((phase) => phase.phase)).toEqual([
      "source",
      "install",
      "typecheck",
      "test",
      "build",
      "finalize",
    ]);
  });

  it("never invents a percentage", () => {
    // Named phases with real elapsed seconds say more and claim less. A
    // percentage would have to be guessed from a previous run's timings.
    const serialized = JSON.stringify(progress());
    expect(serialized).not.toContain("percent");
    expect(serialized).not.toContain("progress");
  });
});

describe("a run in flight (§15)", () => {
  it.each([
    ["provisioning", "source"],
    ["acquiring_source", "source"],
    ["verifying_source", "source"],
    ["securing_sandbox", "source"],
    ["installing", "install"],
    ["typechecking", "typecheck"],
    ["testing", "test"],
    ["building", "build"],
    ["collecting_results", "finalize"],
    ["cleaning_up", "finalize"],
  ])("shows %s as the %s phase being worked on", (stage, phase) => {
    const phases = progress({ stage: stage as ValidationProgressInput["stage"] });

    expect(stateOf(phases, phase)).toBe("active");
  });

  it("shows completed phases as done and later ones as still to come", () => {
    const phases = progress({
      stage: "testing",
      sourceIntegrity: INTEGRITY,
      steps: { install: step({ durationMs: 18_400 }), typecheck: step({ durationMs: 79_100 }) },
    });

    expect(stateOf(phases, "source")).toBe("passed");
    expect(stateOf(phases, "install")).toBe("passed");
    expect(stateOf(phases, "typecheck")).toBe("passed");
    expect(stateOf(phases, "test")).toBe("active");
    expect(stateOf(phases, "build")).toBe("pending");
    expect(stateOf(phases, "finalize")).toBe("pending");
  });

  it("carries the real elapsed time of each finished phase", () => {
    const phases = progress({
      stage: "testing",
      steps: { install: step({ durationMs: 18_400 }) },
    });

    expect(phases.find((phase) => phase.phase === "install")?.durationMs).toBe(18_400);
  });

  it("has a present-tense label for the phase in flight", () => {
    const phases = progress({ stage: "testing" });
    const test = phases.find((phase) => phase.phase === "test");

    expect(test?.activeLabel).toBe("Running tests");
    expect(test?.label).toBe("Tests");
  });

  it.each([
    ["installing", "Installing dependencies"],
    ["typechecking", "Checking types"],
    ["testing", "Running tests"],
    ["building", "Building application"],
  ])("says what is happening while the run is %s", (stage, expected) => {
    /**
     * The copy itself, pinned.
     *
     * This project has no component-test setup, and adding a DOM environment
     * would be new infrastructure for one panel. Extracting the derivation as a
     * pure function is what makes the UI's state testable without one: the
     * component renders `activeLabel` for whichever phase is `active` and holds
     * no logic of its own, so asserting the model here asserts what the user
     * reads.
     */
    const phases = progress({ stage: stage as ValidationProgressInput["stage"] });
    const active = phases.find((phase) => phase.state === "active");

    expect(active?.activeLabel).toBe(expected);
  });

  it("treats a queued run as in flight rather than finished", () => {
    const phases = progress({ status: "queued", stage: "provisioning" });

    expect(stateOf(phases, "build")).toBe("pending");
    expect(stateOf(phases, "build")).not.toBe("not_run");
  });
});

describe("a run that passed", () => {
  it("marks every phase done, including finalizing", () => {
    const phases = progress({
      status: "passed",
      stage: "completed",
      sourceIntegrity: INTEGRITY,
      steps: { install: step(), typecheck: step(), test: step(), build: step() },
    });

    expect(phases.every((phase) => phase.state === "passed")).toBe(true);
  });

  it("shows a phase with no script as skipped rather than passed", () => {
    const phases = progress({
      status: "passed",
      stage: "completed",
      sourceIntegrity: INTEGRITY,
      steps: {
        install: step(),
        typecheck: step({ status: "skipped", skipReason: "script_not_present", durationMs: 0 }),
        test: step(),
        build: step(),
      },
    });

    expect(stateOf(phases, "typecheck")).toBe("skipped");
  });

  it("never shows output for a phase that passed", () => {
    const phases = progress({
      status: "passed",
      stage: "completed",
      sourceIntegrity: INTEGRITY,
      steps: { build: step({ outputTail: "Compiled successfully" }) },
    });

    expect(phases.find((phase) => phase.phase === "build")?.outputTail).toBeNull();
  });
});

describe("a run that failed (§16)", () => {
  it("marks the failing phase and says the rest were not run", () => {
    const phases = progress({
      status: "failed",
      stage: "testing",
      failureCode: "validation_checks_failed",
      sourceIntegrity: INTEGRITY,
      steps: {
        install: step(),
        typecheck: step(),
        test: step({ status: "failed", exitCode: 1, outputTail: "3 tests failed" }),
      },
    });

    expect(stateOf(phases, "test")).toBe("failed");
    // Not `pending`: the run is over, so an empty circle would read as "still
    // to come" on something that will never happen.
    expect(stateOf(phases, "build")).toBe("not_run");
    expect(stateOf(phases, "finalize")).toBe("not_run");
  });

  it("surfaces the bounded output of the phase that failed", () => {
    const phases = progress({
      status: "failed",
      stage: "building",
      failureCode: "validation_checks_failed",
      sourceIntegrity: INTEGRITY,
      steps: { build: step({ status: "failed", exitCode: 1, outputTail: "Type error", outputTruncated: true }) },
    });

    const build = phases.find((phase) => phase.phase === "build");
    expect(build?.outputTail).toBe("Type error");
    expect(build?.outputTruncated).toBe(true);
  });

  it("names the phase that failed", () => {
    const phases = progress({
      status: "failed",
      stage: "typechecking",
      failureCode: "validation_checks_failed",
      sourceIntegrity: INTEGRITY,
      steps: { install: step(), typecheck: step({ status: "failed", exitCode: 2 }) },
    });

    expect(failedPhase(phases)?.label).toBe("Typecheck");
  });

  it("counts a timed-out phase as the failure", () => {
    const phases = progress({
      status: "failed",
      stage: "building",
      failureCode: "sandbox_timeout",
      sourceIntegrity: INTEGRITY,
      steps: { build: step({ status: "timed_out", exitCode: null }) },
    });

    expect(stateOf(phases, "build")).toBe("timed_out");
    expect(failedPhase(phases)?.phase).toBe("build");
  });

  it("reports no failing phase when nothing failed", () => {
    expect(failedPhase(progress({ status: "passed", stage: "completed" }))).toBeNull();
  });

  it("blames source verification only when that is what failed", () => {
    const integrityFailure = progress({
      status: "failed",
      stage: "verifying_source",
      failureCode: "source_integrity_failed",
    });
    expect(stateOf(integrityFailure, "source")).toBe("failed");

    // Provisioning never got as far as verifying anything, so a red cross
    // against source integrity would be a false statement about what was
    // checked.
    const provisioningFailure = progress({
      status: "failed",
      stage: "provisioning",
      failureCode: "sandbox_unavailable",
    });
    expect(stateOf(provisioningFailure, "source")).toBe("not_run");
  });

  it("keeps the phases that completed before the sandbox was lost", () => {
    const phases = progress({
      status: "failed",
      stage: "typechecking",
      failureCode: "sandbox_lost",
      sourceIntegrity: INTEGRITY,
      steps: { install: step() },
    });

    // The install really did happen, and saying so is the difference between a
    // diagnosable failure and "something went wrong".
    expect(stateOf(phases, "source")).toBe("passed");
    expect(stateOf(phases, "install")).toBe("passed");
    expect(stateOf(phases, "typecheck")).toBe("not_run");
  });
});

describe("recorded state outranks stage (§4)", () => {
  it("prefers a persisted phase result over what the stage claims", () => {
    // Stage is best-effort progress reporting and can lag; a recorded phase is
    // evidence that the work happened. When they disagree, the evidence wins.
    const phases = progress({
      status: "running",
      stage: "installing",
      steps: { install: step(), typecheck: step() },
    });

    expect(stateOf(phases, "typecheck")).toBe("passed");
  });
});
