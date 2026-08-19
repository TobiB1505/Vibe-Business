import type { StepChangeKind } from "@/modules/action-plans/schema";
import type { ExecutionRiskClass } from "@/modules/execution-contract/schema";
import {
  COMMAND_CATEGORY_RULES,
  type CommandCategory,
} from "@/modules/coding-agent/observability/events";

/**
 * How much checking the agent does before it stops — as policy, not as a habit.
 *
 * ## The distinction this file exists to draw
 *
 * ```
 * Agent Verification        helps the agent find and repair its own mistakes
 *                           advisory · bounded · may influence its next turn
 *                           authorizes nothing
 *
 * Independent Validation    decides whether a Prepared Change may progress
 *                           toward human approval and merge
 *                           authoritative · isolated · unchanged by this file
 * ```
 *
 * They had collapsed into one thing. Run #4 spent 4m58s of a 6m28s run on
 * `pnpm typecheck`, `pnpm test` and `pnpm build` — and then the independent
 * validator ran install/typecheck/test/build again against the prepared branch,
 * taking about the same five minutes. All three agent checks passed first time,
 * so the whole 4m58s found nothing. Seventy-seven per cent of a paid agent run
 * went on rehearsing a verdict it does not get to give.
 *
 * The sentence this is built to make true:
 *
 * > The agent checks enough to converge. The validator checks enough to
 * > authorize.
 *
 * ## Why the agent was doing it
 *
 * Nobody told it not to, and nothing could have stopped it. The check names
 * were interpolated into the system prompt from the repository's own scripts,
 * the prompt said "run the checks and fix what they find", and the harness's
 * `canUseTool` allows `Bash` by name without looking at the command. The one
 * ceiling that existed — `maxCheckRuns` — is enforced in a gateway method that
 * the sandbox topology no longer calls: run #4 recorded `check_runs: 0` while
 * running three.
 *
 * ## What this is not
 *
 * Not a security boundary. A plan bounds what the *model* chooses to spend; it
 * is not a defence against a hostile repository, and nothing here is trusted to
 * make a change safe. `verifyCandidateChange`, the write scope, the sandbox
 * isolation, independent validation and human approval are unchanged and remain
 * the things that decide whether a change may progress.
 */

/* ---------------------------------------------------------------------------
 * The vocabulary
 * ------------------------------------------------------------------------ */

/**
 * How much self-checking a task warrants.
 *
 * Three, and deliberately not a score. The question "should this agent run the
 * whole test suite?" has an answer per class of work, and a number would invite
 * tuning a threshold until a task passed.
 */
export const VERIFICATION_MODES = ["low", "medium", "high"] as const;
export type VerificationMode = (typeof VERIFICATION_MODES)[number];

/**
 * The checks a plan can speak about.
 *
 * A subset of the `CommandCategory` vocabulary the timeline already records,
 * plus `diff_review` — which is not a command at all but a thing the agent does
 * with the tools it has, and the one required check at every mode.
 *
 * `install` is absent and stays absent: it is the one networked step, and
 * letting a model trigger it would hand it the ability to reopen the registry
 * allowlist at a time of its choosing (CORE-4 §12).
 */
export const VERIFICATION_CHECKS = [
  "diff_review",
  "targeted_test",
  "typecheck",
  "full_test",
  "build",
  "lint",
] as const;
export type VerificationCheck = (typeof VERIFICATION_CHECKS)[number];

/**
 * Which command categories a check corresponds to at the enforcement boundary.
 *
 * `targeted_test` and `full_test` are the same category to a shell — `vitest
 * run src/x.test.ts` and `vitest run` both classify as `test` — so the plan
 * distinguishes them by *argument shape* rather than by category. That
 * distinction is made in `decideVerificationCommand`, which is the only place
 * that knows a test command carrying a path is targeted and one carrying none
 * is not.
 */
const CHECK_CATEGORIES: Record<VerificationCheck, readonly CommandCategory[]> = {
  diff_review: [],
  targeted_test: ["test"],
  full_test: ["test"],
  typecheck: ["typecheck"],
  build: ["build"],
  lint: ["lint"],
};

/* ---------------------------------------------------------------------------
 * The plan
 * ------------------------------------------------------------------------ */

