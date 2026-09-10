import { AgentMergeStage } from "@/app/app/projects/[projectId]/agent/agent-merge-stage";
import { AgentPreviewStage } from "@/app/app/projects/[projectId]/agent/agent-preview-stage";
import { AgentValidateStage } from "@/app/app/projects/[projectId]/agent/agent-validate-stage";
import {
  AgentPreviewActions,
  AgentReviewDecision,
} from "@/app/app/projects/[projectId]/agent/agent-stage-actions";
import { AgentValidateAction } from "@/app/app/projects/[projectId]/agent/agent-validate-action";
import { AgentValidationChecks } from "@/app/app/projects/[projectId]/agent/agent-validation-checks";
import { Notice } from "@/components/ui/states";
import {
  agentStageForChange,
  mergeSummaryFor,
  validationChecks,
} from "@/modules/coding-agent/change-stage-view";
import type { PreparedChangeWorkspaceItem } from "@/modules/execution/workspace";

/**
 * The change, on the Agent's own screen for the stage it is on.
 *
 * ## What this replaced, and why it had to
 *
 * `ChangeGates`. That component was the review surface before the Agent
 * workspace was built, and the workspace replaced it — `agent-stage-actions.tsx`
 * says so in its own comment. It survived in one place: here. So the thread,
 * which is meant to be the primary surface, was the only screen in the product
 * still rendering the superseded one, and a founder on a phone met all five
 * gates stacked into a single column of prose.
 *
 * The registry's reason for one block over five was written about that
 * component and was true of it: *"the gate shows all of it, and it shows the
 * same thing whichever step is currently running — so one block, not five that
 * differ by a heading."* `AgentValidateStage`, `AgentPreviewStage` and
 * `AgentMergeStage` do not differ by a heading. They are three screens with
 * three different jobs, and which one a founder needs is decided by the
 * change, not by a preference.
 *
 * ## Composition, not a second implementation
 *
 * Every one of them is the component the Agent route mounts, given the same
 * card, with the same canonical panels in its slots — `AgentPreviewActions`
 * and `AgentReviewDecision` own the confirmations and the server actions, as
 * they do there. `presentation="block"` drops only the narrative column: the
 * stage number, the display heading and the paragraph restating what Nova's
 * bubble said one line above. Change any of these components and the thread
 * changes with them, because the thread holds no copy of them.
 *
 * ## What it costs to read
 *
 * Nothing. `validationChecks` and `mergeSummaryFor` are pure functions of the
 * card this block already receives, and `previewChanges` is `[]` at every
 * production call site — so the three stages need no read Nova was not already
 * making. The two stages this block cannot render, `understand` and `build`,
 * are about the *run* rather than the change, and their data comes from
 * `readAgentWorkspace`, which signs review images and preflights a merge
 * against GitHub. Those belong behind a streamed boundary, as they are on the
 * Agent route, and they are not here yet.
 */
export function ReviewBlock({
  projectId,
  change,
  planHref,
}: {
  projectId: string;
  change: PreparedChangeWorkspaceItem;
  planHref: string;
}) {
  const stage = agentStageForChange(change.progress.stage);
  const checks = validationChecks(change);

  if (stage === "validate") {
    return (
      <AgentValidateStage
        presentation="block"
        running={change.progress.stage === "validating"}
        checks={
          checks.length > 0 ? (
            <AgentValidationChecks checks={checks} />
          ) : (
            <Notice tone="info" label="Validation checks">
              Checks appear here when a prepared change reaches validation.
            </Notice>
          )
        }
        action={
          <AgentValidateAction
            projectId={projectId}
            preparedChangeId={change.id}
            rerun={change.validation !== null}
            label={change.validation === null ? "Run the checks" : "Validate again"}
          />
        }
      />
    );
  }

  if (stage === "preview") {
    return (
      <AgentPreviewStage
        presentation="block"
        images={change.reviewImages}
        /* `[]` at every production call site: the shipped stage reads the
           frames above, and this list is a fixture-only affordance. */
        changes={[]}
        filesChanged={change.filePaths.length}
        linesAdded={change.lineStats?.added}
        linesRemoved={change.lineStats?.removed}
        filesHref={change.compareUrl ?? undefined}
        reviewReady={change.review.state === "ready"}
        actions={<AgentPreviewActions projectId={projectId} change={change} />}
      />
    );
  }

  return (
    <AgentMergeStage
      presentation="block"
      summary={mergeSummaryFor(change)}
      files={change.files.map((file) => ({
        path: file.path,
        ...(file.linesAdded !== null && file.linesRemoved !== null
          ? { added: file.linesAdded, removed: file.linesRemoved }
          : {}),
      }))}
      allChecksPassed={change.validation?.status === "passed"}
      branchName={change.branchName}
      baseBranch={change.baseBranch}
      commitSha={change.commitSha}
      compareUrl={change.compareUrl}
      backHref={planHref}
      canMerge={change.merge.canMerge}
      decision={<AgentReviewDecision projectId={projectId} change={change} />}
    />
  );
}
