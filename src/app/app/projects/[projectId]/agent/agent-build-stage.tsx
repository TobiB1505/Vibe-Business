import { MonoLabel } from "@/components/ui/typography";
import { Well } from "@/components/ui/surface";
import type { AgentTask } from "./agent-task-panel";

/**
 * Stage two, in the reference's own shape (UI-19).
 *
 * ## Why this is a component and not the task panel again
 *
 * The task panel used to be this stage's body, which meant stage two restated
 * the header directly above it and said nothing about the stage itself. Every
 * other stage names what is happening in it — "Validating your changes", "Your
 * change is ready to preview" — and this one is where the founder most needs
 * that, because it is the longest.
 *
 * ## What it will not say
 *
 * How far along the work is. No percentage, no step count, no elapsed or
 * remaining time: the agent reports what it has *done*, and the panel beside
 * this one lists exactly that. A progress bar here would be a number nothing
 * measured.
 */
export function AgentBuildStage({
  task,
  live,
}: {
  task: AgentTask | null;
  live: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="agent-build">
      <div className="flex flex-col gap-2">
        <MonoLabel className="text-mint">Stage 2 of 5</MonoLabel>
        <h3 className="text-fg text-2xl leading-tight font-bold tracking-[-0.03em] text-balance">
          {live ? "Vibe is writing the change" : "Vibe wrote the change"}
        </h3>
      </div>

      <p className="text-fg-prose max-w-[52ch] text-base leading-relaxed text-pretty">
        {live
          ? "Work happens in an isolated environment on a branch of its own. Your repository and your live product are untouched until you approve something."
          : "The work is done and on a branch of its own. Nothing has reached your repository's default branch, and nothing will without your approval."}
      </p>

      {/* The Move's own steps, as a statement of intent. Not progress: no tick
          here means "finished", and the panel beside this one is the record. */}
      {task !== null && task.steps.length > 0 && (
        <div className="border-line-3 flex flex-col gap-3.5 border-t pt-5">
          <MonoLabel className="text-fg-secondary">
            What this change is meant to do
          </MonoLabel>
          <ul className="flex flex-col gap-2.5">
            {task.steps.map((step) => (
              <li
                key={step}
                className="text-fg-body flex items-start gap-3 text-[0.9375rem]"
              >
                <span
                  aria-hidden="true"
                  className="border-line-3 text-fg-meta mt-0.5 flex size-5 flex-none items-center justify-center rounded-full border text-[11px]"
                >
                  ·
                </span>
                {step}
              </li>
            ))}
          </ul>
        </div>
      )}

      <Well className="flex gap-3.5 p-4">
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-mint mt-px flex-none"
          aria-hidden="true"
        >
          <rect x="4" y="10.5" width="16" height="10" rx="2" />
          <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
        </svg>
        <span className="text-fg-muted text-sm leading-relaxed">
          Vibe is working in a secure, isolated environment. Your code is never
          changed directly.
        </span>
      </Well>
    </div>
  );
}
