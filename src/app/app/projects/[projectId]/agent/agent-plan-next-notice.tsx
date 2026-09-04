import Link from "next/link";
import { Notice } from "@/components/ui/states";

/**
 * "This Move's next step isn't one Vibe can run" — said where it blocks.
 *
 * ## Why this state needed a component of its own
 *
 * The same shape `AgentStaleReadNotice` exists for, one refusal class over.
 * When the plan's current step is a founder decision, real-world work, or
 * Vibe's own work with no executor, no step resolves `agentic`, so
 * `agenticStep` is null, so `AgentReadyStage` renders an empty
 * call-to-action block under a hero still saying Vibe understands this code.
 * The caption said "an Agent run is not currently available for it" and
 * stopped there — true, and useless: it named no step, no reason and no way
 * on, and the founder's own screenshot of that dead end is why this file
 * exists.
 *
 * The distinction it draws is the one that decides what the founder does
 * next. A step Vibe is *waiting* on is somebody's work to finish; a step the
 * founder can confirm is a click away, on a screen this links to.
 *
 * ## What it does not do
 *
 * Start anything, and offer no confirmation of its own. The confirmation
 * lives on the Action Plan beside the step's own completion criterion, which
 * is the sentence a founder is actually attesting to — moving the control
 * here would separate the click from the thing it claims is true.
 *
 * The step's title is rendered as its own element rather than composed into a
 * sentence: it is model-written text, and text Vibe wrote around it must not
 * read as one continuous claim (rule 25).
 */
export function AgentPlanNextNotice({
  stepOrder,
  stepTitle,
  reasonLabel,
  planHref,
  canConfirm,
}: {
  stepOrder: number;
  stepTitle: string;
  reasonLabel: string;
  planHref: string;
  canConfirm: boolean;
}) {
  return (
    <div data-testid="agent-plan-next" className="w-full">
      <Notice
        tone="waiting"
        label="an earlier step comes first"
        action={
          <Link
            href={planHref}
            className="text-fg-prose hover:text-fg rounded-sm text-sm underline underline-offset-4 transition-interactive"
            data-testid="agent-plan-next-link"
          >
            {canConfirm ? "Confirm it on your Action Plan" : "Open your Action Plan"}
          </Link>
        }
        footnote={
          canConfirm
            ? "Confirming it costs nothing and starts nothing. Vibe's part of this Move becomes available once it is done."
            : "Vibe's part of this Move becomes available once that step is done."
        }
      >
        <span className="text-fg-secondary font-mono text-xs">
          Step {String(stepOrder).padStart(2, "0")}
        </span>{" "}
        <span className="text-fg">{stepTitle}</span> — {reasonLabel}
      </Notice>
    </div>
  );
}
