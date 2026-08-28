import { MonoLabel } from "@/components/ui/typography";
import { Well } from "@/components/ui/surface";

/**
 * Stage three's first column (UI-19, reference artboard 2c).
 *
 * ## Why the checks were not enough on their own
 *
 * The reference gives this stage three columns — what is happening, the checks
 * themselves, and the run's activity — and the build had only the last two. A
 * founder arrived at a list of shields with no sentence saying what was being
 * checked or what it leads to, which is the one thing a waiting screen owes
 * whoever is waiting.
 *
 * ## What it promises
 *
 * The next gate, and nothing beyond it. A passing validation means a profile's
 * commands exited zero in an isolated VM — never that a change is safe, correct
 * or ready (rule 66) — so this says a preview comes next and stops there.
 */
export function AgentValidateStage({
  running,
  checks,
  activity,
  action,
}: {
  running: boolean;
  checks?: React.ReactNode;
  activity?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-7" data-testid="agent-validate-intro">
      <div className="grid min-w-0 gap-8 lg:grid-cols-2 xl:grid-cols-[minmax(0,.9fr)_minmax(0,1.12fr)_minmax(19rem,1fr)] xl:items-start">
        <div className="flex min-w-0 flex-col gap-4">
          <MonoLabel className="text-mint">Stage 3 of 5</MonoLabel>

          <h3 className="text-fg text-2xl leading-tight font-bold tracking-[-0.03em] text-balance">
            {running ? "Validating your changes" : "The checks Vibe ran"}
          </h3>

          <p className="text-fg-prose max-w-[46ch] text-base leading-relaxed text-pretty">
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
              <span className="text-fg-body text-[0.9375rem] font-semibold">
                What happens next?
              </span>
              <span className="text-fg-muted max-w-[48ch] text-sm leading-relaxed">
                Once the checks are done you can preview the change and compare it against your
                live product, before deciding anything.
              </span>
            </span>
          </Well>
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          {checks}
          {action}
        </div>

        {activity !== undefined && (
          <div className="min-w-0 lg:col-span-2 xl:col-span-1">{activity}</div>
        )}
      </div>

      <div className="border-line-2 flex flex-wrap items-center justify-between gap-4 border-t pt-5">
        <span className="text-fg-muted flex items-center gap-3 text-sm">
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
        <span className="text-fg-meta font-mono text-xs">
          {running ? "Checks in progress" : "Checks recorded"}
        </span>
      </div>
    </div>
  );
}
