"use client";

import type { ReactNode } from "react";
import { AgentQuestionPanel } from "@/app/app/projects/[projectId]/agent/agent-question-panel";
import { AgentWorkspaceChoice } from "@/app/app/projects/[projectId]/agent/agent-workspace-choice";
import { FounderInputCard } from "@/components/founder-input/founder-input-card";
import type { FounderInputFormState } from "@/components/founder-input/founder-input-card";
import type { FounderInputRequest } from "@/modules/founder-input/schema";
import type { StoredExecutionInterrupt } from "@/modules/coding-agent/store";
import type { WorkspaceCandidate } from "@/modules/validation/profile";

/**
 * The ask: a question answered where it was asked.
 *
 * ## The interaction this replaces
 *
 * "Answer in the Agent". A founder reads Nova's question, presses a button
 * that leaves the conversation, answers on another screen, and is expected to
 * come back — while the run sits paused the whole time. It is the one
 * interaction a surface built to be *the* place a founder works must not have,
 * and it was on ten of the twenty-one moments.
 *
 * ## Why it is composition and not a rebuild
 *
 * Because the shipped pieces already split the two halves that had to be
 * split. `AgentQuestionPanel` renders *what is asked* — from the interrupt —
 * and takes the control as children. `FounderInputCard` is *how it is
 * answered*, and takes its server action as a prop. Neither knows where it is.
 *
 * So the panel travels into the thread and the action stays with whoever can
 * perform it. That is the whole mechanism, and it is why an ask block is a
 * dozen lines rather than a second answering flow to keep in step with the
 * first — which is exactly what the audit map had become.
 *
 * ## What the lab cannot show, and says so
 *
 * The action. `resolveFounderInputAction` writes a durable resolution and
 * unblocks a paused run; there is nothing here to unblock and nothing to
 * write, so the study passes a no-op that reports what it is. The boundary is
 * visible rather than papered over — in production Nova's own route supplies
 * the real action, the same way the agent route supplies it today.
 */
export function AskBlock({
  interrupt,
  request,
  /** The real thing in production. A no-op with a truthful message here. */
  resolveAction,
}: {
  interrupt: StoredExecutionInterrupt;
  request: FounderInputRequest;
  resolveAction: (
    projectId: string,
    requestId: string,
    contextHash: string,
    previous: FounderInputFormState,
    formData: FormData,
  ) => Promise<FounderInputFormState>;
}) {
  return (
    <AgentQuestionPanel
      interrupt={interrupt}
      variant="block"
      waitingSince="12m"
      /* The card below states the question, the reason and the options. On the
         workspace page those sit in two columns and read as a title and a form;
         stacked in a block they were the same sentence twice. */
      questionInChildren
    >
      <FounderInputCard
        projectId="project_e2e"
        request={request}
        context="runtime_execution"
        resolveAction={resolveAction}
        presentation="workspace"
      />
    </AgentQuestionPanel>
  );
}

/**
 * The plan's question, answered in the thread.
 *
 * The same card as the agent's, with `context="action_plan"` — and no panel
 * around it, because the plan page does not wrap it in one either. That is
 * worth noticing rather than smoothing over: the two questions are the same
 * object to the founder and two shapes in the code, and the block inherits
 * whichever shape the owning surface uses rather than imposing a third.
 */
export function PlanAskBlock({
  request,
  resolveAction,
  openRequestCount = 1,
}: {
  request: FounderInputRequest;
  resolveAction: (
    projectId: string,
    requestId: string,
    contextHash: string,
    previous: FounderInputFormState,
    formData: FormData,
  ) => Promise<FounderInputFormState>;
  /** Real open requests on this plan. Used only to orient the current one. */
  openRequestCount?: number;
}) {
  return (
    <FounderInputCard
      projectId="project_e2e"
      request={request}
      context="action_plan"
      presentation="workspace"
      openRequestCount={openRequestCount}
      resolveAction={resolveAction}
    />
  );
}

/**
 * Which application Vibe works on, chosen in the thread.
 *
 * `AgentWorkspaceChoice` splits the same two halves as the question panel: it
 * renders the candidates and takes one control *per candidate* from the
 * caller. So the list travels and the choosing stays behind — and the notice
 * it carries travels with it, which matters more than it looks. "Choosing is
 * free and you can change it later. Nothing starts running" is the sentence
 * that stops a founder reading this as the moment a priced run begins, and a
 * block that rebuilt the list would have had to remember to write it.
 */
export function WorkspaceAskBlock({
  candidates,
  chosen,
  action,
}: {
  candidates: readonly WorkspaceCandidate[];
  chosen?: string | null;
  /**
   * One submit control per candidate, from whoever can perform the choice.
   *
   * In production that is `AgentWorkspaceChoiceAction`, which binds the
   * directory as an argument so there is no field for anything else to arrive
   * in. Omitted here, and the omission is instructive: a render prop cannot
   * cross from a server component to a client one, so whoever supplies the
   * control has to be a client component — which is precisely what the owning
   * route is, and what the lab's placeholder below stands in for.
   */
  action?: (candidate: WorkspaceCandidate) => ReactNode;
}) {
  return (
    <AgentWorkspaceChoice
      candidates={candidates}
      chosen={chosen}
      action={action ?? (() => <LabChoice />)}
    />
  );
}

/** What a control would be. It does nothing and does not pretend otherwise. */
function LabChoice() {
  return (
    <span className="shrink-0 rounded-nav border border-line-3 bg-surface-2 px-3 py-1.5 text-caption text-fg-meta">
      Choose
    </span>
  );
}
