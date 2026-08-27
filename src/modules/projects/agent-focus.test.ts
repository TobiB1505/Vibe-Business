import { describe, expect, it } from "vitest";
import { fakeSeoOpportunity } from "@/modules/execution/test-support";
import type { OpportunityActionState } from "@/modules/execution/view";
import { buildAgentFocus } from "./agent-focus";

/**
 * Which Move the Agent page is about (UI-S3 §2).
 *
 * Every test here is about a founder arriving with a Move id in the URL, and
 * about the one failure this module exists to make impossible: showing them a
 * different Move than the one they asked for.
 */

const MOVE = fakeSeoOpportunity();
const OTHER = fakeSeoOpportunity({ id: "1-revenue-add-pricing", rank: 1, title: "Add pricing" });

const preparable: OpportunityActionState = {
  kind: "preparable",
  capability: "nextjs_seo_foundations_v2",
};

describe("no Move was named", () => {
  it("is a distinct state from a Move that could not be found", () => {
    expect(
      buildAgentFocus({ requestedOpportunityId: null, opportunities: [MOVE], action: preparable }),
    ).toEqual({ kind: "none" });
  });

  it("stays `none` even when the project has Moves Vibe could act on", () => {
    // The Agent page reached directly is not a page about rank 1. Defaulting
    // to "the top Move" here would put a business claim on screen that nobody
    // asked for and nothing chose.
    const focus = buildAgentFocus({
      requestedOpportunityId: null,
      opportunities: [OTHER, MOVE],
      action: preparable,
    });
    expect(focus.kind).toBe("none");
  });
});

describe("a Move this project does not have", () => {
  /**
   * The regression: substituting rank 1. Every sentence on the card would then
   * be about work the founder never selected — and it would look correct.
   */
  it("never substitutes another Move", () => {
    const focus = buildAgentFocus({
      requestedOpportunityId: "9-belongs-to-another-project",
      opportunities: [OTHER, MOVE],
      action: preparable,
    });
    expect(focus).toEqual({ kind: "unresolved" });
  });

  it("resolves to unresolved when the set is empty", () => {
    expect(
      buildAgentFocus({ requestedOpportunityId: MOVE.id, opportunities: [], action: preparable }),
    ).toEqual({ kind: "unresolved" });
  });
});

describe("a Move Vibe cannot yet reason about", () => {
  /**
   * No repository snapshot means `getOpportunityExecutionSummaries` returns
   * nothing at all. That is a missing premise, and calling it `not_automated`
   * would blame the Move for a gap in Vibe's own context.
   */
  it("names the Move and says nothing about what Vibe could do with it", () => {
    const focus = buildAgentFocus({
      requestedOpportunityId: MOVE.id,
      opportunities: [MOVE],
      action: null,
    });
    expect(focus).toEqual({
      kind: "unavailable",
      move: { id: MOVE.id, rank: MOVE.rank, title: MOVE.title },
    });
  });
});

describe("a Move in focus", () => {
  it("carries the execution answer through untouched", () => {
    const action: OpportunityActionState = {
      kind: "already_prepared",
      preparedChangeId: "prepared_1",
    };
    const focus = buildAgentFocus({
      requestedOpportunityId: MOVE.id,
      opportunities: [OTHER, MOVE],
      action,
    });
    expect(focus).toEqual({
      kind: "focused",
      move: { id: MOVE.id, rank: MOVE.rank, title: MOVE.title },
      action,
    });
  });

  it("reports the engine's persisted rank, never a position in the array", () => {
    // MOVE is rank 3 and sits second. A positional rank would say 2.
    const focus = buildAgentFocus({
      requestedOpportunityId: MOVE.id,
      opportunities: [OTHER, MOVE],
      action: preparable,
    });
    expect(focus.kind === "focused" && focus.move.rank).toBe(3);
  });

  it("carries only the three fields a card reads", () => {
    const focus = buildAgentFocus({
      requestedOpportunityId: MOVE.id,
      opportunities: [MOVE],
      action: preparable,
    });
    // Evidence ids, dependencies, confidence and readiness stay server-side:
    // none of them belongs in a card, and shipping the whole object to the
    // browser is how they would get there.
    expect(focus.kind === "focused" && Object.keys(focus.move).sort()).toEqual([
      "id",
      "rank",
      "title",
    ]);
  });
});
