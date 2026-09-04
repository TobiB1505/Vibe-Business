import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startCluster, type Cluster } from "./harness";

/**
 * Every pack version that carries a Product Profile must record which one.
 *
 * ## Why this needs a real PostgreSQL
 *
 * Because the guarantee is a CHECK constraint, and the thing that depends on
 * it is not TypeScript either. `pack-provenance.ts` recomputes an audit's own
 * `input_hash` from the row's versions and a fresh load of its five sources —
 * the only check that can see the Deep Scan, which has no column at all — and
 * it trusts `product_profile_id`, both profile version columns and
 * `founder_intent_hash` to be present for every version in
 * `HASH_VERIFIABLE_PACKS`. Nothing in the application enforces that. The
 * database does, or nobody does.
 *
 * ## Why it exists now rather than in August
 *
 * Migration 20260824012509 widened this constraint for `business-evidence.v4`
 * and shipped without a test. It has been guarding a value nothing writes ever
 * since: from 2026-08-24 the audit built a v4 pack and recorded v3, so no row
 * has ever carried v4. A test here would not have caught that — it is a
 * different defect, pinned in `current-pack-version.test.ts` — but it would
 * have made the constraint's real subject visible, which is the version list,
 * and the version list is what has to grow every time a pack does.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Every version the constraint names, and one it deliberately does not. */
const GUARDED = ["business-evidence.v3", "business-evidence.v4", "business-evidence.v5"];
const UNGUARDED = "business-evidence.v2";

let db: Cluster;
let projectId: string;
let repositorySnapshotId: string;
let liveSnapshotId: string;
let profileId: string;

beforeAll(() => {
  db = startCluster(REPO_ROOT);

  /* The shared full-depth fixture, so this file seeds no chain of its own. */
  db.sql(readFileSync(join(REPO_ROOT, "supabase", "tests", "fixture.sql"), "utf8"));
  db.sql(`select project_id from public.build_lifecycle_fixture('packs');`);

  projectId = db.sql(`select id from public.projects where name = 'packs' limit 1;`);
  repositorySnapshotId = db.sql(
    `select id from public.repository_intelligence_snapshots where project_id = '${projectId}' limit 1;`,
  );
  liveSnapshotId = db.sql(
    `select id from public.live_product_intelligence_snapshots where project_id = '${projectId}' limit 1;`,
  );
  profileId = db.sql(
    `select id from public.product_profiles where project_id = '${projectId}' limit 1;`,
  );
}, 300_000);

afterAll(() => db?.stop());

/**
 * An audit row, with the traceability columns present unless a test drops one.
 *
 * `null` for a column means "omit it", which is the state the constraint
 * exists to refuse.
 */
function auditRow(packVersion: string, traceability: Record<string, string | null>): string {
  const columns: Record<string, string> = {
    project_id: `'${projectId}'`,
    repository_snapshot_id: `'${repositorySnapshotId}'`,
    live_snapshot_id: `'${liveSnapshotId}'`,
    business_context_hash: `'${"b".repeat(64)}'`,
    input_hash: `'${"c".repeat(64)}'`,
    schema_version: `'business-audit-schema-v1'`,
    audit_version: `'business-audit-v3'`,
    evidence_pack_version: `'${packVersion}'`,
    prompt_version: `'p'`,
    rubric_version: `'r'`,
    provider: `'anthropic'`,
    model: `'claude-sonnet-5'`,
    access_mode: `'credits'`,
    /*
     * Terminal, and complete. `business_readiness_audits_single_in_flight_idx`
     * admits one non-terminal audit per project, so a row-per-test fixture has
     * to finish; `..._completed_has_result` then requires the document and a
     * count. Neither is what this file is testing, and both have to be
     * satisfied for it to reach the constraint that is.
     */
    status: `'completed'`,
    completed_at: `now()`,
    result: `'{}'::jsonb`,
    assessed_lenses: `9`,
  };

  for (const [column, value] of Object.entries(traceability)) {
    if (value !== null) columns[column] = value;
  }

  return (
    `insert into public.business_readiness_audits (${Object.keys(columns).join(", ")})` +
    ` values (${Object.values(columns).join(", ")});`
  );
}

const COMPLETE: Record<string, string> = {
  product_profile_id: "null",
  product_profile_schema_version: `'product-profile-v1'`,
  product_profile_builder_version: `'profile-builder-v1'`,
  founder_intent_hash: `'${"d".repeat(64)}'`,
};

/** The complete traceability set, with one column knocked out per test. */
function withProfile(overrides: Record<string, string | null> = {}): Record<string, string | null> {
  return { ...COMPLETE, product_profile_id: `'${profileId}'`, ...overrides };
}

describe("a guarded pack version must record its Product Profile", () => {
  it.each(GUARDED)("accepts %s with the full traceability set", (version) => {
    expect(() => db.sql(auditRow(version, withProfile()))).not.toThrow();
  });

  it.each(GUARDED)("refuses %s without a Product Profile id", (version) => {
    const error = db.sqlExpectingError(
      auditRow(version, withProfile({ product_profile_id: null })),
    );

    expect(error).toContain("business_readiness_audits_v3_has_profile");
  });

  it.each(GUARDED)("refuses %s without a founder intent hash", (version) => {
    const error = db.sqlExpectingError(
      auditRow(version, withProfile({ founder_intent_hash: null })),
    );

    expect(error).toContain("business_readiness_audits_v3_has_profile");
  });

  it.each(GUARDED)("refuses %s without both profile version columns", (version) => {
    for (const column of ["product_profile_schema_version", "product_profile_builder_version"]) {
      const error = db.sqlExpectingError(auditRow(version, withProfile({ [column]: null })));

      expect(error, column).toContain("business_readiness_audits_v3_has_profile");
    }
  });
});

/**
 * The other half, and the reason the constraint names versions rather than a
 * date: a pre-CORE-2 row genuinely has no profile to record, and refusing it
 * would make old rows un-writable rather than making new ones honest.
 */
describe("a pack version from before the Product Profile is left alone", () => {
  it(`accepts ${UNGUARDED} with no traceability at all`, () => {
    expect(() =>
      db.sql(
        auditRow(UNGUARDED, {
          product_profile_id: null,
          product_profile_schema_version: null,
          product_profile_builder_version: null,
          founder_intent_hash: null,
        }),
      ),
    ).not.toThrow();
  });
});
