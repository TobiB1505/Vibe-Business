import { BLOCK_FOR_MOMENT, type BlockKind } from "./blocks";
import type { FocusCandidate } from "./focus";
import type { NovaHomeEntry } from "./home-view";

/**
 * What the workspace can show, as a closed union the domain owns.
 *
 * ## Why this is a module and not the feature that draws it
 *
 * The same argument `blocks.ts` makes one line above: *"a block kind, not a
 * component"*. An artifact **kind** is domain vocabulary — it is what a message
 * in a thread refers to, what a `CHECK` constraint enumerates, and what a
 * moment resolves to — while *where it is read* and *what draws it* are the
 * product surface, and those stay in `src/features/workspace/registry/`.
 *
 * It lived there for one slice, and the thread schema is what showed the seam:
 * `nova_messages.artifact_kind` needs this union to check its `CHECK` against,
 * and a module may not import a feature (rule 86). A union a module needs is a
 * union the domain owns.
 *
 * ## What is deliberately not a kind
 *
 * A **preview** and a **diff**. The restructure audit's §C.7 listed both, and
 * gave both the prepared change's own address. They are what
 * `agentStageForChange` picks *within* one prepared change, not objects a
 * founder opens — and a kind whose address and whose read are another kind's is
 * the generic renderer [ADR 0109](../../../docs/decisions/0109-nova-first-application-shell.md)
 * §4 refuses.
 */

/**
 * One artifact, and what its address needs to name it.
 *
 * A discriminated union rather than `{ kind, id? }`, so the compiler refuses an
 * address built without the id it interpolates. `ArtifactKind` is derived from
 * it for the same reason `BlockKind` is written once: two unions that must
 * agree and are never compared is how they stop agreeing.
 */
export type ArtifactRef =
  /** The business reading: nine lenses, the score and the leading blocker. */
  | { kind: "business_health" }
  /** What Vibe understands the product to be, and what it learned that from. */
  | { kind: "product" }
  /** One Move, read before it is paid for. */
  | { kind: "opportunity"; opportunityId: string }
  /** The sequence of steps, and which one is waiting. */
  | { kind: "action_plan" }
  /** The agent at work: its stages, its events and the files it touched. */
  | { kind: "agent_execution" }
  /** One prepared change and its whole review gate, at whatever stage it is. */
  | { kind: "prepared_change"; preparedChangeId: string }
  /** What a merged change made measurable. */
  | { kind: "experiment" }
  /** A question Vibe is waiting on, with the run that asked it around it. */
  | { kind: "founder_input" };

export type ArtifactKind = ArtifactRef["kind"];

export const ARTIFACT_KINDS = [
  "business_health",
  "product",
  "opportunity",
  "action_plan",
  "agent_execution",
  "prepared_change",
  "experiment",
  "founder_input",
] as const satisfies readonly ArtifactKind[];

/**
 * Which artifact a thread block opens, total over `BlockKind`.
 *
 * The same shape and the same reason as `BLOCK_FOR_MOMENT`: a tenth block kind
 * fails the build here until somebody decides what opening it means.
 *
 * `null` is a decision, not a gap. A run's named stages and an empty block are
 * **events, not objects** — there is no page that shows more of them than the
 * thread already does, and a link to one would be a founder leaving the only
 * surface that was telling them anything.
 */
export const ARTIFACT_FOR_BLOCK: Record<BlockKind, ArtifactKind | null> = {
  audit: "business_health",
  scan: "product",
  agent: "agent_execution",
  /* The step being offered is one row of the sequence, and the sequence is
     where it is read in order. */
  ready: "action_plan",
  review: "prepared_change",
  move: "opportunity",
  ask: "founder_input",
  progress: null,
  none: null,
};

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

/**
 * How an artifact is spelled in a URL.
 *
 * The workspace is a **parameter on the conversation's own address**, not a
 * route of its own, and that is the whole of why "returning from the workspace
 * preserves the conversation" needs no mechanism: the founder never left. It
 * also means a founder can send somebody a link to *the thing Nova was talking
 * about* and the conversation arrives with it.
 *
 * Two parameters rather than one packed string, for the reason
 * `PLAN_OPPORTUNITY_PARAM` is its own parameter: a composite value is a format,
 * and a format needs a parser that can disagree with the thing that wrote it.
 */
export const WORKSPACE_ARTIFACT_PARAM = "artifact";
export const WORKSPACE_ARTIFACT_REF_PARAM = "ref";

/**
 * A pair of query values back into the union, or nothing.
 *
 * Total over `ArtifactKind`, so a ninth kind fails the build here rather than
 * silently becoming an address that opens on nothing. Both halves are checked:
 * a kind that needs a reference and arrives without one is **not** an artifact
 * — `?artifact=opportunity` with no `ref` would otherwise render "a Move" with
 * no Move, which is the empty frame ADR 0109 §4 refuses.
 *
 * Nothing here trusts the value: it is a query string, which is to say it is
 * whatever somebody typed. The kind is checked against the closed union and the
 * reference is only ever used to look a row up through a client the founder's
 * own session scopes — never interpolated into anything, and never authority.
 */
export function parseArtifactRef(
  kind: string | undefined,
  ref: string | undefined,
): ArtifactRef | null {
  if (kind === undefined || !isArtifactKind(kind)) return null;

  switch (kind) {
    case "opportunity":
      return ref === undefined || ref.length === 0 ? null : { kind, opportunityId: ref };
    case "prepared_change":
      return ref === undefined || ref.length === 0 ? null : { kind, preparedChangeId: ref };
    default:
      return { kind };
  }
}

/** Whether a string is one of the eight. Exported for a store reading one back. */
export function isArtifactKind(value: string): value is ArtifactKind {
  return (ARTIFACT_KINDS as readonly string[]).includes(value);
}

/** The reference an artifact carries, when it carries one. */
export function artifactRefId(artifact: ArtifactRef): string | null {
  switch (artifact.kind) {
    case "opportunity":
      return artifact.opportunityId;
    case "prepared_change":
      return artifact.preparedChangeId;
    default:
      return null;
  }
}
