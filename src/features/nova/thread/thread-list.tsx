import Link from "next/link";
import { StatusPill } from "@/components/ui/status-pill";
import { EmptyState } from "@/components/ui/states";
import { MonoLabel } from "@/components/ui/typography";
import { formatTimestamp } from "@/lib/utils/format-datetime";
import { threadPath } from "@/lib/routing/project-urls";
import { cn } from "@/lib/utils/cn";
import type { ThreadListEntry } from "./queries";
import { NewThreadButton } from "./new-thread-button";

/**
 * Every conversation this product has had.
 *
 * ## Why this is a list and not a second navigation
 *
 * [ADR 0109](../../../../docs/decisions/0109-nova-first-application-shell.md)
 * §4: *the workspace is not a second navigation*, and the same restraint
 * applies here. A thread is not a document to file, tag, search or organise —
 * it is where a founder and Nova were talking. So the list says what each one
 * is called, when it was last touched, and which one is current, and it stops
 * there. Anything more would be the knowledge-management product this is not.
 *
 * ## Why "current" and not "open"
 *
 * Because *open* is a status a founder can set and *current* is a fact about
 * where the next run event will land — the most recently created open thread.
 * They are usually the same thread and the difference matters exactly when a
 * founder has started a second conversation: the first one is still open and is
 * no longer where anything arrives.
 */
export function ThreadList({
  projectId,
  entries,
}: {
  projectId: string;
  entries: readonly ThreadListEntry[];
}) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <MonoLabel className="tracking-[0.18em]">
          {entries.length === 1 ? "1 conversation" : `${entries.length} conversations`}
        </MonoLabel>
        <NewThreadButton projectId={projectId} />
      </div>

      {entries.length === 0 ? (
        <EmptyState
          title="Nothing written down yet"
          description="This is where what happens to your product gets written down. Ask Nova something, or start something from your product's home, and it will show up here."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {entries.map(({ thread, current }) => (
            <li key={thread.id}>
              <Link
                href={threadPath(projectId, thread.id)}
                aria-current={current ? "true" : undefined}
                className={cn(
                  "rounded-panel border-line-1 bg-surface-1 flex flex-col gap-1.5 border px-4 py-3.5",
                  "transition-interactive hover:border-mint-line",
                  "focus-visible:ring-mint focus-visible:ring-2 focus-visible:outline-none",
                  current && "border-mint-line bg-mint-tint",
                )}
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <span className="text-fg-body min-w-0 truncate text-body font-medium">
                    {thread.title}
                  </span>
                  {current && <StatusPill tone="active">Current</StatusPill>}
                  {thread.status === "archived" && <StatusPill tone="neutral">Archived</StatusPill>}
                </div>
                {/*
                  When it was last touched, or that it has not been. A thread
                  with no messages says so rather than borrowing its own
                  creation time — those are different facts, and the second one
                  reads as a conversation that happened.
                */}
                <span className="text-fg-meta font-mono text-caption">
                  {thread.lastMessageAt === null
                    ? "Nothing said yet"
                    : (formatTimestamp(thread.lastMessageAt) ?? "Nothing said yet")}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
