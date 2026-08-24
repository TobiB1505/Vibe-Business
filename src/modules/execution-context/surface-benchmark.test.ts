import { describe, expect, it } from "vitest";
import { fakeAgentLimits, fakeAgentSpec } from "@/modules/coding-agent/test-support";
import { compileAgentInstruction } from "@/modules/coding-agent/prompt";
import { fakePlanStep } from "@/modules/execution-contract/test-support";
import { BRIEF_BUDGET } from "./brief";
import { compileExecutionBrief, type TrustedStepFacts } from "./compiler";
import {
  compileCompletionBudget,
  evaluateCompletionAction,
  initialCompletionState,
  observeToolFailure,
  type CompletionState,
} from "./completion";
import { renderExecutionBrief } from "./render";
import { compileAgentVerificationPlan } from "./verification";
import { fakePublicSiteSnapshot } from "./test-support";

/**
 * Three task shapes, one repository, no task-specific code (PART N, O, P).
 *
 * ## Why all three live in one file
 *
 * Because the claim being made is a comparison. Run #6's robots step and run
 * #7's canonical step compiled to byte-identical briefs, and the reason a
 * generalization sprint can be believed is that the same compiler now produces
 * *different* context for them while a third, non-SEO task resolves through the
 * identical mechanism. Splitting them would let each pass on its own terms.
 *
 * The shared plan text is deliberate and is taken from the real plan both runs
 * came from: its goal names canonical URLs, Open Graph, structured data *and*
 * robots meta, which is exactly why prose could never tell its steps apart.
 */

const PLAN_GOAL =
  "Implement the missing technical SEO signals — canonical URLs, Open Graph tags, " +
  "structured data, and robots meta — across the public pages you already have.";
const PLAN_OUTCOME =
  "Your public pages carry canonical URLs, Open Graph tags, structured data, and robots meta.";

const SNAPSHOT = fakePublicSiteSnapshot();

function briefFor(input: {
  stepTitle: string;
  purpose: string;
  doneWhen: string;
  step: TrustedStepFacts | null;
}) {
  const base = fakeAgentSpec({
    step: fakePlanStep({
      title: input.stepTitle,
      purpose: input.purpose,
      completionCriteria: input.doneWhen,
    }),
  });

  return compileExecutionBrief({
    spec: {
      ...base,
      objective: {
        ...base.objective,
        goal: PLAN_GOAL,
        stepTitle: input.stepTitle,
        purpose: input.purpose,
        doneWhen: input.doneWhen,
        expectedChangedState: PLAN_OUTCOME,
      },
      repository: { ...base.repository, baseSha: SNAPSHOT.source.commitSha },
    },
    snapshot: SNAPSHOT,
    productProfile: null,
    liveOrigin: null,
    step: input.step,
  });
}

const CANONICAL = {
  stepTitle: "Add canonical URLs to public pages",
  purpose:
    "Closes the gap where duplicate or parameterised URLs could be misread by search engines.",
  doneWhen: "Every existing public page returns a canonical URL tag matching the plan.",
  step: { changeKind: "product_change", evidenceIds: ["live.seo.canonical_missing"] } as const,
};

const ROBOTS = {
  stepTitle: "Add robots meta directives to public and signed-in pages",
  purpose: "Prevents search engines from indexing signed-in application pages.",
  doneWhen: "Public pages carry an indexable robots meta directive.",
  step: { changeKind: "product_change", evidenceIds: ["live.seo.robots_meta_missing"] } as const,
};

const ROBOTS_TXT = {
  stepTitle: "Publish a robots.txt at the site root",
  purpose: "Crawlers have no directive file to read.",
  doneWhen: "A robots directive is served at the origin root.",
  step: { changeKind: "product_change", evidenceIds: ["live.seo.robots_txt_missing"] } as const,
};

/** PART P — the same surface, reached with no SEO concept anywhere in the step. */
const CTA = {
  stepTitle: "Update the primary call to action on public pages",
  purpose: "Visitors do not know what to do next on any entry page.",
  doneWhen: "Every public page carries the agreed primary call to action.",
  step: { changeKind: "product_change", evidenceIds: ["live.conversion.primary_cta"] } as const,
};

/* ---------------------------------------------------------------------------
 * PART D — canonical falls out, without the compiler knowing what canonical is
 * ------------------------------------------------------------------------ */

