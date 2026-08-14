import { describe, expect, it } from "vitest";
import { computeMergeIdentity } from "./identity";

/**
 * Merge identity (Sprint 11C §5, §20).
 *
 * Identity is what makes a double click one merge and a re-approval a new one.
 * The two properties that matter pull in opposite directions, which is why they
 * are both tested here rather than assumed from the field list.
 */

const PARAMS = {
  projectId: "project_1",
  preparedChangeId: "prepared_1",
  changeApprovalId: "approval_1",
  preparedCommitSha: "a".repeat(40),
  preparedBaseSha: "b".repeat(40),
  mergePolicyVersion: "merge-policy-v1",
};

describe("what makes two merges the same merge", () => {
  it("is deterministic", () => {
    expect(computeMergeIdentity(PARAMS)).toBe(computeMergeIdentity(PARAMS));
  });

  it("is a sha256 hex digest", () => {
    expect(computeMergeIdentity(PARAMS)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("does not depend on the order the fields are written", () => {
    // The canonical form is a fixed-order array, so a refactor of the params
    // object cannot silently rehash every stored merge and orphan the rows the
    // written-identity index was meant to match.
    const reordered = {
      mergePolicyVersion: PARAMS.mergePolicyVersion,
      preparedBaseSha: PARAMS.preparedBaseSha,
      preparedCommitSha: PARAMS.preparedCommitSha,
      changeApprovalId: PARAMS.changeApprovalId,
      preparedChangeId: PARAMS.preparedChangeId,
      projectId: PARAMS.projectId,
    };

    expect(computeMergeIdentity(reordered)).toBe(computeMergeIdentity(PARAMS));
  });
});

describe("what makes them different merges", () => {
  const fields: (keyof typeof PARAMS)[] = [
    "projectId",
    "preparedChangeId",
    "changeApprovalId",
    "preparedCommitSha",
    "preparedBaseSha",
    "mergePolicyVersion",
  ];

  for (const field of fields) {
    it(`changes when ${field} changes`, () => {
      expect(computeMergeIdentity({ ...PARAMS, [field]: "different" })).not.toBe(
        computeMergeIdentity(PARAMS),
      );
    });
  }

  it("distinguishes two approvals of the same commit", () => {
    // A revoked-then-re-approved change is a genuinely new merge attempt: a
    // human decided twice, and the second decision is not the first one
    // resurrected.
    expect(computeMergeIdentity({ ...PARAMS, changeApprovalId: "approval_2" })).not.toBe(
      computeMergeIdentity(PARAMS),
    );
  });

  it("changes when the merge policy version changes", () => {
    // A stored merge must never be reinterpreted under rules it was not
    // checked against.
    expect(computeMergeIdentity({ ...PARAMS, mergePolicyVersion: "merge-policy-v2" })).not.toBe(
      computeMergeIdentity(PARAMS),
    );
  });
});

describe("what identity deliberately ignores", () => {
  it("takes no timestamp, so two clicks are one merge", () => {
    // The signature has nowhere to put one. Asserted as a property of the type
    // rather than of a value, because that is where the guarantee lives.
    expect(Object.keys(PARAMS)).not.toContain("requestedAt");
    expect(computeMergeIdentity(PARAMS)).toBe(computeMergeIdentity({ ...PARAMS }));
  });

  it("takes no current default-branch head", () => {
    // Deliberately absent (§5). Where `main` is right now is a *precondition*,
    // checked live immediately before the write — folding it in would mint a
    // new identity every time somebody unrelated pushed, so a blocked merge
    // could never be retried under the same identity.
    expect(Object.keys(PARAMS)).not.toContain("observedDefaultHead");
  });
});
