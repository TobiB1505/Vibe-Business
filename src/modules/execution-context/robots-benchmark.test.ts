import { describe, expect, it } from "vitest";
import { fakeAgentLimits, fakeAgentSpec } from "@/modules/coding-agent/test-support";
import { compileAgentInstruction } from "@/modules/coding-agent/prompt";
import { fakePlanStep } from "@/modules/execution-contract/test-support";
import { classifyCommand } from "@/modules/coding-agent/observability/events";
import { compileExecutionBrief } from "./compiler";
import { compileAgentVerificationPlan, decideVerificationCommand } from "./verification";
import { renderExecutionBrief } from "./render";
import { fakeBriefSnapshot, fakeRoute } from "./test-support";

/**
 * The benchmark (EXECUTION CONTEXT INTELLIGENCE, PART P).
 *
 * ## What this is
 *
 * One deterministic reconstruction of the task real run #4 will be given — a
 * crawler-indexing step against a repository shaped like the one run #3 worked
 * in — so that "the agent starts from what Vibe knows" is a thing this suite
 * asserts rather than a thing a paid run has to demonstrate.
 *
 * ## What it deliberately does not assert
 *
 * That the agent behaves differently. No test can prove that: it is a property
 * of a model, measured by running one. What is asserted here is everything
 * Vibe controls — that the briefing contains the paths run #3 spent fourteen
 * reads finding, that it stays small, that it is fenced, and that it never
 * becomes an instruction. Whether that changes the run is what the recorded
 * counts in `agent_execution_runs` will answer, against run #3's own numbers.
 */

const ROBOTS_STEP = fakePlanStep({
  title: "Keep search engines out of the signed-in app",
  purpose:
    "Crawlers are indexing dashboard pages, so customer names appear in public search results.",
  completionCriteria:
    "A robots directive exists at the site root and the signed-in area is marked noindex.",
});

/** A repository laid out the way Vibe Business itself is. */
const SNAPSHOT = fakeBriefSnapshot({
  frameworkEvidence: ["package.json"],
  routes: [
    fakeRoute({ path: "/", kind: "layout", sourcePath: "src/app/layout.tsx" }),
    fakeRoute({ path: "/app", kind: "layout", sourcePath: "src/app/app/layout.tsx" }),
    fakeRoute({ path: "/" }),
    fakeRoute({ path: "/pricing" }),
    fakeRoute({ path: "/app/dashboard", sourcePath: "src/app/app/dashboard/page.tsx" }),
    fakeRoute({ path: "/api/github/webhook", kind: "api", sourcePath: "src/app/api/github/webhook/route.ts" }),
  ],
  surfaces: [
    { id: "robots", name: "robots.txt", detected: false },
    {
      id: "seo_metadata",
      name: "SEO metadata",
      detected: true,
      evidencePaths: ["src/app/layout.tsx"],
    },
    {
      id: "dashboard_app",
      name: "Signed-in application",
      detected: true,
      evidencePaths: ["src/app/app/layout.tsx"],
    },
  ],
  topLevelDirectories: ["src", "public", "supabase", "docs", "scripts"],
});

function benchmarkBrief() {
  return compileExecutionBrief({
    spec: fakeAgentSpec({ step: ROBOTS_STEP }),
    snapshot: SNAPSHOT,
    productProfile: null,
    liveOrigin: null,
  });
}

describe("robots benchmark", () => {
  it("names the layouts run #3 spent fourteen file reads finding", () => {
    const paths = benchmarkBrief().fileCandidates.map((candidate) => candidate.path);

    expect(paths).toContain("src/app/layout.tsx");
    expect(paths).toContain("src/app/app/layout.tsx");
  });

  it("tells the agent where a new route file goes without naming one", () => {
    const router = benchmarkBrief().facts.find((fact) => fact.subject === "router");

    expect(router?.value).toContain("src/app");
    // Derived from the observed route sources, never from a robots→path table.
    expect(router?.value).not.toContain("robots");
  });

  it("says the surface does not exist yet, which is the whole job of the step", () => {
    const surface = benchmarkBrief().facts.find(
      (fact) => fact.subject === "business_surface" && fact.value.includes("robots"),
    );

    expect(surface?.value).toContain("not found");
  });

  it("costs a fraction of a single file read to send", () => {
    const rendered = renderExecutionBrief(benchmarkBrief());

    // Run #3 read fourteen files. One `src/app/layout.tsx` alone was 1,333 bytes.
    expect(rendered.bytes).toBeLessThan(2048);
    expect(rendered.candidatesRendered).toBeGreaterThan(0);
  });

  it("reaches the model only inside a labelled untrusted fence", () => {
    const instruction = compileAgentInstruction({
      spec: fakeAgentSpec({ step: ROBOTS_STEP }),
      limits: fakeAgentLimits(),
      availableChecks: ["typecheck", "test"],
      brief: benchmarkBrief(),
    });

    expect(instruction.briefed).toBe(true);
    expect(instruction.userMessage).toContain('<untrusted source="vibe-repository-briefing">');

    // Rule 42: not one character of it may reach the system prompt.
    expect(instruction.system).not.toContain("src/app/layout.tsx");
    expect(instruction.system).not.toContain("Next.js");
  });

  it("changes the instruction from `go and look` to `verify what matters`", () => {
    const spec = fakeAgentSpec({ step: ROBOTS_STEP });
    const limits = fakeAgentLimits();

    const unbriefed = compileAgentInstruction({ spec, limits, availableChecks: ["typecheck"] });
    const briefed = compileAgentInstruction({
      spec,
      limits,
      availableChecks: ["typecheck"],
      brief: benchmarkBrief(),
    });

    expect(unbriefed.system).toContain("Read before you write");
    expect(briefed.system).toContain("Verify what matters");
    expect(briefed.system).toContain("do not re-survey");
  });

  it("falls back to the v1 instruction when the briefing describes a different commit", () => {
    const stale = compileExecutionBrief({
      spec: fakeAgentSpec({ step: ROBOTS_STEP }),
      snapshot: fakeBriefSnapshot({ commitSha: "0".repeat(40) }),
      productProfile: null,
      liveOrigin: null,
    });

    const instruction = compileAgentInstruction({
      spec: fakeAgentSpec({ step: ROBOTS_STEP }),
      limits: fakeAgentLimits(),
      availableChecks: ["typecheck"],
      brief: stale,
    });

    // Spec-pinned facts survive the gate, so the brief is not empty — but it
    // carries nothing that would let an agent skip reading the repository.
    expect(instruction.system).toContain("Read before you write");
    expect(instruction.userMessage).not.toContain("src/app/layout.tsx");
  });
});