describe("run #7's shape: a task that applies to every public page (PART D)", () => {
  const brief = briefFor(CANONICAL);
  const paths = brief.fileCandidates.map((candidate) => candidate.path);

  it("names the page files run #7 spent nine reads of its own finding", () => {
    for (const path of [
      "src/app/page.tsx",
      "src/app/login/page.tsx",
      "src/app/signup/page.tsx",
      "src/app/privacy/page.tsx",
      "src/app/terms/page.tsx",
    ]) {
      expect(paths).toContain(path);
    }
  });

  it("names the root layout, where the shared metadata infrastructure lives", () => {
    expect(paths).toContain("src/app/layout.tsx");
  });

  it("does not pull the signed-in area in merely because it exists (PART O)", () => {
    expect(paths).not.toContain("src/app/app/(account)/page.tsx");
    expect(paths).not.toContain("src/app/app/(account)/billing/page.tsx");
  });

  it("states the surface as a fact, so the file list is not a sample of nothing", () => {
    const surface = brief.facts.find((fact) => fact.subject === "execution_surface");

    expect(surface?.value).toContain("/privacy");
    expect(surface?.value).toContain("public pages");
  });

  it("says the signed-in pages were left out on purpose", () => {
    const exclusion = brief.facts.filter((fact) => fact.subject === "execution_surface");

    expect(exclusion.some((fact) => fact.value.includes("outside this step"))).toBe(true);
  });

  it("knows nothing about canonical URLs", () => {
    const rendered = renderExecutionBrief(brief).text.toLowerCase();

    // The word may appear because the *step's own text* is quoted back. What
    // must not exist is a candidate or fact Vibe produced from knowing what a
    // canonical URL is: every path here came from route intelligence.
    for (const candidate of brief.fileCandidates) {
      expect(candidate.reason).not.toContain("canonical");
    }
    expect(rendered).not.toContain("canonical url tag should");
  });

  it("carries the requirement it derived, and what produced it", () => {
    expect(brief.surface.requirement.derivedFrom).toEqual(["live.seo.canonical_missing"]);
    expect(brief.surface.requirement.scopes).toContain("public_pages");
    expect(brief.surface.publicPagesResolved).toBe(7);
  });
});

/* ---------------------------------------------------------------------------
 * The defect itself: two steps of one plan must not compile identically
 * ------------------------------------------------------------------------ */

describe("steps of one plan no longer compile to the same brief", () => {
  it("gives a site-root artifact task a different surface from a per-page one", () => {
    const perPage = briefFor(CANONICAL);
    const artifact = briefFor(ROBOTS_TXT);

    expect(perPage.surface.requirement.scopes).toContain("public_pages");
    expect(artifact.surface.requirement.scopes).not.toContain("public_pages");
    expect(artifact.surface.requirement.surfaces).toEqual(["robots"]);
  });

  it("stops selecting a pricing surface because both steps said 'the plan'", () => {
    // `SURFACE_TERMS.pricing_page` lists "plan"/"plans"; both real steps say
    // "matching the plan". Trusted evidence replaces that guess entirely.
    const notes = briefFor(CANONICAL).fileCandidates.map((candidate) => candidate.note ?? "");

    expect(notes.some((note) => note.toLowerCase().includes("pricing"))).toBe(false);
  });

  it("falls back to the old prose hints when a step cites nothing recognisable", () => {
    const unrecognised = briefFor({ ...CANONICAL, step: { changeKind: "product_change", evidenceIds: [] } });

    expect(unrecognised.surface.requirement.scopes).toEqual([]);
    expect(unrecognised.fileCandidates.length).toBeGreaterThan(0);
  });
});

/* ---------------------------------------------------------------------------
 * PART N — the run #6 shape must stay compact
 * ------------------------------------------------------------------------ */

describe("run #6's shape stays a small, cheap brief (PART N)", () => {
  const brief = briefFor(ROBOTS);
  const rendered = renderExecutionBrief(brief);

  it("stays well inside the rendered byte ceiling", () => {
    expect(rendered.bytes).toBeLessThan(BRIEF_BUDGET.maxRenderedBytes);
  });

  it("stays inside the candidate cap", () => {
    expect(brief.fileCandidates.length).toBeLessThanOrEqual(BRIEF_BUDGET.maxCandidates);
  });

  it("still names both layouts, which is what run #6 actually edited", () => {
    const paths = brief.fileCandidates.map((candidate) => candidate.path);

    expect(paths).toContain("src/app/layout.tsx");
    expect(paths).toContain("src/app/app/layout.tsx");
  });

  it("keeps the verification mode LOW", () => {
    expect(compileAgentVerificationPlan({ ...ROBOTS.step, riskClass: "low" }).mode).toBe("low");
  });

  it("counts what it left out rather than pretending it fitted", () => {
    const wide = briefFor(CANONICAL);

    expect(wide.truncated.candidatesOmitted).toBeGreaterThanOrEqual(0);
    expect(wide.surface.publicPagesIncluded).toBeLessThanOrEqual(wide.surface.publicPagesResolved);
  });
});

/* ---------------------------------------------------------------------------
 * PART P — a non-SEO task, through the identical mechanism
 * ------------------------------------------------------------------------ */

