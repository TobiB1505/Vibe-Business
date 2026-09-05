import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import { MonoLabel } from "./typography";

/**
 * A semantic table, for rows a server already paged (P15).
 *
 * ## What it is not
 *
 * Not a data grid. There is no sorting, no filtering, no selection and no
 * per-row menu, because the two things this product tabulates — a Credit
 * ledger and a list of agent runs — are read in the order the server returned
 * them and acted on one at a time, through a link. shadcn's Table recipe is a
 * thin wrapper over the real elements, which is exactly the amount of
 * component this needs; what is ported is its structure, not a dependency.
 *
 * ## The wrapper, and the rule it keeps
 *
 * Wide content scrolls inside its own box. `overflow-x-auto` sits on a
 * container that never imposes a height on the page, so a long table lengthens
 * the document rather than growing a second scroll region inside the shell.
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
  className,
}: {
  /** Names the table for assistive technology. Rendered, not decorative. */
  caption: string;
  head: readonly string[];
  children: ReactNode;
  /** A totals row, when the table has a total worth stating. */
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("w-full overflow-x-auto", className)}>
      <table className="w-full min-w-[36rem] border-collapse text-left">
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
