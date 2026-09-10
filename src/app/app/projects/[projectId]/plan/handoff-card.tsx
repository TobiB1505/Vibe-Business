"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { CheckIcon } from "@/components/ui/dashboard-icons";
import { StatusPill } from "@/components/ui/status-pill";
import { Surface } from "@/components/ui/surface";
import { MonoLabel } from "@/components/ui/typography";
import type { ActionPlanStep } from "@/modules/action-plans/schema";
import { compileHandoffPrompt, type LaterStep, type SettledStep } from "@/modules/handoff/prompt";
import { HANDOFF_TOOL_CHOICES, HANDOFF_TOOL_LABELS } from "@/modules/handoff/view";
import type { HandoffPurpose, HandoffTool } from "@/modules/handoff/schema";
import { recordHandoffAction, type HandoffActionState } from "../handoff-action";

/**
 * "Vibe won't build this one — your own tool can" (ADR 0099).
 *
 * ## Why a screen and not a sentence
 *
 * Vibe refuses payment architecture permanently, and the refusal is right: its
 * validation runs the project's own typecheck, tests and build, and none of
 * those can see that a charge is off by a factor of a hundred. Until now that
 * left the plan with nothing on it — the step is `vibe` + `product_change`, so
 * no attestation admitted it either, and the founder simply stopped.
 *
 * But they are a vibe coder. They already have a coding agent, with their
 * credentials, on their machine, allowed to do what Vibe is not. What they do
 * not have is Vibe's answer to *what* to build and *why*. So the refusal
 * becomes a handoff.
 *
 * ## Two states, one card
 *
 * Before the handoff it asks which tool, because the prompt's first sentence
 * differs for an agent in a checked-out repository and a hosted builder with no
 * branch. After it, it shows the prompt and the confirmation.
 *
 * ## What it never claims
 *
 * That Vibe built anything. The finding the founder writes afterwards is their
 * report of what their tool did — Vibe validated none of it, and the copy says
 * so rather than letting a completed step imply otherwise.
 */
/**
 * The two things this card can be, in the founder's words.
 *
 * Same mechanism, opposite reasons, and saying the wrong one would be a lie in
 * either direction. A refusal that read "Vibe cannot reach this" would excuse
 * a policy decision as a limitation; a measurement that read "Vibe won't build
 * this" would claim there was something to build.
 */
const PURPOSE_COPY: Record<
  HandoffPurpose,
  { pill: string; lead: string; toolQuestion: string; toolFootnote: string }
> = {
  build: {
    pill: "Vibe won't build this one",
    lead:
      "Vibe can only ship a change it can prove is sound, and its checks cannot tell a correct " +
      "charge from a wrong one. Your own coding tool can build this — Vibe will write the " +
      "instructions.",
    toolQuestion: "What do you build with?",
    toolFootnote:
      "This writes no code and spends nothing. It records which tool you chose and gives you " +
      "the prompt for it.",
  },
  verify: {
    pill: "Only you can check this one",
    lead:
      "Vibe's checks run with no network and no keys, so they can never complete a real " +
      "signup or payment. Your own tool runs where the keys and the live app are — Vibe " +
      "will write what to check.",
    toolQuestion: "Want a prompt to check it with?",
    toolFootnote:
      "Optional. This changes nothing and spends nothing — it gives you a prompt to run the " +
      "check with. Already checked it? Just record what happened below.",
  },
};

