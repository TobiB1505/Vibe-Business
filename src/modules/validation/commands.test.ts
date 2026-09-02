import { describe, expect, it } from "vitest";
import { describeCommand, installCommand, planValidationSteps } from "./commands";

/**
 * Command construction (Sprint 10A §12, §13, §19).
 *
 * The property under test is that a shell command cannot originate anywhere
 * except this module. A repository path could not come from model prose in
 * Sprint 9; a command has strictly more authority than a path.
 */

const scriptsOf = (...names: string[]) => names;

describe("install is locked and script-free (§11)", () => {
  it("uses pnpm's frozen lockfile install", () => {
    expect(installCommand("pnpm")).toEqual({
      command: "pnpm",
      args: ["install", "--frozen-lockfile", "--ignore-scripts"],
    });
  });

  it("uses npm's clean install", () => {
    expect(installCommand("npm")).toEqual({ command: "npm", args: ["ci", "--ignore-scripts"] });
  });

  it.each(["pnpm", "npm"] as const)("never lets %s modify the lockfile", (packageManager) => {
    const rendered = describeCommand(installCommand(packageManager));

    expect(rendered).not.toContain("--no-frozen-lockfile");
    expect(rendered).not.toContain("update");
    expect(rendered).not.toContain("--force");
  });

  it.each(["pnpm", "npm"] as const)("suppresses lifecycle scripts for %s", (packageManager) => {
    // Install is the one step that runs with network access. A dependency's
    // postinstall hook is the classic supply-chain execution point.
    expect(describeCommand(installCommand(packageManager))).toContain("--ignore-scripts");
  });
});

describe("step planning (§12, §19)", () => {
  it("plans install, typecheck, test and build when all scripts exist", () => {
    const plan = planValidationSteps({
      packageManager: "pnpm",
      scripts: scriptsOf("typecheck", "test", "build"),
    });

    expect(plan.map((entry) => entry.step)).toEqual(["install", "typecheck", "test", "build"]);
    expect(plan.every((entry) => entry.run)).toBe(true);
  });

  it("orders the cheapest, most specific signal first", () => {
    // Typecheck before test before build, so a broken change fails with a
    // useful message rather than after a four-minute build.
    const plan = planValidationSteps({
      packageManager: "pnpm",
      scripts: scriptsOf("build", "test", "typecheck"),
    });

    expect(plan.map((entry) => entry.step)).toEqual(["install", "typecheck", "test", "build"]);
  });

  it("skips a step whose script does not exist, with a reason", () => {
    const plan = planValidationSteps({ packageManager: "pnpm", scripts: scriptsOf("build") });
    const test = plan.find((entry) => entry.step === "test");

    expect(test).toEqual({ step: "test", run: false, reason: "script_not_present" });
  });

  it("never invents a test command", () => {
    // `npm test` on a repository with no test script exits non-zero. Reporting
    // that as a failure would be reporting a failure the user cannot act on.
    const plan = planValidationSteps({ packageManager: "npm", scripts: scriptsOf("build") });
    const rendered = plan
      .filter((entry) => entry.run)
      .map((entry) => describeCommand(entry.command));

    expect(rendered.some((command) => /\btest\b/.test(command))).toBe(false);
  });

  it("accepts either spelling of a typecheck script", () => {
    const plan = planValidationSteps({
      packageManager: "pnpm",
      scripts: scriptsOf("type-check", "build"),
    });
    const typecheck = plan.find((entry) => entry.step === "typecheck");

    expect(typecheck?.run).toBe(true);
    if (!typecheck?.run) return;
    expect(describeCommand(typecheck.command)).toBe("pnpm run type-check");
  });

  it("treats an existing test script as required", () => {
    // Present but red is a real failure. It must not be softened into "skipped".
    const plan = planValidationSteps({
      packageManager: "pnpm",
      scripts: scriptsOf("test", "build"),
    });
    const test = plan.find((entry) => entry.step === "test");

    expect(test?.run).toBe(true);
    if (!test?.run) return;
    expect(test.required).toBe(true);
  });
});

describe("commands are structured, never shell strings (§13)", () => {
  it("keeps arguments as a real array", () => {
    // No shell parses this, so there is no place for injection even if a value
    // were ever attacker-influenced.
    const plan = planValidationSteps({ packageManager: "pnpm", scripts: scriptsOf("build") });

    for (const entry of plan) {
      if (!entry.run) continue;
      expect(Array.isArray(entry.command.args)).toBe(true);
      expect(entry.command.command).not.toMatch(/[;&|><$`]/);
      for (const arg of entry.command.args) expect(arg).not.toMatch(/[;&|><$`]/);
    }
  });

  it("runs a script by name rather than by its contents", () => {
    // `pnpm run build` names the script; the repository's own definition of it
    // stays inside the sandbox and never reaches a Vibe execution API.
    const plan = planValidationSteps({
      packageManager: "pnpm",
      scripts: scriptsOf("build"),
    });
    const build = plan.find((entry) => entry.step === "build");

    expect(build?.run).toBe(true);
    if (!build?.run) return;
    expect(build.command.args).toEqual(["run", "build"]);
  });

  it("produces the same plan regardless of script declaration order", () => {
    const forward = planValidationSteps({
      packageManager: "pnpm",
      scripts: ["build", "test", "typecheck"],
    });
    const reversed = planValidationSteps({
      packageManager: "pnpm",
      scripts: ["typecheck", "test", "build"],
    });

    expect(JSON.stringify(forward)).toBe(JSON.stringify(reversed));
  });
});
