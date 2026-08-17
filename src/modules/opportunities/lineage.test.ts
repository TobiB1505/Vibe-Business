import { describe, expect, it } from "vitest";
import { conclusionKeySet } from "@/modules/business-audit/conclusions";
import { fakePlannedAudit } from "@/modules/action-plans/test-support";
import { renderOpportunityInput } from "./render";
import { buildEvidencePackV3 } from "@/modules/business-audit/evidence-v3";
import {
  fakeAuthenticatedSnapshot,
  fakeFounderIntent,
  fakeLiveSnapshot,
  fakeRepositorySnapshot,
} from "@/modules/business-audit/test-support";
import { fakeProductProfile } from "@/modules/product-understanding/test-support";
import { FAKE_EVIDENCE_IDS, fakeWireOpportunity } from "./test-support";
import { validateOpportunityOutput } from "./validate";

/**
 * Where the Move → Conclusion lineage is **created** (CORE-2b FIX §2, §19).
 *
 * Its sibling `lineage-resolution.test.ts` covers where it is **read** — which
 * finding each stored Move answers, and what the screen does with that.
 *
 * The engine has always known which conclusion each Move addresses; it simply never
 * recorded it. These tests hold the two halves of recording it honestly: the keys are
 * shown to the model, and a key the model returns is verified against the audit rather
 * than trusted.
 */

const AUDIT = fakePlannedAudit();
const KEYS = conclusionKeySet(AUDIT);

function validate(overrides: Parameters<typeof fakeWireOpportunity>[0] = {}) {
  return validateOpportunityOutput([fakeWireOpportunity(overrides)], FAKE_EVIDENCE_IDS, KEYS);
}

describe("the audit is rendered with conclusion ids", () => {
  it("shows a key beside every conclusion", () => {
    const rendered = renderOpportunityInput({
      audit: AUDIT,
      pack: buildEvidencePackV3({
        productProfile: fakeProductProfile(),
        founderIntent: fakeFounderIntent(),
        repository: fakeRepositorySnapshot(),
        liveProduct: fakeLiveSnapshot(),
        authenticatedProduct: fakeAuthenticatedSnapshot(),
      }),
    });

    // The model cannot cite an id it was never shown, so this is the precondition for
    // every other test in this file.
    expect(rendered).toContain("{blocker-1}");
    expect(rendered).toContain("Every opportunity must name the id of the conclusion");
  });
});

describe("a cited conclusion key", () => {
  it("is recorded when the audit actually contains it", () => {
    const result = validate({ sourceConclusionKey: "blocker-1" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.opportunities[0].sourceConclusionKey).toBe("blocker-1");
  });

  /**
   * Rule 45's shape, applied to lineage: an unverifiable reference is dropped rather
   * than stored. A fabricated key would be worse than a missing one — the planner
   * trusts a stored key completely, and would plan against a problem nobody drew.
   */
  it("is dropped when the audit does not contain it", () => {
    const result = validate({ sourceConclusionKey: "blocker-9" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.opportunities[0].sourceConclusionKey).toBeNull();
    expect(result.result.notes.join(" ")).toContain("does not exist");
  });

  /**
   * A Move that addresses no single conclusion is unusual and legitimate.
   *
   * It is not grounds for discarding the opportunity — enforcing a planning
   * prerequisite inside prioritization would let the Action Planner's needs delete a
   * Move a founder should see. The planner refuses to plan it instead.
   */
  it("may be absent without costing the opportunity", () => {
    const result = validate({ sourceConclusionKey: "" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.opportunities).toHaveLength(1);
    expect(result.result.opportunities[0].sourceConclusionKey).toBeNull();
  });

  /**
   * Degrading safely when the caller supplies no key set at all.
   *
   * "Nothing is verifiable" must mean "record nothing", never "trust everything" — an
   * unverified lineage is worse than a missing one.
   */
  it("is dropped when no keys can be verified", () => {
    const result = validateOpportunityOutput(
      [fakeWireOpportunity({ sourceConclusionKey: "blocker-1" })],
      FAKE_EVIDENCE_IDS,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.opportunities[0].sourceConclusionKey).toBeNull();
  });

  it("ignores a non-string the transport let through", () => {
    const result = validate({ sourceConclusionKey: 7 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.opportunities[0].sourceConclusionKey).toBeNull();
  });
});
