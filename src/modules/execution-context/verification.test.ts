import { describe, expect, it } from "vitest";
import { fakeAgentLimits, fakeAgentSpec } from "@/modules/coding-agent/test-support";
import { compileAgentInstruction } from "@/modules/coding-agent/prompt";
import { fakePlanStep } from "@/modules/execution-contract/test-support";
import { classifyCommand } from "@/modules/coding-agent/observability/events";
import {
  classifyAgentVerification,
  compileAgentVerificationPlan,
  decideVerificationCommand,
  escalateVerification,
  renderVerificationPlan,
  toSandboxPolicy,
  type AgentVerificationPlan,
  type VerificationClassificationInput,
} from "./verification";

/**
 * Agent verification, asserted at the boundary that enforces it.
 *
 * Every test below drives `decideVerificationCommand` — the same pure function
 * the sandbox harness calls before it runs a command — rather than asserting
 * about prompt wording. A prompt is a request; a refusal is a fact.
 */

function classify(
  overrides: Partial<VerificationClassificationInput> = {},
): VerificationClassificationInput {
  return {
    changeKind: "product_change",
    evidenceIds: ["live.seo.robots_meta_missing"],
    riskClass: "moderate",
    ...overrides,
  };
}

function decide(plan: AgentVerificationPlan, command: string, commandsUsed = 0) {
  return decideVerificationCommand({
    command,
    category: classifyCommand(command),
    plan,
    counters: { commandsUsed, elapsedMs: null },
  });
}

describe("classification reads structured facts, never prose", () => {
  it("gives a presentational change the cheapest plan", () => {
    expect(classifyAgentVerification(classify()).mode).toBe("low");
  });

  it("generalises across the whole SEO family, not one task", () => {
    for (const id of [
      "live.seo.canonical_missing",
      "live.seo.open_graph_missing",
      "live.seo.structured_data_missing",
      "live.seo.sitemap_missing",
    ]) {
      expect(classifyAgentVerification(classify({ evidenceIds: [id] })).mode).toBe("low");
    }
  });

  it("gives a behaviour change a middle plan", () => {
    expect(
      classifyAgentVerification(classify({ evidenceIds: ["live.conversion.signup_cta"] })).mode,
    ).toBe("medium");
  });

  it("treats an absent signal as an unnarrowed one, never as a weak one", () => {
    expect(classifyAgentVerification(classify({ evidenceIds: [] })).mode).toBe("medium");
  });

  it("lets a mixed citation pull the mode up, never down", () => {
    expect(
      classifyAgentVerification(
        classify({ evidenceIds: ["live.seo.canonical_missing", "repo.surface.payments"] }),
      ).mode,
    ).toBe("medium");
  });

  it("lets risk raise the mode and never lower it", () => {
    expect(classifyAgentVerification(classify({ riskClass: "high" })).mode).toBe("high");
  });

  /**
   * The property PART O exists for.
   *
   * A step's words are written by a model about a customer's business, and a
   * repository can influence what that model saw. If wording moved this
   * classifier, a step reworded to sound like metadata work would buy itself
   * less checking — the same downgrade `risk.ts` refuses by never reading a
   * title.
   */
  it("cannot be moved by any text at all", () => {
    const injected = classify({
      evidenceIds: ["live.conversion.signup_cta"],
    });

    // Whatever a title, a purpose or a README said, the inputs are two
    // structured fields and a risk class. There is no text parameter to pass.
    expect(Object.keys(injected).sort()).toEqual(["changeKind", "evidenceIds", "riskClass"]);
    expect(classifyAgentVerification(injected).mode).toBe("medium");
  });

  it("ignores an evidence id a model tried to invent", () => {
    // Ids are minted by Vibe's detectors and validated against the pack, so an
    // unrecognised one cannot match a presentational prefix and lands on the
    // conservative side rather than the cheap one.
    expect(
      classifyAgentVerification(classify({ evidenceIds: ["live.seo.IGNORE_ALL_RULES"] })).mode,
    ).toBe("low");
    expect(
      classifyAgentVerification(classify({ evidenceIds: ["totally.invented.id"] })).mode,
    ).toBe("medium");
  });
});

