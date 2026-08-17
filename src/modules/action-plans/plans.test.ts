import { describe, expect, it } from "vitest";
import { defaultPlannedOpportunity, resolvePlannerSource } from "./source";
import { firstActionableStep, planProgress } from "./sequence";
import {
  FAKE_PLAN_EVIDENCE_IDS,
  fakeConclusion,
  fakeOpportunity,
  fakePlannedAudit,
  fakeRepositorySnapshotFor,
  fakeWirePlan,
  fakeWirePlanStep,
} from "./test-support";
import { validateActionPlanOutput } from "./validate";

/**
 * The product requirements of CORE-2b, as scenarios (§71–§84).
 *
 * These are not unit tests of a function. Each one takes a production-shaped
 * plan through the whole domain pipeline — validate, classify, sequence — and
 * asserts a property the sprint says a plan must have. They are the closest
 * thing in the suite to "would a founder be well served by this?".
 */

const CONTEXT = { repository: fakeRepositorySnapshotFor() };

function plan(wire = fakeWirePlan()) {
  const result = validateActionPlanOutput(wire, FAKE_PLAN_EVIDENCE_IDS, CONTEXT);
  if (!result.ok) throw new Error(`fixture did not validate: ${result.reason}`);
  return result.result;
}

/** §71 — the audience plan, which is the sprint's own quality benchmark (§68). */
describe("the audience plan", () => {
  it("prepares options before it asks the founder anything", () => {
    const result = plan();

    const decision = result.steps.find((step) => step.actor === "founder_decision");
    expect(decision).toBeDefined();
    if (!decision) return;

    // §24, §25, §93: the decision does not arrive cold. Something Vibe did
    // comes first, and the decision depends on it.
    const prepared = result.steps.filter(
      (step) => decision.dependsOn.includes(step.order) && step.actor === "vibe",
    );
    expect(prepared.length).toBeGreaterThan(0);
    expect(prepared[0].changeKind).toBe("analysis");
  });

  it("represents the founder's choice explicitly rather than hiding it", () => {
    const result = plan();

    expect(result.steps.some((step) => step.executionSupport === "founder_decides")).toBe(true);
    // Never quietly selected for them (§22).
    expect(result.steps.some((step) => step.executionSupport === "vibe_executes_now")).toBe(false);
  });

  it("makes the positioning work depend on the choice", () => {
    const result = plan();

    const decision = result.steps.find((step) => step.actor === "founder_decision");
    const change = result.steps.find((step) => step.changeKind === "product_change");
    expect(decision && change).toBeTruthy();
    if (!decision || !change) return;

    expect(change.dependsOn).toContain(decision.order);
  });

  it("stays within a plan's meaningful size", () => {
    const result = plan();

    expect(result.steps.length).toBeGreaterThanOrEqual(2);
    expect(result.steps.length).toBeLessThanOrEqual(7);
  });

  /** §95 — the first actionable step is Vibe's preparation, not the decision. */
  it("starts with something that can genuinely happen now", () => {
    const result = plan();
    const next = firstActionableStep(result.steps);

    expect(next?.order).toBe(1);
    expect(next?.executionSupport).toBe("vibe_prepares");
    expect(planProgress(result.steps)).toBe("ready");
  });
});

/**
 * §72 — the revenue plan does not jump from "revenue unresolved" to "install
 * checkout".
 *
 * The property under test is ordering: the strategic work precedes the
 * implementation work, and the implementation cannot become the next step
 * before the decision is made.
 */
