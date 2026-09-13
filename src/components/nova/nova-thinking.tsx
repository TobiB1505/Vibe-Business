"use client";

import { useId, useState } from "react";
import { CheckIcon, ChevronRightIcon } from "@/components/ui/icons.generated";
import type { NovaThinkingStep } from "@/modules/nova/conversation";

/**
 * What Nova did before she answered.
 *
 * ## What this shows, and the line it does not cross
 *
 * The steps Vibe **dispatched** — its own observation of its own work, read
 * back from `agent_turn_tool_calls`. It is not model reasoning. Rule 43 says
 * reasoning is never requested, never persisted and never displayed, and there
 * is no column it could have come from; the migration's own comment exists to
 * make adding one something somebody has to argue for. So the header says
 * "Looked at" rather than "Thought", because "thought" would be a claim about
 * something nobody watched.
 *
 * Each step is Vibe's own sentence about it. Never the tool's name, never its
 * arguments, never what it returned — `catalog.ts` holds the labels and
 * `conversation.ts` selects the four columns that may cross.
 *
 * ## Where the shape came from
 *
 * 21st.dev, and it was ported rather than installed. `@elements-/chain-of-thought`
 * gave the structure — a collapsible whose header carries a count, and steps
 * with a status mark, a connecting rail and room for a detail beneath. It
 * arrives depending on `@radix-ui/react-collapsible`, `lucide-react` and a
 * `tailwind-merge`-backed `cn`, and paints its states in `bg-amber-100`,
 * `text-green-600` and `text-blue-600`; Vibe has none of those three packages,
 * its `cn` is a filtered join that does not resolve conflicts, and an arbitrary
 * Tailwind colour is a defect where a token fits. `@serafimcloud/thinking-tool`
 * gave the second half — the collapsed row that shimmers while it is live and
 * goes quiet when it is done — and it injects a `<style>` element into
 * `document.head` at runtime carrying hardcoded neutral hexes with no
 * `prefers-reduced-motion` guard at all.
 *
 * What is kept is the *pattern*, which is the part worth having: a quiet
 * one-line summary that a founder can open, a rail that makes the steps read as
 * one sequence rather than four bullets, and a live state that is visibly
 * different from a finished one. Everything else is Vibe's.
 *
 * ## Rejected outright
 *
 * `@elements-/tool-call` renders each call as its raw name over a JSON payload,
 * which is built for an engineer watching an agent. `@n1m4mz/agent-trace` adds
 * span timings and token counts, which are Vibe's accounting and not a
 * founder's business. `@educalvolpz/ai-message` is a generic chat bubble, and
 * Vibe owns `NovaBubble` with its tone, tail and eyebrow.
 */

const STATE_LABEL: Record<NovaThinkingStep["state"], string | null> = {
  done: null,
  // Said, because a step that found nothing is a fact about the founder's
  // evidence rather than a failure, and silence would round it up to "done".
  empty: "nothing there yet",
  skipped: "skipped",
};

/**
 * How long it took, in words.
 *
 * Rounded to whole seconds and never to a decimal: the number is real, and
 * "4.37 seconds" implies a precision that matters to nobody. Under a second is
 * "a moment" rather than "0 seconds", which reads as nothing having happened.
 */
function elapsed(durationMs: number | null): string | null {
  if (durationMs === null || durationMs < 0) return null;
  if (durationMs < 1_000) return "a moment";
  return `${Math.round(durationMs / 1_000)} seconds`;
}

export function NovaThinking({
  steps,
  durationMs,
  /** True while the turn is still running: the header shimmers and stays open. */
  live = false,
  /**
   * What the header says while live — the stage the operation is actually in.
   *
   * Passed rather than derived, because only the caller polling the operation
   * knows it, and a header that guessed would be asserting a stage nobody
   * observed. When it is absent the header says the plain thing instead.
   */
  liveLabel,
}: {
  steps: readonly NovaThinkingStep[];
  durationMs?: number | null;
  live?: boolean;
  liveLabel?: string;
}) {
  const [open, setOpen] = useState(live);
  const panelId = useId();

  // Nothing to show, and nothing to claim. A live turn that has not finished a
  // step yet still has a header worth reading; a finished turn that ran none
  // answered from what it already held, which is a real and good outcome.
  if (steps.length === 0 && !live) return null;

  const took = elapsed(durationMs ?? null);
  const summary = live
    ? (liveLabel ?? "Looking at your business")
    : took
      ? `Looked at your business, ${took}`
      : "Looked at your business";

  return (
    <div className="flex w-full flex-col gap-2">
      <button
        type="button"
        onClick={() => setOpen((was) => !was)}
        aria-expanded={open}
        aria-controls={panelId}
        disabled={steps.length === 0}
        className="text-fg-meta hover:text-fg-secondary transition-interactive focus-visible:ring-mint/30 -mx-1 flex w-fit items-center gap-1.5 rounded-field px-1 py-0.5 text-ui focus-visible:outline-none focus-visible:ring-2 disabled:cursor-default"
      >
        <span className={live ? "nova-thinking-live" : undefined}>{summary}</span>
        {steps.length > 0 && (
          <ChevronRightIcon
            className={`size-3 shrink-0 transition-transform duration-150 ${open ? "rotate-90" : ""}`}
          />
        )}
      </button>

      {open && steps.length > 0 && (
        <ol id={panelId} className="flex flex-col gap-0">
          {steps.map((step, index) => (
            <li key={`${step.label}-${index}`} className="flex gap-2.5">
              {/*
                The mark and the rail in one column, and the rail carries no
                margin of its own.

                The first draft gave both a margin and let the rail take what
                was left, which drew a short dash between each pair of rows —
                six separate items rather than one sequence, which is the whole
                thing the rail is for. The mark now sits in a box the height of
                one line of text so it aligns with the label beside it, and the
                rail fills everything under it.
              */}
              <div className="flex w-3 shrink-0 flex-col items-center">
                <span className="flex h-5 items-center justify-center">
                  <StepMark state={step.state} />
                </span>
                {index < steps.length - 1 && <span className="bg-line-4 w-px flex-1" />}
              </div>
              <div className="flex min-w-0 flex-1 items-baseline gap-2 pb-3 leading-5">
                <span
                  className={
                    step.state === "skipped"
                      ? "text-fg-disabled text-ui"
                      : "text-fg-secondary text-ui"
                  }
                >
                  {step.label}
                </span>
                {STATE_LABEL[step.state] && (
                  <span className="text-fg-meta text-meta shrink-0">{STATE_LABEL[step.state]}</span>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/**
 * The status mark.
 *
 * A tick for a step that read something, a hollow ring for one that found
 * nothing, and a dash for one that never ran. Three marks rather than three
 * colours: colour alone is not a distinction every reader can make, and the
 * contrast budget on this surface is spent on the reply above it.
 */
function StepMark({ state }: { state: NovaThinkingStep["state"] }) {
  if (state === "done") {
    return <CheckIcon className="text-mint size-3 shrink-0" aria-hidden />;
  }
  if (state === "empty") {
    return (
      <span aria-hidden className="border-line-strong size-2.5 shrink-0 rounded-full border" />
    );
  }
  return <span aria-hidden className="bg-line-4 h-px w-2.5 shrink-0 rounded-full" />;
}
