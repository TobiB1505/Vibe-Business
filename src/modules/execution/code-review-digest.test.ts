import { describe, expect, it } from "vitest";
import { computeCodeReviewDigest } from "./code-review-digest";

/**
 * The identity of a rendered diff (Sprint 0055 §3, ADR 0063).
 *
 * One property carries the file, and it is the one that makes this admissible
 * as approval evidence at all: the same two commits and the same paths produce
 * the same digest, and anything that would change what a person was shown
 * produces a different one.
 */

const base = {
  projectId: "project_1",
  preparedChangeId: "prepared_1",
  preparedBaseSha: "a".repeat(40),
  preparedCommitSha: "b".repeat(40),
  paths: ["src/lib/pricing.ts", "src/lib/retail.ts"],
};

describe("computeCodeReviewDigest", () => {
  it("is stable for the same diff", () => {
    expect(computeCodeReviewDigest(base)).toBe(computeCodeReviewDigest(base));
  });

  it("does not depend on the order the paths arrive in", () => {
    // A caller's iteration order is not part of what a person looked at.
    expect(computeCodeReviewDigest({ ...base, paths: [...base.paths].reverse() })).toBe(
      computeCodeReviewDigest(base),
    );
  });

  it("changes when any part of what was shown changes", () => {
    const digest = computeCodeReviewDigest(base);

    for (const change of [
      { preparedBaseSha: "c".repeat(40) },
      { preparedCommitSha: "d".repeat(40) },
      { paths: [...base.paths, "src/lib/added.ts"] },
      { paths: ["src/lib/pricing.ts"] },
      { projectId: "project_2" },
      { preparedChangeId: "prepared_2" },
    ]) {
      expect(computeCodeReviewDigest({ ...base, ...change })).not.toBe(digest);
    }
  });

  it("is a sha256 hex digest", () => {
    expect(computeCodeReviewDigest(base)).toMatch(/^[0-9a-f]{64}$/);
  });
});
