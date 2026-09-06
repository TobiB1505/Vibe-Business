import Link from "next/link";
import { ChevronRightIcon } from "@/components/ui/dashboard-icons";
import { StatusPill } from "@/components/ui/status-pill";
import { statusForFocusTier } from "@/components/system/status-vocabulary";
import { MonoLabel } from "@/components/ui/typography";
import type { NovaHomeEntry } from "@/modules/nova/home-view";

/**
 * Everything else that is true (UI Sourcing Spec C2; audit E13).
 *
 * ## Why this exists at all
 *
 * `deriveNovaFocus` is a ranking rather than a cascade precisely so that a
 * second true thing is not silently unreachable: a project can hold a change
 * awaiting review, a stale audit and an open question at the same instant, and
 * "the project is in state 14" is not a sentence that can be true about it.
 * The Focus Card renders the first. This renders the rest, so the ranking's
 * whole point survives contact with the screen.
 *
 * ## Why the rows carry no controls
 *
 * Each row is a link to the thing itself, and nothing more. Giving every row
 * its own button would rebuild the wall of equally weighted choices that Nova
 * exists to replace — and it would put a second and third priced control on a
 * screen whose entire claim is that there is one thing to do next.
 *
 * The tier word is text, not a colour: `blocked` and `needs a decision` read
 * the same to a screen reader as to an eye.
 */
export function AttentionStack({
  entries,
  hrefFor,
}: {
  entries: NovaHomeEntry[];
  /** Where a row goes. Resolved by the page, which owns the route table. */
  hrefFor: (entry: NovaHomeEntry) => string;
}) {
  // No secondary items is not an empty state. It means the Focus Card is the
  // whole truth, which is a good outcome and needs no explaining.
  if (entries.length === 0) return null;

  return (
    <section aria-labelledby="nova-attention" className="flex flex-col gap-3">
      <MonoLabel as="h2" id="nova-attention">
        Also true
      </MonoLabel>

      <ul className="border-line-2 divide-line-1 divide-y overflow-hidden rounded-panel border">
        {entries.map((entry) => {
          const status = statusForFocusTier(entry.tier);
          return (
            <li key={entry.id}>
              <Link
                href={hrefFor(entry)}
                className="hover:bg-surface-hover focus-visible:bg-surface-hover flex items-start gap-3 px-4 py-3.5 transition-interactive sm:items-center"
              >
                <StatusPill tone={status.tone} className="mt-0.5 shrink-0 sm:mt-0">
                  {status.word}
                </StatusPill>
                <span className="text-fg-body min-w-0 flex-1 text-sm">
                  {entry.message}
                  {entry.detail && (
                    <span className="text-fg-muted block truncate text-ui">{entry.detail}</span>
                  )}
                </span>
                <ChevronRightIcon className="text-fg-meta mt-1 size-4 shrink-0 sm:mt-0" />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