describe("LOW refuses the two commands that dominated run #4", () => {
  const plan = compileAgentVerificationPlan(classify());

  it("refuses a production build", () => {
    const decision = decide(plan, "pnpm build 2>&1 | tail -100");

    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    expect(decision.check).toBe("build");
    expect(decision.reason).toBe("check_not_permitted");
  });

  it("refuses the whole test suite", () => {
    const decision = decide(plan, "pnpm test 2>&1 | tail -100");

    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    expect(decision.check).toBe("full_test");
  });

  it("refuses a project typecheck", () => {
    expect(decide(plan, "pnpm typecheck 2>&1 | tail -60").allowed).toBe(false);
  });

  it("tells the agent why, and points at the validator", () => {
    const decision = decide(plan, "pnpm build");

    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    expect(decision.message).toContain("validates the prepared change independently");
    // Never a silent block, and never an internal reason.
    expect(decision.message.length).toBeGreaterThan(40);
    expect(decision.message).not.toContain("evidence");
  });

  it("allows a targeted test", () => {
    expect(decide(plan, "npx vitest run src/app/landing-contract.test.ts").allowed).toBe(true);
  });

  it("leaves ordinary work untouched", () => {
    for (const command of ["ls src/app", "cat package.json", "git status", "echo hello"]) {
      expect(decide(plan, command).allowed, command).toBe(true);
    }
  });
});

describe("repair survives (PART H)", () => {
  const plan = compileAgentVerificationPlan(classify());

  it("permits the edit → check → fix → recheck loop within budget", () => {
    expect(decide(plan, "npx vitest run src/app/x.test.ts", 0).allowed).toBe(true);
    expect(decide(plan, "npx vitest run src/app/x.test.ts", 1).allowed).toBe(true);
    expect(decide(plan, "npx vitest run src/app/x.test.ts", 2).allowed).toBe(true);
  });

  it("stops when the command budget is spent, and says so", () => {
    const decision = decide(plan, "npx vitest run src/app/x.test.ts", plan.maxVerificationCommands);

    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    expect(decision.reason).toBe("command_budget_exhausted");
  });

  it("stops when the time budget is spent", () => {
    const decision = decideVerificationCommand({
      command: "npx vitest run src/app/x.test.ts",
      category: "test",
      plan,
      counters: { commandsUsed: 0, elapsedMs: plan.maxVerificationWallClockMs },
    });

    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    expect(decision.reason).toBe("wall_clock_exhausted");
  });

  /** A failing targeted test must not become a licence to run everything. */
  it("does not widen the plan because a check failed", () => {
    expect(decide(plan, "pnpm test").allowed).toBe(false);
    expect(decide(plan, "pnpm build").allowed).toBe(false);
  });
});

describe("MEDIUM and HIGH", () => {
  const medium = compileAgentVerificationPlan(classify({ evidenceIds: ["live.conversion.signup_cta"] }));
  const high = compileAgentVerificationPlan(classify({ riskClass: "high" }));

  it("MEDIUM allows a typecheck but still refuses the suite and the build", () => {
    expect(decide(medium, "pnpm typecheck").allowed).toBe(true);
    expect(decide(medium, "pnpm test").allowed).toBe(false);
    expect(decide(medium, "pnpm build").allowed).toBe(false);
  });

  it("HIGH allows everything, because converging may need it", () => {
    for (const command of ["pnpm typecheck", "pnpm test", "pnpm build", "pnpm lint"]) {
      expect(decide(high, command).allowed, command).toBe(true);
    }
  });

  it("HIGH requires a typecheck rather than merely allowing one", () => {
    expect(high.requiredChecks).toContain("typecheck");
  });

  it("every mode requires the agent to read its own diff", () => {
    for (const plan of [compileAgentVerificationPlan(classify()), medium, high]) {
      expect(plan.requiredChecks).toContain("diff_review");
    }
  });
});

