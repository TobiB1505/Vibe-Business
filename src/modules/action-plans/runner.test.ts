import { describe, expect, it } from "vitest";
import {
  ACTION_PLANNING_CONFIG,
  BUSINESS_READINESS_AUDIT_CONFIG,
} from "@/modules/ai/operations";
import { buildEvidencePackV3 } from "@/modules/business-audit/evidence-v3";
import {
  FakeProvider,
  fakeAuthenticatedSnapshot,
  fakeFounderIntent,
  fakeLiveSnapshot,
  fakeRepositorySnapshot,
} from "@/modules/business-audit/test-support";
import { fakeProductProfile } from "@/modules/product-understanding/test-support";
import { buildActionPlanRequest, buildPlannerPack, runActionPlanning } from "./runner";
import { fakePlannerSource, fakeRepositorySnapshotFor, fakeWirePlan } from "./test-support";

/**
 * The planning pipeline, end to end against a fake provider
 * (CORE-2b §45, §55, §56, §98).
 *
 * No test here reaches the Anthropic API, needs a key, or costs money.
 */

function sources() {
  return {
    productProfile: fakeProductProfile(),
    founderIntent: fakeFounderIntent(),
    repository: fakeRepositorySnapshot(),
    liveProduct: fakeLiveSnapshot(),
    authenticatedProduct: fakeAuthenticatedSnapshot(),
  };
}

function input(provider: FakeProvider) {
  return {
    source: fakePlannerSource(),
    pack: buildEvidencePackV3(sources()),
    repository: fakeRepositorySnapshotFor(),
    provider,
    config: ACTION_PLANNING_CONFIG,
  };
}

function planProvider(overrides: Parameters<typeof fakeWirePlan>[0] = {}) {
  return new FakeProvider({
    result: {
      ok: true,
      data: fakeWirePlan(overrides),
      usage: { inputTokens: 3_100, outputTokens: 1_400, thinkingTokens: 900 },
      model: "claude-sonnet-5",
      latencyMs: 21_000,
    },
  });
}

describe("runActionPlanning", () => {
  it("produces a versioned plan from one paid call", async () => {
    const provider = planProvider();
    const outcome = await runActionPlanning(input(provider));

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    // One billable call. Not planner → summarizer → classifier (§45).
    expect(provider.requests).toHaveLength(1);
    expect(outcome.plan.contractVersion).toBe("action-planner-contract-v1");
    expect(outcome.plan.promptVersion).toBe("action-planner-prompt-v1");
    expect(outcome.plan.rubricVersion).toBe("action-planner-rubric-v1");
    expect(outcome.plan.model).toBe("claude-sonnet-5");
    expect(outcome.plan.steps).toHaveLength(4);
  });

  it("counts tokens before spending anything", async () => {
    const provider = planProvider();
    await runActionPlanning(input(provider));

    expect(provider.countRequests).toHaveLength(1);
  });

  it("refuses to spend when the count itself fails", async () => {
    const provider = new FakeProvider({
      tokenCount: { ok: false, error: "provider_billing_error" },
    });

    const outcome = await runActionPlanning(input(provider));

    expect(outcome).toMatchObject({ ok: false, error: "provider_billing_error" });
    expect(provider.requests).toHaveLength(0);
  });

  /** §55 — a failed run leaves nothing half-valid, and reports its usage. */
  it("carries usage through a provider failure", async () => {
    const provider = new FakeProvider({
      result: {
        ok: false,
        error: "output_truncated",
        usage: { inputTokens: 3_000, outputTokens: 10_000, thinkingTokens: 9_000 },
        model: "claude-sonnet-5",
        latencyMs: 40_000,
      },
    });

    const outcome = await runActionPlanning(input(provider));

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error).toBe("output_truncated");
    // Tokens were billed. Recording that honestly is the ledger's whole point.
    expect(outcome.usage?.outputTokens).toBe(10_000);
  });

  it("reports a validation failure with its reason", async () => {
    const provider = planProvider({ goal: "" });
    const outcome = await runActionPlanning(input(provider));

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error).toBe("structured_output_schema_invalid");
    expect(outcome.diagnostic?.validationReason).toBe("missing_plan_goal");
  });

  it("refuses a request that will not fit the input budget", async () => {
    const provider = new FakeProvider({ tokenCount: { ok: true, inputTokens: 999_999 } });
    const outcome = await runActionPlanning(input(provider));

    expect(outcome).toMatchObject({ ok: false, error: "action_plan_input_budget_exceeded" });
    expect(provider.requests).toHaveLength(0);
  });
});