export type AgentVerificationPlan = {
  planVersion: string;
  mode: VerificationMode;

  /** Done before stopping. `diff_review` is always here. */
  requiredChecks: readonly VerificationCheck[];
  /** Permitted if the agent judges them useful. Never obligatory. */
  allowedChecks: readonly VerificationCheck[];
  /** Refused at the boundary, with a reason the agent is told. */
  forbiddenChecks: readonly VerificationCheck[];

  /** Total check commands the run may execute, across all categories. */
  maxVerificationCommands: number;
  /** Wall-clock ceiling for check commands, from the first one. */
  maxVerificationWallClockMs: number;
  /**
   * Re-runs of a *failing* check that are allowed while repairing.
   *
   * Separate from the command ceiling because repair is the thing that must
   * keep working: an agent that edits, runs a targeted test, sees it fail,
   * fixes the code and re-runs is the loop this whole design is trying to make
   * cheap, and a ceiling that killed it would trade money for correctness.
   */
  maxRepairRetries: number;

  /** Why this mode, in Vibe's words. Never a model's. */
  rationale: string;
};

export const AGENT_VERIFICATION_PLAN_VERSION = "agent-verification.v1" as const;

/* ---------------------------------------------------------------------------
 * The three profiles
 * ------------------------------------------------------------------------ */

/**
 * Deliberately simple, and deliberately not a risk engine.
 *
 * The interesting property is the LOW row: no typecheck, no full suite, no
 * build. That is the whole bet of this sprint — that for a metadata-shaped
 * change, an agent reading its own diff converges just as well as one that
 * spends five minutes proving the project still compiles, because the validator
 * proves that afterwards anyway and its verdict is the only one that counts.
 *
 * If the bet is wrong it shows up as an independent validation failure on a
 * change the agent thought was finished, which is exactly the signal that would
 * justify moving a task class up a mode.
 */
const PROFILES: Record<
  VerificationMode,
  Omit<AgentVerificationPlan, "planVersion" | "rationale" | "mode">
> = {
  low: {
    requiredChecks: ["diff_review"],
    allowedChecks: ["targeted_test"],
    forbiddenChecks: ["full_test", "build", "typecheck", "lint"],
    // Three, not one: enough for a targeted test plus two repair re-runs, which
    // is the loop PART H insists must survive. A ceiling, never a target — a
    // LOW run that reviews its diff and stops spends none of it.
    maxVerificationCommands: 3,
    maxVerificationWallClockMs: 180_000,
    maxRepairRetries: 2,
  },
  medium: {
    requiredChecks: ["diff_review"],
    allowedChecks: ["targeted_test", "typecheck"],
    forbiddenChecks: ["full_test", "build"],
    maxVerificationCommands: 6,
    maxVerificationWallClockMs: 420_000,
    maxRepairRetries: 3,
  },
  /*
   * HIGH may run everything, because a change to auth or data is where an agent
   * genuinely may need the full suite to converge. It is still advisory: a HIGH
   * run that passes every check has proved nothing about whether the change may
   * merge, and independent validation runs from scratch regardless.
   */
  high: {
    requiredChecks: ["diff_review", "typecheck"],
    allowedChecks: ["targeted_test", "full_test", "build", "lint"],
    forbiddenChecks: [],
    maxVerificationCommands: 10,
    maxVerificationWallClockMs: 900_000,
    maxRepairRetries: 4,
  },
};

/* ---------------------------------------------------------------------------
 * Classification (PART D, PART E)
 * ------------------------------------------------------------------------ */

/**
 * Evidence families whose implementation is presentational.
 *
 * Named beside `FINANCIAL_SURFACES` and `SECURITY_SURFACES` in
 * `execution-contract/risk.ts`, in the same spirit and reading the same field.
 * These are prefixes of ids **Vibe mints itself** from deterministic detectors —
 * `live.seo.*` comes from the live analyzer's closed `seoSignals` set, and the
 * planner is validated to cite only ids that exist in the evidence pack. A
 * model chooses which of our ids to cite; it cannot invent one.
 *
 * That is the entire reason this is keyed on evidence ids rather than on the
 * step's words. A verification mode derived from prose would let a step
 * reworded to sound like metadata work buy itself less checking, which is the
 * same failure `risk.ts` refuses by never reading a title.
 *
 * The list names *families*, not the benchmark task. `robots` appears nowhere:
 * the robots step qualifies because it cites `live.seo.robots_meta_missing`,
 * exactly as its canonical-URL and Open Graph siblings qualify by citing
 * `live.seo.canonical_missing` and `live.seo.open_graph_missing`.
 */
