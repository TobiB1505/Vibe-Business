import { beforeEach, describe, expect, it } from "vitest";
import {
  FakeDatabase,
  fakeSupabase,
  newQueryRecorder,
  readsOf,
  type QueryRecorder,
} from "@/modules/operations/test-support";
import { getDashboardOverview } from "./dashboard";

/**
 * The account dashboard, executed (VB-025).
 *
 * ## What this file is really about
 *
 * One sentence in `dashboard-contract.test.ts` used to say the audits read must
 * *not* be capped, and it was right for the reason it gave: the read is ordered
 * newest-first across every project, so a cap fills with the busiest project's
 * history and a quiet product renders as never analysed.
 *
 * That reason has not gone away — capping the read alone would still do exactly
 * that. What changed is that a project the cap hides is now re-read on its own,
 * so the cap is bounded *and* the quiet project keeps its score. That is a
 * behavioural claim about a case only real rows can produce, which is why this
 * file exists rather than another source assertion.
 */

const USER = "user_1";
const BUSY = "project_busy";
const QUIET = "project_quiet";

let db: FakeDatabase;
let recorder: QueryRecorder;

function client() {
  return fakeSupabase(db, recorder);
}

function seedProject(id: string, name: string) {
  db.seed("projects", { id, user_id: USER, name, created_at: "2026-01-01T00:00:00.000Z" });
}

function seedAudit(projectId: string, score: number, at: string) {
  db.seed("business_readiness_audits", {
    project_id: projectId,
    product_profile_id: "profile_1",
    overall_score: score,
    status: "completed",
    schema_version: "audit.v7",
    audit_version: "7",
    evidence_pack_version: "4",
    prompt_version: "1",
    rubric_version: "1",
    provider: "anthropic",
    model: "claude-opus-5",
    created_at: at,
  });
}

beforeEach(() => {
  db = new FakeDatabase();
  recorder = newQueryRecorder();
});

describe("a quiet project keeps its score beside a busy one", () => {
  /*
   * The arrangement the cap would break: every one of the busy project's audits
   * is newer than the quiet project's only audit, and there are more of them
   * than the whole budget. A plain `.limit()` returns nothing but the busy
   * project, and the quiet card says "never analysed" about a project that has
   * been analysed.
   */
  function seedCrowdedAccount(busyAudits: number) {
    seedProject(BUSY, "Busy");
    seedProject(QUIET, "Quiet");

    seedAudit(QUIET, 41, "2026-02-01T00:00:00.000Z");
    for (let index = 0; index < busyAudits; index += 1) {
      seedAudit(BUSY, 70 + index, `2026-03-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`);
    }
  }

  it("reports the quiet project's score even when the budget is full", async () => {
    seedCrowdedAccount(40);

    const overview = await getDashboardOverview(client(), USER);
    const quiet = overview.projects.find((project) => project.id === QUIET);

    expect(quiet?.score).toBe(41);
    expect(quiet?.scoreState).not.toBe("never_analysed");
  });

  it("pays for the repair only when the budget was actually spent", async () => {
    // Two projects, four audits: nowhere near the budget, so nothing is hidden
    // and no project needs a second read.
    seedProject(BUSY, "Busy");
    seedProject(QUIET, "Quiet");
    seedAudit(BUSY, 70, "2026-03-01T00:00:00.000Z");
    seedAudit(BUSY, 72, "2026-03-02T00:00:00.000Z");
    seedAudit(QUIET, 41, "2026-02-01T00:00:00.000Z");

    await getDashboardOverview(client(), USER);

    expect(readsOf(recorder, "business_readiness_audits")).toBe(1);
  });

  it("does not read one project's audits per project in the ordinary case", async () => {
    for (let index = 0; index < 6; index += 1) {
      seedProject(`project_${index}`, `Project ${index}`);
      seedAudit(`project_${index}`, 50 + index, `2026-02-0${index + 1}T00:00:00.000Z`);
    }

    await getDashboardOverview(client(), USER);

    expect(readsOf(recorder, "business_readiness_audits")).toBe(1);
  });
});

describe("the newest opportunity set per project", () => {
  it("survives a busy project filling the response", async () => {
    seedProject(BUSY, "Busy");
    seedProject(QUIET, "Quiet");

    db.seed("opportunity_sets", {
      id: "set_quiet",
      project_id: QUIET,
      status: "completed",
      created_at: "2026-02-01T00:00:00.000Z",
    });
    for (let index = 0; index < 400; index += 1) {
      db.seed("opportunity_sets", {
        id: `set_busy_${index}`,
        project_id: BUSY,
        status: "completed",
        created_at: `2026-03-01T00:00:${String(index % 60).padStart(2, "0")}.${String(index).padStart(3, "0")}Z`,
      });
    }
    db.seed("business_opportunities", {
      id: "move_1",
      opportunity_set_id: "set_quiet",
      rank: 1,
      title: "Make pricing visible",
      problem: "Nobody can tell what it costs.",
      impact: "high",
      effort: "medium",
    });

    const overview = await getDashboardOverview(client(), USER);
    const quiet = overview.projects.find((project) => project.id === QUIET);

    expect(quiet?.nextMovesCount).toBe(1);
    expect(quiet?.topMove?.title).toBe("Make pricing visible");
  });
});

describe("the trend a card draws", () => {
  it("is bounded per project rather than by the account's whole history", async () => {
    seedProject(BUSY, "Busy");
    for (let index = 0; index < 30; index += 1) {
      seedAudit(BUSY, 60 + index, `2026-03-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`);
    }

    const overview = await getDashboardOverview(client(), USER);
    const busy = overview.projects.find((project) => project.id === BUSY);

    // One project, so the whole budget is its own: twelve readings, newest
    // first, and the score is the newest of them rather than the oldest.
    expect(busy?.scoreHistory).toHaveLength(12);
    expect(busy?.score).toBe(89);
  });
});