describe("the request", () => {
  it("sends no tools and no reasoning request", () => {
    const request = buildActionPlanRequest(
      fakePlannerSource(),
      buildPlannerPack({ source: fakePlannerSource(), pack: buildEvidencePackV3(sources()) }),
      ACTION_PLANNING_CONFIG,
    );

    // The trust model's first property: there is no field for a tool, so a
    // model reading untrusted evidence cannot be made to act by it (ADR 0011).
    expect(request).not.toHaveProperty("tools");
    expect(request.outputSchema).toBeDefined();
  });

  /** Rule 42 — no customer content is ever interpolated into a system prompt. */
  it("keeps customer content out of the system prompt", () => {
    const source = fakePlannerSource();
    const request = buildActionPlanRequest(
      source,
      buildPlannerPack({ source, pack: buildEvidencePackV3(sources()) }),
      ACTION_PLANNING_CONFIG,
    );

    expect(request.system).not.toContain(source.opportunity.title);
    expect(request.system).not.toContain(source.conclusion?.rootProblem ?? "@@none@@");
    // …and all of it is in the fenced user message instead.
    expect(request.userContent).toContain(source.opportunity.title);
    expect(request.userContent).toContain("<move>");
    expect(request.userContent).toContain("UNTRUSTED DATA");
  });

  /*
   * §34, §98 and FIX §16–§18 — what the context tests are actually for.
   *
   * There used to be one assertion here: the planner pack is strictly smaller than the
   * audit's. The intent was right and the assertion was the wrong shape — "smaller than
   * an audit, forever, for every Move" is not a property of a correct planner. A Move
   * spanning four lenses with heavy evidence behind each could legitimately need more
   * context than a thin audit of a small product, and the test would have made that a
   * failure rather than a finding. A test that fires on correct behaviour eventually
   * gets satisfied by making the behaviour worse.
   *
   * So the invariants below are the **architectural** property instead — the planner
   * receives the source judgment and the product's own understanding, and nothing else
   * — plus one fixture-scoped size expectation, clearly labelled as a fixture
   * expectation rather than a product rule.
   */

  it("excludes evidence the source judgment never cited", () => {
    const source = fakePlannerSource({
      citedEvidenceIds: ["profile.identity.description"],
    });
    const full = buildEvidencePackV3(sources());
    const focused = buildPlannerPack({ source, pack: full });

    const scanner = focused.items.filter(
      (item) => item.category !== "product_profile" && item.category !== "founder_intent",
    );

    // Every surviving scanner line is one the Move, the conclusion or its lenses
    // pointed at. Nothing arrives because it happened to be in the pack (§36).
    for (const item of scanner) {
      expect(source.citedEvidenceIds).toContain(item.id);
    }
    // …and the audit genuinely held scanner evidence that did not survive, so the
    // assertion above is not vacuously true.
    const droppedScannerLines = full.items.filter(
      (item) =>
        item.category !== "product_profile" &&
        item.category !== "founder_intent" &&
        !source.citedEvidenceIds.includes(item.id),
    );
    expect(droppedScannerLines.length).toBeGreaterThan(0);
  });

  it("excludes evidence belonging to lenses this Move does not touch", () => {
    const source = fakePlannerSource({ citedEvidenceIds: ["profile.identity.description"] });
    const focused = buildPlannerPack({ source, pack: buildEvidencePackV3(sources()) });
    const ids = new Set(focused.items.map((item) => item.id));

    // An unrelated lens's evidence — payments, for an audience Move — must not travel.
    expect(ids.has("repo.surface.payments")).toBe(false);
  });

  it("does not resend the audit's broad business reasoning", () => {
    const source = fakePlannerSource();
    const request = buildActionPlanRequest(
      source,
      buildPlannerPack({ source, pack: buildEvidencePackV3(sources()) }),
      ACTION_PLANNING_CONFIG,
    );

    // The five scored dimensions and the audit's other conclusions are the audit's
    // work, already done. Sending them invites the planner to re-audit (§4).
    expect(request.userContent).not.toContain("Technical breakdown");
    expect(request.userContent).not.toContain("Overall business readiness");
  });

  it("stays within the operation's configured input budget", async () => {
    const provider = planProvider();
    await runActionPlanning(input(provider));

    // The budget is the real, enforced constraint — it refuses a request rather than
    // trimming silently — so this is the size assertion that belongs in the suite.
    const counted = provider.countRequests.length;
    expect(counted).toBe(1);
    expect(ACTION_PLANNING_CONFIG.maxInputTokens).toBeLessThan(
      // Smaller than the audit's own ceiling, which is the economic intent stated as a
      // configuration fact rather than as a per-run invariant.
      BUSINESS_READINESS_AUDIT_CONFIG.maxInputTokens,
    );
  });

  /**
   * A **fixture** expectation, not a product invariant (FIX §17).
   *
   * On this fixture the focused pack is smaller than the audit's, and it should be —
   * that is the whole reason `evidence.ts` exists. If it ever stops being true, the
   * right response is to read the diff and decide, not to assume a regression: the real
   * economic answer comes from the dogfood's measured cost (§18), which is recorded and
   * has not been removed.
   */
  it("is smaller than the audit pack on this fixture", () => {
    const source = fakePlannerSource();
    const full = buildEvidencePackV3(sources());
    const focused = buildPlannerPack({ source, pack: full });

    expect(focused.items.length).toBeLessThan(full.items.length);
  });

  it("always keeps what Vibe understands about the product", () => {
    const source = fakePlannerSource({ citedEvidenceIds: [] });
    const focused = buildPlannerPack({ source, pack: buildEvidencePackV3(sources()) });

    // A plan built without the profile would be a template (§33).
    expect(focused.items.some((item) => item.category === "product_profile")).toBe(true);
  });

  it("keeps every id the source judgment cited", () => {
    const source = fakePlannerSource();
    const focused = buildPlannerPack({ source, pack: buildEvidencePackV3(sources()) });
    const ids = new Set(focused.items.map((item) => item.id));

    for (const cited of source.citedEvidenceIds) {
      // Only assert for ids the real pack actually contains — the fixture cites
      // a superset on purpose, so a missing id here would be a real narrowing bug.
      if (buildEvidencePackV3(sources()).items.some((item) => item.id === cited)) {
        expect(ids.has(cited)).toBe(true);
      }
    }
  });
});
