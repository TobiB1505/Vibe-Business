import { describe, expect, it } from "vitest";
import { verifyPackProvenance, type LoadedPackSources } from "./pack-provenance";
import { computeAuditInputHash, type StoredAudit } from "./store";

/**
 * The rebuild-provenance check.
 *
 * A consumer that rebuilds the audit's evidence pack loads the *latest*
 * snapshot of each kind, not the audit's. This is the only thing standing
 * between that and a paid call that reasons over one run's evidence using
 * another run's conclusions.
 */

const SOURCES: LoadedPackSources = {
  repositorySnapshotId: "repo_1",
  liveSnapshotId: "live_1",
  productProfileId: "profile_1",
  founderIntentHash: "c".repeat(64),
  authenticatedSnapshotId: "auth_1",
};

const VERSIONS = {
  schemaVersion: "business-readiness-audit.v1",
  auditVersion: "business-audit-v1",
  promptVersion: "business-audit-prompt-v2",
  rubricVersion: "business-readiness-rubric-v1",
  productProfileSchemaVersion: "product-profile.v1",
  productProfileBuilderVersion: "profile-builder-v1",
  provider: "anthropic",
  model: "claude-sonnet-5",
};

/**
 * The same nine versions, in the shape the identity function names them.
 *
 * `StoredAudit` mirrors the column names and `computeAuditInputHash` predates
 * them, so `product_profile_schema_version` is `profileSchemaVersion` there.
 * Written out rather than spread, so the two shapes cannot quietly diverge.
 */
function hashFor(sources: LoadedPackSources, evidencePackVersion: string, promptVersion?: string) {
  return computeAuditInputHash({
    ...sources,
    schemaVersion: VERSIONS.schemaVersion,
    auditVersion: VERSIONS.auditVersion,
    evidencePackVersion,
    promptVersion: promptVersion ?? VERSIONS.promptVersion,
    rubricVersion: VERSIONS.rubricVersion,
    profileSchemaVersion: VERSIONS.productProfileSchemaVersion,
    profileBuilderVersion: VERSIONS.productProfileBuilderVersion,
    provider: VERSIONS.provider,
    model: VERSIONS.model,
  });
}

/** An audit row whose `input_hash` genuinely is the digest of `sources`. */
function audit(
  overrides: Partial<StoredAudit> = {},
  sources: LoadedPackSources = SOURCES,
): StoredAudit {
  const evidencePackVersion = overrides.evidencePackVersion ?? "business-evidence.v3";
  return {
    id: "audit_1",
    projectId: "project_1",
    status: "completed",
    accessMode: "credits",
    inputHash: hashFor(sources, evidencePackVersion),
    overallScore: 40,
    failureCode: null,
    result: null,
    productProfileId: sources.productProfileId,
    founderIntentHash: sources.founderIntentHash,
    repositorySnapshotId: sources.repositorySnapshotId,
    liveSnapshotId: sources.liveSnapshotId,
    evidencePackVersion,
    ...VERSIONS,
    createdAt: "2026-08-02T00:00:00.000Z",
    completedAt: "2026-08-02T00:00:00.000Z",
    ...overrides,
  };
}

describe("a v3 audit is verified through its own identity hash", () => {
  it("passes when the rebuild loaded the same five sources", () => {
    expect(verifyPackProvenance(audit(), SOURCES)).toEqual({
      matches: true,
      verifiedBy: "input_hash",
    });
  });

  /**
   * All five, including the Deep Scan.
   *
   * `authenticatedSnapshotId` has no column on `business_readiness_audits`, so
   * it is the one source a field-by-field comparison structurally cannot see.
   * Through the hash it is covered exactly like the other four — which is the
   * whole reason this check recomputes rather than compares.
   */
  it.each([
    ["repository", { repositorySnapshotId: "repo_2" }],
    ["live", { liveSnapshotId: "live_2" }],
    ["product profile", { productProfileId: "profile_2" }],
    ["founder intent", { founderIntentHash: "d".repeat(64) }],
    ["Deep Scan", { authenticatedSnapshotId: "auth_2" }],
  ])("refuses when the %s moved", (_name, moved) => {
    expect(verifyPackProvenance(audit(), { ...SOURCES, ...moved })).toEqual({
      matches: false,
      verifiedBy: "input_hash",
      diverged: "unattributed",
    });
  });

  /**
   * "No Deep Scan" is a fact, not a missing one.
   *
   * `computeAuditInputHash` carries null through as JSON null rather than
   * mapping it to a sentinel string, so an audit that reasoned without a Deep
   * Scan cannot be satisfied by one appearing later — and cannot be forged by a
   * snapshot whose id happens to match some placeholder.
   */
  it("refuses when a Deep Scan appeared under an audit that had none", () => {
    const without = { ...SOURCES, authenticatedSnapshotId: null };
    expect(verifyPackProvenance(audit({}, without), without).matches).toBe(true);
    expect(verifyPackProvenance(audit({}, without), SOURCES).matches).toBe(false);
  });

  /**
   * The versions come from the row, never from today's constants.
   *
   * A prompt or model bump is a legitimate reason to buy a *new* audit. It is
   * not a reason to refuse to reuse an existing one's conclusions, and checking
   * against the current constants would answer "is this reproducible now?"
   * instead of "are these the observations it reasoned from?".
   */
  it("does not refuse an audit written under older versions", () => {
    const old = audit({ promptVersion: "business-audit-prompt-v1" });
    old.inputHash = hashFor(SOURCES, "business-evidence.v3", "business-audit-prompt-v1");
    expect(verifyPackProvenance(old, SOURCES).matches).toBe(true);
  });
});

