"use client";

import { useCallback, useEffect, useState } from "react";
import { ACCEPT_ALL, REJECT_ALL, type ConsentChoices } from "@/modules/consent/categories";
import {
  CONSENT_COOKIE,
  CONSENT_VERSION,
  allowedCategories,
  consentCookieString,
  decodeConsent,
  encodeConsent,
  needsDecision,
  type ConsentRecord,
} from "@/modules/consent/record";

/**
 * The decision, in the browser (UI-23).
 *
 * ## Why the gate is here rather than in the root layout
 *
 * Reading `cookies()` in the root layout would work and would cost the whole
 * site its static rendering: `/`, `/privacy` and `/terms` are prerendered
 * today, and one `cookies()` call anywhere above them makes every page
 * dynamic. A landing page that stops being static in order to decide whether
 * to load an analytics tag has paid for consent with the thing the analytics
 * were measuring.
 *
 * So the tags are gated client-side, which is what every consent platform
 * does and what "prior consent" actually requires: the script element is
 * **created** only after the decision is read. Nothing is loaded and then
 * stopped — before the first render there is no tag in the document at all.
 *
 * ## Why `undefined` is not `false`
 *
 * The first client render has not read the cookie yet, and treating that
 * instant as a refusal is harmless while treating it as consent is not. The
 * state is `undefined` until read, every consumer waits for a real value, and
 * the banner does not flash on a visitor who decided months ago.
 */
export type ConsentState = {
  /** `undefined` until the cookie has been read. */
  record: ConsentRecord | null | undefined;
  /** What is allowed right now. Nothing optional, until a decision says otherwise. */
  choices: ConsentChoices;
  /** Whether the banner still has a question to ask. */
  undecided: boolean;
  save: (choices: ConsentChoices) => void;
};

/** The raw cookie value, or null. The module functions do every reading of it. */
function readCookieValue(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.split("; ").find((entry) => entry.startsWith(`${CONSENT_COOKIE}=`));
  return match ? match.slice(CONSENT_COOKIE.length + 1) : null;
}

/** The event every consumer listens to, so one decision updates every panel at once. */
const CONSENT_EVENT = "vibe:consent";

export function useConsent(): ConsentState {
  /*
    The raw value, not a parsed record.

    `allowedCategories` and `needsDecision` are the two functions the unit
    suite proves — that an unreadable, forged or stale value allows nothing and
    asks again — and the first version of this hook reimplemented both inline.
    A mutation found it: breaking `allowedCategories` failed three unit tests
    and not one browser test, because nothing in the product called it. They
    are called here now, so the tests guard the running path rather than a
    parallel copy of it.
  */
  const [value, setValue] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    const read = () => setValue(readCookieValue());
    read();
    /*
      The banner and the settings panel are two components writing one cookie.
      Without this, saving in one leaves the other showing the old state until
      a navigation — which on the settings page means the toggles disagree with
      the banner that just closed.
    */
    window.addEventListener(CONSENT_EVENT, read);
    return () => window.removeEventListener(CONSENT_EVENT, read);
  }, []);

  const save = useCallback((choices: ConsentChoices) => {
    const next: ConsentRecord = {
      version: CONSENT_VERSION,
      choices,
      decidedAt: Math.floor(Date.now() / 1000),
    };
    // `Secure` would stop the browser storing this on http://localhost, which
    // is where consent has to be testable.
    document.cookie = consentCookieString(next, window.location.protocol === "https:");
    setValue(encodeConsent(next));
    window.dispatchEvent(new Event(CONSENT_EVENT));
  }, []);

  // Before the cookie has been read there is no decision and nothing is
  // allowed — `undefined` is not `false`, and every consumer waits for a real
  // value rather than acting on the gap.
  const read = value !== undefined;

  return {
    record: read ? decodeConsent(value) : undefined,
    choices: read ? allowedCategories(value) : REJECT_ALL,
    undecided: read ? needsDecision(value) : false,
    save,
  };
}

export { ACCEPT_ALL, REJECT_ALL };
