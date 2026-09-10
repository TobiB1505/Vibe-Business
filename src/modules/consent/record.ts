import {
  OPTIONAL_CATEGORIES,
  REJECT_ALL,
  type ConsentChoices,
  type OptionalCategory,
} from "./categories";

/**
 * The consent record: what was decided, when, and against which list (UI-23).
 *
 * ## Why a cookie and not `localStorage`
 *
 * Because the server has to know before it renders. A tracker gated on a value
 * only the client can read is a tracker that ships in the HTML and is removed
 * afterwards — by which time it has already run. The root layout reads this
 * cookie and simply does not render what was refused, so a refused tag is
 * absent rather than silenced.
 *
 * ## Why it carries a version
 *
 * Consent is given to a list. When the list changes — a new tracker, a
 * category split — an old record no longer describes what is being asked, and
 * treating it as an answer is answering on somebody's behalf. A record whose
 * version is not `CONSENT_VERSION` is not a decision; the banner asks again.
 *
 * **Raise it whenever `CATEGORY_DESCRIPTIONS` gains something that is loaded.**
 * Rewording a summary is not a reason; adding a recipient is.
 *
 * ## Why the format is this crude
 *
 * `v1.101.1757246400` — version, one digit per optional category in the fixed
 * order of `OPTIONAL_CATEGORIES`, and the second the choice was made. It is
 * parsed by a browser, by the server, and by a person reading their own cookie
 * jar, and it holds no identifier of any kind. JSON in a cookie would be the
 * same three facts with escaping and a base64 step in front of them.
 */

/** The list this record answers. Raise it when the list changes. */
export const CONSENT_VERSION = 1;

/** Readable by client script on purpose: the banner and the settings panel both write it. */
export const CONSENT_COOKIE = "vibe-consent";

/** A year. Long enough not to nag, short enough that consent is periodically re-asked. */
export const CONSENT_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export type ConsentRecord = {
  version: number;
  choices: ConsentChoices;
  /** When the choice was made, in whole seconds. Shown in Settings, never sent anywhere. */
  decidedAt: number;
};

/** Serialise a decision. Deterministic: the same decision produces the same string. */
export function encodeConsent(record: ConsentRecord): string {
  const flags = OPTIONAL_CATEGORIES.map((category) => (record.choices[category] ? "1" : "0")).join(
    "",
  );
  return `v${record.version}.${flags}.${Math.floor(record.decidedAt)}`;
}

/**
 * Read a decision, or `null` for anything that is not one.
 *
 * Strict on purpose. A malformed or truncated value is not a decision and must
 * not resolve to one — least of all to an accepting one — so every failure path
 * ends at `null` and `null` means *ask*. The only value this returns choices
 * for is one this code wrote, at the current version.
 */
export function decodeConsent(value: string | null | undefined): ConsentRecord | null {
  if (!value) return null;

  const match = /^v(\d+)\.([01]+)\.(\d+)$/.exec(value.trim());
  if (!match) return null;

  const version = Number(match[1]);
  const flags = match[2]!;
  const decidedAt = Number(match[3]);

  // A record answering a different list is not an answer to this one.
  if (version !== CONSENT_VERSION) return null;
  if (flags.length !== OPTIONAL_CATEGORIES.length) return null;
  if (!Number.isFinite(decidedAt) || decidedAt <= 0) return null;

  const choices = { ...REJECT_ALL };
  OPTIONAL_CATEGORIES.forEach((category: OptionalCategory, index) => {
    choices[category] = flags[index] === "1";
  });

  return { version, choices, decidedAt };
}

/**
 * What is allowed right now.
 *
 * The absence of a record is a refusal, not a pause. Everything optional is off
 * until somebody says otherwise — which is what "prior consent" means, and the
 * difference between asking and announcing.
 */
export function allowedCategories(value: string | null | undefined): ConsentChoices {
  return decodeConsent(value)?.choices ?? REJECT_ALL;
}

/** Whether the banner still has a question to ask. */
export function needsDecision(value: string | null | undefined): boolean {
  return decodeConsent(value) === null;
}

/**
 * The `document.cookie` string for a decision.
 *
 * `SameSite=Lax` because nothing cross-site needs to read it, and `Secure`
 * everywhere but `http://localhost`, where the attribute would stop the cookie
 * being stored at all and make consent untestable in development.
 */
export function consentCookieString(record: ConsentRecord, secure: boolean): string {
  const parts = [
    `${CONSENT_COOKIE}=${encodeConsent(record)}`,
    "Path=/",
    `Max-Age=${CONSENT_MAX_AGE_SECONDS}`,
    "SameSite=Lax",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}
