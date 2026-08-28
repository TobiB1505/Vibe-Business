import { beforeEach, describe, expect, it } from "vitest";
import {
  FakeDatabase,
  fakeSupabase,
  newQueryRecorder,
  readsOf,
  seedProductUnderstanding,
  selectsOf,
  type QueryRecorder,
} from "@/modules/operations/test-support";
import { hasSuccessfulSnapshot } from "@/modules/repository-intelligence/store";
import { getAuditCurrency, getAuditReadiness, readAuditEvidence } from "./service";

/**
 * How many times one Business Health render asks for the same document
 * (VB-022).
 *
 * ## Why this is measured rather than reasoned about
 *
 * Because the duplication is invisible at every call site. `getAuditReadiness`
 * needs the repository snapshot; so does `getAuditCurrency`; so does the
 * profile-currency check inside the first; so does the page itself. Each is
 * correct on its own, each is a single `await` inside a `Promise.all`, and the
 * cost only exists in the total — which is the same shape VB-023 found on the
 * Agent screen and the same reason a source assertion cannot see it.
 *
 * These documents are not small. `repository_intelligence_snapshots.result` and
 * the audit document are multi-hundred-kilobyte JSONB, and this is the
 * most-visited route in the product.
 */

const USER = "user_1";
const PROJECT = "project_1";

let db: FakeDatabase;
let recorder: QueryRecorder;

function client() {
  return fakeSupabase(db, recorder);
}

function seed() {
  db.seed("projects", { id: PROJECT, user_id: USER, production_url: "https://acme.test" });
  db.seed("repository_intelligence_snapshots", {
    id: "snapshot_1",
    project_id: PROJECT,
    status: "completed",
    result: { schemaVersion: "repository_intelligence.v1" },
    created_at: "2026-02-01T00:00:00.000Z",
  });
  db.seed("live_product_intelligence_snapshots", {
    id: "live_1",
    project_id: PROJECT,
    status: "completed",
    result: { schemaVersion: "live_product_intelligence.v1" },
    created_at: "2026-02-01T00:00:00.000Z",
  });

  // A project with a profile is the state that reaches every branch. Without
  // one, `getAuditCurrency` returns before it looks at anything and the
  // duplication this measures never happens.
  seedProductUnderstanding(db, { projectId: PROJECT });
}

beforeEach(() => {
  db = new FakeDatabase();
  recorder = newQueryRecorder();
  seed();
});

describe("the reads Business Health makes", () => {
  /*
   * The page's own composition, reduced to the three read models that share
   * evidence. The route awaits thirteen; these are the ones the audit measured
   * fetching the same documents over and over.
   */
  async function healthReads() {
    const supabase = client();
    const evidence = await readAuditEvidence(supabase, PROJECT);
    await Promise.all([
      getAuditReadiness(supabase, PROJECT, evidence),
      getAuditCurrency(supabase, PROJECT, evidence),
    ]);
  }

  const EVIDENCE_TABLES = [
    "repository_intelligence_snapshots",
    "live_product_intelligence_snapshots",
    "authenticated_product_intelligence_snapshots",
    "product_profiles",
    "business_readiness_audits",
  ];

  it("asks for each evidence document exactly once", async () => {
    await healthReads();

    for (const table of EVIDENCE_TABLES) {
      expect(readsOf(recorder, table), `${table} was not read exactly once`).toBe(1);
    }
  });

  it("still reads for itself when a caller has nothing to share", async () => {
    /*
     * The prefetch is an optimisation for a page that is reading all of this
     * anyway, never a requirement. A Server Action or a workflow step calling
     * one read model on its own must still get an answer — so the parameter is
     * optional, and this is what says the fallback is real rather than a shape
     * nothing exercises.
     */
    const readiness = await getAuditReadiness(client(), PROJECT);

    expect(readiness.missing).toEqual([]);
    expect(readsOf(recorder, "repository_intelligence_snapshots")).toBe(1);
  });

  it("never asks for a document in order to test a boolean", async () => {
    /*
     * The other half of VB-022, and the half counting cannot see: a read that
     * happens once is still wasteful if it drags a two-hundred-kilobyte
     * analyzer result across the wire so a caller can write
     * `Boolean(snapshot?.result)`.
     *
     * `status = 'completed'` is the same predicate by CHECK constraint —
     * `repository_intelligence_completed_has_result` — so the existence read
     * cannot answer differently from the document read it replaces.
     */
    expect(await hasSuccessfulSnapshot(client(), PROJECT)).toBe(true);

    for (const columns of selectsOf(recorder, "repository_intelligence_snapshots")) {
      expect(columns, "an existence check pulled the analyzer document").not.toContain("result");
    }
  });

  it("gives the same answer either way", async () => {
    const supabase = client();
    const evidence = await readAuditEvidence(supabase, PROJECT);

    expect(await getAuditReadiness(supabase, PROJECT, evidence)).toEqual(
      await getAuditReadiness(supabase, PROJECT),
    );
    expect(await getAuditCurrency(supabase, PROJECT, evidence)).toEqual(
      await getAuditCurrency(supabase, PROJECT),
    );
  });
});
