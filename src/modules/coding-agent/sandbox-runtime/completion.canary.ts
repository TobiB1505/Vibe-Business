import { describe, expect, it } from "vitest";
import {
  compileCompletionBudget,
  toSandboxCompletionPolicy,
} from "@/modules/execution-context/completion";
import { verificationPlanForMode } from "@/modules/execution-context/verification";
import { markerPath, runCanary, sdkBinaryAvailable } from "./canary/harness";

/**
 * Post-implementation completion control, run against the real SDK.
 *
 * Run #5 spent 69% of its wall clock and eight of fifteen provider calls after
 * the last edit, on work that was mostly re-reading the repository. The prompt
 * already asked it to stop; asking again is not a mechanism. These tests drive
 * the mechanism through the SDK's own tool dispatch, for zero provider cost.
 *
 * The scripts below are what a model *would* have done — taken from run #5's
 * actual feed — rather than what a well-behaved one does.
 */

const BUDGET = compileCompletionBudget("low");
const BRIEF = ["src/app/layout.tsx", "src/app/app/layout.tsx"];

/*
 * The LOW plan's required checks travel with the budget (Sprint 0044).
 *
 * Without them the harness cannot tell "reading a file I changed because Vibe
 * required a diff review" from "reading a file because I am curious", which is
 * exactly the distinction run #7 needed and did not have.
 */
const policy = toSandboxCompletionPolicy({
  budget: BUDGET,
  briefPaths: BRIEF,
  requiredChecks: verificationPlanForMode("low").requiredChecks,
});

const write = (path: string) => ({ name: "Write", input: { file_path: path, content: "x\n" } });
const read = (path: string) => ({ name: "Read", input: { file_path: path } });
const bash = (command: string) => ({ name: "Bash", input: { command } });

/** Every path the scripts below write to, so the workspace has its directories. */
const SCRIPTED_PATHS = [
  ...BRIEF,
  "src/modules/execution/generators/nextjs-seo-foundations.ts",
  "src/modules/execution/generators/other.ts",
  "src/modules/somewhere-else.ts",
  "src/modules/somewhere-else-again.ts",
];

const available = sdkBinaryAvailable();
const canary = available ? describe : describe.skip;

