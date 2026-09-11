import { MonoLabel } from "@/components/ui/typography";
import { Well } from "@/components/ui/surface";

/**
 * Stage three's first column (UI-19, reference artboard 2c).
 *
 * ## Why Agent activity does not live here
 *
 * Validation is deliberately two columns: what the independent gate means and
 * the checks it ran. The Agent's event stream belongs to Build; repeating it
 * here made implementation activity look like validation evidence.
 *
 * ## What it promises
 *
 * The next gate, and nothing beyond it. A passing validation means a profile's
 * commands exited zero in an isolated VM — never that a change is safe, correct
 * or ready (rule 66) — so this says a preview comes next and stops there.
 */
/**
 * Where this stage is drawn, and what that costs it.
 *
 * `page` is the Agent workspace: a narrative left column — the stage number,
 * a display heading, a paragraph and a "what happens next" well — beside the
 * evidence and the controls.
 *
 * `block` is Nova's thread, where every one of those is already said. Her
 * bubble above the block says what is happening and why, the block's own frame
 * names it, and the thread is the sequence, so a stage number inside it is a
 * second count of the same position. What is left is the half a page cannot
 * say twice: the checks, the control, and the line about isolation.
 *
 * A prop and not a second component, for the reason the Deep Scan panel took
 * one: two components rendering one stage is two places for a founder's screen
 * to drift, and the drift is invisible until somebody opens both.
 */
export type AgentStagePresentation = "page" | "block";

export function AgentValidateStage({
  running,
  checks,
  action,
  presentation = "page",
}: {
  running: boolean;
  checks?: React.ReactNode;
  action?: React.ReactNode;
  presentation?: AgentStagePresentation;
}) {
  if (presentation === "block") {
    return (
      <div className="flex min-w-0 flex-col gap-5" data-testid="agent-validate-intro">
        {checks}
        {action}
        {/*
          Kept, where the heading and the prose are not: that validation ran
          nowhere near the founder's product is a fact about what Vibe did,
          and it is the one sentence here that Nova's own line does not carry.
        */}
        <p className="text-fg-muted text-body">
          Validation runs in an isolated environment. Nothing is live.
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-7" data-testid="agent-validate-intro">
      <div className="grid min-w-0 gap-8 lg:grid-cols-[minmax(0,.9fr)_minmax(0,1.18fr)] lg:items-start lg:gap-12">
        <div className="flex min-w-0 flex-col gap-4">
          <MonoLabel className="text-mint">Stage 3 of 5</MonoLabel>

          <h3 className="text-fg text-moment font-bold text-balance">
            {running ? "Validating your changes" : "The checks Vibe ran"}
          </h3>

          <p className="text-fg-prose max-w-[46ch] text-lead leading-relaxed text-pretty">
            {running
              ? "Vibe is running checks in an isolated environment before showing you a preview."
              : "Each check ran in an isolated environment on this exact change, before any preview existed."}
          </p>

          <Well className="mt-1 flex gap-3.5 p-4">
            <svg
              viewBox="0 0 24 24"
              width="19"
              height="19"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-mint mt-px flex-none"
              aria-hidden="true"
            >
              <path d="M13.2 2.5 4.8 13.2h6L10 21.5l8.4-10.7h-6l.8-8.3Z" />
            </svg>
            <span className="flex flex-col gap-1.5">
              <span className="text-fg-body text-card-title font-semibold">
                What happens next?
              </span>
              <span className="text-fg-muted max-w-[48ch] text-body leading-relaxed">
                Once the checks are done you can preview the change and compare it against your
                live product, before deciding anything.              </span>
            </span>
          </Well>
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          {checks}
          {action}
        </div>
      </div>

      <div className="border-line-2 mt-2 flex min-h-[5.25rem] flex-wrap items-center justify-between gap-4 border-t px-1 py-7">
        <span className="text-fg-muted flex items-center gap-3 text-body">
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-mint"
            aria-hidden="true"
          >
            <rect x="4" y="10.5" width="16" height="10" rx="2" />
            <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
          </svg>
          Validation runs in an isolated environment. Nothing is live.
        </span>
        <span className="text-fg-meta font-mono text-caption">
          {running ? "Checks in progress" : "Checks recorded"}
        </span>
      </div>
    </div>
  );
}