const PRESENTATIONAL_EVIDENCE_PREFIXES: readonly string[] = [
  "live.seo.",
  "live.site.",
  "repo.surface.seo_metadata",
  "repo.surface.sitemap",
  "repo.surface.robots",
  "repo.surface.legal",
  "repo.surface.docs_help",
  "repo.surface.contact",
];

/**
 * Change kinds that alter something outside Vibe.
 *
 * The same set `risk.ts` uses. A step that only decides, analyses or measures
 * changes no code, so there is nothing for an agent to verify.
 */
const MUTATING_CHANGE_KINDS: readonly StepChangeKind[] = ["product_change", "external_setup"];

export type VerificationClassificationInput = {
  changeKind: StepChangeKind;
  /** Vibe-minted ids the step cites. Never free text. */
  evidenceIds: readonly string[];
  /** The spec's own risk class. Raises the mode; never lowers it. */
  riskClass: ExecutionRiskClass;
};

/**
 * Which mode a step gets.
 *
 * Two independent inputs and a floor. The evidence ids say what *kind* of work
 * it is; `riskClass` says how bad a mistake would be, and it can only push the
 * answer up. A step that cites nothing at all is `medium` — the conservative
 * default, because an absent signal is not a weak signal.
 */
export function classifyAgentVerification(
  input: VerificationClassificationInput,
): { mode: VerificationMode; rationale: string } {
  const floor: VerificationMode =
    input.riskClass === "high" || input.riskClass === "prohibited" ? "high" : "low";

  if (floor === "high") {
    return {
      mode: "high",
      rationale: "The step is classified high risk, so deeper self-checking is permitted.",
    };
  }

  if (!MUTATING_CHANGE_KINDS.includes(input.changeKind)) {
    return {
      mode: "low",
      rationale: "The step changes no application code.",
    };
  }

  if (input.evidenceIds.length === 0) {
    return {
      mode: "medium",
      rationale: "The step cites no evidence, so its scope cannot be narrowed.",
    };
  }

  const allPresentational = input.evidenceIds.every((id) =>
    PRESENTATIONAL_EVIDENCE_PREFIXES.some((prefix) => id.startsWith(prefix)),
  );

  return allPresentational
    ? {
        mode: "low",
        rationale: "Every cited signal is presentational, so a diff review is the useful check.",
      }
    : {
        mode: "medium",
        rationale: "The step changes product behaviour beyond presentation.",
      };
}

/** Builds the plan for one classified step. */
export function compileAgentVerificationPlan(
  input: VerificationClassificationInput,
): AgentVerificationPlan {
  const { mode, rationale } = classifyAgentVerification(input);
  return { planVersion: AGENT_VERIFICATION_PLAN_VERSION, mode, rationale, ...PROFILES[mode] };
}

/* ---------------------------------------------------------------------------
 * Deciding one command (PART G)
 * ------------------------------------------------------------------------ */

export const VERIFICATION_REFUSAL_REASONS = [
  "check_not_permitted",
  "command_budget_exhausted",
  "wall_clock_exhausted",
] as const;
export type VerificationRefusalReason = (typeof VERIFICATION_REFUSAL_REASONS)[number];

export type VerificationDecision =
  | { allowed: true; check: VerificationCheck | null; category: CommandCategory }
  | {
      allowed: false;
      reason: VerificationRefusalReason;
      check: VerificationCheck;
      category: CommandCategory;
      /** What the agent is told. Vibe's words, bounded, no internals. */
      message: string;
    };

/** State the harness keeps while a run is in progress. */
export type VerificationCounters = {
  commandsUsed: number;
  /** Milliseconds since the first check command. Null before there is one. */
  elapsedMs: number | null;
};

/**
 * Is a test command targeted or the whole suite?
 *
 * By argument shape, because that is the only thing distinguishable from a
 * command line. A test invocation that names a path, a file, a `-t` filter or a
 * project is targeted; a bare `pnpm test` is the suite.
 *
 * Wrong in the safe direction by construction: anything that does not look
 * clearly targeted is treated as a full run, so the failure mode is refusing a
 * targeted test at LOW rather than admitting a 90-second suite.
 */
export const TARGETED_TEST_PATTERN = String.raw`(--?t\b|--testNamePattern|--project\b|--dir\b|--related\b|[\w./-]+\.(test|spec)\.[jt]sx?\b|src\/[\w./-]+)`;

function isTargetedTest(command: string): boolean {
  return new RegExp(TARGETED_TEST_PATTERN).test(command);
}

