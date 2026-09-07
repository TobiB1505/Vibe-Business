import { beforeEach, describe, expect, it } from "vitest";
import {
  FakeDatabase,
  fakeSupabase,
  newQueryRecorder,
  readsOf,
  type QueryRecorder,
} from "@/modules/operations/test-support";
import { ROBOTS_ABSENCE_EVIDENCE, SITEMAP_ABSENCE_EVIDENCE } from "./capabilities";
import { getMoveWithExecution, getOpportunityExecutionSummaries } from "./service";

/**
 * What reading one Move is allowed to cost.
 *
 * ## The shape this exists to prevent
 *
 * `getMoveWithExecution` asked `getOpportunityExecutionSummaries` for every
 * Move in the set and used one. That is a reuse lookup per supported
 * opportunity — on the product's most-visited route, to answer about a single
 * card — plus a second read of the whole opportunity set, because the plural
 * function reads it again for itself.
 *
 * Neither was visible in the code: the call is one line, and the fan-out is
 * inside a function whose own name says it is about all of them. So it is
 * asserted as a count rather than left to a reader to notice.
 *
 * ## Why the assertion is "does not grow", not a number
 *
 * A fixed total would fail on any honest refactor and would say nothing about
 * the defect. What matters is the shape: reading *one* Move must not depend on
 * how many Moves exist. `MAX_OPPORTUNITIES` caps the set at five today, which
 * bounds the damage and is not a reason for the loop to be there.
 *
 * The set is deliberately all-supported. An unsupported opportunity resolves
 * without touching the database, so a fixture of unsupported Moves would show
 * no fan-out and pass against the broken code.
 */

const PROJECT = "project_move_cost";
const SET = "set_1";
const SNAPSHOT = "snapshot_1";

let db: FakeDatabase;
let recorder: QueryRecorder;

const client = () => fakeSupabase(db, recorder);

/** A snapshot the capability resolver says supports the SEO executor. */
function snapshotResult() {
  return {
    source: {
      commitSha: "c".repeat(40),
      branch: "main",
      analyzerVersion: "v5",
      treeComplete: true,
    },
    frameworks: [{ id: "nextjs", name: "Next.js", confidence: "high", evidence: [] }],
    businessSurfaces: [
      { id: "robots", name: "robots.txt", detected: false, confidence: "high", evidence: [] },
      { id: "sitemap", name: "sitemap.xml", detected: false, confidence: "high", evidence: [] },
    ],
  };
}

/** A Move whose structure — never its wording — resolves to the executor. */
function seedMove(id: string, rank: number) {
  db.seed("business_opportunities", {
    id,
    opportunity_set_id: SET,
    rank,
    source_conclusion_key: "discoverability",
    title: `Move ${rank}`,
    problem: "Search engines cannot see the site.",
    why_now: "Nothing downstream works without it.",
    impact: "high",
    effort: "low",
    confidence: "high",
    category: "distribution",
    primary_lens: "offer",
    secondary_lenses: [],
    evidence_ids: [ROBOTS_ABSENCE_EVIDENCE[0], SITEMAP_ABSENCE_EVIDENCE[0]],
    execution_type: "code_change",
    execution_readiness: "ready",
    dependencies: [],
  });
}

function seed(moves: number) {
  db = new FakeDatabase();
  recorder = newQueryRecorder();

  db.seed("projects", { id: PROJECT, production_url: "https://example.com" });
  db.seed("repository_intelligence_snapshots", {
    id: SNAPSHOT,
    project_id: PROJECT,
    status: "completed",
    source_commit_sha: "c".repeat(40),
    source_branch: "main",
    analyzer_version: "v5",
    completeness: "complete",
    completeness_reasons: [],
    failure_code: null,
    result: snapshotResult(),
    created_at: "2026-08-01T00:00:00.000Z",
    completed_at: "2026-08-01T00:00:00.000Z",
  });
  db.seed("opportunity_sets", {
    id: SET,
    project_id: PROJECT,
    business_audit_id: null,
    status: "completed",
    opportunity_count: moves,
    input_hash: "o".repeat(64),
    created_at: "2026-08-03T00:00:00.000Z",
    completed_at: "2026-08-03T00:00:00.000Z",
  });
  for (let rank = 1; rank <= moves; rank += 1) seedMove(`move_${rank}`, rank);
}