describe("the revenue plan", () => {
  const revenue = fakeWirePlan({
    goal: "Decide what customers pay for, and where the line between free and paid sits.",
    addressesRootProblem:
      "The root problem is that no one has decided how usage becomes revenue. At the end of this there is a stated charging model and a free/paid boundary.",
    steps: [
      fakeWirePlanStep({
        order: 1,
        title: "Identify what unit of value customers actually receive",
        completionCriteria:
          "The single unit customers get value from is named, with the evidence that supports it.",
        actor: "vibe",
        changeKind: "analysis",
        evidenceIds: ["profile.identity.description"],
      }),
      fakeWirePlanStep({
        order: 2,
        title: "Prepare two plausible charging models",
        completionCriteria:
          "Two charging models exist, each with what it would mean for delivery cost and for the free tier.",
        actor: "vibe",
        changeKind: "analysis",
        dependsOn: [1],
        evidenceIds: ["intent.monetization_model"],
      }),
      fakeWirePlanStep({
        order: 3,
        title: "Choose the charging direction",
        completionCriteria: "One charging model is chosen and recorded as the intended direction.",
        actor: "founder_decision",
        changeKind: "decision",
        dependsOn: [2],
        evidenceIds: [],
      }),
      fakeWirePlanStep({
        order: 4,
        title: "Define the boundary between free and paid",
        completionCriteria:
          "The capabilities that stay free and those that require payment are written down and consistent with the chosen model.",
        actor: "founder_decision",
        changeKind: "decision",
        dependsOn: [3],
        evidenceIds: [],
      }),
      fakeWirePlanStep({
        order: 5,
        title: "Add a checkout the chosen model needs",
        completionCriteria:
          "A visitor can complete a purchase for the priced capability without leaving the product.",
        actor: "vibe",
        changeKind: "product_change",
        dependsOn: [4],
        evidenceIds: ["repo.surface.payments"],
      }),
    ],
  });

  it("does not offer the checkout before the model is decided", () => {
    const result = plan(revenue);
    const next = firstActionableStep(result.steps);

    expect(next?.order).toBe(1);
    expect(next?.changeKind).toBe("analysis");
  });

  it("puts every strategic decision before the implementation", () => {
    const result = plan(revenue);

    const build = result.steps.find((step) => step.changeKind === "product_change");
    const decisions = result.steps.filter((step) => step.actor === "founder_decision");
    expect(build && decisions.length).toBeTruthy();
    if (!build) return;

    for (const decision of decisions) expect(decision.order).toBeLessThan(build.order);
  });

  /** §74 — Stripe has no approved capability, so the step stays honest. */
  it("keeps the unsupported checkout in the plan without calling it executable", () => {
    const result = plan(revenue);

    const build = result.steps.find((step) => step.changeKind === "product_change");
    expect(build).toBeDefined();
    expect(build?.executionSupport).toBe("not_yet_supported");
    expect(build?.capability).toBeNull();
    expect(build?.requiresApproval).toBe(true);
  });
});

/**
 * §73 — the executable case, and the only one in the product today.
 *
 * The step's business wording is ordinary; what makes it executable is the
 * structured evidence it cites and what the repository snapshot says.
 */
