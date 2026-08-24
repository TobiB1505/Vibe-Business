import Link from "next/link";
import { STATUS_GLYPHS, statusToneText } from "@/components/ui/status-pill";
import { Surface } from "@/components/ui/surface";
import { MonoLabel } from "@/components/ui/typography";

/**
 * Connected understanding — what Vibe learns from (CORE-5, Stage D).
 *
 * ## Why this block exists
 *
 * Overview carried a `<dl>` called "Project context" whose rows read
 * "Repository intelligence — Ready", "Live product intelligence — Not
 * inspected yet". Every word of that is Vibe's own vocabulary for its own
 * subsystems, and the screen it sat on was the first thing a founder saw.
 *
 * The facts are worth keeping — a founder genuinely should know which of the
 * four sources Vibe has and which it does not, because it is the difference
 * between a confident audit and a thin one. What changes is that each row is
 * named for the thing in the founder's world rather than the module in ours,
 * and each one leads somewhere.
 *
 * ## Why every row leads somewhere
 *
 * Two of these are the only route to a page that is deliberately not in the
 * navigation: Deep Scan is a child of My Product, and what a founder told Vibe
 * now lives in Settings. A row that reported "Not run yet" and offered no way
 * to run it would be the dead end this codebase keeps finding and closing.
 *
 * ## Four states, not a boolean (Stage D)
 *
 * A client-rendered site was genuinely visited and largely unread — that is
 * neither "ready" nor "not yet", and flattening it into either would have the
 * row disagree with the summary below it. Likewise a scan that failed is a
 * fact worth stating, not the same silence as never having run.
 *
 * ## Absence is not a deficiency
 *
 * "Not run yet" is a statement about Vibe, never about the product (CORE-1
 * §17, §42). A `failed` row reports what happened to Vibe's read — the one
 * state that may warrant amber — and no row implies the founder has failed to
 * do something.
 */

export type SourceState =
  /** Read, and the read is the whole picture. */
  | "ready"
  /** Read, and honestly not the whole picture — the note says why. */
  | "partial"
  /** The last attempt did not produce a result, and none exists from before. */
  | "failed"
  /** Never read. A fact about Vibe, not a demand. */
  | "none";

export type UnderstandingSource = {
  id: string;
  /** What it is, in the founder's words. Never a module name. */
  label: string;
  state: SourceState;
  /** One line on where this source stands, chosen by the page per state. */
  detail: string;
  /**
   * A longer honest caveat under the row — e.g. why a visit was only partial,
   * in the same words the full summary uses. Rare, and never decorative.
   */
  note?: string | null;
  /** Where to go to change that. Every row has one. */
  href: string;
  action: string;
};

const STATE_GLYPHS: Record<SourceState, { glyph: string; className: string }> = {
  ready: { glyph: STATUS_GLYPHS.confirmed, className: statusToneText("success") },
  partial: { glyph: STATUS_GLYPHS.unknown, className: statusToneText("waiting") },
  failed: { glyph: STATUS_GLYPHS.refused, className: statusToneText("problem") },
  none: { glyph: STATUS_GLYPHS.pending, className: "text-fg-faint" },
};

export function ProductOverview({ sources }: { sources: UnderstandingSource[] }) {
  // A partially read source is still a source Vibe is working from.
  const readyCount = sources.filter(
    (source) => source.state === "ready" || source.state === "partial",
  ).length;

  return (
    <Surface level="panel" padding="lg" className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <MonoLabel as="h3">What Vibe learns from</MonoLabel>
        <p className="text-fg-muted max-w-[62ch] text-sm">
          {/*
            A count, not a score. It says how much Vibe has to reason with; it
            does not grade the product, and four of four is not "good".
          */}
          Vibe is working from {readyCount} of {sources.length} sources. The more of these it can
          reach, the less of your business it has to guess at.
        </p>
      </div>

      <ul className="flex flex-col gap-3">
        {sources.map((source) => (
          <li
            key={source.id}
            className="border-line-1 flex flex-col gap-1.5 border-b pb-3 last:border-b-0 last:pb-0"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1.5">
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="flex items-baseline gap-2">
                  {/*
                    Decorative: the words beside it carry the same state, so
                    nothing here depends on a glyph or a colour being seen.
                  */}
                  <span aria-hidden className={STATE_GLYPHS[source.state].className}>
                    {STATE_GLYPHS[source.state].glyph}
                  </span>
                  <span className="text-fg-body text-sm font-medium">{source.label}</span>
                </span>
                <span className="text-fg-muted text-ui">{source.detail}</span>
              </span>
              <Link
                href={source.href}
                className="text-fg-muted hover:text-fg-body shrink-0 rounded-sm text-xs underline underline-offset-4 transition-interactive"
              >
                {source.action}
              </Link>
            </div>
            {source.note && (
              <p className="text-fg-muted max-w-[70ch] pl-6 text-xs leading-relaxed">
                {source.note}
              </p>
            )}
          </li>
        ))}
      </ul>
    </Surface>
  );
}
