/**
 * This product's password rule, in one number (UI-18).
 *
 * ## Why it is not in `actions.ts`
 *
 * It was, and it could not leave: `actions.ts` is a `"use server"` module, so
 * every export has to be an async function. The three password inputs
 * therefore could not read the number the server refuses on, and they carried
 * `minLength={6}` — while the server refused anything under 8.
 *
 * That is not a cosmetic mismatch. The browser accepted a seven-character
 * password, submitted it, and the screen came back with an error the field it
 * had just approved was now blamed for. And the hint above it said "at least
 * 8", so the interface stated the rule correctly, checked it incorrectly, and
 * enforced it correctly, in that order, on one screen.
 *
 * `actions.ts` explains at its own call site why the rule is refused in this
 * repository rather than left to the provider's dashboard setting: so that a
 * reader of this code can determine what the rule is. That argument only works
 * if there is one place to read it.
 */
export const MINIMUM_PASSWORD_LENGTH = 8;

/** The refusal, worded once, so the server and the hint cannot disagree. */
export function passwordTooShortMessage(): string {
  return `Choose a password with at least ${MINIMUM_PASSWORD_LENGTH} characters.`;
}

/** The hint above the field, from the same number. */
export const PASSWORD_HINT = `At least ${MINIMUM_PASSWORD_LENGTH} characters`;
