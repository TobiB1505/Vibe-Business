import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import { MonoLabel } from "./typography";

/**
 * A semantic table, for rows a server already paged (P15).
 *
 * ## What it is not
 *
 * Not a data grid. There is no sorting, no filtering, no selection and no
 * per-row menu, because what this product tabulates — today, the changes Vibe
 * has written for a product — is read in the order the server returned it and
 * acted on one row at a time, through a link. shadcn's Table recipe is a thin
 * wrapper over the real elements, which is exactly the amount of component
 * this needs; what is ported is its structure, not a dependency.
 *
 * [2026-09-10] This said "the two things this product tabulates — a Credit
 * ledger and a list of agent runs". Neither is true at HEAD: the ledger draws
 * its own rows, and the run list was replaced by a list of changes.
 *
 * ## The wrapper, and the rule it keeps
 *
 * Wide content scrolls inside its own box. `overflow-x-auto` sits on a
 * container that never imposes a height on the page, so a long table lengthens
 * the document rather than growing a second scroll region inside the shell.
 *
 * `minWidth` is the floor under that, and it is a floor rather than a
 * constant because the right one depends on how many columns a table has. At
 * 36rem a four-column table on a phone puts its second column off-screen —
 * legal, and still the wrong answer when that column is the one carrying the
 * outcome. A caller with fewer columns says so and its table fits.
 *
 * ## The caption is not decoration
 *
 * A table without one announces itself to a screen reader as "table, 4 columns,
 * 12 rows" and nothing else. `caption` is required and visually hidden by
 * default: naming it costs a prop and is the difference between a table
 * somebody can navigate and one they have to reconstruct.
 */
export function Table({
  caption,
  head,
  children,
  footer,
  minWidth = "min-w-[36rem]",
  className,
}: {
  /** Names the table for assistive technology. Rendered, not decorative. */
  caption: string;
  head: readonly string[];
  children: ReactNode;
  /** A totals row, when the table has a total worth stating. */
  footer?: ReactNode;
  /**
   * The width below which the table scrolls sideways instead of compressing.
   *
   * A Tailwind class, so the value is in the same vocabulary as the rest of
   * the layout. Default suits four or more columns; a two-column table should
   * name a narrower one so a phone can read both of them at once.
   */
  minWidth?: string;
  className?: string;
}) {
  return (
    <div className={cn("w-full overflow-x-auto", className)}>
      <table className={cn("w-full border-collapse text-left", minWidth)}>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-line-2 border-b">
            {head.map((label) => (
              <th key={label} scope="col" className="py-2.5 pr-4 last:pr-0 align-bottom">
                <MonoLabel>{label}</MonoLabel>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-line-2 divide-y">{children}</tbody>
        {footer && <tfoot className="border-line-2 border-t">{footer}</tfoot>}
      </table>
    </div>
  );
}

/** One row. `href` makes the first cell the link, never the whole row. */
export function TableRow({ children }: { children: ReactNode }) {
  return <tr>{children}</tr>;
}

export function TableCell({
  children,
  numeric = false,
  className,
}: {
  children: ReactNode;
  /** Right-aligned and tabular, for an amount or a count. */
  numeric?: boolean;
  className?: string;
}) {
  return (
    <td
      className={cn(
        "text-fg-body py-2.5 pr-4 text-sm last:pr-0",
        numeric && "text-right tabular-nums",
        className,
      )}
    >
      {children}
    </td>
  );
}
