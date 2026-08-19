import { describe, expect, it } from "vitest";
import {
  compileCompletionBudget,
  toSandboxCompletionPolicy,
} from "@/modules/execution-context/completion";
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

const policy = toSandboxCompletionPolicy({ budget: BUDGET, briefPaths: BRIEF });

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
        write("src/app/layout.tsx"),
        // Six permitted actions, then the seventh is past the LOW window.
        read("src/app/layout.tsx"),
        read("src/app/app/layout.tsx"),
        bash("echo one"),
        bash("echo two"),
        bash("echo three"),
        bash("echo four"),
        bash(`touch ${marker}`),
      ],
      markerPaths: { late: marker },
      scriptedPaths: SCRIPTED_PATHS,
      maxTurns: 14,
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
        write("src/app/layout.tsx"),
        read("src/app/layout.tsx"),
        read("src/app/app/layout.tsx"),
        read("src/app/layout.tsx"),
      ],
      scriptedPaths: SCRIPTED_PATHS,
      maxTurns: 10,
    });

    expect(outcome.result?.verificationRefusals).toBe(0);
  });

  /**
   * The loop that must never break.
   *
   * A new edit buys back the window, because an agent that is still changing
   * files has not finished. That is what makes repair possible without an
   * exemption the model has to ask for — and asking is exactly what a model
   * would learn to do if an exemption existed.
   */
  it("gives a repairing agent a fresh window on every edit", async () => {
    const marker = markerPath("repair-final");

    const outcome = await runCanary({
      completion: policy,
      script: [
        write("src/app/layout.tsx"),
        read("src/app/layout.tsx"),
        bash("echo check-one"),
        bash("echo check-two"),
        bash("echo check-three"),
        bash("echo check-four"),
        bash("echo check-five"),
        // Sixth action would exhaust the window — but this is an edit, so the
        // window resets instead.
        write("src/app/layout.tsx"),
        read("src/app/layout.tsx"),
        bash(`touch ${marker}`),
      ],
      markerPaths: { final: marker },
      scriptedPaths: SCRIPTED_PATHS,
      maxTurns: 16,
    });

    expect(outcome.result?.verificationRefusals).toBe(0);
    expect(outcome.markers.final).toBe(true);
    // A window reset, not a repair: nothing had failed.
    expect(outcome.result?.completionWindows).toBe(1);
    expect(outcome.result?.repairCycles).toBe(0);
  });

  it("stops an agent that keeps buying windows forever", async () => {
    const script = [];
    for (let cycle = 0; cycle <= BUDGET.maxCompletionWindows + 1; cycle += 1) {
      script.push(write("src/app/layout.tsx"));
      script.push(read("src/modules/somewhere-else.ts"));
      script.push(read("src/modules/somewhere-else-again.ts"));
    }

    const outcome = await runCanary({
      completion: policy,
      script,
      scriptedPaths: SCRIPTED_PATHS,
      maxTurns: 24,
    });

    expect(outcome.result?.verificationRefusals ?? 0).toBeGreaterThan(0);
    expect(outcome.result?.completionWindows ?? 0).toBeGreaterThanOrEqual(
      BUDGET.maxCompletionWindows,
    );
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
  it("reproduces run #6 without inventing a repair or a test", async () => {
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
    // The second edit reset the window. Nothing had failed, so nothing was repaired.
    expect(outcome.result?.completionWindows).toBe(1);
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

    expect(outcome.result?.completionWindows).toBe(1);
    expect(outcome.result?.repairCycles).toBe(1);
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
