import Link from "next/link";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { Table, TableCell, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/states";
import { formatTimestamp } from "@/lib/utils/format-datetime";
import type { AgentRunSummary } from "@/modules/coding-agent/observability/run-view";

/**
 * Every run this product has had (audit R29).
 *
 * ## Why it exists
 *
 * The workspace shows the newest run. A project that has run the agent eleven
 * times had ten it could no longer reach — including the ones whose changes
 * were merged, which is the half a founder is most likely to want back. There
 * was no query for them and no screen that listed them.
 *
 * ## What a row says, and what it does not
 *
 * When it ran, how it ended, and how many files Vibe verified it changed. Not
 * what it cost: the reservation is one read per run, and putting that behind a
 * list turns a scan into a fan-out. The cost is on the run itself, where the
 * founder is looking at one.
 *
 * A run with no change produced none — that is a real outcome, not a missing
 * value — so the count is a dash rather than a zero, and only a run that
 * produced a change offers a link.
 */

const STATUS_TONE: Record<string, StatusTone> = {
  completed: "success",
  succeeded: "success",
  failed: "problem",
  cancelled: "neutral",
  running: "active",
  needs_user: "waiting",
};

const STATUS_WORD: Record<string, string> = {
  completed: "Finished",
  succeeded: "Finished",
  failed: "Failed",
  cancelled: "Stopped",
  running: "Running",
  needs_user: "Waiting for you",
};

export function AgentRunHistory({
  runs,
  changeHref,
}: {
  runs: readonly AgentRunSummary[];
  /** Where a run's change lives. Only called for a run that produced one. */
  changeHref: (preparedChangeId: string) => string;
}) {
  if (runs.length === 0) {
    return (
      <EmptyState
        title="No runs yet"
        description="When Vibe runs the agent on this product, every run stays listed here."
      />
    );
  }

  return (
    <Table caption="Agent runs for this product" head={["Run", "Outcome", "Files changed"]}>
      {runs.map((run) => {
        const when = formatTimestamp(run.startedAt ?? run.completedAt);

        return (
          <TableRow key={run.id}>
            <TableCell>
              {run.preparedChangeId ? (
                <Link
                  href={changeHref(run.preparedChangeId)}
                  className="text-fg-body hover:text-fg rounded-sm underline underline-offset-4 transition-interactive"
                >
                  {when ?? "Not started"}
                </Link>
              ) : (
                (when ?? "Not started")
              )}
            </TableCell>
            <TableCell>
              <StatusPill tone={STATUS_TONE[run.status] ?? "neutral"}>
                {STATUS_WORD[run.status] ?? run.status}
              </StatusPill>
            </TableCell>
            <TableCell numeric>
              {/* A run that changed nothing changed nothing. Not a zero. */}
              {run.changedFileCount === null ? "—" : run.changedFileCount}
            </TableCell>
          </TableRow>
        );
      })}
    </Table>
  );
}
