"use client";

import { useEffect, useState } from "react";
import { DiffView } from "@/components/change/diff-view";
import { TextAction } from "@/components/ui/button";
import type { PreparedDiff } from "@/modules/execution/diff";
import {
  REVIEW_CLASSIFICATION_LABELS,
  REVIEW_CLASSIFICATION_NOTES,
  REVIEW_DOWNGRADE_NOTE,
  type ReviewClassificationResult,
} from "@/modules/review/classification";
import { getPreparedDiffAction } from "./prepare-change-action";

/**
 * What changed, on the card a person decides from (Sprint 0055 §2, ADR 0040).
 *
 * ## Why this loads on demand rather than on render
 *
 * Because the diff is two bounded GitHub reads per changed file, and
 * `execution/workspace.ts` is emphatic about what a page load may cost: the
 * lifecycle rows are read once for the whole list precisely so a card does not
 * fan out. Fetching every change's diff server-side would put that fan-out back
 * — for content most cards are not being looked at.
 *
 * So it is fetched when it is wanted. For a `code` change that is immediately,
 * because there the diff *is* the review and a person arriving at the card has
 * nothing else to read. For everything else it is on the click, because the
 * comparison above it is the primary evidence and the diff is the check.
 *
 * ## Why the classification is displayed at all
 *
 * A missing preview panel is a question. Without a sentence saying *this change
 * alters no rendered page*, a founder looking for the before/after they saw
 * last time has to conclude Vibe forgot — and the honest answer, in Vibe's own
 * words rather than a model's, is one line.
 */

const FAILURE_MESSAGES: Record<string, string> = {
  not_found: "This change could not be found.",
  not_prepared: "This change has no commit to compare yet.",
  unavailable: "Vibe could not reach your repository to read this change.",
};

export function ChangeDiffSection({
  projectId,
  preparedChangeId,
  classification,
  filesChanged,
}: {
  projectId: string;
  preparedChangeId: string;
  /** Null when Vibe could not determine it, which reads as the stricter answer. */
  classification: ReviewClassificationResult | null;
  filesChanged: number;
}) {
  const isCodeReview = classification?.classification === "code";

  const [open, setOpen] = useState(isCodeReview);
  const [diff, setDiff] = useState<PreparedDiff | null>(null);
  const [error, setError] = useState<string | null>(null);

  /*
   * Fetched once, when the section is actually showing something.
   *
   * No state is set synchronously in the effect body — the first update happens
   * after the await, and `settled` guards a card that unmounted while the read
   * was in flight. `loading` is derived below rather than tracked, so there is
   * no third state that can disagree with the other two.
   */
  useEffect(() => {
    if (!open || diff !== null || error !== null) return;

    let cancelled = false;

    void (async () => {
      /*
       * Caught rather than allowed to reject. A server action that throws —
       * an expired session, a transport failure — would otherwise surface as
       * an unhandled rejection and leave this section rendering "Reading the
       * change…" forever, which is the one thing it must not do: a person
       * waiting on a diff that will never arrive cannot tell that from a slow
       * repository.
       */
      const result = await getPreparedDiffAction(projectId, preparedChangeId).catch(
        () => ({ ok: false, error: "unavailable" }) as const,
      );
      if (cancelled) return;

      if (result.ok) setDiff(result.diff);
      else setError(FAILURE_MESSAGES[result.error] ?? FAILURE_MESSAGES.unavailable);
    })();

    return () => {
      cancelled = true;
    };
  }, [open, diff, error, projectId, preparedChangeId]);

  const loading = open && diff === null && error === null;

  return (
    <section className="space-y-2 border-t border-line-2 pt-3">
      {/* A direct child of the section, like every other panel's heading. The
          browser suite scopes each panel by exactly that relationship, so a
          heading nested inside a layout wrapper is a panel no test can name. */}
      <h4 className="text-sm font-medium text-fg-body">What changed</h4>

      {classification && (
        <div className="space-y-1">
          <p className="text-sm text-fg-secondary">
            {REVIEW_CLASSIFICATION_LABELS[classification.classification]} ·{" "}
            {REVIEW_CLASSIFICATION_NOTES[classification.classification]}
          </p>
          {classification.routes.length > 0 && (
            <p className="text-xs text-fg-muted">Pages affected: {classification.routes.join(", ")}</p>
          )}
          {/* Why a page file did not earn a screenshot. Without this the reader
              has to guess whether the classifier missed it. */}
          {classification.downgradedPaths.length > 0 && (
            <p className="text-xs text-fg-muted">{REVIEW_DOWNGRADE_NOTE}</p>
          )}
        </div>
      )}

      {!isCodeReview && (
        <TextAction type="button" className="text-xs" onClick={() => setOpen((was) => !was)}>
          {open
            ? "Hide the diff"
            : `Show the diff — ${filesChanged} file${filesChanged === 1 ? "" : "s"}`}
        </TextAction>
      )}

      {loading && <p className="text-sm text-fg-secondary">Reading the change…</p>}
      {open && error && <p className="text-sm text-coral">{error}</p>}
      {open && diff && <DiffView diff={diff} />}
    </section>
  );
}
