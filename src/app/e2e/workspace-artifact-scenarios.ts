import { deriveNovaFocus, type NovaFocusFacts } from "@/modules/nova/focus";
import { buildNovaHomeView, type NovaHomeEntry } from "@/modules/nova/home-view";

/**
 * The address on an artifact, in a browser (ADR 0109 §4, Slice 4).
 *
 * ## What only a browser can answer here
 *
 * Two things, and the unit tests can reach neither. Whether the link is
 * *legible* — it sits in a block's meta row opposite a mono label in 0.16em
 * tracking, and both have to fit on one line at 390px without the row wrapping
 * into the composed surface below it. And whether it says something a founder
 * can act on: "Business Health" is the destination's own name, taken from
 * `PROJECT_SECTIONS`, and a registry pointing at a section that had been
 * renamed would produce a link with the old word on it.
 *
 * ## Why the block's contents are a placeholder and that is deliberate
 *
 * The claim under test is the *frame*: that the moment on screen resolves to an
 * artifact, that the artifact resolves to an address, and that the address is
 * drawn. Every one of those comes from the product's own chain —
 * `deriveNovaFocus`, `BLOCK_FOR_MOMENT`, `ARTIFACT_FOR_BLOCK`, `artifactOpen` —
 * and none of it comes from what is inside the frame. Mounting three real
 * composed surfaces to prove a link in their header would put a business map,
 * a Move card and a review gate between the test and the one row it is about.
 *
 * `study-block` is where the real blocks are looked at, and it mounts every one
 * of them.
 */

export const E2E_WORKSPACE_ARTIFACT_SCENARIOS = [
  /** An audit reading, which is read in full under Business Health. */
  "artifact-audit",
  /** A Move, which is read in the Action Plan and carries the Move's own id. */
  "artifact-move",
  /** A prepared change, which is read in the Agent and carries the change's id. */
  "artifact-change",
  /** Nothing owed. No block, therefore no frame and no address. */
  "artifact-settled",
] as const;

export type E2eWorkspaceArtifactScenario = (typeof E2E_WORKSPACE_ARTIFACT_SCENARIOS)[number];

export function isE2eWorkspaceArtifactScenario(
  scenario: string,
): scenario is E2eWorkspaceArtifactScenario {
  return (E2E_WORKSPACE_ARTIFACT_SCENARIOS as readonly string[]).includes(scenario);
}

/** The project every scenario here is about. */
export const WORKSPACE_ARTIFACT_PROJECT = "project_e2e";

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

const FACTS: Record<E2eWorkspaceArtifactScenario, NovaFocusFacts> = {
  "artifact-audit": { ...NO_FACTS, auditOutdated: true },
  "artifact-move": {
    ...NO_FACTS,
    moves: [{ id: "move_e2e", rank: 1, title: "Add a pricing page" }],
  },
  "artifact-change": {
    ...NO_FACTS,
    changes: [
      {
        preparedChangeId: "change_e2e",
        stage: "review_required",
        headline: "Two files changed on a branch of their own",
        createdAt: "2026-09-11T09:00:00.000Z",
      },
    ],
  },
  "artifact-settled": NO_FACTS,
};

/** The real ranking over the fact set, exactly as Home derives it. */
export function workspaceArtifactEntry(scenario: E2eWorkspaceArtifactScenario): NovaHomeEntry {
  return buildNovaHomeView(deriveNovaFocus(FACTS[scenario])).primary;
}