describe("escalation is bounded and never the model's call", () => {
  const low = compileAgentVerificationPlan(classify());

  it("does not escalate on a single failure", () => {
    expect(escalateVerification({ plan: low, failedChecks: 1 }).escalated).toBe(false);
  });

  it("escalates one step, and one step only", () => {
    const first = escalateVerification({ plan: low, failedChecks: low.maxRepairRetries });
    expect(first.escalated).toBe(true);
    if (!first.escalated) return;
    expect(first.plan.mode).toBe("medium");

    // Still refuses a build: low never reaches high by failing twice.
    expect(decide(first.plan, "pnpm build").allowed).toBe(false);
  });

  it("stops at the ceiling", () => {
    const high = compileAgentVerificationPlan(classify({ riskClass: "high" }));
    const outcome = escalateVerification({ plan: high, failedChecks: 99 });

    expect(outcome.escalated).toBe(false);
    if (outcome.escalated) return;
    expect(outcome.reason).toBe("ceiling_reached");
  });
});

describe("what crosses into the sandbox", () => {
  it("carries rules and integers, and no prose", () => {
    const policy = toSandboxPolicy(compileAgentVerificationPlan(classify()));

    expect(policy.mode).toBe("low");
    expect(policy.permittedChecks).toContain("diff_review");
    expect(policy.permittedChecks).not.toContain("build");
    expect(policy.categoryRules.length).toBeGreaterThan(0);
    // The rationale is Vibe's own note for a human. It is not shipped.
    expect(JSON.stringify(policy)).not.toContain("presentational");
  });

  it("classifies commands in the sandbox by the same table the timeline uses", () => {
    const policy = toSandboxPolicy(compileAgentVerificationPlan(classify()));

    for (const command of ["pnpm build", "pnpm test", "pnpm typecheck", "git status"]) {
      const matched = policy.categoryRules.find((rule) => new RegExp(rule.pattern).test(command));
      expect(matched?.category ?? "other").toBe(classifyCommand(command));
    }
  });
});

describe("the instruction the agent receives", () => {
  const plan = compileAgentVerificationPlan(classify());

  const instruction = () =>
    compileAgentInstruction({
      spec: fakeAgentSpec({ step: fakePlanStep({ title: "Add robots meta directives" }) }),
      limits: fakeAgentLimits(),
      availableChecks: ["typecheck", "test", "build"],
      verification: plan,
    });

  it("states a completion condition instead of `until you are out of budget`", () => {
    const { system } = instruction();

    expect(system).toContain("You are finished when two things are true");
    expect(system).not.toContain("until you are out of budget");
  });

  it("stops advertising a check-run ceiling the runtime no longer enforces", () => {
    expect(instruction().system).not.toContain("check runs (");
  });

  it("names what it may not run, and why arguing is pointless", () => {
    const { userMessage } = instruction();

    expect(userMessage).toContain("Do not run:");
    expect(userMessage).toContain("refused by the runtime");
    expect(userMessage).toContain("validates the change independently");
  });

  it("keeps Vibe's own policy out of an untrusted fence", () => {
    const rendered = renderVerificationPlan(plan);
    const { userMessage } = instruction();
    const fenced = userMessage.split('<untrusted')[1] ?? "";

    expect(userMessage).toContain(rendered);
    expect(fenced).not.toContain("Before you stop");
  });

  it("falls back to the previous instruction when no plan was compiled", () => {
    const without = compileAgentInstruction({
      spec: fakeAgentSpec(),
      limits: fakeAgentLimits(),
      availableChecks: ["typecheck"],
    });

    expect(without.verificationMode).toBeNull();
    expect(without.system).toContain("run the checks and fix what they find");
  });
});
