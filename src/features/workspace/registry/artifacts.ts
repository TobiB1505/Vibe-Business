import { type BlockKind } from "@/modules/nova/blocks";
import type { PROJECT_SECTIONS, PROJECT_SUBSECTIONS } from "@/components/layout/project-shell";
import { agentChangeHref, planMoveHref } from "@/modules/action-plans/source";
import { preparedChangeHref, projectSectionPath } from "@/lib/routing/project-urls";

/**
 * What the workspace can show, as a closed union — never an engine.
 *
 * ## Why a registry rather than a renderer
 *
 * [ADR 0109](../../../../docs/decisions/0109-nova-first-application-shell.md)
 * §4: an artifact is a `{ kind, ref }` resolved by one total record over a
 * closed union, checked by the compiler and by a test that every kind has an
 * existing read model, an existing view and an existing address. There is no
 * universal artifact engine, no generic renderer, and no artifact a model
 * composes.
 *
 * **One view, two frames, and no copies.** The artifact view *is* the owning
 * feature's view — `AuditOverview`, `UnderstandingPanel`, `MoveCard`, the Agent
 * stages, `ExperimentCard`, `FounderInputCard` — mounted with a frame. Which is
 * why nothing in `features/workspace/` is a view: this directory holds the
 * addresses and the frame, and every pixel comes from the feature that owns the
 * object.
 *
 * ## Why this file is data
 *
 * The same argument `modules/nova/blocks.ts` makes for `BlockKind`: a registry
 * that mapped a kind to a React element could only be checked by rendering one.
 * This holds strings and arithmetic over them, so `artifacts.test.ts` can check
 * every kind against `PROJECT_SECTIONS`, against the modules that read it and
 * against the modules that draw it without mounting anything — and any caller,
 * client or server, can ask where an artifact opens without pulling ten
 * features behind it. Its one component import is `import type`, which the
 * compiler erases.
 *
 * ## What is deliberately not a kind
 *
 * A **preview** and a **diff**. The restructure audit's §C.7 listed both, and
 * both listed their address as *"same"* — the prepared change's. They are what
 * `agentStageForChange` picks *within* one prepared change, not objects a
 * founder can open on their own, and a kind whose address and whose read are
 * another kind's is the generic renderer this decision refuses. `prepared_change`
 * covers them, at whichever stage the change is in.
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
 * Which section each artifact is read at, by URL segment.
 *
 * The segment and not the whole address: an artifact with a ref adds a
 * parameter and a fragment on top of it, and those belong to the module that
 * owns the contract (`action-plans/source.ts` for `?plan=` and `?change=`,
 * `lib/routing/project-urls.ts` for the prepared-change anchor).
 *
 * A literal typed against the two section tables, rather than a lookup in them.
 * The compiler is then the first thing that refuses an address for a section
 * that does not exist — ADR 0109 §7 is that every address survives, and a
 * registry is exactly where one would quietly stop doing so. `artifacts.test.ts`
 * asks the same question at runtime, because the failure a type cannot describe
 * is a section renamed in one table and still named here in the other.
 *
 * Deriving the value *from* the table instead would make both checks circular:
 * whatever the table said would be what this said, and a founder's link would
 * follow a section wherever it went without anyone deciding that it should.
 */
type ProjectSegment =
  | (typeof PROJECT_SECTIONS)[number]["segment"]
  | (typeof PROJECT_SUBSECTIONS)[number]["segment"];

export const ARTIFACT_SEGMENT: Record<ArtifactKind, ProjectSegment> = {
  business_health: "health",
  product: "product",
  opportunity: "plan",
  action_plan: "plan",
  agent_execution: "agent",
  prepared_change: "agent",
  experiment: "experiments",
  /*
   * The Agent, because that is the one screen that mounts `FounderInputCard`
   * outside a thread — and a question raised by the planner is answered there
   * too. If a second surface ever answers one, this becomes a ref rather than
   * a constant.
   */
  founder_input: "agent",
};

/** A module path and one symbol it exports. Checked as text, never imported. */
type SourceRef = readonly [string, string];

/**
 * Where each artifact is read, and what draws it.
 *
 * Module path and exported symbol, asserted by the test rather than imported
 * here. Importing them would pull ten features' server graphs into every build
 * that needs one address, and would make this file unusable from a client
 * component — the cost the `commands.ts` barrel was refused for in Slice 3.
 *
 * What it buys is the claim ADR 0109 §4 makes: **every kind has an existing
 * read model and an existing view**. A kind invented ahead of its read fails
 * here, which is what stops the registry describing a workspace that does not
 * exist yet.
 */
export const ARTIFACT_SOURCES: Record<
  ArtifactKind,
  { read: SourceRef; views: readonly SourceRef[] }
> = {
  business_health: {
    read: ["src/modules/projects/business-brain-view.ts", "buildBusinessBrainView"],
    views: [["src/features/health/audit-overview.tsx", "AuditOverview"]],
  },
  product: {
    read: ["src/modules/product-understanding/view.ts", "buildUnderstandingView"],
    views: [["src/features/product/understanding-panel.tsx", "UnderstandingPanel"]],
  },
  opportunity: {
    read: ["src/modules/opportunities/service.ts", "getLatestOpportunities"],
    views: [["src/features/plan/move-card.tsx", "MoveCard"]],
  },
  action_plan: {
    read: ["src/modules/action-plans/service.ts", "getLatestActionPlan"],
    views: [["src/features/plan/plan-detail-panel.tsx", "PlanDetailPanel"]],
  },
  agent_execution: {
    read: ["src/modules/coding-agent/agent-workspace.ts", "readAgentWorkspace"],
    views: [["src/features/agent/agent-build-stage.tsx", "AgentBuildStage"]],
  },
  /*
   * Three views and one object, which is the case that decides the shape of
   * this field. `agentStageForChange` reads the change's own stage and picks;
   * naming one of them here would be the mapping-by-candidate-kind mistake
   * `home-view.ts` records — two opposite states sent to the same screen.
   */
  prepared_change: {
    read: ["src/modules/execution/workspace.ts", "getPreparedChangeWorkspaceItem"],
    views: [
      ["src/features/agent/agent-validate-stage.tsx", "AgentValidateStage"],
      ["src/features/agent/agent-preview-stage.tsx", "AgentPreviewStage"],
      ["src/features/agent/agent-merge-stage.tsx", "AgentMergeStage"],
    ],
  },
  experiment: {
    read: ["src/modules/business-measurement/project-impact.ts", "getProjectImpact"],
    views: [["src/features/experiments/experiment-card.tsx", "ExperimentCard"]],
  },
  founder_input: {
    read: ["src/modules/founder-input/store.ts", "getFounderInputRequest"],
    views: [["src/features/founder-input/founder-input-card.tsx", "FounderInputCard"]],
  },
};

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
 * The full-page address of one artifact.
 *
 * Every parameter and fragment comes from the module that owns it, so this is
 * arithmetic and never a second contract: ADR 0058's `?plan=` and `?change=`
 * from `action-plans/source.ts`, the prepared-change anchor from
 * `lib/routing/project-urls.ts`, the project path from the one owner Slice 3
 * gave it.
 */
export function artifactHref(projectId: string, artifact: ArtifactRef): string {
  const section = projectSectionPath(projectId, ARTIFACT_SEGMENT[artifact.kind]);

  switch (artifact.kind) {
    case "opportunity":
      return planMoveHref(section, artifact.opportunityId);
    case "prepared_change":
      return preparedChangeHref(
        agentChangeHref(section, artifact.preparedChangeId),
        artifact.preparedChangeId,
      );
    default:
      return section;
  }
}
