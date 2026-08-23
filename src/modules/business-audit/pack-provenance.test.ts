import { describe, expect, it } from "vitest";
import { verifyPackProvenance } from "./pack-provenance";

/**
 * The rebuild-provenance check.
 *
 * A consumer that rebuilds the audit's evidence pack loads the *latest*
 * snapshot of each kind, not the audit's. This is the only thing standing
 * between that and a paid call that reasons over one run's evidence using
 * another run's conclusions.
 */

const AUDIT = {
  repositorySnapshotId: "repo_1",
  liveSnapshotId: "live_1",
  productProfileId: "profile_1",
  founderIntentHash: "c".repeat(64),
};

const LOADED = {
  repositorySnapshotId: "repo_1",
  liveSnapshotId: "live_1",
  productProfileId: "profile_1",
  founderIntentHash: "c".repeat(64),
};

describe("the rebuild came from the audit's observations", () => {
  it("passes when every recorded source matches", () => {
    expect(verifyPackProvenance(AUDIT, LOADED)).toEqual({ matches: true });
  });

  it.each([
    ["repository", { repositorySnapshotId: "repo_2" }],
    ["live", { liveSnapshotId: "live_2" }],
    ["product_profile", { productProfileId: "profile_2" }],
    ["founder_intent", { founderIntentHash: "d".repeat(64) }],
  ])("names %s when that one moved", (diverged, moved) => {
    expect(verifyPackProvenance(AUDIT, { ...LOADED, ...moved })).toEqual({
      matches: false,
      diverged,
    });
  });
});

describe("what a null on the audit row means", () => {
  /**
   * `product_profile_id` and `founder_intent_hash` are nullable by design: rows
   * written before CORE-2 have neither, and back-filling one would be inventing
   * a fact. A pre-CORE-2 audit keeps exactly the coverage it always had for
   * those, and gains the snapshot check — which is strictly more than nothing.
   */
  it("skips a profile the audit never recorded", () => {
    expect(
      verifyPackProvenance(
        { ...AUDIT, productProfileId: null, founderIntentHash: null },
        { ...LOADED, productProfileId: "anything", founderIntentHash: "e".repeat(64) },
      ),
    ).toEqual({ matches: true });
  });

  /**
   * The snapshot ids are the opposite case, and the distinction is the point.
   *
   * They are `not null` on the table and have been since it existed, so a null
   * here cannot come from production — only from a fixture describing an audit
   * that could not exist. Skipping it would make the guard pass vacuously
   * wherever a test forgot to seed one, which is precisely how a guard ends up
   * green and absent at the same time.
   */
  it.each(["repositorySnapshotId", "liveSnapshotId"] as const)(
    "refuses rather than skips when %s is absent",
    (field) => {
      const verdict = verifyPackProvenance({ ...AUDIT, [field]: null }, LOADED);
      expect(verdict.matches).toBe(false);
    },
  );
});
