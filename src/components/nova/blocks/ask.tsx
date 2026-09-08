"use client";

import { FounderInputCard } from "@/components/founder-input/founder-input-card";
import type { FounderInputFormState } from "@/components/founder-input/founder-input-card";
import type { FounderInputRequest } from "@/modules/founder-input/schema";

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
 * Because `FounderInputCard` already splits the two halves that had to be
 * split: it renders the question, the reason, the recommendation and the
 * options, and it takes the server action that answers as a prop. It does not
 * know where it is. So the card travels into the thread and the action stays
 * with whoever can perform it — which is why an ask block is a dozen lines
 * rather than a second answering flow to keep in step with the first.
 *
 * ## What used to be here, and why it went
 *
 * `AgentQuestionPanel`, in its `block` variant, wrapping the card. The panel
 * writes "Vibe has a question" and the waiting time as a heading; the card
 * writes "Execution paused" and the question; the render block above both
 * writes "Needs your answer". Three statements of one fact, and — because the
 * card brought its own amber `Surface` inside the block's amber frame — two
 * borders around one question.
 *
 * The card won because it is the half that cannot be dropped: it holds the
 * options and the submit. What it was missing was the waiting time, which is
 * the only thing the panel said that nothing else did, so the card takes it as
 * a prop now. The panel is untouched and still owns the Agent route, where it
 * is a page-scale object rather than a heading inside somebody else's frame.
 */
export function AskBlock({
  projectId,
  request,
  /**
   * Which flow asked.
   *
   * A runtime question has a paused run behind it and the card says so; a
   * planner question does not. The candidate's kind is what knows, and it is
   * the same distinction `focus.ts` uses to raise two candidates instead of
   * one.
   */
  context,
  /** How long it has been waiting, already formatted by whoever holds a clock. */
  waitingSince,
  /** Real open requests on this plan. Used only to orient the current one. */
  openRequestCount = 1,
  /** The real thing in production. A no-op with a truthful message in the lab. */
  resolveAction,
}: {
  projectId: string;
  request: FounderInputRequest;
  context: "action_plan" | "runtime_execution";
  waitingSince?: string;
  openRequestCount?: number;
  resolveAction: (
    projectId: string,
    requestId: string,
    contextHash: string,
    previous: FounderInputFormState,
    formData: FormData,
  ) => Promise<FounderInputFormState>;
}) {
  return (
    <FounderInputCard
      projectId={projectId}
      request={request}
      context={context}
      presentation="block"
      waitingSince={waitingSince}
      openRequestCount={openRequestCount}
      resolveAction={resolveAction}
    />
  );
}