export function HandoffCard({
  projectId,
  actionPlanId,
  step,
  repository,
  tool,
  settled,
  later,
  purpose,
  confirmation,
}: {
  projectId: string;
  actionPlanId: string;
  step: ActionPlanStep;
  /** `owner/name`, or null when Vibe holds no repository for this project. */
  repository: string | null;
  /** The tool already chosen, or null when no handoff has been recorded yet. */
  tool: HandoffTool | null;
  /** Closed steps of this plan, and what closing each one produced (ADR 0099). */
  settled: readonly SettledStep[];
  /** Steps after this one — named so they are not built by accident. */
  later: readonly LaterStep[];
  /** Why the prompt is being issued — a refusal, or a check Vibe cannot reach. */
  purpose: HandoffPurpose;
  /** The attestation card, rendered under the prompt once a handoff exists. */
  confirmation: React.ReactNode;
}) {
  const copy = PURPOSE_COPY[purpose];
  const action = recordHandoffAction.bind(null, projectId, actionPlanId, step.id, purpose);
  const [state, formAction, pending] = useActionState<HandoffActionState, FormData>(action, null);

  return (
    <Surface level="card" padding="md" tone="amber" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <StatusPill tone="waiting" dot>
          {copy.pill}
        </StatusPill>
        <span className="text-fg-muted text-caption">Step {step.order}</span>
      </div>

      <div className="flex flex-col gap-1.5">
        <h3 className="text-fg text-title leading-snug font-semibold">{step.title}</h3>
        <p className="text-fg-prose text-body leading-relaxed">{step.description}</p>
        <p className="text-fg-muted text-body leading-relaxed">{copy.lead}</p>
      </div>

      {tool === null ? (
        <form action={formAction} className="flex flex-col items-start gap-2.5">
          <MonoLabel className="text-amber tracking-[0.12em]">{copy.toolQuestion}</MonoLabel>
          <div className="flex flex-wrap gap-2" data-testid="handoff-tools">
            {HANDOFF_TOOL_CHOICES.map((choice) => (
              <Button
                key={choice.id}
                type="submit"
                name="tool"
                value={choice.id}
                variant="secondary"
                disabled={pending}
              >
                {choice.label}
              </Button>
            ))}
          </div>
          <p className="text-fg-muted text-caption">{copy.toolFootnote}</p>
          {state && !state.ok && (
            <p role="alert" className="text-coral text-body">
              {state.message}
            </p>
          )}
        </form>
      ) : (
        <HandoffPrompt
          prompt={compileHandoffPrompt({ step, tool, repository, settled, later, purpose })}
          toolLabel={HANDOFF_TOOL_LABELS[tool]}
        />
      )}

      {/*
        A build handoff has nothing to confirm until the founder's tool has
        built something, so the form waits for the prompt. A verification is the
        other way round: they may have checked it already, by hand, and being
        made to pick a tool first would be the product insisting on help nobody
        asked for. Both paths, side by side — take the prompt, or just say what
        happened.
      */}
      {(tool !== null || purpose === "verify") && confirmation}
    </Surface>
  );
}

function HandoffPrompt({ prompt, toolLabel }: { prompt: string; toolLabel: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex flex-col gap-2">
      <MonoLabel className="text-amber tracking-[0.12em]">Paste this into {toolLabel}</MonoLabel>

      {/*
        The copy control sits on the block it copies, which is where every
        editor, gist and docs site puts it. It was a full-width secondary button
        beside the heading — the same weight as "Record this finding", competing
        with the action that actually advances the plan for something that only
        moves text onto a clipboard.
      */}
      <div className="relative">
        <button
          type="button"
          onClick={() => {
            /* Best effort, and the prompt stays selectable either way: a
               clipboard write can be refused by the browser, and a copy button
               that lies is worse than one that quietly does nothing. */
            void navigator.clipboard
              ?.writeText(prompt)
              .then(() => setCopied(true))
              .catch(() => setCopied(false));
          }}
          aria-label={copied ? "Prompt copied" : "Copy prompt"}
          data-testid="handoff-copy"
          className="border-line-2 bg-surface-2 text-fg-muted hover:text-fg hover:border-line-3 absolute top-2 right-2 z-10 flex items-center gap-1.5 rounded-nav border px-2 py-1 text-caption transition-interactive"
        >
          {copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
          {copied ? "Copied" : "Copy"}
        </button>
        <pre
          data-testid="handoff-prompt"
          className="border-line-2 bg-surface-2 text-fg-body rounded-well max-h-72 overflow-auto border py-2 pr-20 pl-3 text-caption leading-relaxed whitespace-pre-wrap"
        >
          {prompt}
        </pre>
      </div>
    </div>
  );
}

/** Two offset sheets — the shape every interface uses for "copy". */
function CopyIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V6a2 2 0 0 1 2-2h9" />
    </svg>
  );
}
