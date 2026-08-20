import type { ActivityEntry, ActivityTone } from "@/modules/audit-log/view";
import { EmptyState } from "@/components/ui/states";
import { Surface } from "@/components/ui/surface";
import { MonoLabel } from "@/components/ui/typography";
import { formatTimestamp } from "@/lib/utils/format-datetime";

/**
 * The Activity feed (Sprint UI-2 Phase A).
 *
 * Replaces UI-1's "not available yet" state, which was honest at the time:
 * `audit_events` had no read path, and a feed assembled in the browser from
 * what happened to be on screen would have been fiction.
 *
 * Everything rendered here comes from a row the system wrote at the moment it
 * acted. Nothing is derived, inferred or back-filled — an empty feed means
 * nothing has been recorded against this project, and says so.
 */

const DOT_CLASSES: Record<ActivityTone, string> = {
  success: "bg-mint",
  waiting: "bg-amber",
  problem: "bg-coral",
  neutral: "bg-fg-meta",
};

function ActivityRow({ entry }: { entry: ActivityEntry }) {
  return (
    <li className="border-line-1 flex gap-4 border-b py-4 last:border-b-0 last:pb-0">
      {/* Decorative: the row's title and its facts already carry the meaning,
          so state is never signalled by colour alone. */}
      <span
        aria-hidden
        className={`mt-1.5 size-2 shrink-0 rounded-full ${DOT_CLASSES[entry.tone]}`}
      />

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <span className="text-fg-body text-sm">{entry.title}</span>
          <time
            dateTime={entry.at}
            className="text-fg-meta shrink-0 font-mono text-meta"
          >
            {formatTimestamp(entry.at) ?? entry.at}
          </time>
        </div>

        {entry.facts.length > 0 && (
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {entry.facts.map((fact) => (
              <span key={fact.label} className="text-fg-muted font-mono text-meta">
                <span className="text-fg-meta">{fact.label} </span>
                {fact.value}
              </span>
            ))}
          </div>
        )}
      </div>
    </li>
  );
}

export function ActivityFeed({
  entries,
  hasMore,
}: {
  entries: ActivityEntry[];
  /** True when the project has more history than this page shows. */
  hasMore: boolean;
}) {
  if (entries.length === 0) {
    return (
      <EmptyState
        title="Nothing recorded yet"
        description="Vibe writes an entry here every time it does something consequential — analysing a repository, running an audit, preparing a change, and every approval and merge. Nothing has been recorded against this project so far."
      />
    );
  }

  return (
    <Surface level="panel" padding="lg" className="flex flex-col gap-3">
      <MonoLabel>Most recent first</MonoLabel>
      <ul className="flex flex-col">
        {entries.map((entry) => (
          <ActivityRow key={entry.id} entry={entry} />
        ))}
      </ul>
      {hasMore && (
        // Stated rather than paginated: a "show more" control needs a second
        // read and a place to keep the offset, and this sprint's read path is
        // deliberately page-shaped. Saying the history is longer is honest;
        // implying this is all of it would not be.
        <p className="text-fg-muted text-xs">
          Older entries exist beyond the {entries.length} shown here.
        </p>
      )}
    </Surface>
  );
}
