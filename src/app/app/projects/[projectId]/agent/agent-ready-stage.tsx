import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { AgentCore } from "./agent-core";
import { AgentReadyFacts, AgentStartCta } from "./agent-start-cta";
import { AgentTaskPanel, type AgentTask } from "./agent-task-panel";

/**
 * Stage one is the signature hero from the implementation target: the task is
 * the answer, the Agent is a presence, and the three grounded facts close the
 * surface. The action is navigation back to the Action Plan because this route
 * never starts or prices a run itself.
 */
export function AgentReadyStage({
  task,
  fallback,
  planHref,
  repository,
  liveUrl,
  caption,
}: {
  task: AgentTask | null;
  fallback: React.ReactNode;
  planHref: string;
  repository: string | null;
  liveUrl: string | null;
  caption: string;
}) {
  return (
    <div className="relative min-w-0 overflow-hidden" data-testid="agent-ready-stage">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -top-44 right-12 h-[32rem] w-[38rem] rounded-full blur-3xl"
        style={{
          background:
            "radial-gradient(circle, color-mix(in oklab, var(--color-mint) 13%, transparent), transparent 68%)",
        }}
      />

      <div className="relative grid min-w-0 gap-10 lg:grid-cols-2 lg:gap-14 lg:items-start">
        <div className="min-w-0">{task === null ? fallback : <AgentTaskPanel task={task} />}</div>

        <div className="flex min-w-0 flex-col items-center gap-5 pt-1 lg:pt-0">
          <AgentCore
            state="idle"
            eyebrow="Vibe is ready to work"
            headline="Vibe understands your product, code and goals."
            caption={caption}
            size="hero"
          />
          <AgentStartCta note="Choose the move before anything starts">
            <Link
              href={planHref}
              className={`${buttonClasses({ variant: "primary", size: "md" })} w-full justify-center`}
            >
              Open Action Plan
              <svg
                viewBox="0 0 24 24"
                width="19"
                height="19"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M4 12h16m-6-6 6 6-6 6" />
              </svg>
            </Link>
          </AgentStartCta>
        </div>
      </div>

      <AgentReadyFacts
        repository={repository}
        liveUrl={liveUrl}
        className="relative mt-8"
      />
    </div>
  );
}
