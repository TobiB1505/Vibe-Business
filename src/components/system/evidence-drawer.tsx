"use client";

import { useId, useState } from "react";
import { ChevronDownIcon, DismissIcon } from "@/components/ui/icons.generated";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { RatingChip } from "@/components/ui/status-pill";
import { MonoLabel } from "@/components/ui/typography";
import { ConfidenceIndicator, type ConfidenceViewModel } from "./confidence";

/**
 * Why Vibe believes something (UI Sourcing Spec §14, S4/S5; audit E2).
 *
 * ## The problem this closes
 *
 * Every lens reading, conclusion, Move and profile field in this product
 * carries evidence ids, and `describeEvidenceId` has always been able to turn
 * one into a founder sentence with its source. The audit found that resolver
 * feeding the model and two components, one of which is asserted absent by
 * test — so the founder saw conclusions and never the grounds for them.
 *
 * ## The rules this component is built to keep
 *
 * **No raw ids.** A citation reaches here already resolved to `{ detail,
 * source, certainty }`. The id itself is never rendered, which is why the prop
 * is `EvidenceCitation[]` and not `string[]` — a component that took ids would
 * have to resolve them, and a client component cannot reach the resolver.
 *
 * **Nothing unverifiable.** Citations that did not survive validation are
 * dropped by the caller before they get here, and `withheldCount` says how
 * many rather than showing them. Rendering a citation the product cannot stand
 * behind is exactly what rule 45 forbids.
 *
 * **Read-only.** A drawer explains; it never acts. Nothing in here spends
 * Credits, writes anything or changes the URL, which is what makes it safe to
 * open over any surface.
 *
 * ## Why the trigger lives here too
 *
 * `CitationCount` is the only way in. Keeping the button beside the panel it
 * opens is what makes "3 sources" and the drawer's own heading provably the
 * same claim — and it keeps the client boundary to one component, so a page
 * full of findings does not become a page full of client components.
 */

export type EvidenceCitation = {
  /** The founder sentence from `describeEvidenceId`. Never the id. */
  detail: string;
  /** Where it came from, in the founder's words: "Your live site". */
  source: string;
  /**
   * `curated` — resolved through a table written for a founder.
   * `derived` — the id made readable, correct only for a citation the product
   * no longer produces. Shown so a thin explanation is visibly thin.
   */
  certainty?: "curated" | "derived";
};

export function EvidenceDrawer({
  open,
  onClose,
  /** What is being explained: "Why this is the first thing to fix". */
  title,
  /** The conclusion itself, restated so the drawer stands alone. */
  conclusion,
  confidence,
  citations,
  withheldCount = 0,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  conclusion?: string | null;
  confidence?: ConfidenceViewModel | null;
  citations: EvidenceCitation[];
  withheldCount?: number;
}) {
  const titleId = useId();

  return (
    <Sheet open={open} onClose={onClose} side="right" labelledBy={titleId}>
      <header className="border-line-2 flex flex-col gap-3 border-b p-6">
        <div className="flex items-start justify-between gap-4">
          <MonoLabel>Evidence</MonoLabel>
          {/*
            A mark in a container rather than an underlined word. The word was
            the least conventional answer available in a drawer header, and it
            only ever read as a control because of a line under it — which on a
            phone, where there is no hover to explain it, is all a founder gets.
          */}
          <Button
            variant="ghost"
            icon={<DismissIcon size={16} />}
            label="Close"
            onClick={onClose}
            className="-me-1"
          />
        </div>
        <h2 id={titleId} className="text-fg text-title font-bold">
          {title}
        </h2>
        {conclusion && <p className="text-fg-prose max-w-[62ch] text-body">{conclusion}</p>}
        {confidence && <ConfidenceIndicator model={confidence} className="self-start" />}
      </header>

      <div className="flex flex-col gap-4 p-6">
        {citations.length === 0 ? (
          /*
           * An empty drawer is still a drawer. "No evidence survived
           * validation" is a real answer and a different one from "Vibe has no
           * opinion" — closing the drawer on an empty list would leave a
           * citation count the founder could press and learn nothing from.
           */
          <p className="text-fg-muted text-body">
            No evidence survived validation for this. Nothing here rests on it.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {citations.map((citation, index) => (
              <li
                key={`${citation.source}:${citation.detail}:${index}`}
                className="border-line-2 bg-well rounded-well flex flex-col gap-2 border p-4"
              >
                <p className="text-fg-body text-body leading-relaxed">{citation.detail}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <MonoLabel>{citation.source}</MonoLabel>
                  {citation.certainty === "derived" && (
                    <RatingChip className="text-meta">Unlabelled source</RatingChip>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {withheldCount > 0 && (
          <p className="text-fg-muted text-ui">
            {withheldCount === 1
              ? "1 citation could not be verified and is not shown."
              : `${withheldCount} citations could not be verified and are not shown.`}
          </p>
        )}
      </div>
    </Sheet>
  );
}

/**
 * The control that opens the drawer, and the drawer's only entry point.
 *
 * The count is in the button's text rather than in an icon or a superscript,
 * so it reads the same to a screen reader as to an eye. `aria-haspopup` and
 * `aria-expanded` say what pressing it will do before it is pressed.
 */
export function CitationCount({
  citations,
  title,
  conclusion,
  confidence,
  withheldCount = 0,
  className,
}: {
  citations: EvidenceCitation[];
  title: string;
  conclusion?: string | null;
  confidence?: ConfidenceViewModel | null;
  withheldCount?: number;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const total = citations.length;

  // No citations and nothing withheld means there is nothing to open. A
  // trigger that led to an empty drawer would be a control that wastes a click.
  if (total === 0 && withheldCount === 0) return null;

  return (
    <>
      {/*
        A container at rest rather than an underline. This is the disclosure
        role: nothing around it says what it opens, so the word stays inside
        the control and the chevron says the direction.
      */}
      <Button
        variant="ghost"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        icon={<ChevronDownIcon size={14} />}
        className={className}
      >
        {total === 1 ? "1 source" : `${total} sources`}
      </Button>
      <EvidenceDrawer
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        conclusion={conclusion}
        confidence={confidence}
        citations={citations}
        withheldCount={withheldCount}
      />
    </>
  );
}
