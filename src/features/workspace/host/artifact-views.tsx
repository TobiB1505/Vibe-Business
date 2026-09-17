import "server-only";

import { AuditBlock, MoveBlock, ReviewBlock } from "@/features/nova/thread/blocks";
import { UnderstandingPanel } from "@/features/product/understanding-panel";
import { ExperimentCard } from "@/features/experiments/experiment-card";
import { EmptyState } from "@/components/ui/states";
import { getLatestAuditStamp, getProjectAuditById } from "@/modules/business-audit/store";
import { buildBusinessBrainView } from "@/modules/projects/business-brain-view";
import { getMoveWithExecution } from "@/modules/execution/service";
import { getPreparedChangeWorkspaceItem } from "@/modules/execution/workspace";
import { getProjectImpact } from "@/modules/business-measurement/project-impact";
import { getLatestProfile } from "@/modules/product-understanding/store";
import { buildUnderstandingView } from "@/modules/product-understanding/view";
import type { ArtifactRef } from "@/modules/nova/artifacts";
import type { ProjectAccess } from "@/modules/projects/workspace-context";
import { projectSectionPath } from "@/lib/routing/project-urls";
import { ARTIFACT_SEGMENT } from "../registry/artifacts";

/**
 * What the workspace draws for one artifact — and what it deliberately does not.
 *
 * ## One view, two frames, and no copies
 *
 * Every branch below mounts a component some other surface already mounts, at
 * the compact presentation that component already has. `AuditBlock`,
 * `MoveBlock` and `ReviewBlock` are the thread's own blocks;
 * `UnderstandingPanel` is My Product's; `ExperimentCard` is the Experiments
 * page's. Nothing in `features/workspace/` draws a pixel of an artifact itself,
 * which is the property that stops this becoming the universal artifact engine
 * [ADR 0109](../../../../docs/decisions/0109-nova-first-application-shell.md)
 * §4 refuses.
 *
 * ## Why three of the eight are named rather than drawn
 *
 * `action_plan`, `agent_execution` and `founder_input` are not objects that fit
 * beside a conversation, and the reason is the same for all three: each is a
 * *workspace of its own*, not a thing to look at.
 *
 *   - An **action plan** is a sequence read in order, with a control per step
 *     and a handoff model behind it. Three steps of it in a column is not a
 *     smaller plan, it is a worse one.
 *   - An **agent execution** is a five-stage run with two live streams. A pane
 *     that showed a third of it while the run moved would be the thing a
 *     founder watched instead of the screen built for watching.
 *   - A **founder input** belongs to the run that is paused waiting for it, and
 *     answering it out of that context is how a founder answers the wrong
 *     question. It is also already the first thing on Nova's own screen when it
 *     is the thing that matters — which is where a question that stops a run
 *     ought to be.
 *
 * So the pane names them, says the one true thing it can say without a read,
 * and opens them. That is a decision with a reason rather than a gap, and it is
 * why this file has no `default:` branch: a ninth kind fails the build until
 * somebody makes the same decision about it.
 *
 * ## Reads
 *
 * One artifact is on screen at a time, so exactly one of these runs. Each makes
 * the same read the surface that owns the artifact makes — never a second read
 * model assembled for the pane, which is the kind that drifts and then
 * contradicts the page it was copied from.
 */

export type ArtifactViewResult =
  /** Drawn here, by the feature that owns it. */
  | { kind: "view"; node: React.ReactNode }
  /**
   * Named here, read at its own address. `reason` is shown to the founder — it
   * is the sentence above, said once, rather than a blank panel and a button.
   */
  | { kind: "elsewhere"; reason: string };

export async function artifactView(
  access: ProjectAccess,
  artifact: ArtifactRef,
): Promise<ArtifactViewResult> {
  switch (artifact.kind) {
    case "business_health":
      return { kind: "view", node: await businessHealth(access) };
    case "product":
      return { kind: "view", node: await product(access) };
    case "opportunity":
      return { kind: "view", node: await move(access, artifact.opportunityId) };
    case "prepared_change":
      return { kind: "view", node: await preparedChange(access, artifact.preparedChangeId) };
    case "experiment":
      return { kind: "view", node: await experiment(access) };
    case "action_plan":
      return {
        kind: "elsewhere",
        reason:
          "Your plan is a sequence, and it is read in order — each step with the control that moves it.",
      };
    case "agent_execution":
      return {
        kind: "elsewhere",
        reason:
          "A run has five stages and two live streams. It is worth the whole screen while it is going.",
      };
    case "founder_input":
      return {
        kind: "elsewhere",
        reason:
          "A question belongs to the run that is waiting on it, so it is answered there — or on Nova's own screen, where it goes first.",
      };
  }
}

