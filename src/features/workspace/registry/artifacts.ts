import {
  artifactRefId,
  WORKSPACE_ARTIFACT_PARAM,
  WORKSPACE_ARTIFACT_REF_PARAM,
  type ArtifactKind,
  type ArtifactRef,
} from "@/modules/nova/artifacts";
import type { PROJECT_SECTIONS, PROJECT_SUBSECTIONS } from "@/features/shell/project-shell";
import { agentChangeHref, planMoveHref } from "@/modules/action-plans/source";
import { preparedChangeHref, projectSectionPath, threadPath } from "@/lib/routing/project-urls";

/**
 * Where each artifact is read, and what draws it — never an engine.
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
 * The **union itself** is `src/modules/nova/artifacts.ts`, beside `blocks.ts`
 * and for the same reason a block kind lives there: a kind is domain
 * vocabulary — what a message refers to, what a `CHECK` enumerates — while
 * *where it is read* and *what draws it* are the product surface, which is
 * here.
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
 */

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

/**
 * The same artifact, shown **beside the conversation** rather than instead of it.
 *
 * The workspace is a parameter on a thread's own address, so this is the thread
 * plus what to put in the pane, and the fragment is what a phone uses to reach
 * the pane when it is a section under the transcript rather than a column
 * beside it. A founder following this link lands in the conversation with the
 * thing under discussion open — which is the sentence ADR 0109 §4 makes, and
 * the reason returning from the workspace needs no mechanism at all.
 *
 * `artifactHref` above is the other half and is not replaced by this: one is
 * *the thing, whole, at its own address*, the other is *the thing, beside what
 * was said about it*. A founder wants both, at different moments.
 */
export const WORKSPACE_ANCHOR = "workspace";

export function threadArtifactHref(
  projectId: string,
  threadId: string,
  artifact: ArtifactRef,
): string {
  const ref = artifactRefId(artifact);
  const query = new URLSearchParams({ [WORKSPACE_ARTIFACT_PARAM]: artifact.kind });
  if (ref !== null) query.set(WORKSPACE_ARTIFACT_REF_PARAM, ref);

  return `${threadPath(projectId, threadId)}?${query.toString()}#${WORKSPACE_ANCHOR}`;
}
