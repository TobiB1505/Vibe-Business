/**
 * What a name is allowed to be, without touching a database.
 *
 * Split from `founder-profile.ts` because the form needs the length limit and
 * the store is `server-only` — importing one to get the other pulled the whole
 * server module into the client bundle and failed the build. The split is the
 * better shape regardless: this half is a pure rule about text, testable with
 * no client and no fixture, and the half next door is the I/O.
 *
 * ## Why a name is reduced at all
 *
 * It travels into a model prompt. Two different things follow, and only one of
 * them lives here: the **application** fences the value as data in a user
 * message and never as an instruction (rule 42), and the **value itself** is
 * reduced to one plain line — no control characters, no line breaks, no runs
 * of whitespace — with a database CHECK behind it as the backstop. This
 * function is the front door; the constraint holds for whatever writes the
 * table next.
 */

/** The longest a name may be, matching `founder_profiles_display_name_check`. */
export const MAX_FOUNDER_NAME_LENGTH = 60;

/**
 * One plain line, or null when nothing usable was typed.
 *
 * Null is the answer for an empty box **and** for a box containing only
 * whitespace or control characters, because both mean the same thing: the
 * founder gave no name. The caller turns that into a deletion rather than
 * storing an empty string, so "no name" has exactly one representation.
 *
 * The name is **not** otherwise cleaned up. Capitalisation, punctuation and
 * non-Latin scripts are left exactly as typed — this decides what is safe to
 * store, not what a name is allowed to look like.
 */
export function normalizeFounderName(input: string | null | undefined): string | null {
  if (typeof input !== "string") return null;

  const oneLine = input
    /* Every control character, not just the three the CHECK names. */
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (oneLine.length === 0) return null;
  return oneLine.slice(0, MAX_FOUNDER_NAME_LENGTH).trim();
}