canary("completion control", () => {
  it("lets the agent look around freely before it has written anything", async () => {
    const outcome = await runCanary({
      completion: policy,
      // Ten reads of files nowhere near the brief — the pre-edit orientation
      // PART I insists must stay possible, because the brief is evidence and
      // an agent that cannot look around cannot discover it is wrong.
      script: Array.from({ length: 10 }, (_, index) => read(`src/unrelated-${index}.ts`)),
      maxTurns: 14,
    });

    expect(outcome.result?.verificationRefusals).toBe(0);
    expect(outcome.result?.policyDecisions ?? 0).toBeGreaterThanOrEqual(10);
  });

  it("makes exploration scarce once the code is written", async () => {
    const marker = markerPath("late-explore");

    const outcome = await runCanary({
      completion: policy,
      script: [
        write("src/modules/somewhere-else.ts"),
        /*
         * Enough calls to cross the stabilisation threshold, spend the whole
         * optional allowance, and then keep going. Convergence is observed from
         * the absence of mutations, not announced — so the first few of these
         * are what move the run into `completing` in the first place.
         */
        ...Array.from({ length: 12 }, (_, index) => bash(`echo ${index}`)),
        bash(`touch ${marker}`),
      ],
      markerPaths: { late: marker },
      scriptedPaths: SCRIPTED_PATHS,
      maxTurns: 30,
    });

    expect(outcome.result?.verificationRefusals ?? 0).toBeGreaterThan(0);
    expect(outcome.markers.late).toBe(false);

    const refused = outcome.progress.entries.filter((e) => e.kind === "verification_refused");
    expect(refused[0]?.refusalReason).toBe("completion_budget_exhausted");
  });

  it("refuses a second outside-brief read after implementing, and allows the first", async () => {
    const outcome = await runCanary({
      completion: policy,
      script: [
        write("src/app/layout.tsx"),
        // Three non-mutating calls first: that is what convergence looks like
        // from outside, and the outside-brief allowance only starts there.
        bash("echo one"),
        bash("echo two"),
        bash("echo three"),
        // One is allowed — the brief can be wrong, and a single look is cheap.
        read("src/modules/execution/generators/nextjs-seo-foundations.ts"),
        // The second is the tail behaviour run #5 actually produced.
        read("src/modules/execution/generators/other.ts"),
      ],
      scriptedPaths: SCRIPTED_PATHS,
      maxTurns: 10,
    });

    const refused = outcome.progress.entries.filter((e) => e.kind === "verification_refused");
    expect(refused).toHaveLength(1);
    expect(refused[0]?.refusalReason).toBe("outside_brief_budget_exhausted");
  });

  it("does not charge brief reads against the outside-brief allowance", async () => {
    const outcome = await runCanary({
      completion: policy,
      script: [
        write("src/app/app/layout.tsx"),
        read("src/app/layout.tsx"),
        read("src/app/layout.tsx"),
        read("src/app/layout.tsx"),
      ],
      scriptedPaths: SCRIPTED_PATHS,
      maxTurns: 10,
    });

    expect(outcome.result?.verificationRefusals).toBe(0);
  });

  /**
   * Run #7's shape, against the real SDK.
   *
   * Eight files that all legitimately need the same change, each preceded by
   * the read that makes writing it possible — then a review of every one of
   * them. Under the counter this replaces, the fifth edit exhausted the window
   * and all eight reviews were refused.
   */
  it("charges an eight-file change nothing, and allows reviewing all of it", async () => {
    const marker = markerPath("wide-change-final");
    const pages = [
      "src/app/layout.tsx",
      "src/app/page.tsx",
      "src/app/login/page.tsx",
      "src/app/signup/page.tsx",
      "src/app/forgot-password/page.tsx",
      "src/app/reset-password/page.tsx",
      "src/app/privacy/page.tsx",
      "src/app/terms/page.tsx",
    ];

    const outcome = await runCanary({
      completion: policy,
      script: [
        ...pages.flatMap((path) => [read(path), write(path)]),
        ...pages.map((path) => read(path)),
        bash(`touch ${marker}`),
      ],
      markerPaths: { final: marker },
      scriptedPaths: [...SCRIPTED_PATHS, ...pages],
      maxTurns: 40,
    });

    expect(outcome.result?.verificationRefusals).toBe(0);
    expect(outcome.result?.implementationMutations).toBe(8);
    expect(outcome.result?.convergenceMutations).toBe(0);
    expect(outcome.result?.repairCycles).toBe(0);
    // Every one of the eight reviews was recognised as required work.
    expect(outcome.result?.requiredVerificationActions).toBe(8);
    expect(outcome.markers.final).toBe(true);
  });

  /**
   * The priority that run #7 did not have.
   *
   * The optional budget is spent to exhaustion, and then the agent reads a file
   * it changed. That read is the LOW plan's own required diff review, so no
   * Vibe resource budget may refuse it — while an unrelated read at the same
   * moment still is.
   */
  it("allows a required diff review past an exhausted budget, and refuses an unrelated read", async () => {
    const allowed = markerPath("diff-review-allowed");
    const refusedMarker = markerPath("unrelated-refused");

    const outcome = await runCanary({
      completion: policy,
      script: [
        write("src/app/layout.tsx"),
        ...Array.from({ length: 12 }, (_, index) => bash(`echo spend-${index}`)),
        read("src/app/layout.tsx"),
        bash(`touch ${allowed}`),
        read("src/modules/somewhere-else.ts"),
        bash(`touch ${refusedMarker}`),
      ],
      markerPaths: { allowed, refused: refusedMarker },
      scriptedPaths: SCRIPTED_PATHS,
      maxTurns: 40,
    });

    const reasons = outcome.progress.entries
      .filter((entry) => entry.kind === "verification_refused")
      .map((entry) => entry.refusalReason);

    // The diff review ran; the optional reads around it did not.
    expect(outcome.result?.requiredVerificationActions ?? 0).toBeGreaterThanOrEqual(1);
    expect(outcome.result?.requiredVerificationOverrides ?? 0).toBeGreaterThanOrEqual(1);
    expect(reasons).toContain("completion_budget_exhausted");
  });

  it("bounds how many times one changed file may be re-read", async () => {
    const outcome = await runCanary({
      completion: policy,
      script: [
        write("src/app/layout.tsx"),
        ...Array.from({ length: BUDGET.maxDiffReviewReadsPerPath + 2 }, () =>
          read("src/app/layout.tsx"),
        ),
      ],
      scriptedPaths: SCRIPTED_PATHS,
      maxTurns: 20,
    });

    const reasons = outcome.progress.entries
      .filter((entry) => entry.kind === "verification_refused")
      .map((entry) => entry.refusalReason);

    expect(reasons).toContain("diff_review_scope_exhausted");
  });

  it("stops an agent that converges and reopens forever", async () => {
    const script = [];
    for (let cycle = 0; cycle <= BUDGET.maxConvergenceWindows + 1; cycle += 1) {
      script.push(write("src/modules/somewhere-else.ts"));
      for (let call = 0; call <= BUDGET.implementationStabilisationCalls; call += 1) {
        script.push(bash(`echo cycle-${cycle}-${call}`));
      }
    }

    const outcome = await runCanary({
      completion: policy,
      script,
      scriptedPaths: SCRIPTED_PATHS,
      maxTurns: 60,
    });

    const reasons = outcome.progress.entries
      .filter((entry) => entry.kind === "verification_refused")
      .map((entry) => entry.refusalReason);

    expect(reasons.length).toBeGreaterThan(0);
    expect(outcome.result?.convergenceMutations ?? 0).toBeGreaterThanOrEqual(1);
    // It never failed at anything, so it never repaired anything either.
    expect(outcome.result?.repairCycles).toBe(0);
  });

  /**
   * Run #6's exact shape, replayed.
   *
   * Two ordinary implementation edits and a grep that mentions test filenames.
   * The old build recorded a repair cycle for the second edit and a targeted
   * test for the grep; neither happened. Both are now counted for what they are.
   */
  it("reproduces run #6 without inventing a repair, a window or a test", async () => {
    const outcome = await runCanary({
      completion: policy,
      script: [
        write("src/app/layout.tsx"),
        write("src/app/app/layout.tsx"),
        read("src/app/layout.tsx"),
        bash(
          'grep -rn "robots" src/app/landing-contract.test.ts 2>/dev/null; find . -iname "*metadata*.test.*"',
        ),
      ],
      scriptedPaths: SCRIPTED_PATHS,
      maxTurns: 12,
    });

    expect(outcome.result?.verificationRefusals).toBe(0);
    // Two implementation edits. Nothing converged, nothing was repaired.
    expect(outcome.result?.implementationMutations).toBe(2);
    expect(outcome.result?.convergenceMutations).toBe(0);
    expect(outcome.result?.repairCycles).toBe(0);
    // And a grep that merely names test files is not a test run.
    expect(outcome.result?.verificationCommands).toBe(0);
  });

  it("counts a mutation after a real failure as a repair", async () => {
    const outcome = await runCanary({
      completion: policy,
      script: [
        write("src/app/layout.tsx"),
        // A command that exits non-zero: the harness observes the failure.
        bash("exit 3"),
        write("src/app/layout.tsx"),
      ],
      scriptedPaths: SCRIPTED_PATHS,
      maxTurns: 10,
    });

    expect(outcome.result?.repairCycles).toBe(1);
    expect(outcome.result?.convergenceMutations).toBe(0);
  });

  it("permits everything when no completion policy was supplied", async () => {
    const marker = markerPath("no-completion-policy");

    const outcome = await runCanary({
      script: [
        write("src/app/layout.tsx"),
        ...Array.from({ length: 8 }, (_, i) => read(`src/elsewhere-${i}.ts`)),
        bash(`touch ${marker}`),
      ],
      markerPaths: { late: marker },
      scriptedPaths: SCRIPTED_PATHS,
      maxTurns: 16,
    });

    expect(outcome.result?.verificationRefusals).toBe(0);
    expect(outcome.markers.late).toBe(true);
  });
});
