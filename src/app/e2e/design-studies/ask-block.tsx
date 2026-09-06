"use client";

import { AgentQuestionPanel } from "@/app/app/projects/[projectId]/agent/agent-question-panel";
import { FounderInputCard } from "@/components/founder-input/founder-input-card";
import type { FounderInputFormState } from "@/components/founder-input/founder-input-card";
import type { FounderInputRequest } from "@/modules/founder-input/schema";
import type { StoredExecutionInterrupt } from "@/modules/coding-agent/store";

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
