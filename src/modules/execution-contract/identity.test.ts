import { describe, expect, it } from "vitest";
import { BUILD_CHAIN_POLICY_VERSION } from "./chain";
import { computeExecutionSpecIdentity } from "./identity";

/**
 * The execution spec identity, and what a chain does to it.
 *
 * ## Why a frozen digest lives here
 *
 * This identity is not only compared against itself. `computeAgentRunIdentity`
 * hashes it, and `startAgentExecution` returns a **succeeded** run by that
 * identity as `kind: "reused"`. So a change that re-hashes specs which nobody
 * touched does not produce a tidy migration problem — it produces a second
 * Credit reservation for work that was already delivered, because the
 * re-resolution stops finding the run that delivered it.
 *
 * The constant below is that guarantee, written down. Every version string in
 * the fixture is a literal rather than the exported constant, deliberately: a
 * legitimate version bump *should* change the identity, and this test is about
 * the hashing shape rather than about today's constants.
 */

const SOLO = {
  projectId: "11111111-1111-4111-8111-111111111111",
  actionPlanId: "22222222-2222-4222-8222-222222222222",
  stepKey: "2-build-pricing-page",
  baseSha: "a".repeat(40),
  repositorySnapshotId: "33333333-3333-4333-8333-333333333333",
  mode: "agentic",
  executionClass: "application_code_change",
  riskClass: "moderate",
  capability: null,
  capabilityVersion: null,
  businessContextHash: "b".repeat(64),
  absorbedPreparationKeys: [],
  specSchemaVersion: "execution-spec.v1",
  resolverVersion: "execution-resolver-v2",
  policyVersion: "execution-policy-v1",
  riskPolicyVersion: "execution-risk-policy-v2",
};

/** What the sixteen fields above hashed to before build chains existed. */
const SOLO_DIGEST = "ae9a81e27745bd0c699a40d5a2e6515cbf7fe8a1cc4dda2d6de4dee17a488e10";

describe("a run that delivers one step", () => {
  it("hashes to exactly what it always did", () => {
    expect(computeExecutionSpecIdentity(SOLO)).toBe(SOLO_DIGEST);
  });

  it("is unchanged by a chain of one, which is only the head restated", () => {
    // Every spec the builder produces now passes `chainStepKeys`, and for a run
    // of one that list contains the step key already hashed two fields up. If
    // this ever diverges, every stored solo spec is orphaned.
    expect(
      computeExecutionSpecIdentity({
        ...SOLO,
        chainStepKeys: [SOLO.stepKey],
        chainPolicyVersion: BUILD_CHAIN_POLICY_VERSION,
      }),
    ).toBe(SOLO_DIGEST);
  });

  it("is unchanged by an empty chain", () => {
    expect(
      computeExecutionSpecIdentity({ ...SOLO, chainStepKeys: [], chainPolicyVersion: "x" }),
    ).toBe(SOLO_DIGEST);
  });
});

describe("a run that delivers a chain", () => {
  const chained = {
    ...SOLO,
    chainStepKeys: [SOLO.stepKey, "3-link-pricing-page"],
    chainPolicyVersion: BUILD_CHAIN_POLICY_VERSION,
  };

  /*
   * Rule 67, concretely. Without this, a founder who declined the chain and
   * approved a one-step change could have that approval come to sit on a spec
   * claiming two steps: same project, plan, step key, base, snapshot, mode,
   * class, risk, capability, context and versions — same identity — and
   * `startAgentExecution` would return the earlier run as `reused`.
   */
  it("is a different artifact from the same head run alone", () => {
    expect(computeExecutionSpecIdentity(chained)).not.toBe(SOLO_DIGEST);
  });

  it("is a different artifact from a chain of different members", () => {
    expect(
      computeExecutionSpecIdentity({
        ...chained,
        chainStepKeys: [SOLO.stepKey, "3-something-else"],
      }),
    ).not.toBe(computeExecutionSpecIdentity(chained));
  });

  it("is a different artifact from a longer chain with the same prefix", () => {
    expect(
      computeExecutionSpecIdentity({
        ...chained,
        chainStepKeys: [...chained.chainStepKeys, "4-third"],
      }),
    ).not.toBe(computeExecutionSpecIdentity(chained));
  });

  it("is a different artifact under different chain rules", () => {
    // Rule 65: a stored spec must never be reinterpreted under rules it was not
    // resolved under, and the chain policy is one of those rules.
    expect(
      computeExecutionSpecIdentity({ ...chained, chainPolicyVersion: "build-chain-v2" }),
    ).not.toBe(computeExecutionSpecIdentity(chained));
  });

  it("is stable across repeated computation", () => {
    expect(computeExecutionSpecIdentity(chained)).toBe(computeExecutionSpecIdentity({ ...chained }));
  });

  /*
   * Order is meaning here, unlike in a set. `[2, 3]` and `[3, 2]` describe
   * different runs — which step is the head decides the commit subject, the
   * provenance and the price anchor — so they must not collide.
   */
  it("distinguishes chains that differ only in order", () => {
    expect(
      computeExecutionSpecIdentity({
        ...chained,
        chainStepKeys: [...chained.chainStepKeys].reverse(),
      }),
    ).not.toBe(computeExecutionSpecIdentity(chained));
  });
});
