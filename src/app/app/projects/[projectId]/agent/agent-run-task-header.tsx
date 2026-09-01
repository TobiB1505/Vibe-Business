import { MonoLabel } from "@/components/ui/typography";
import { AgentTaskPanel, type AgentTask } from "./agent-task-panel";

/** The compact task card above Validate, Preview and Review. */
export function AgentRunTaskHeader({
  task,
  stage,
  filesChanged,
}: {
  task: AgentTask | null;
  stage: string;
  filesChanged: number | null;
}) {
  return (
    <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
      <div className="min-w-0">
        {task === null ? (
          <div className="flex flex-col gap-2">
            <MonoLabel className="text-mint">Current task</MonoLabel>
            <p className="text-fg-body text-base">Task details are unavailable for this run.</p>
          </div>
        ) : (
          <AgentTaskPanel task={task} compact summary />
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:flex lg:flex-none">
        <div className="rounded-well border-line-2 bg-well flex min-w-[11.75rem] flex-col gap-2 border px-5 py-4">
          <span className="text-fg-body text-sm font-semibold">Current stage</span>
          <span className="text-fg-muted font-mono text-xs">{stage}</span>
        </div>
        <div className="rounded-well border-line-2 bg-well flex min-w-[11.75rem] flex-col gap-2 border px-5 py-4">
          <span className="text-fg-body text-sm font-semibold">Measured change</span>
          <span className="text-fg-muted font-mono text-xs">
            {filesChanged === null
              ? "Not measured yet"
              : `${filesChanged} ${filesChanged === 1 ? "file" : "files"}`}
          </span>
        </div>
      </div>
    </div>
  );
}