describe("reading one Move", () => {
  beforeEach(() => seed(5));

  /**
   * The fixture has to be a world where the loop would show, or the assertions
   * below pass for the wrong reason. Five supported Moves means the plural
   * function makes five reuse lookups — and this is the test that says so.
   */
  it("describes a set the executor supports", async () => {
    const summaries = await getOpportunityExecutionSummaries(client(), PROJECT);

    expect(summaries).toHaveLength(5);
    expect(summaries.every((entry) => entry.capability !== null)).toBe(true);
    expect(readsOf(recorder, "prepared_changes")).toBe(5);
  });

  /** One card, one reuse lookup. */
  it("looks for a reusable change once", async () => {
    const move = await getMoveWithExecution(client(), {
      projectId: PROJECT,
      opportunityId: "move_3",
    });

    expect(move?.opportunity.id).toBe("move_3");
    expect(readsOf(recorder, "prepared_changes")).toBe(1);
  });

  /**
   * The set was read twice: once here and once inside the plural function,
   * each read carrying its own join for the Moves.
   */
  it("reads the opportunity set once", async () => {
    await getMoveWithExecution(client(), { projectId: PROJECT, opportunityId: "move_1" });

    expect(readsOf(recorder, "opportunity_sets")).toBe(1);
    expect(readsOf(recorder, "business_opportunities")).toBe(1);
  });

  /** The cost of one card does not depend on how many cards exist. */
  it("costs the same whatever the set holds", async () => {
    seed(1);
    await getMoveWithExecution(client(), { projectId: PROJECT, opportunityId: "move_1" });
    const one = recorder.reads.length;

    seed(5);
    await getMoveWithExecution(client(), { projectId: PROJECT, opportunityId: "move_1" });
    const five = recorder.reads.length;

    expect(five).toBe(one);
    /*
     * Eight: the set, its Moves, the audit behind it, the snapshot, the
     * project's origin, one reuse lookup, and the two operation reads. Named
     * so that halving it or doubling it is a change somebody chose.
     *
     * Two of those are free in a real request and not here — `cache()` wraps
     * the audit and the snapshot reads, and Nova Home has already made both by
     * the time it asks for a Move. This fake has no request scope, so it counts
     * what the function issues rather than what the request pays.
     */
    expect(one).toBe(8);
  });
});

describe("what the split must not change", () => {
  beforeEach(() => seed(3));

  /**
   * `executionSummaryFor` is the plural function's own body, so the singular
   * answer is the same answer. Asserted against the plural one rather than
   * against a hand-written expectation, which is the comparison that would
   * still hold if the capability rules changed underneath both.
   */
  it("gives the same capability and reuse answer as the list does", async () => {
    const summaries = await getOpportunityExecutionSummaries(client(), PROJECT);
    const move = await getMoveWithExecution(client(), {
      projectId: PROJECT,
      opportunityId: "move_2",
    });
    const summary = summaries.find((entry) => entry.opportunityId === "move_2");

    expect(summary?.capability).not.toBeNull();
    /*
     * `preparable` carries the capability, and it is the state a supported Move
     * with no prepared change and no running operation resolves to. Asserting
     * the kind as well as the value is what makes this a comparison of the two
     * answers rather than of two `undefined`s.
     */
    expect(move?.execution).toEqual({ kind: "preparable", capability: summary?.capability });
  });

  /**
   * No snapshot is the plural function's empty list, said once. A Move still
   * comes back — the sentence above it is true either way — with a null
   * execution, which `MoveCard` reads as "no executor summary exists".
   */
  it("still returns the Move when nothing has read the repository", async () => {
    db.rows("repository_intelligence_snapshots").length = 0;

    const move = await getMoveWithExecution(client(), {
      projectId: PROJECT,
      opportunityId: "move_1",
    });

    expect(move?.opportunity.id).toBe("move_1");
    expect(move?.execution).toBeNull();
    expect(readsOf(recorder, "prepared_changes")).toBe(0);
  });
});
