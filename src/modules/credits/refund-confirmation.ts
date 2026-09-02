/**
 * Reading the operator's confirmation for a refund (VB-038).
 *
 * ## Why this is three answers and not a boolean
 *
 * The refund path defaults to writing nothing: without confirmation it reads
 * the charge, prints what it would post, and stops. That is the right default —
 * the input is a UUID typed by a person at the moment they are annoyed about a
 * support ticket, and the operation moves money.
 *
 * A boolean collapses two very different situations into "no". Somebody who set
 * nothing wants the dry run. Somebody who typed `VIBE_REFUND_CONFIRM=true`
 * wanted the refund, and under a boolean they get a dry run that looks exactly
 * like success: output appears, the command exits, and the customer is still
 * waiting for their Credits. Failing safe is correct; failing safe *silently*
 * is how a person stops trusting a tool that was working.
 *
 * So a value that is present but not the word is its own answer, and the caller
 * refuses loudly rather than proceeding as though nothing was asked.
 *
 * ## Why `yes` and not a list of affirmatives
 *
 * Accepting `true`, `1`, `y` and `on` would remove the misspelled case by
 * widening what confirms a money movement, which is the wrong direction for a
 * switch whose whole job is to be deliberate. One word, and anything else is
 * told it is not that word.
 */

export const REFUND_CONFIRMATION_WORD = "yes";

export type RefundConfirmation =
  /** Nothing was set. The caller reads, prints, and writes nothing. */
  | { kind: "dry_run" }
  /** Exactly the word. The caller posts the refund. */
  | { kind: "confirmed" }
  /**
   * Something was set, and it was not the word.
   *
   * Carries what was typed so the message can name it — an operator who reads
   * "expected yes" and cannot see what they wrote will try the same thing again.
   */
  | { kind: "not_the_word"; given: string };

export function readRefundConfirmation(raw: string | undefined): RefundConfirmation {
  const given = (raw ?? "").trim();

  if (given.length === 0) return { kind: "dry_run" };
  if (given === REFUND_CONFIRMATION_WORD) return { kind: "confirmed" };
  return { kind: "not_the_word", given };
}

/** What an operator is told when they wrote something other than the word. */
export function refundConfirmationRefusal(given: string): string {
  return (
    `VIBE_REFUND_CONFIRM is set to "${given}", and the only value that confirms a refund is ` +
    `"${REFUND_CONFIRMATION_WORD}". Nothing was posted. Re-run with ` +
    `VIBE_REFUND_CONFIRM=${REFUND_CONFIRMATION_WORD} once the dry run above looks right.`
  );
}
