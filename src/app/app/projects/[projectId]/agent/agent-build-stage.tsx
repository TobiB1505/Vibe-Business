import { MonoLabel } from "@/components/ui/typography";
import { AgentAssuranceBar } from "./agent-assurance-bar";
import { AgentTaskPanel, type AgentTask } from "./agent-task-panel";
import type { AgentStagePresentation } from "./agent-validate-stage";

/** Stage two: task, working core and grounded activity in one live workspace. */
export function AgentBuildStage({
  task,
  live,
  core,
  activity,
  presentation = "page",
}: {
  task: AgentTask | null;
  live: boolean;
  core: React.ReactNode;
  activity: React.ReactNode;
  /** See `AgentStagePresentation`. `block` drops what Nova already said. */
  presentation?: AgentStagePresentation;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-7" data-testid="agent-build">
      <div className="grid min-w-0 gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(18rem,1fr)_minmax(19rem,1.08fr)] xl:items-start">
        {/*
          The task, and the stand-in for one.

          A real task stays in both places: it is what the founder asked for,
          and no other surface repeats it. The stand-in does not. *"Vibe is
          writing the change"* is the sentence Nova's own bubble says one line
          above the block, and the paragraph under it — work happens on a
          branch of its own, nothing reaches your default branch without your
          approval — is what the assurance bar at the foot of this stage says
          in its own words.
        */}
        {(task !== null || presentation === "page") && (
          <div className="min-w-0 xl:pt-2">
            {task === null ? (
              <div className="flex flex-col gap-4">
                <MonoLabel className="text-mint">Current task</MonoLabel>
                <h3 className="text-fg text-2xl leading-tight font-bold tracking-[-0.03em]">
                  {live ? "Vibe is writing the change" : "Vibe wrote the change"}
                </h3>
                <p className="text-fg-prose max-w-[46ch] text-base leading-relaxed">
                  Work happens in an isolated environment on a branch of its own. Nothing reaches
                  your default branch without your approval.
                </p>
              </div>
            ) : (
              <AgentTaskPanel task={task} compact summary />
            )}
          </div>
        )}

        <div className="flex min-w-0 items-start justify-center">{core}</div>
        <div className="min-w-0">{activity}</div>
      </div>

      {/*
        Three assurances in a row on a page; three stacked rows in a thread
        column, at three hundred pixels, partly repeating each other — "nothing
        is live yet" above "you're always in control". The claim is worth
        keeping and the bar is not the way to make it here, so the block says
        it once, in the same shape the validate stage settled on.
      */}
      {presentation === "page" ? (
        <AgentAssuranceBar showGuidance={false} />
      ) : (
        <p className="text-fg-muted text-sm">
          Work happens in an isolated copy of your code, on a branch of its own. Nothing reaches
          your default branch without your approval.
        </p>
      )}
    </div>
  );
}
