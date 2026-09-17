import { BLOCK_FOR_MOMENT } from "@/modules/nova/blocks";
import type { FocusCandidate } from "@/modules/nova/focus";
import type { NovaHomeEntry } from "@/modules/nova/home-view";
import {
  ARTIFACT_FOR_BLOCK,
  type ArtifactKind,
  type ArtifactRef,
} from "@/features/workspace/registry/artifacts";

/**
 * Which artifact the moment on screen is about.
 *
 * ## Three tables, one direction
 *
 * `BLOCK_FOR_MOMENT` says what a moment *shows*; `ARTIFACT_FOR_BLOCK` says what
 * that block *is*; this supplies the id the address needs. Each is total over
 * the union below it, so a twenty-second moment or a tenth block fails the
 * build rather than silently losing its link — which is the property the whole
 * chain exists for, and the reason this does not read the candidate's kind
 * directly. A fourth table keyed by `FocusCandidateKind` would be a fourth
 * place to forget one.
 *
 * ## Why `null` is a real answer twice over
 *
 * Once because the block is an event and not an object — a run's named stages
 * have no page that shows more of them. And once because the candidate does not
 * carry what the address interpolates: a Move's id, a prepared change's id. An
 * address built without one is `?plan=undefined`, which is a link to a screen
 * that opens on nothing, and no link at all is the honest version of that.
 */
export function artifactForEntry(entry: NovaHomeEntry): ArtifactRef | null {
  const kind = ARTIFACT_FOR_BLOCK[BLOCK_FOR_MOMENT[entry.kind]];
  return kind === null ? null : REF_FOR_KIND[kind](entry.candidate);
}

/**
 * What each artifact needs from the candidate, total over `ArtifactKind`.
 *
 * Most need nothing: a section is the whole address. The two that do read the
 * candidate the same way `subjectKey` in `home-view.ts` does — by the field
 * being present, never by the kind — because two of the five change moments are
 * opposite states of one change and asking the kind is how they get sent to the
 * same wrong screen.
 */
const REF_FOR_KIND: Record<ArtifactKind, (candidate: FocusCandidate) => ArtifactRef | null> = {
  business_health: () => ({ kind: "business_health" }),
  product: () => ({ kind: "product" }),
  action_plan: () => ({ kind: "action_plan" }),
  agent_execution: () => ({ kind: "agent_execution" }),
  experiment: () => ({ kind: "experiment" }),
  founder_input: () => ({ kind: "founder_input" }),
  opportunity: (candidate) =>
    "move" in candidate ? { kind: "opportunity", opportunityId: candidate.move.id } : null,
  prepared_change: (candidate) =>
    "preparedChangeId" in candidate
      ? { kind: "prepared_change", preparedChangeId: candidate.preparedChangeId }
      : null,
};
