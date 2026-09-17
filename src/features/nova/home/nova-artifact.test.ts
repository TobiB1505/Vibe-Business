import { describe, expect, it } from "vitest";
import {
  deriveNovaFocus,
  type FocusCandidateKind,
  type NovaFocusFacts,
} from "@/modules/nova/focus";
import { buildNovaHomeView } from "@/modules/nova/home-view";
import { BLOCK_FOR_MOMENT } from "@/modules/nova/blocks";
import { ARTIFACT_FOR_BLOCK } from "@/features/workspace/registry/artifacts";
import { artifactForEntry } from "./nova-artifact";

/**
 * Every moment either opens the right artifact or opens none.
 *
 * ## Why this is derived and not a table of expectations
 *
 * Because a table of expectations is a fourth copy of the mapping, and the
 * point of three total records is that there is one. What has to hold is that
 * the *chain* agrees: the block a moment shows, the artifact that block is, and
 * the reference this function builds. So the assertion asks the first two and
 * checks the third against them — which fails when any link in the chain moves,
 * and cannot pass by being changed alongside one.
 *
 * ## Why the facts are built here
 *
 * The lab already owns twenty-one fact sets, under `src/app/e2e/design-studies/`,
 * and they say of themselves that nothing under `/app` imports them. A product
 * test reaching into the fixture route for its inputs would tie the two
 * together in the direction that makes the fixtures load-bearing. These are the
 * smallest facts that raise the four moments carrying an artifact with an id or
 * without one, which is the only part of the space this function can get wrong.
 */

const NO_FACTS: NovaFocusFacts = {
  sourceDisconnected: false,
  failedOperations: { agent: false, scan: false, audit: false },
  stalledOperations: { agent: false, scan: false, audit: false },
  changes: [],
  questions: [],
  moves: [],
  plannedMoveId: null,
  executableStep: null,
  planOffered: false,
  auditOutdated: false,
  repositoryReadOutdated: false,
  workspaceChoiceRequired: false,
  working: null,
};

function primary(facts: Partial<NovaFocusFacts>) {
  return buildNovaHomeView(deriveNovaFocus({ ...NO_FACTS, ...facts })).primary;
}

/** The artifact the chain says this moment is about, asked of the tables. */
function expected(kind: FocusCandidateKind) {
  return ARTIFACT_FOR_BLOCK[BLOCK_FOR_MOMENT[kind]];
}

describe("the artifact a moment is about", () => {
  it("opens the audit on the moment that shows one", () => {
    const entry = primary({ auditOutdated: true });
    expect(entry.kind).toBe("audit_outdated");
    expect(artifactForEntry(entry)).toEqual({ kind: "business_health" });
    expect(artifactForEntry(entry)?.kind).toBe(expected(entry.kind));
  });

  it("carries the Move's own id, so the plan opens on it", () => {
    const entry = primary({ moves: [{ id: "move_7", rank: 1, title: "Add a pricing page" }] });
    expect(artifactForEntry(entry)).toEqual({ kind: "opportunity", opportunityId: "move_7" });
    expect(artifactForEntry(entry)?.kind).toBe(expected(entry.kind));
  });

  it("carries the change's own id, so the Agent opens on it", () => {
    const entry = primary({
      changes: [
        {
          preparedChangeId: "change_7",
          stage: "review_required",
          headline: "Two files changed on a branch",
          createdAt: "2026-09-11T09:00:00.000Z",
        },
      ],
    });
    expect(artifactForEntry(entry)).toEqual({
      kind: "prepared_change",
      preparedChangeId: "change_7",
    });
    expect(artifactForEntry(entry)?.kind).toBe(expected(entry.kind));
  });

  /**
   * A moment whose block is a sentence has no artifact, and says so.
   *
   * `nothing_to_do` is the case a placeholder would be most tempting on: the
   * thread is quiet and a link would fill it. It stays empty, because the link
   * would be to a page that answers a question nobody asked.
   */
  it("gives a moment with no block no artifact", () => {
    const entry = primary({});
    expect(entry.kind).toBe("nothing_to_do");
    expect(expected(entry.kind)).toBeNull();
    expect(artifactForEntry(entry)).toBeNull();
  });

  it("gives a disconnected source no artifact either", () => {
    const entry = primary({ sourceDisconnected: true });
    expect(artifactForEntry(entry)).toBeNull();
  });
});