/** Which check a command represents, or null when it is not a check at all. */
export function checkForCommand(command: string, category: CommandCategory): VerificationCheck | null {
  if (category === "test") return isTargetedTest(command) ? "targeted_test" : "full_test";

  for (const check of VERIFICATION_CHECKS) {
    if (CHECK_CATEGORIES[check].includes(category)) return check;
  }
  return null;
}

const REFUSAL_MESSAGES: Record<VerificationRefusalReason, string> = {
  check_not_permitted:
    "This check is not part of the verification plan for this task. Vibe validates the " +
    "prepared change independently afterwards — it will run the full checks. Review your " +
    "own changes instead, and stop when the plan's required checks are satisfied.",
  command_budget_exhausted:
    "The verification command budget for this task is used up. Vibe validates the prepared " +
    "change independently afterwards. Finish and stop.",
  wall_clock_exhausted:
    "The verification time budget for this task is used up. Vibe validates the prepared " +
    "change independently afterwards. Finish and stop.",
};

/**
 * Whether one command may run — the whole enforcement decision, in one pure
 * function.
 *
 * Pure so that the same answer can be reached in two places without either
 * being able to drift: the harness calls it inside the sandbox before running
 * the command, and Vibe's tests call it directly. Nothing about a decision
 * depends on where it is made.
 *
 * A command that is not a check is never refused here. This bounds verification
 * effort, not the agent's ability to work — reading files, searching and
 * editing are untouched, and so is any command that classifies as something
 * other than a check.
 */
export function decideVerificationCommand(input: {
  command: string;
  category: CommandCategory;
  plan: AgentVerificationPlan;
  counters: VerificationCounters;
}): VerificationDecision {
  const { command, category, plan, counters } = input;

  const check = checkForCommand(command, category);
  if (!check) return { allowed: true, check: null, category };

  const permitted =
    plan.requiredChecks.includes(check) || plan.allowedChecks.includes(check);

  if (!permitted) {
    return {
      allowed: false,
      reason: "check_not_permitted",
      check,
      category,
      message: REFUSAL_MESSAGES.check_not_permitted,
    };
  }

  if (counters.commandsUsed >= plan.maxVerificationCommands) {
    return {
      allowed: false,
      reason: "command_budget_exhausted",
      check,
      category,
      message: REFUSAL_MESSAGES.command_budget_exhausted,
    };
  }

  if (counters.elapsedMs !== null && counters.elapsedMs >= plan.maxVerificationWallClockMs) {
    return {
      allowed: false,
      reason: "wall_clock_exhausted",
      check,
      category,
      message: REFUSAL_MESSAGES.wall_clock_exhausted,
    };
  }

  return { allowed: true, check, category };
}

/* ---------------------------------------------------------------------------
 * What crosses into the sandbox
 * ------------------------------------------------------------------------ */

/**
 * The plan as the harness receives it: rules plus limits, no prose.
 *
 * Carried in `request.json` as data, never interpolated into program text —
 * the same property ADR 0029 gives the runtime program, preserved. The
 * category rules travel with it so the sandbox classifies commands by exactly
 * the same table Vibe's timeline does.
 */
export type SandboxVerificationPolicy = {
  mode: VerificationMode;
  permittedChecks: readonly VerificationCheck[];
  maxVerificationCommands: number;
  maxVerificationWallClockMs: number;
  categoryRules: readonly { category: string; pattern: string }[];
  /**
   * How the sandbox tells a targeted test from the whole suite.
   *
   * Shipped rather than duplicated inside the harness, because a second copy of
   * this pattern is a second answer to "is this a targeted test", and the two
   * would drift the first time either was edited. One string, one meaning, in
   * both places.
   */
  targetedTestPattern: string;
  messages: Record<VerificationRefusalReason, string>;
};

export function toSandboxPolicy(plan: AgentVerificationPlan): SandboxVerificationPolicy {
  return {
    mode: plan.mode,
    permittedChecks: [...new Set([...plan.requiredChecks, ...plan.allowedChecks])],
    maxVerificationCommands: plan.maxVerificationCommands,
    maxVerificationWallClockMs: plan.maxVerificationWallClockMs,
    categoryRules: COMMAND_CATEGORY_RULES.map((rule) => ({
      category: rule.category,
      pattern: rule.pattern,
    })),
    targetedTestPattern: TARGETED_TEST_PATTERN,
    messages: REFUSAL_MESSAGES,
  };
}

/* ---------------------------------------------------------------------------
 * Escalation (PART I)
 * ------------------------------------------------------------------------ */

