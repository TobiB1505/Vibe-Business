import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PROJECT_SECTIONS } from "@/components/layout/project-shell";
import {
  LOOP_STAGES,
  deriveLoopStage,
  loopBlockMessage,
  type LoopBlockReason,
  type LoopStageFacts,
  type LoopStageId,
  type LoopStageView,
  type PreparedChangeLoopFacts,
} from "./loop-stage";

/**
 * Where a project stands in the product loop (UI-8 §1).
 *
 * Three properties carry the weight here, and each of them is a rule the
 * sprint agreed to before any pixel was drawn:
 *
 *  - the projection is **pure** — no database handle, no clock, no polling;
 *  - a stage nobody has reached is never rendered as a problem;
 *  - `credits_required` is a route into paying, not a wall.
 */

/** A project that has been all the way round the loop once. */
function facts(overrides: Partial<LoopStageFacts> = {}): LoopStageFacts {
  return {
    repositoryConnected: true,
    hasProductProfile: true,
    hasAudit: true,
    auditBlockedReason: null,
    hasMoves: true,
    movesBlockedReason: null,
    preparedChanges: [change({ merged: true })],
    ...overrides,
  };
}

/** One prepared change that has passed validation and nothing further. */
function change(overrides: Partial<PreparedChangeLoopFacts> = {}): PreparedChangeLoopFacts {
  return {
    validationPassed: true,
    validationFailed: false,
    approved: false,
    merged: false,
    mergeStalled: false,
    ...overrides,
  };
}

function byId(views: LoopStageView[]): Record<LoopStageId, LoopStageView> {
  return Object.fromEntries(views.map((view) => [view.id, view])) as Record<
    LoopStageId,
    LoopStageView
  >;
}

/** The id of the one stage that is not `done` or `pending`. */
function current(views: LoopStageView[]): LoopStageId | null {
  return views.find((view) => view.state === "active" || view.state === "blocked")?.id ?? null;
}

describe("the shape of the rail", () => {
  it("renders seven stages, in loop order", () => {
    const views = deriveLoopStage(facts());

    expect(views.map((view) => view.id)).toEqual([
      "connect",
      "scan",
      "audit",
      "moves",
      "prepare",
      "review",
      "merged",
    ]);
  });

  /*
   * The rail is orientation laid over the eight workspace sections, not a
   * second router. A stage naming a section that does not exist would render a
   * dead link — and because `projectSectionHref` falls back to the project
   * root for an unknown id, it would be a *silently* dead link.
   */
  it("names only sections the workspace actually has", () => {
    const sectionIds = new Set(PROJECT_SECTIONS.map((section) => section.id));

    for (const stage of LOOP_STAGES) {
      expect(sectionIds).toContain(stage.sectionId);
    }
  });

  it("has a message for every block reason it can produce", () => {
    const reasons: LoopBlockReason[] = [
      "audit_already_running",
      "start_attempts_exhausted",
      "product_profile_missing",
      "product_profile_stale",
      "audit_missing",
      "audit_stale",
      "validation_failed",
      "merge_stalled",
    ];

    for (const reason of reasons) {
      expect(loopBlockMessage(reason)).toMatch(/\S/);
    }
  });
});

describe("which stage a project is on", () => {
  it("starts at connect when no repository is connected", () => {
    const views = deriveLoopStage(facts({ repositoryConnected: false }));

    expect(current(views)).toBe("connect");
    expect(views.every((view) => view.state !== "done")).toBe(true);
  });

  it("is on scan once a repository is connected but nothing is understood", () => {
    const views = deriveLoopStage(facts({ hasProductProfile: false }));

    expect(current(views)).toBe("scan");
    expect(byId(views).connect.state).toBe("done");
  });

  it("is on audit once the product is understood", () => {
    expect(current(deriveLoopStage(facts({ hasAudit: false })))).toBe("audit");
  });

  it("is on opportunities once an audit exists", () => {
    expect(current(deriveLoopStage(facts({ hasMoves: false })))).toBe("moves");
  });

  it("is on prepare once moves exist and nothing has been prepared", () => {
    expect(current(deriveLoopStage(facts({ preparedChanges: [] })))).toBe("prepare");
  });

  /*
   * The five verdicts, checked at each boundary rather than in bulk. A
   * table-driven loop over generated combinations would pass just as happily
   * with two of them silently mapped to the wrong box.
   */
  it("is on prepare while a change has not passed validation", () => {
    const views = deriveLoopStage(facts({ preparedChanges: [change({ validationPassed: false })] }));

    expect(current(views)).toBe("prepare");
  });

  it("is on prepare when a change failed validation", () => {
    const views = deriveLoopStage(
      facts({ preparedChanges: [change({ validationPassed: false, validationFailed: true })] }),
    );

    expect(current(views)).toBe("prepare");
  });

  it("is on review once a change has passed validation", () => {
    expect(current(deriveLoopStage(facts({ preparedChanges: [change()] })))).toBe("review");
  });

  it("is on merged once a change is approved", () => {
    const views = deriveLoopStage(facts({ preparedChanges: [change({ approved: true })] }));

    expect(current(views)).toBe("merged");
  });

  it("is on merged when a change cannot go in as it is", () => {
    const views = deriveLoopStage(facts({ preparedChanges: [change({ mergeStalled: true })] }));

    expect(current(views)).toBe("merged");
  });

  it("has finished the loop once a change is merged", () => {
    const views = deriveLoopStage(facts({ preparedChanges: [change({ merged: true })] }));

    expect(current(views)).toBeNull();
    expect(views.every((view) => view.state === "done")).toBe(true);
  });

  /*
   * A merged change has been through every gate before it, so the verdicts are
   * read from the far end backwards — the same reason `deriveChangeProgress`
   * does. A merge row that is still marked stalled from an earlier refused
   * attempt must not drag a change that has since gone in back to "merged".
   */
  it("lets merged win over an earlier stall on the same change", () => {
    const views = deriveLoopStage(
      facts({ preparedChanges: [change({ merged: true, mergeStalled: true })] }),
    );

    expect(views.every((view) => view.state === "done")).toBe(true);
  });

  /*
   * A project does not go backwards because it started something new. Showing
   * a project with a merged change as stuck at "prepare" would forget that it
   * has already been round once — which is the single thing the rail exists to
   * tell a returning founder.
   */
  it("is decided by the furthest change, not the newest", () => {
    const views = deriveLoopStage(
      facts({
        preparedChanges: [change({ validationPassed: false }), change({ merged: true })],
      }),
    );

    expect(views.every((view) => view.state === "done")).toBe(true);
  });

  it("exposes exactly one stage that is neither done nor pending", () => {
    const views = deriveLoopStage(facts({ hasAudit: false }));
    const live = views.filter((view) => view.state === "active" || view.state === "blocked");

    expect(live).toHaveLength(1);
  });
});

