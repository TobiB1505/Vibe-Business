/**
 * The footnote under the Focus Card's control, or nothing (audit finding 3).
 *
 * ## The collision this resolves
 *
 * Nova's prompt table and its action catalog are written separately, and for
 * three of the four prompts that is invisible — *Move it onto your default
 * branch?* sits above **Merge it** and each says something the other does not.
 * On `audit_outdated` they converge: the prompt is *Run the audit again?* and
 * the label is **Run the audit again**, so the card printed one sentence twice,
 * a question mark apart, one directly beneath the other.
 *
 * Neither table is wrong on its own, which is why the fix is not in either of
 * them — the feed renders the same prompt in a position where it reads as a
 * question, and Home's footnote sits *below* the control where it can only
 * read as an echo. `working-strip.tsx` hit the identical shape ("Waiting for
 * you · Waiting for you") between two equally correct tables and resolved it
 * the same way: the duplicate yields at the call site.
 *
 * ## Why the comparison is this narrow
 *
 * Trailing punctuation and case are the only differences the two tables
 * actually produce. A looser rule — prefix matching, word overlap — would
 * start swallowing footnotes that genuinely add something, and a footnote
 * silently missing is worse than one that repeats: nobody would ever see the
 * absence to report it.
 */

function normalise(value: string): string {
  return value
    .trim()
    .replace(/[?.!]+$/, "")
    .toLowerCase();
}

export function footnoteFor(
  prompt: string | null,
  controlLabel: string | undefined,
): string | null {
  if (prompt === null) return null;
  if (controlLabel === undefined) return prompt;
  return normalise(prompt) === normalise(controlLabel) ? null : prompt;
}
