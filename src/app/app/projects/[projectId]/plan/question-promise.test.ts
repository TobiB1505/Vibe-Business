import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The card only promises a question when the question is there (UX audit F-3).
 *
 * `MoveCard` says "Answer the question below so Vibe can continue." The
 * question is `FounderInputCard`, and it renders in `plan-detail-panel.tsx`
 * under a different condition: whether this Move's plan carries an open
 * founder-input request. Nothing derived one from the other, so a founder
 * could be told to answer a question, scroll looking for it, and reach the end
 * of the page — no error, no empty state, an instruction with no referent.
 *
 * ## Why this is textual
 *
 * The suite's environment is `node` and these are client components, so there
 * is no DOM to render them into. What can be asserted is the wiring: that the
 * sentence is behind the flag, and that the flag is computed from the same
 * value the question is.
 *
 * That is weaker than rendering both and looking. It is strong enough for the
 * defect it guards, which is somebody deleting the condition and leaving the
 * sentence — the state the fixture `moves_ranked` demonstrates.
 */

const PLAN = join(process.cwd(), "src/app/app/projects/[projectId]/plan");

function read(file: string): string {
  return readFileSync(join(PLAN, file), "utf8");
}

const PROMISE = "Answer the question below so Vibe can continue.";

describe("a Move never promises a question that is not below it", () => {
  it("keeps the promise behind the flag", () => {
    const source = read("move-card.tsx");
    expect(source).toContain(PROMISE);

    // The sentence and the flag in one expression. Splitting them is how the
    // promise gets re-detached.
    const branch = source.slice(source.indexOf('case "needs_user_input":'));
    const detail = branch.slice(0, branch.indexOf("};") + 2);
    expect(detail).toContain("questionIsBelow");
    expect(detail).toContain(PROMISE);
  });

  it("says something location-free when the question is elsewhere", () => {
    // The card still has to say what is happening; it must not say "below".
    const source = read("move-card.tsx");
    const branch = source.slice(source.indexOf('case "needs_user_input":'));
    const detail = branch.slice(0, branch.indexOf("};") + 2);
    expect(detail).toContain("Vibe needs a decision from you before this can move.");
  });

  it("computes the flag from the value the question renders under", () => {
    const workspace = read("action-plan-workspace.tsx");
    const call = workspace.slice(workspace.indexOf("<MoveCard"));
    const props = call.slice(0, call.indexOf("/>") + 2);

    expect(props).toContain("questionIsBelow");
    expect(props).toContain("founderInputRequest");
    // The panel is handed this Move's plan and no other; the flag has to carry
    // the same restriction or it goes true for a question about a different Move.
    expect(props).toContain("planView?.plan.opportunityId === activeOpportunity.id");
  });

  it("renders the question under exactly that value", () => {
    // The other half of the pair. If the panel's condition moves, the flag
    // above is computing something else and this fails rather than drifting.
    expect(read("plan-detail-panel.tsx")).toContain("{founderInputRequest ? (");
  });
});
