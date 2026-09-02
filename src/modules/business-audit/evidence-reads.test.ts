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
import {
  actionPlanReadinessFrom,
  getActionPlanReadiness,
  readActionPlanReadinessInputs,
} from "@/modules/action-plans/service";
import {
  getAuditAccessStatus,
  getAuditCurrency,
  getAuditReadiness,
  readAuditEvidence,
} from "./service";

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

const EVIDENCE_TABLES = [
  "repository_intelligence_snapshots",
  "live_product_intelligence_snapshots",
  "authenticated_product_intelligence_snapshots",
  "product_profiles",
  "business_readiness_audits",
];

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

/* ---------------------------------------------------------------------------
 * The two call sites that were not sharing (PERF-004, PERF-005)
 * ------------------------------------------------------------------------ */

/**
 * The prefetch parameter above is only worth having where it is passed, and
 * two call sites on the two heaviest routes were not passing it.
 *
 * `getAuditAccessStatus` took no evidence at all, so Business Health read the
 * pack, handed it to the two read models beside this one, and then this one
 * read the whole pack again. The Action Plan was the same mistake multiplied:
 * every input readiness needs is project-scoped, and it asked for all of them
 * once per Move on screen.
 */
describe("the evidence a caller already holds is not read again", () => {
  it("answers the audit entitlement without a second pass over the pack", async () => {
    const supabase = client();
    const evidence = await readAuditEvidence(supabase, PROJECT);

    await getAuditAccessStatus(supabase, { projectId: PROJECT, userId: USER }, evidence);

    for (const table of EVIDENCE_TABLES.filter((t) => t !== "business_readiness_audits")) {
      expect(readsOf(recorder, table), `${table} was read again for the entitlement`).toBe(1);
    }

    /*
     * The audit table is the exception, and counting reads of it would be the
     * wrong assertion: the entitlement asks it three further questions of its
     * own — has one completed, is one running, how many started recently —
     * and those are narrow, differently-filtered reads rather than a second
     * copy of anything.
     *
     * What must not happen twice is the *document*. Only the pack's own read
     * selects `result`, which is the multi-hundred-kilobyte column.
     */
    const documentReads = selectsOf(recorder, "business_readiness_audits").filter((columns) =>
      columns.includes("result"),
    );
    expect(documentReads, "the audit document was transferred twice").toHaveLength(1);

    /*
     * This fixture has no completed audit, which is the sharp case rather than
     * a gap in it: the pack's answer is `null`, and reaching for the prefetched
     * value with `??` would treat that real answer as an absent one and read
     * the table again to rediscover it. Branching on whether the pack was given
     * is what makes "no audit" shareable.
     */
  });

  it("still answers for a caller that holds nothing", async () => {
    // The parameter is an optimisation, never a requirement — the same
    // property the readiness fallback above asserts.
    const status = await getAuditAccessStatus(client(), { projectId: PROJECT, userId: USER });

    expect(status.blockedReason).not.toBe(undefined);
  });

  it("reads what every Move shares once, however many Moves there are", async () => {
    const supabase = client();
    const inputs = await readActionPlanReadinessInputs(supabase, PROJECT);

    const before = { ...recorder };
    const answers = ["move_a", "move_b", "move_c", "move_d", "move_e"].map((id) =>
      actionPlanReadinessFrom(inputs, id),
    );

    expect(answers).toHaveLength(5);
    expect(
      recorder.reads.length,
      "deriving readiness for a Move must not reach the database at all",
    ).toBe(before.reads.length);
  });

  it("gives one Move the same answer whether the caller shared inputs or not", async () => {
    const supabase = client();
    const inputs = await readActionPlanReadinessInputs(supabase, PROJECT);

    expect(actionPlanReadinessFrom(inputs, null)).toEqual(
      await getActionPlanReadiness(supabase, PROJECT, null),
    );
  });
});