/** The nine lenses, the score and the blocker — the thread's own audit block. */
async function businessHealth(access: ProjectAccess): Promise<React.ReactNode> {
  const stamp = await getLatestAuditStamp(access.supabase, access.project.id);
  if (!stamp) return <Nothing what="No business reading has finished yet." />;

  const stored = await getProjectAuditById(access.supabase, {
    projectId: access.project.id,
    auditId: stamp.id,
  });
  if (!stored?.result?.synthesis) return <Nothing what="No business reading has finished yet." />;

  const view = buildBusinessBrainView({
    audit: stored.result,
    lastScanAt: stored.completedAt ?? stored.createdAt,
    auditReadings: [],
    movesByConclusion: {},
  });
  if (!view) return <Nothing what="No business reading has finished yet." />;

  return <AuditBlock view={view} />;
}

/** What Vibe understands the product to be. My Product's own panel. */
async function product(access: ProjectAccess): Promise<React.ReactNode> {
  const profile = await getLatestProfile(access.supabase, access.project.id);
  if (profile === null) return <Nothing what="Vibe has not read this product yet." />;

  return (
    <UnderstandingPanel
      view={buildUnderstandingView(profile.profile, profile.stored.synthesized)}
      projectId={access.project.id}
      confirmedAt={profile.stored.confirmedAt ?? null}
      /*
       * No controls. Confirming a reading, correcting it and re-running the
       * scan are all consequential and two of them are priced — they belong on
       * the page that states what they cost, and a pane beside a conversation
       * is not that page. `actions` is a required prop rather than an optional
       * one, so passing nothing is a decision the compiler made me make.
       */
      actions={null}
    />
  );
}

/** One Move, as the plan and the thread both draw it. */
async function move(access: ProjectAccess, opportunityId: string): Promise<React.ReactNode> {
  const found = await getMoveWithExecution(access.supabase, {
    projectId: access.project.id,
    opportunityId,
  });

  // A Move that has been superseded, or one whose id came from an old link.
  // Nothing rather than an empty card: the conversation beside it still stands.
  if (found === null) return <Nothing what="That Move is not in the current plan." />;

  return <MoveBlock opportunity={found.opportunity} execution={found.execution} />;
}

/**
 * One prepared change, at whatever stage it is — validation, preview, approval
 * or merge. `ReviewBlock` reads the stage off the change itself, which is the
 * distinction `home-view.ts` records losing when it was derived from a moment.
 */
async function preparedChange(
  access: ProjectAccess,
  preparedChangeId: string,
): Promise<React.ReactNode> {
  const change = await getPreparedChangeWorkspaceItem(access.supabase, {
    projectId: access.project.id,
    userId: access.userId,
    repositoryFullName: access.project.repository?.fullName ?? null,
    preparedChangeId,
  });

  if (change === null) return <Nothing what="That change is no longer waiting for you." />;

  return (
    <ReviewBlock
      projectId={access.project.id}
      change={change}
      planHref={projectSectionPath(access.project.id, ARTIFACT_SEGMENT.action_plan)}
    />
  );
}

/** The most recent merged change and what became true afterwards. */
async function experiment(access: ProjectAccess): Promise<React.ReactNode> {
  const impact = await getProjectImpact(access.supabase, {
    projectId: access.project.id,
    userId: access.userId,
    repositoryConnected: access.project.repository !== null,
  });

  const latest = impact.entries[0];
  if (latest === undefined)
    return <Nothing what="Nothing has merged yet, so nothing is measured." />;

  return (
    <ExperimentCard
      entry={latest}
      agentHref={projectSectionPath(access.project.id, ARTIFACT_SEGMENT.agent_execution)}
    />
  );
}

/**
 * An artifact whose read came back with nothing.
 *
 * Never zero, never a frame around an absence, and never a guess about why —
 * the sentence says what is true and the conversation beside it is unaffected.
 */
function Nothing({ what }: { what: string }) {
  return <EmptyState title="Nothing to show here yet" description={what} />;
}
