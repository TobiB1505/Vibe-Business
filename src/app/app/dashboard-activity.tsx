import Link from "next/link";
import type { ActivityEntry, ActivityTone } from "@/modules/audit-log/view";
import { Surface } from "@/components/ui/surface";
import { MonoLabel } from "@/components/ui/typography";
import { formatTimestamp } from "@/lib/utils/format-datetime";

/**
 * Recent activity across every project (Sprint UI-3).
 *
 * The quietest section on the dashboard, deliberately: it is context, not a
 * call to action. Level 1 surface where attention is level 2, no buttons, and
 * the project name is a link rather than a control.
 *
 * Every row is an event the system wrote at the moment it acted. Nothing here
 * is derived or summarised.
 */

const DOT: Record<ActivityTone, string> = {
  success: "bg-mint",
  waiting: "bg-amber",
  problem: "bg-coral",
  neutral: "bg-fg-meta",
};

export type DashboardActivityEntry = ActivityEntry & {
  projectId: string;
  projectName: string;
};

export function DashboardActivity({ entries }: { entries: DashboardActivityEntry[] }) {
  return (
    <Surface
      as="section"
      level="section"
      padding="lg"
      aria-labelledby="activity-heading"
      className="flex flex-col gap-4"
    >
      <MonoLabel as="h2" id="activity-heading">
        Recent activity
      </MonoLabel>
      {entries.length === 0 ? (
        <p className="text-fg-muted max-w-[62ch] text-sm">
          Vibe writes an entry here every time it does something consequential — analysing a
          repository, running an audit, preparing a change, and every approval and merge. Nothing
          has happened on your projects yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {entries.map((entry) => (
            <li key={entry.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${DOT[entry.tone]}`} />
              <span className="text-fg-body text-sm">{entry.title}</span>
              <Link
                href={`/app/projects/${entry.projectId}/activity`}
                className="text-fg-muted hover:text-fg-body rounded-sm font-mono text-meta transition-interactive"
              >
                {entry.projectName}
              </Link>
              <time
                dateTime={entry.at}
                className="text-fg-meta ml-auto shrink-0 font-mono text-meta"
              >
                {formatTimestamp(entry.at) ?? entry.at}
              </time>
            </li>
          ))}
        </ul>
      )}
    </Surface>
  );
}