describe("blocking", () => {
  it("blocks the audit stage when the product profile is missing", () => {
    const views = deriveLoopStage(
      facts({ hasAudit: false, auditBlockedReason: "product_profile_missing" }),
    );

    expect(byId(views).audit).toMatchObject({
      state: "blocked",
      blockReason: "product_profile_missing",
    });
  });

  it("blocks the opportunities stage when the audit is stale", () => {
    const views = deriveLoopStage(facts({ hasMoves: false, movesBlockedReason: "audit_stale" }));

    expect(byId(views).moves).toMatchObject({ state: "blocked", blockReason: "audit_stale" });
  });

  it.each<[Partial<PreparedChangeLoopFacts>, LoopStageId, LoopBlockReason]>([
    [{ validationPassed: false, validationFailed: true }, "prepare", "validation_failed"],
    [{ mergeStalled: true }, "merged", "merge_stalled"],
  ])("blocks a change at the %s stage", (overrides, id, reason) => {
    const views = deriveLoopStage(facts({ preparedChanges: [change(overrides)] }));

    expect(byId(views)[id]).toMatchObject({ state: "blocked", blockReason: reason });
  });

  /*
   * BILLING CORE-2 §39 made `credits_required` a route into paying, and its own
   * docblock says a UI must not render it as a wall. A rail that painted it red
   * would re-decide, in the opposite direction, a question billing has already
   * answered — and it would do it on the most visible surface in the product.
   */
  it("does not treat credits_required as a block", () => {
    const views = deriveLoopStage(
      facts({ hasAudit: false, auditBlockedReason: "credits_required" }),
    );

    expect(byId(views).audit).toMatchObject({ state: "active", blockReason: null });
  });

  /*
   * A step nobody has reached cannot have failed. Without this, a project that
   * never got past connecting would show a red "Opportunities" — turning "not
   * yet" into "went wrong" on the founder's first ever screen.
   */
  it("never blocks a stage the project has not reached", () => {
    const views = deriveLoopStage(
      facts({
        repositoryConnected: false,
        auditBlockedReason: "product_profile_missing",
        movesBlockedReason: "audit_missing",
        preparedChanges: [change({ mergeStalled: true })],
      }),
    );

    expect(views.filter((view) => view.state === "blocked")).toHaveLength(0);
  });

  it("carries a block reason only on a blocked stage", () => {
    for (const view of deriveLoopStage(facts({ hasMoves: false, movesBlockedReason: "audit_stale" }))) {
      if (view.state !== "blocked") expect(view.blockReason).toBeNull();
    }
  });
});

/**
 * The projection stays a projection.
 *
 * These assertions look paranoid and are not. The failure they prevent is
 * gradual: someone needs one more fact, reaches for the database rather than
 * threading it through the caller, and the rail quietly becomes a place where
 * product questions get decided a second time — with a different answer,
 * because it reads at a different moment than the section it sits above.
 *
 * Asserting it on the source rather than by mocking is deliberate: a mock
 * proves this call did not read, and the source proves it *cannot*.
 */
describe("purity", () => {
  const source = readFileSync(join(process.cwd(), "src/modules/execution/loop-stage.ts"), "utf8");

  it("takes facts and nothing else", () => {
    expect(deriveLoopStage).toHaveLength(1);
  });

  it("is synchronous", () => {
    expect(source).not.toMatch(/\basync\b/);
    expect(source).not.toMatch(/\bawait\b/);
    expect(source).not.toMatch(/Promise</);
  });

  it("holds no database handle", () => {
    expect(source).not.toMatch(/supabase/i);
    expect(source).not.toMatch(/SupabaseClient/);
  });

  it("reads no clock", () => {
    expect(source).not.toMatch(/Date\.now/);
    expect(source).not.toMatch(/new Date/);
  });
});
