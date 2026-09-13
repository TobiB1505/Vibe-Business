"use client";

import { useActionState, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/states";
import {
  MAX_FOUNDER_MESSAGE_CHARS,
  MIN_FOUNDER_MESSAGE_CHARS,
} from "@/modules/business-agent/orchestrator/budgets";
import { askNovaAction, type AskNovaActionState } from "./nova-turn-actions";

/**
 * The one place a founder writes to Nova.
 *
 * ## Why there is exactly one of these
 *
 * Nova's guard used to read "no text input anywhere", and it was a real claim
 * rather than a style rule: an unbounded box that feeds a model is a surface
 * where anything can be typed and something has to decide what to do with it.
 * ADR 0109 narrowed the claim rather than deleting it, in the open and with an
 * argument — Sprint 0215's shape. What replaces "none" is **one**, named, and
 * bounded by the same constant the server enforces, and `nova-ui.test.ts`
 * holds the count at one.
 *
 * ## Bounded in two places on purpose
 *
 * `maxLength` here is a courtesy: it shows the founder the limit instead of
 * letting them meet it. `sanitizeFounderMessage` on the server is the fact,
 * because a browser control is a suggestion and a form can be posted without
 * one. The constant is shared so the two can never disagree.
 *
 * ## Enter sends, Shift+Enter does not
 *
 * The convention every chat a founder has used already follows. The form still
 * submits by button, so the keyboard path and the pointer path are the same
 * path, and a screen reader reaches a real submit control rather than a
 * keydown handler.
 *
 * ## Uncontrolled, and why that is the right shape here
 *
 * React resets an uncontrolled form once its action resolves, so the box clears
 * itself on a successful send with no effect and no state to keep in step. The
 * failing case is the one that needed thought: a reset there would throw away
 * what somebody typed, so the action returns their text with the refusal and
 * it goes back into the box. Only the *length* is tracked in state, and only so
 * the send control can refuse an empty question before the server has to.
 *
 * ## What it does not do
 *
 * It does not stream, poll, optimistically render the founder's own message,
 * or hold any part of the conversation. The thread is server-rendered from
 * rows; this control's whole job is to start a turn and get out of the way.
 */
export function NovaComposer({
  projectId,
  conversationId,
  /** True while a turn is already running: one live turn per conversation. */
  busy,
}: {
  projectId: string;
  conversationId: string | null;
  busy: boolean;
}) {
  const [state, formAction, pending] = useActionState<AskNovaActionState, FormData>(
    askNovaAction.bind(null, projectId),
    null,
  );
  const restored = state?.ok === false ? state.text : "";
  const [length, setLength] = useState(restored.trim().length);
  const formRef = useRef<HTMLFormElement>(null);
  const fieldId = useId();

  const tooShort = length < MIN_FOUNDER_MESSAGE_CHARS;
  const disabled = pending || busy || tooShort;

  return (
    <div className="flex w-full flex-col gap-2">
      <form ref={formRef} action={formAction} className="flex w-full flex-col gap-2">
        {conversationId ? (
          <input type="hidden" name="conversationId" value={conversationId} />
        ) : null}
        <label htmlFor={fieldId} className="sr-only">
          Ask Nova about your product
        </label>
        <Textarea
          id={fieldId}
          name="message"
          /*
           * Keyed on the refusal so a returned message actually re-enters the
           * box: React reuses an uncontrolled input across renders and would
           * otherwise ignore a changed `defaultValue`.
           */
          key={restored}
          defaultValue={restored}
          onChange={(event) => setLength(event.target.value.trim().length)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              if (!disabled) formRef.current?.requestSubmit();
            }
          }}
          maxLength={MAX_FOUNDER_MESSAGE_CHARS}
          rows={2}
          className="min-h-20"
          disabled={busy}
          placeholder={busy ? "Nova is working on your last one…" : "Ask Nova about your product"}
        />
        <div className="flex items-center justify-end gap-3">
          <Button type="submit" variant="primary" busy={pending} disabled={disabled}>
            {pending ? "Sending…" : "Ask Nova"}
          </Button>
        </div>
      </form>
      {state?.ok === false && (
        <Notice tone="problem" label="It did not send">
          {state.message}
        </Notice>
      )}
    </div>
  );
}