describe("a non-SEO task resolves the same public-page surface (PART P)", () => {
  const brief = briefFor(CTA);

  it("resolves the public pages with no SEO surface involved", () => {
    expect(brief.surface.requirement.scopes).toEqual(["public_pages"]);
    expect(brief.surface.requirement.surfaces).toEqual([]);
  });

  it("offers the same page files the canonical task got", () => {
    const cta = brief.fileCandidates
      .filter((candidate) => candidate.reason === "public_page_surface")
      .map((candidate) => candidate.path);
    const canonical = briefFor(CANONICAL)
      .fileCandidates.filter((candidate) => candidate.reason === "public_page_surface")
      .map((candidate) => candidate.path);

    expect(cta).toEqual(canonical);
  });

  it("still keeps the signed-in area out", () => {
    const paths = brief.fileCandidates.map((candidate) => candidate.path);

    expect(paths.some((path) => path.startsWith("src/app/app/"))).toBe(false);
  });

  it("reaches the agent as data, inside the untrusted fence", () => {
    const instruction = compileAgentInstruction({
      spec: fakeAgentSpec(),
      limits: fakeAgentLimits(),
      availableChecks: [],
      brief,
      verification: null,
      completion: null,
    });

    expect(instruction.userMessage).toContain('<untrusted source="vibe-repository-briefing">');
    expect(instruction.userMessage).toContain("src/app/login/page.tsx");
    expect(instruction.system).not.toContain("src/app/login/page.tsx");
  });
});

/* ---------------------------------------------------------------------------
 * PART O — the run #7 lifecycle, end to end
 * ------------------------------------------------------------------------ */

describe("the run #7 lifecycle, replayed against the fixed policy (PART O)", () => {
  const BUDGET = compileCompletionBudget("low");
  const PLAN = compileAgentVerificationPlan({ ...CANONICAL.step, riskClass: "low" });

  function replay() {
    const brief = briefFor(CANONICAL);
    const briefPaths = new Set(brief.fileCandidates.map((candidate) => candidate.path));
    let state: CompletionState = initialCompletionState();
    let clock = 0;
    const refusals: string[] = [];

    const act = (toolName: string, path: string | null) => {
      clock += 1_000;
      const outcome = evaluateCompletionAction(state, {
        toolName,
        path,
        briefPaths,
        requiredChecks: PLAN.requiredChecks,
        commandCheck: null,
        budget: BUDGET,
        now: clock,
      });
      state = outcome.state;
      if (!outcome.decision.allowed) refusals.push(outcome.decision.reason);
      return outcome.decision;
    };

    const changed = [
      "src/app/layout.tsx",
      "src/app/page.tsx",
      "src/app/login/page.tsx",
      "src/app/signup/page.tsx",
      "src/app/forgot-password/page.tsx",
      "src/app/reset-password/page.tsx",
      "src/app/privacy/page.tsx",
      "src/app/terms/page.tsx",
    ];

    for (const path of changed) {
      act("Read", path);
      act("Edit", path);
    }

    return { act, changed, refusals, get state() { return state; } };
  }

  it("charges eight legitimate edits no convergence at all", () => {
    const run = replay();

    expect(run.state.implementationMutations).toBe(8);
    expect(run.state.convergenceMutations).toBe(0);
    expect(run.refusals).toEqual([]);
  });

  it("allows the required review of all eight changed files", () => {
    const run = replay();

    for (const path of run.changed) {
      expect(run.act("Read", path).allowed).toBe(true);
    }
    expect(run.state.requiredVerificationActions).toBe(8);
  });

  it("still refuses an unrelated read once the run has converged", () => {
    const run = replay();
    for (const path of run.changed) run.act("Read", path);

    let refusal: string | null = null;
    for (let index = 0; index < 20 && refusal === null; index += 1) {
      const decision = run.act("Read", `src/lib/unrelated-${index}.ts`);
      if (!decision.allowed) refusal = decision.reason;
    }

    expect(refusal).not.toBeNull();
  });

  it("leaves genuine repair possible after a failed check", () => {
    const run = replay();
    for (const path of run.changed) run.act("Read", path);
    for (let index = 0; index < 10; index += 1) run.act("Grep", null);

    // A command failed: the harness observed it, the model did not report it.
    const failed = observeToolFailure(run.state, "Bash");
    const outcome = evaluateCompletionAction(failed, {
      toolName: "Read",
      path: "src/lib/whatever.ts",
      briefPaths: new Set(),
      requiredChecks: PLAN.requiredChecks,
      commandCheck: null,
      budget: BUDGET,
      now: 100_000,
    });

    expect(outcome.decision.allowed).toBe(true);
    expect(outcome.decision.activity).toBe("repair");
  });
});
