import { MonoLabel } from "@/components/ui/typography";
import { AgentAssuranceBar } from "./agent-assurance-bar";
import { AgentTaskPanel, type AgentTask } from "./agent-task-panel";

/** Stage two: task, working core and grounded activity in one live workspace. */
export function AgentBuildStage({
  task,
  live,
  core,
  activity,
}: {
  task: AgentTask | null;
  live: boolean;
  core: React.ReactNode;
  activity: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-7" data-testid="agent-build">
      <div className="grid min-w-0 gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(18rem,1fr)_minmax(19rem,1.08fr)] xl:items-start">
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

        <div className="flex min-w-0 items-start justify-center">{core}</div>
        <div className="min-w-0">{activity}</div>
      </div>

      <AgentAssuranceBar showGuidance={false} />
    </div>
  );
}