/**
 * The trap ADR 0044 named, pinned.
 *
 * The discriminator was `=== "business-evidence.v3"`. On the day a v4 pack
 * shipped, every new audit would have taken the pre-CORE-2 column comparison
 * instead — the weaker path, which cannot see the Deep Scan at all — and
 * nothing would have failed. The strongest provenance guarantee would simply
 * have gone quiet for every audit written from then on.
 */
describe("a newer pack keeps the strong path", () => {
  it("verifies a v4 audit by its identity hash, not by columns", () => {
    const v4 = audit({ evidencePackVersion: "business-evidence.v4" });
    v4.inputHash = hashFor(SOURCES, "business-evidence.v4");

    expect(verifyPackProvenance(v4, SOURCES)).toEqual({
      matches: true,
      verifiedBy: "input_hash",
    });
  });

  it("still sees the Deep Scan move under v4", () => {
    const v4 = audit({ evidencePackVersion: "business-evidence.v4" });
    v4.inputHash = hashFor(SOURCES, "business-evidence.v4");

    // The column path cannot detect this — there is no column for it. If the
    // discriminator ever narrows again, this is the assertion that goes red.
    expect(
      verifyPackProvenance(v4, { ...SOURCES, authenticatedSnapshotId: "auth_2" }),
    ).toEqual({ matches: false, verifiedBy: "input_hash", diverged: "unattributed" });
  });
});

describe("an older audit falls back to the columns it does record", () => {
  /**
   * A pre-CORE-2 row was hashed by an older shape of `computeAuditInputHash`,
   * so recomputing it would refuse forever rather than detect anything.
   * `business_readiness_audits_v3_has_profile` is what makes the split safe: it
   * guarantees the profile columns only for v3.
   */
  const legacy = (overrides: Partial<StoredAudit> = {}) =>
    audit({
      evidencePackVersion: "business-evidence.v2",
      inputHash: "z".repeat(64),
      productProfileId: null,
      productProfileSchemaVersion: null,
      productProfileBuilderVersion: null,
      founderIntentHash: null,
      ...overrides,
    });

  it("passes on the snapshots it can compare, ignoring the unrecorded profile", () => {
    expect(verifyPackProvenance(legacy(), SOURCES)).toEqual({
      matches: true,
      verifiedBy: "recorded_columns",
    });
  });

  it.each([
    ["repository", { repositorySnapshotId: "repo_2" }],
    ["live", { liveSnapshotId: "live_2" }],
  ])("names the %s snapshot when it moved", (name, moved) => {
    expect(verifyPackProvenance(legacy(), { ...SOURCES, ...moved })).toEqual({
      matches: false,
      verifiedBy: "recorded_columns",
      diverged: name,
    });
  });

  /**
   * `repository_snapshot_id` and `live_snapshot_id` are `not null` on the table
   * and have been since it existed, so a null cannot come from production —
   * only from a fixture describing an audit that could not exist. Skipping it
   * would make the guard pass vacuously wherever a test forgot to seed one,
   * which is precisely how a guard ends up green and absent at the same time.
   */
  it.each(["repositorySnapshotId", "liveSnapshotId"] as const)(
    "refuses rather than skips when %s is absent",
    (field) => {
      expect(verifyPackProvenance(legacy({ [field]: null }), SOURCES).matches).toBe(false);
    },
  );

  it("compares the profile when the row does record one", () => {
    const withProfile = legacy({ productProfileId: "profile_1", founderIntentHash: "c".repeat(64) });
    expect(verifyPackProvenance(withProfile, SOURCES).matches).toBe(true);
    expect(
      verifyPackProvenance(withProfile, { ...SOURCES, productProfileId: "profile_2" }),
    ).toEqual({ matches: false, verifiedBy: "recorded_columns", diverged: "product_profile" });
  });
});
