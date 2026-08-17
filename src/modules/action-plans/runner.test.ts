import { describe, expect, it } from "vitest";
import { ACTION_PLANNING_CONFIG } from "@/modules/ai/operations";
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

  /**
   * §34, §98 — the planner's context is a focused selection, not the audit's.
   *
   * If this ever fails because the planner started receiving the whole pack,
   * the cost target in §98 has been lost and the plan is about to become an
   * inventory of what the scanner did not find (§36).
   */
  it("sends less evidence than the audit read", () => {
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
