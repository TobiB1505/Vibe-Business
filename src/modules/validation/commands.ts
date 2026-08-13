import type { SupportedPackageManager, ValidationStepName } from "./schema";

/**
 * Which commands run, and where they may come from (Sprint 10A §12, §13).
 *
 * ## The rule
 *
 * **Vibe constructs every command. Nothing else may.**
 *
 * Not the opportunity's title, not its problem text, not evidence, not model
 * output, not client input. A repository path could not come from model prose
 * in Sprint 9 (`execution/paths.ts`); a *shell command* has strictly more
 * authority than a path, so the same rule applies with less room for
 * exceptions.
 *
 * Commands are therefore built from three deterministic inputs — the profile,
 * the package manager, and which scripts genuinely exist in `package.json` —
 * and are represented as `{ command, args[] }`, never as a string to be parsed
 * by a shell. There is no interpolation point for an attacker to reach.
 *
 * ## Repository scripts are still untrusted
 *
 * `pnpm build` runs whatever the repository put in its `build` script. That is
 * unavoidable — it is the thing being validated — and it is exactly why every
 * one of these runs inside the sandbox and never through any Vibe runtime
 * execution API (§13).
 *
 * ## No invented scripts
 *
 * If `package.json` has no `test` script, the test step is `skipped` with
 * reason `script_not_present`. It is never turned into `npm test`, which would
 * exit non-zero on a repository that simply never had tests and report a
 * failure the user cannot act on (§19).
 */

export type SandboxCommand = {
  command: string;
  args: string[];
};

/**
 * Locked, script-free dependency installation (§11).
 *
 * `--frozen-lockfile` / `npm ci` are the two package managers' "install
 * exactly what the lockfile says" modes: no resolution, no upgrades, no
 * lockfile rewriting. If the lockfile disagrees with `package.json` the
 * install fails, which is the correct outcome — validating a dependency tree
 * nobody committed would validate the wrong thing.
 *
 * `--ignore-scripts` is the security half. Install is the one step that runs
 * with network access, and a dependency's `postinstall` hook is the classic
 * supply-chain execution point. Suppressing lifecycle scripts while the
 * network is open removes that window entirely.
 *
 * The cost is real and documented: a repository that genuinely needs a
 * postinstall step to build will fail validation. In V0.1 that is the intended
 * trade — a false negative, not a weakened boundary (§10).
 */
export function installCommand(packageManager: SupportedPackageManager): SandboxCommand {
  return packageManager === "pnpm"
    ? { command: "pnpm", args: ["install", "--frozen-lockfile", "--ignore-scripts"] }
    : { command: "npm", args: ["ci", "--ignore-scripts"] };
}

/** Runs a `package.json` script through the resolved package manager. */
export function scriptCommand(
  packageManager: SupportedPackageManager,
  script: string,
): SandboxCommand {
  return packageManager === "pnpm"
    ? { command: "pnpm", args: ["run", script] }
    : { command: "npm", args: ["run", script] };
}

/** The scripts each optional step will use, in preference order. */
const OPTIONAL_STEP_SCRIPTS: Record<"typecheck" | "test", readonly string[]> = {
  typecheck: ["typecheck", "type-check"],
  test: ["test"],
};

/** The build step is mandatory: it is what "the application still builds" means. */
const BUILD_SCRIPTS: readonly string[] = ["build"];

export type PlannedStep =
  | { step: ValidationStepName; run: true; command: SandboxCommand; required: boolean }
  | { step: ValidationStepName; run: false; reason: "script_not_present" };

/**
 * The full ordered plan for one run.
 *
 * Order is not cosmetic: typecheck before test before build puts the fastest,
 * most specific signal first, so a broken change fails with a useful message
 * rather than after a four-minute build.
 */
export function planValidationSteps(input: {
  packageManager: SupportedPackageManager;
  /** Script names present in the repository's `package.json`. */
  scripts: readonly string[];
}): PlannedStep[] {
  const available = new Set(input.scripts);
  const plan: PlannedStep[] = [
    {
      step: "install",
      run: true,
      command: installCommand(input.packageManager),
      required: true,
    },
  ];

  for (const step of ["typecheck", "test"] as const) {
    const script = OPTIONAL_STEP_SCRIPTS[step].find((candidate) => available.has(candidate));

    plan.push(
      script === undefined
        ? { step, run: false, reason: "script_not_present" }
        : {
            step,
            run: true,
            command: scriptCommand(input.packageManager, script),
            // Present but failing is a real failure. A test suite that exists
            // and is red must not be reported as though it never ran (§19).
            required: true,
          },
    );
  }

  const buildScript = BUILD_SCRIPTS.find((candidate) => available.has(candidate));
  plan.push(
    buildScript === undefined
      ? { step: "build", run: false, reason: "script_not_present" }
      : {
          step: "build",
          run: true,
          command: scriptCommand(input.packageManager, buildScript),
          required: true,
        },
  );

  return plan;
}

/** Display form for storage and UI. Never re-parsed or executed. */
export function describeCommand(command: SandboxCommand): string {
  return [command.command, ...command.args].join(" ");
}
