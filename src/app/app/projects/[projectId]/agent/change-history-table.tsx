import Link from "next/link";
import { StatusPill } from "@/components/ui/status-pill";
import { Table, TableCell, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/states";
import { formatTimestamp } from "@/lib/utils/format-datetime";
import type { ChangeHistoryEntry } from "@/modules/execution/change-history";
import {
  CHANGE_HISTORY_LABELS,
  CHANGE_HISTORY_TONES,
} from "@/modules/execution/change-history-view";

/**
 * Every change this product has had (audit R29).
 *
 * ## Why the row is a change and not a run
 *
 * This was a list of runs. A founder who had run the agent eleven times saw
 * eleven rows headed by a timestamp, each saying `Finished` — which is a fact
 * about Vibe's machinery and not about their product. Two of those runs may
 * have been attempts at the same Move; one may have produced nothing; the one
 * that actually changed the product looked exactly like the others.
 *
 * The question the screen exists to answer is *what has Vibe done to my
 * product*, and the unit of that answer is a change: it either reached the
 * default branch or it did not. So the row leads with what the change was
 * for, and `changeHistoryOutcome` says what became of it.
 *
 * ## What a row says, and what it does not
 *
 * What it was for, what became of it, when, and how many files. Not what it
 * cost: the reservation is one read per run, and putting that behind a list
 * turns a scan into a fan-out. The cost is on the change's own screen, where
 * the founder is looking at one.
 *
 * A change whose Move is gone from the latest opportunity set still gets a
 * row, named by its branch. A prepared change is an artifact — a commit
 * sitting in the customer's repository — and it does not stop existing because
 * the advice that motivated it was regenerated.
 */
export function ChangeHistoryTable({
  entries,
  /**
   * The Move titles, by opportunity id.
   *
   * Handed in rather than read: the workspace above already holds the
   * opportunity set to render its task panel, so a second read here would be
   * the same strings fetched twice for one screen.
   */
  moveTitles,
  changeHref,
}: {
  entries: readonly ChangeHistoryEntry[];
  moveTitles: ReadonlyMap<string, string>;
  changeHref: (preparedChangeId: string) => string;
}) {
  if (entries.length === 0) {
    return (
      <EmptyState
        title="No changes yet"
        description="When Vibe writes a change to this product, it stays listed here — merged, discarded or waiting."
      />
    );
  }

  return (
    <Table
      caption="Changes Vibe has written for this product"
      head={["Change", "Outcome"]}
      /*
       * Two columns, and a floor a phone can hold both of.
       *
       * It was four — change, outcome, when, files — which at 36rem put the
       * outcome off the right edge of a 430px screen. Legal, because a table
       * may scroll inside its own box, and still the wrong answer: a founder
       * could read what each change was for or what became of it, never both,
       * and scrolling back lost the titles. So the two facts that have to sit
       * together are the two columns, and the rest moved under the title.
       */
      minWidth="min-w-[20rem]"
    >
      {entries.map((entry) => {
        const title =
          (entry.opportunityId ? moveTitles.get(entry.opportunityId) : undefined) ??
          entry.branchName;

        return (
          <TableRow key={entry.preparedChangeId}>
            <TableCell>
              <div className="flex min-w-0 flex-col gap-1">
                {/*
                  The change itself, not the Move. A row leads back to the
                  thing it is about — the Move is reachable from there, and a
                  founder scanning this list is looking for a change they
                  remember.
                */}
                <Link
                  href={changeHref(entry.preparedChangeId)}
                  className="text-fg-body hover:text-fg rounded-sm underline underline-offset-4 transition-interactive"
                >
                  {title}
                </Link>

                {/*
                  When, and how much. Under the title rather than in columns of
                  their own: both are things a founder reads once they have
                  found the row, and giving them the width to sit beside the
                  outcome is what pushed the outcome off a phone.
                */}
                <p className="text-fg-meta text-xs">
                  {[
                    formatTimestamp(entry.createdAt),
                    /* A preparation that wrote nothing wrote nothing — no
                       count, rather than a zero standing in for one. */
                    entry.filesChanged === 0
                      ? "no files"
                      : `${entry.filesChanged} file${entry.filesChanged === 1 ? "" : "s"}`,
                  ]
                    .filter((part): part is string => part !== null)
                    .join(" · ")}
                </p>
              </div>
            </TableCell>
            <TableCell>
              <StatusPill tone={CHANGE_HISTORY_TONES[entry.outcome]}>
                {CHANGE_HISTORY_LABELS[entry.outcome]}
              </StatusPill>
            </TableCell>
          </TableRow>
        );
      })}
    </Table>
  );
}