/* ---------------------------------------------------------------------------
 * The other half of the benchmark: what run #5 must stop doing (Sprint 0042)
 * ------------------------------------------------------------------------ */

/**
 * The same step, seen by the verification classifier.
 *
 * These are the exact structured fields the persisted plan carries for step 4
 * of the SEO plan — read out of `action_plan_steps`, not invented here. The
 * step's *words* appear nowhere in the classifier's input, which is the point.
 */
const ROBOTS_CLASSIFICATION = {
  changeKind: "product_change",
  evidenceIds: ["live.seo.robots_meta_missing"],
  riskClass: "moderate",
} as const;

function benchmarkPlan() {
  return compileAgentVerificationPlan(ROBOTS_CLASSIFICATION);
}

function decide(command: string, commandsUsed = 0) {
  return decideVerificationCommand({
    command,
    category: classifyCommand(command),
    plan: benchmarkPlan(),
    counters: { commandsUsed, elapsedMs: null },
  });
}

describe("robots benchmark — verification", () => {
  it("compiles the cheapest plan for the benchmark step", () => {
    const plan = benchmarkPlan();

    expect(plan.mode).toBe("low");
    expect(plan.requiredChecks).toEqual(["diff_review"]);
    expect(plan.allowedChecks).toEqual(["targeted_test"]);
  });

  /**
   * The three commands that were 4m58s of run #4's 6m28s.
   *
   * Asserted as the exact strings the agent composed, off its own feed, so this
   * is a statement about the run that happened rather than about a command
   * shape somebody imagined.
   */
  it.each([
    ["pnpm typecheck 2>&1 | tail -60", "typecheck", 89_900],
    ["pnpm test 2>&1 | tail -100", "full_test", 90_600],
    ["pnpm build 2>&1 | tail -100", "build", 118_000],
  ])("refuses %s, which cost run #4 %s", (command, check) => {
    const decision = decide(command);

    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    expect(decision.check).toBe(check);
  });

  it("still lets the agent write, read and search", () => {
    for (const command of [
      'find . -name "*.tsx" | grep src/app',
      "pwd && ls",
      "cat src/app/layout.tsx",
    ]) {
      expect(decide(command).allowed, command).toBe(true);
    }
  });

  it("keeps a targeted repair loop available", () => {
    expect(decide("npx vitest run src/app/landing-contract.test.ts", 0).allowed).toBe(true);
    expect(decide("npx vitest run src/app/landing-contract.test.ts", 1).allowed).toBe(true);
  });

  /**
   * The sentence this whole sprint exists to keep true.
   *
   * A refused agent check changes nothing about what independent validation
   * runs. The two live in different modules, against different commands, on
   * different machines, and the plan has no field that could reach the second.
   */
  it("does not touch what the independent validator will run", () => {
    const spec = fakeAgentSpec({ step: ROBOTS_STEP });

    expect(spec.validation.supported).toBe(true);
    if (!spec.validation.supported) return;
    expect([...spec.validation.sandboxSteps]).toEqual(["install", "typecheck", "test", "build"]);

    // And the plan carries nothing that names them.
    expect(JSON.stringify(benchmarkPlan())).not.toContain("install");
  });

  it("gives the agent both halves of its finish line", () => {
    const instruction = compileAgentInstruction({
      spec: fakeAgentSpec({ step: ROBOTS_STEP }),
      limits: fakeAgentLimits(),
      availableChecks: ["typecheck", "test", "build"],
      brief: benchmarkBrief(),
      verification: benchmarkPlan(),
    });

    // Done When, from the plan, fenced as the customer's own words.
    expect(instruction.userMessage).toContain("Done when:");
    // And what counts as enough checking, in Vibe's words, unfenced.
    expect(instruction.userMessage).toContain("Before you stop");
    expect(instruction.verificationMode).toBe("low");
  });
});
