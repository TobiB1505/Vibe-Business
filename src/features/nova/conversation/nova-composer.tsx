"use client";

import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { NovaBubble } from "@/components/nova/nova-bubble";
import { NovaAside, NovaLine } from "@/components/nova/nova-thread";
import { MAX_QUESTION_CHARS } from "@/modules/nova/conversation/payload";
import { askNovaAction, type AskNovaResult } from "./commands/ask-nova";
import { ArtifactChip, ProposalLine } from "@/features/nova/thread/turn-pointers";

/**
 * The one input in this product (ADR 0109 §5).
 *
 * ## What the product used to say, and why it stopped
 *
 * *"There is nothing to type."* That was right for three years of this
 * surface's life and it is the sentence Slice 6 removes: the Nova architecture
 * audit's §M closed *an unrestricted chat input*, and what it closed was an
 * **unbounded** input feeding a decision. This one is bounded, it feeds a
 * validated reply, and the decisions stay where they were — behind the controls
 * the catalogue already defines.
 *
 * ## Why the reply appears here and also in the thread
 *
 * Because the founder is looking here. The answer lands under the composer
 * immediately and the thread is refreshed by the command's own
 * `revalidatePath` — so reloading shows the same exchange in its place, and
 * nothing here is the record. This component holds the last reply and nothing
 * else; the transcript is `nova_messages`.
 *
 * ## Why the button is disabled while thinking and the field is not
 *
 * A founder who thought of a better way to put it should be able to edit it. A
 * founder who presses twice should not get two answers — the bound counts both
 * (ADR 0110 §2), and the second would arrive against a thread the first had
 * already moved.
 */
export function NovaComposer({
  projectId,
  /**
   * The thread this is asking in, so a pointer in the answer has somewhere to
   * open. The chip opens the workspace *beside this conversation*, which needs
   * this conversation's address.
   */
  threadId,
}: {
  projectId: string;
  threadId: string;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<AskNovaResult | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);

  function ask(formData: FormData) {
    const question = String(formData.get("question") ?? "");
    if (question.trim().length === 0) return;

    startTransition(async () => {
      const answer = await askNovaAction(projectId, question);
      setResult(answer);
      if (answer.ok && field.current) field.current.value = "";
    });
  }

  return (
    <section className="flex flex-col gap-3" aria-label="Ask Nova">
      {result !== null && (
        <div className="flex flex-col gap-2.5">
          <NovaBubble aside={!result.ok} tail index={0}>
            {result.ok ? (
              <NovaLine>{result.reply}</NovaLine>
            ) : (
              <NovaAside>{result.message}</NovaAside>
            )}
          </NovaBubble>

          {/*
            What she pointed at, and what she offered. Both are stored as their
            own turns and both are drawn by the thread on the next load — they
            are repeated here for the same reason the reply is: the founder is
            looking at this spot, and an answer that mentioned a Move with no
            way to open it would be a sentence about a thing behind a refresh.
          */}
          {result.ok && result.artifact !== null && (
            <ArtifactChip projectId={projectId} threadId={threadId} artifact={result.artifact} />
          )}

          {result.ok && result.actionId !== null && (
            <NovaBubble aside index={1}>
              <ProposalLine projectId={projectId} actionId={result.actionId} />
            </NovaBubble>
          )}
        </div>
      )}

      <form action={ask} className="flex flex-col gap-2.5">
        <label htmlFor="nova-question" className="sr-only">
          Ask Nova about your product
        </label>
        {/*
          The product's one well, reached for rather than retyped —
          `field.test.ts` refuses a hand-written `<textarea>` anywhere outside
          `field.tsx`, because five of them with four fills between them is
          exactly how this repository got here once already.
        */}
        <Textarea
          id="nova-question"
          name="question"
          ref={field}
          rows={2}
          maxLength={MAX_QUESTION_CHARS}
          placeholder="Ask me about your product"
          className="min-h-20"
        />

        <div className="flex items-center justify-between gap-3">
          {/*
            ADR 0094: a free operation says so, in the word rather than in a
            zero. Asking costs nothing and is bounded instead (ADR 0110), and a
            founder who has to wonder is a founder who does not ask.
          */}
          <span className="text-fg-meta font-mono text-caption">Included</span>
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? "Thinking" : "Ask"}
          </Button>
        </div>
      </form>
    </section>
  );
}