/**
 * When a LOW plan turns out to have been the wrong call.
 *
 * The honest failure of an evidence-keyed classifier is a step whose evidence
 * said "presentational" and whose implementation was not. The agent finds that
 * out the way anyone would — a targeted check fails in a way that is not about
 * the lines it wrote — and the plan has to have somewhere to go that is not
 * "give up" and not "run everything".
 *
 * Two rules make it safe:
 *
 * 1. **One step only.** `low → medium`, `medium → high`, and no path from `low`
 *    to `high`. A run cannot climb to the top by failing twice.
 * 2. **Not the model's decision.** Escalation is granted by this function
 *    against a counted, observed condition — repeated failure of a permitted
 *    check — never because a model asked for it or declared itself high risk.
 *    There is no tool through which it could ask.
 *
 * It is recorded as `verification_escalated` so a class of task that keeps
 * escalating becomes a reason to change the classifier rather than a thing that
 * silently costs more every run.
 */
export type EscalationOutcome =
  | { escalated: true; plan: AgentVerificationPlan; from: VerificationMode }
  | { escalated: false; reason: "ceiling_reached" | "insufficient_evidence" };

const NEXT_MODE: Record<VerificationMode, VerificationMode | null> = {
  low: "medium",
  medium: "high",
  high: null,
};

export function escalateVerification(input: {
  plan: AgentVerificationPlan;
  /** How many permitted checks have failed. Observed, never claimed. */
  failedChecks: number;
}): EscalationOutcome {
  if (input.failedChecks < input.plan.maxRepairRetries) {
    return { escalated: false, reason: "insufficient_evidence" };
  }

  const next = NEXT_MODE[input.plan.mode];
  if (!next) return { escalated: false, reason: "ceiling_reached" };

  return {
    escalated: true,
    from: input.plan.mode,
    plan: {
      planVersion: input.plan.planVersion,
      mode: next,
      rationale: `Escalated from ${input.plan.mode}: a permitted check failed repeatedly.`,
      ...PROFILES[next],
    },
  };
}

/* ---------------------------------------------------------------------------
 * Rendering (PART J)
 * ------------------------------------------------------------------------ */

const CHECK_LABELS: Record<VerificationCheck, string> = {
  diff_review: "review every file you changed, in full",
  targeted_test: "one test that covers what you changed",
  typecheck: "a project typecheck",
  full_test: "the whole test suite",
  build: "a production build",
  lint: "a lint run",
};

/**
 * The plan as prompt text.
 *
 * ## Why this is authored here rather than fenced as untrusted
 *
 * Because unlike the Execution Brief, none of it comes from a customer. Every
 * string above is a Vibe constant, and the only values interpolated are a mode
 * name from a three-value union and two integers. It is policy Vibe wrote, so
 * it belongs in the part of the message that carries Vibe's instructions —
 * fencing it would tell the model to treat Vibe's own rules as quoted material.
 *
 * ## What it deliberately does not say
 *
 * Nothing about *why* a mode was chosen in terms of evidence ids, risk classes
 * or classifier internals. The agent needs to know what it may run and when it
 * may stop. Explaining the machinery would invite argument with it, and there
 * is nothing to argue with: the boundary refuses regardless of what the model
 * concludes about the reasoning.
 */
export function renderVerificationPlan(plan: AgentVerificationPlan): string {
  const lines: string[] = [
    "Before you stop, do exactly this and no more:",
    "",
    ...plan.requiredChecks.map((check) => `- Required: ${CHECK_LABELS[check]}`),
  ];

  if (plan.allowedChecks.length > 0) {
    lines.push(
      ...plan.allowedChecks.map((check) => `- Allowed if it would tell you something: ${CHECK_LABELS[check]}`),
    );
  }

  if (plan.forbiddenChecks.length > 0) {
    lines.push(
      "",
      `Do not run: ${plan.forbiddenChecks.map((check) => CHECK_LABELS[check]).join("; ")}.`,
      "These are refused by the runtime, so attempting one costs you a turn and changes nothing.",
    );
  }

  lines.push(
    "",
    `At most ${plan.maxVerificationCommands} check commands, and at most ` +
      `${Math.round(plan.maxVerificationWallClockMs / 1000)} seconds of checking in total.`,
    "",
    "After you stop, Vibe validates the change independently and from scratch — a fresh install,",
    "a full typecheck, the whole test suite and a production build, in its own isolated machine.",
    "That is the verdict, and running those yourself does not make it come out better. What your",
    "own checks are for is catching your own mistakes while you can still fix them.",
  );

  return lines.join("\n");
}