describe("the SEO foundations plan", () => {
  const seo = fakeWirePlan({
    goal: "Give search engines the two files they need before any content work is worth doing.",
    addressesRootProblem:
      "The root problem is that nothing structural tells a search engine this site exists. At the end of this it does.",
    steps: [
      fakeWirePlanStep({
        order: 1,
        title: "Add the missing discoverability foundations",
        description:
          "The two structural files search engines look for are added, generated from the product's own routes.",
        completionCriteria:
          "A crawler requesting the two structural discovery files receives both, listing the product's real public routes.",
        actor: "vibe",
        changeKind: "product_change",
        evidenceIds: ["live.seo.robots_txt_missing", "live.seo.sitemap_missing"],
      }),
      fakeWirePlanStep({
        order: 2,
        title: "Define what would show the change worked",
        completionCriteria:
          "The indexing signal to watch, and the window to watch it over, are written down.",
        actor: "vibe",
        changeKind: "measurement",
        dependsOn: [1],
        evidenceIds: [],
      }),
    ],
  });

  it("resolves to the real registry capability", () => {
    const result = plan(seo);

    expect(result.steps[0].executionSupport).toBe("vibe_executes_now");
    expect(result.steps[0].capability).toBe("nextjs_seo_foundations_v2");
  });

  it("stops being executable when the repository no longer supports it", () => {
    const result = validateActionPlanOutput(seo, FAKE_PLAN_EVIDENCE_IDS, {
      repository: fakeRepositorySnapshotFor({ frameworks: [{ id: "astro", name: "Astro" }] }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.steps[0].executionSupport).toBe("not_yet_supported");
    expect(result.result.steps[0].capability).toBeNull();
  });

  it("still requires approval even though Vibe can do it", () => {
    const result = plan(seo);
    expect(result.steps[0].requiresApproval).toBe(true);
  });
});

/** §76 — a manual founder action is never Vibe's work. */
describe("founder actions", () => {
  it("keeps customer interviews with the founder", () => {
    const result = plan(
      fakeWirePlan({
        steps: [
          fakeWirePlanStep(),
          fakeWirePlanStep({
            order: 2,
            title: "Talk to five people in the candidate segment",
            completionCriteria:
              "Five conversations have happened and what each person said about the problem is written down.",
            actor: "founder_action",
            changeKind: "research",
            dependsOn: [1],
            evidenceIds: [],
          }),
        ],
      }),
    );

    const interviews = result.steps[1];
    expect(interviews.executionSupport).toBe("founder_acts");
    expect(interviews.executionSupport).not.toBe("vibe_executes_now");
    expect(interviews.capability).toBeNull();
  });
});

/** §77 — an external dependency is represented, and does not fail the plan. */
describe("external dependencies", () => {
  const waiting = fakeWirePlan({
    steps: [
      fakeWirePlanStep({
        order: 1,
        title: "Wait for the payment provider to approve the account",
        completionCriteria:
          "The payment provider has approved the account and live keys are available.",
        actor: "external_party",
        changeKind: "external_setup",
        evidenceIds: [],
      }),
      fakeWirePlanStep({
        order: 2,
        title: "Define the first priced capability",
        completionCriteria:
          "One capability is named as the thing money is exchanged for, with what a buyer receives.",
        actor: "vibe",
        changeKind: "analysis",
        dependsOn: [1],
        evidenceIds: [],
      }),
    ],
  });

  it("represents it as itself rather than as a failure", () => {
    const result = plan(waiting);

    expect(result.steps[0].executionSupport).toBe("external_dependency");
    // The plan is valid. Waiting on the world is a normal state (§27).
    expect(result.steps).toHaveLength(2);
  });

  it("says the plan is blocked rather than pretending it is ready", () => {
    const result = plan(waiting);
    expect(planProgress(result.steps)).toBe("blocked");
  });
});

/**
 * §83 — the most important test in this file.
 *
 * Business priority and execution suitability are independent. When the top
 * Move needs a founder decision and a lower-ranked Move has a real capability
 * behind it, the planner must still plan the top Move. Doing otherwise would
 * mean the product quietly works on the easy thing while telling the founder it
 * worked on the important thing.
 */
describe("priority is not execution suitability", () => {
  it("plans the top-ranked Move even when a lower one is easier to execute", () => {
    const opportunities = [
      fakeOpportunity({
        id: "1-positioning-narrow-your-first-customer",
        rank: 1,
        executionType: "business_decision",
        executionReadiness: "needs_user_input",
      }),
      fakeOpportunity({
        id: "2-seo-add-discoverability-foundations",
        rank: 2,
        title: "Add discoverability foundations",
        category: "seo",
        primaryDimension: "distribution",
        secondaryDimensions: [],
        // The one thing Vibe can actually execute today.
        executionType: "code_change",
        executionReadiness: "ready",
        evidenceIds: ["live.seo.robots_txt_missing", "live.seo.sitemap_missing"],
      }),
    ];

    const chosen = defaultPlannedOpportunity(opportunities);

    expect(chosen?.rank).toBe(1);
    expect(chosen?.id).toBe("1-positioning-narrow-your-first-customer");
    expect(chosen?.executionReadiness).toBe("needs_user_input");
  });
});

/**
 * §82 — source fidelity. A plan for the audience blocker stays about the
 * audience blocker, even when other areas of the business are also weak.
 */
describe("source binding", () => {
  it("binds a Move to the conclusion it actually answers", () => {
    const audit = fakePlannedAudit({
      synthesis: {
        version: "business-audit-synthesis-v5",
        lenses: [],
        overall: "…",
        strengths: [],
        blockers: [
          // Weak, and about something else entirely.
          fakeConclusion({
            rootProblem: "Nothing about this business is legally set up.",
            headline: "There is no privacy policy or terms of service.",
            evidenceIds: ["repo.surface.payments"],
            dimensions: ["monetization"],
            lenses: ["business_readiness"],
          }),
          fakeConclusion(),
        ],
      },
    });

    const source = resolvePlannerSource(audit, fakeOpportunity());

    expect(source.conclusion?.rootProblem).toBe(
      "The business has not decided who its first customer is.",
    );
  });

  it("admits when no conclusion matches rather than guessing", () => {
    const audit = fakePlannedAudit({
      synthesis: {
        version: "business-audit-synthesis-v5",
        lenses: [],
        overall: "…",
        strengths: [],
        blockers: [
          fakeConclusion({
            evidenceIds: ["repo.surface.payments"],
            dimensions: ["monetization"],
            lenses: ["revenue_economics"],
          }),
        ],
      },
    });

    const source = resolvePlannerSource(
      audit,
      fakeOpportunity({ evidenceIds: ["live.site.title"], primaryDimension: "distribution", secondaryDimensions: [] }),
    );

    // No overlap at all. Attaching the only blocker would put a root problem on
    // a plan that does not address it (§37).
    expect(source.conclusion).toBeNull();
  });

  it("carries the lenses behind the matched conclusion", () => {
    const source = resolvePlannerSource(fakePlannedAudit(), fakeOpportunity());

    expect(source.lenses.map((lens) => lens.lens)).toContain("audience");
    expect(source.citedEvidenceIds).toContain("profile.identity.description");
  });

  it("has no conclusion to bind for an audit without a synthesis", () => {
    const source = resolvePlannerSource(fakePlannedAudit({ synthesis: null }), fakeOpportunity());

    expect(source.conclusion).toBeNull();
    expect(source.lenses).toEqual([]);
    // The Move's own evidence still travels; a plan is still possible.
    expect(source.citedEvidenceIds.length).toBeGreaterThan(0);
  });
});
