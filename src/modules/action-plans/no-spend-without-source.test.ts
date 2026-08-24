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
import { runActionPlanning } from "./runner";
import { resolvePlannerSource } from "./source";
import {
  fakeConclusion,
  fakeOpportunity,
  fakePlannedAudit,
  fakeRepositorySnapshotFor,
  fakeWirePlan,
} from "./test-support";

/**
 * No source conclusion, no paid inference (CORE-2b FIX §7, §9, §21–§23).
 *
 * ## Why this is a type, not an ordering
 *
 * The obvious way to enforce "resolve the source before calling the provider" is to
 * write the calls in that order and add a test that watches. That test passes forever
 * and protects nothing: the next refactor moves a line, and the guarantee is gone with
 * every test still green.
 *
 * So `PlannerSource.conclusion` is non-nullable and `resolvePlannerSource` returns a
 * discriminated result. A planner source cannot be *constructed* without a conclusion,
 * `runActionPlanning` takes one as input, and therefore no code path exists that reaches
 * the provider without one. The tests below pin that property from both directions:
 * unresolvable inputs never produce a source, and the runner cannot be handed one.
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

/** Every way a Move can fail to name its business problem. */
const UNRESOLVABLE = [
  {
    name: "an audit with no conclusions",
    audit: fakePlannedAudit({ synthesis: null }),
    opportunity: fakeOpportunity(),
    reason: "audit_has_no_conclusions",
  },
  {
    name: "a stated key the audit does not contain",
    audit: fakePlannedAudit(),
    opportunity: fakeOpportunity({ sourceConclusionKey: "blocker-9" }),
    reason: "conclusion_not_in_audit",
  },
  {
    name: "a legacy Move matching nothing",
    audit: fakePlannedAudit(),
    opportunity: fakeOpportunity({
      sourceConclusionKey: null,
      evidenceIds: ["repo.surface.payments"],
      primaryDimension: "distribution",
      secondaryDimensions: [],
    }),
    reason: "no_legacy_match",
  },
  {
    name: "a legacy Move matching two conclusions equally",
    audit: fakePlannedAudit({
      synthesis: {
        version: "business-audit-synthesis-v7",
        lenses: [],
        overall: "…",
        strengths: [],
        blockers: [
          fakeConclusion({ rootProblem: "First candidate." }),
          fakeConclusion({ rootProblem: "Second, equally plausible candidate." }),
        ],
      },
    }),
    opportunity: fakeOpportunity({ sourceConclusionKey: null }),
    reason: "ambiguous_legacy_match",
  },
] as const;

describe("an unresolvable source never becomes a planner source", () => {
  for (const scenario of UNRESOLVABLE) {
    it(`refuses ${scenario.name}`, () => {
      const resolution = resolvePlannerSource(scenario.audit, scenario.opportunity);

      expect(resolution.resolved).toBe(false);
      if (resolution.resolved) return;
      expect(resolution.reason).toBe(scenario.reason);
      // No partial source, no null-conclusion source, nothing a caller could pass on.
      expect(resolution).not.toHaveProperty("source");
    });
  }
});

describe("the provider is unreachable without a source", () => {
  /**
   * §23 — the ordering property, proven at the only place it can be: a caller that
   * follows the contract cannot reach the provider, because there is nothing to call it
   * with. `runActionPlanning` requires a `PlannerSource`, and no unresolvable input
   * produces one.
   */
  for (const scenario of UNRESOLVABLE) {
    it(`spends nothing on ${scenario.name}`, async () => {
      const provider = new FakeProvider({
        result: {
          ok: true,
          data: fakeWirePlan(),
          usage: { inputTokens: 1, outputTokens: 1, thinkingTokens: 0 },
          model: "claude-sonnet-5",
          latencyMs: 1,
        },
      });

      const resolution = resolvePlannerSource(scenario.audit, scenario.opportunity);

      // The production sequence: resolve, then call. There is no `else` branch to
      // write, because there is no source to call with.
      if (resolution.resolved) {
        await runActionPlanning({
          source: resolution.source,
          pack: buildEvidencePackV3(sources()),
          repository: fakeRepositorySnapshotFor(),
          provider,
          config: ACTION_PLANNING_CONFIG,
        });
      }

      // Neither the billable call nor the free token count was reached. The count is
      // asserted too: it is free, but reaching it means the gate ran in the wrong place.
      expect(provider.requests).toHaveLength(0);
      expect(provider.countRequests).toHaveLength(0);
    });
  }

  it("does spend once the source resolves", async () => {
    const provider = new FakeProvider({
      result: {
        ok: true,
        data: fakeWirePlan(),
        usage: { inputTokens: 3_000, outputTokens: 1_200, thinkingTokens: 800 },
        model: "claude-sonnet-5",
        latencyMs: 20_000,
      },
    });

    const resolution = resolvePlannerSource(fakePlannedAudit(), fakeOpportunity());
    expect(resolution.resolved).toBe(true);
    if (!resolution.resolved) return;

    const outcome = await runActionPlanning({
      source: resolution.source,
      pack: buildEvidencePackV3(sources()),
      repository: fakeRepositorySnapshotFor(),
      provider,
      config: ACTION_PLANNING_CONFIG,
    });

    // The contrast that makes the tests above meaningful rather than vacuous.
    expect(outcome.ok).toBe(true);
    expect(provider.requests).toHaveLength(1);
  });
});
