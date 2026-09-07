import { isAuthSurfacePath, toSameOriginPath } from "./routes";

/**
 * Deciding whether the founder has finished signing in.
 *
 * Until now the flow asked them: a browser opened, they signed in, and then
 * they pressed **I'm logged in — Analyze**. That button is a question Vibe can
 * usually answer itself, and asking it has a cost — the founder watches a
 * finished login for as long as it takes them to notice the button.
 *
 * Three constraints shape everything here:
 *
 *  1. **Structure only, never a value.** The probe reads whether an
 *     `input[type=password]` *exists*. It never reads one, and there is no
 *     field on `RawSignInProbe` that could carry a credential even if the page
 *     rewrote the script. Same rule as `extract.ts`, one signal wider, and the
 *     widening is a boolean.
 *  2. **A false positive is expensive, a false negative is free.** Starting
 *     early spends the scan on a login page. Starting late costs one button
 *     press — the button stays. So every ambiguous reading resolves to *not
 *     signed in*.
 *  3. **The page is hostile input.** Labels are capped at the source, the
 *     verdict is a closed set of codes, and nothing a page writes becomes text
 *     Vibe renders or stores.
 */

/** What the in-page script may return. Booleans and short labels, nothing else. */
export type RawSignInProbe = {
  passwordFieldPresent: unknown;
  signOutAffordancePresent: unknown;
  accountAffordancePresent: unknown;
  hasAppShell: unknown;
};

/**
 * The function evaluated in the page.
 *
 * Note the password check: `querySelector("input[type=password]") !== null`. It resolves to a
 * boolean at the source, so no value exists to cross the CDP boundary. A
 * change that returns the element, its value, or its name is the change to
 * refuse in review.
 */
export function signInProbeScript(): RawSignInProbe {
  const SIGN_OUT = /(^|[^a-z])(log\s?out|logout|sign\s?out|signout|abmelden|ausloggen|d[ée]connexion|cerrar sesi[oó]n)([^a-z]|$)/i;
  const ACCOUNT = /(^|[^a-z])(account|profile|settings|dashboard|billing|konto|profil|einstellungen)([^a-z]|$)/i;

  const labelOf = (element: Element): string =>
    (element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 80);

  let signOut = false;
  let account = false;

  // Bounded at 300 elements: a page with more interactive elements than that
  // has already told us everything this probe can learn.
  for (const element of Array.from(document.querySelectorAll("a[href], button, [role=button], [role=menuitem]")).slice(0, 300)) {
    const href = element.getAttribute("href") ?? "";
    const label = labelOf(element);
    if (SIGN_OUT.test(label) || SIGN_OUT.test(href)) signOut = true;
    if (ACCOUNT.test(label) || ACCOUNT.test(href)) account = true;
    if (signOut && account) break;
  }

  return {
    passwordFieldPresent: document.querySelector("input[type=password]") !== null,
    signOutAffordancePresent: signOut,
    accountAffordancePresent: account,
    hasAppShell: Boolean(
      document.querySelector("nav, [role=navigation], aside, [class*=sidebar], [class*=Sidebar]"),
    ),
  };
}

/** The probe after our own runtime has refused to trust it. */
export type SignInProbe = {
  /** Origin-relative path the browser is on, or `null` when it is elsewhere. */
  path: string | null;
  passwordFieldPresent: boolean;
  signOutAffordancePresent: boolean;
  accountAffordancePresent: boolean;
  hasAppShell: boolean;
};

function bool(value: unknown): boolean {
  return value === true;
}

export function sanitizeSignInProbe(raw: RawSignInProbe, path: string | null): SignInProbe {
  return {
    path,
    // `=== true`, not truthiness: a page that returns `"yes"` or `1` for
    // `passwordFieldPresent` would otherwise get a free *negative* on the one
    // field whose whole job is to hold the scan back.
    passwordFieldPresent: bool(raw.passwordFieldPresent),
    signOutAffordancePresent: bool(raw.signOutAffordancePresent),
    accountAffordancePresent: bool(raw.accountAffordancePresent),
    hasAppShell: bool(raw.hasAppShell),
  };
}

/**
 * Paths a founder passes *through* on the way in, beyond the auth surfaces
 * themselves.
 *
 * The shared list in `routes.ts` holds what is unambiguously an auth page.
 * These four are added here and **only** here, because the two questions carry
 * opposite risks: treating `/orders/confirm` as auth here delays an unprompted
 * start by one poll, while treating it as auth in `NEVER_VISIT` would silently
 * drop a real product surface from the crawl. A widening that belongs in one
 * file is not a widening that belongs in both.
 */
const MID_FLOW_PATHS = [/(^|\/)(confirm|challenge|callback|oauth)(\/|$)/i];

export function isAuthPath(path: string): boolean {
  return isAuthSurfacePath(path) || MID_FLOW_PATHS.some((pattern) => pattern.test(path));
}

/** Why the verdict is what it is. A closed set — never text from the page. */
export type SignInReason =
  /** A sign-out affordance. No signed-out page offers one. */
  | "sign_out_offered"
  /** An application shell plus an account affordance, off any auth path. */
  | "app_shell_and_account"
  /** A password field is on screen. */
  | "password_field_present"
  /** The browser is on a login, signup, reset or verification path. */
  | "on_auth_path"
  /** The browser is not on the project's origin at all. */
  | "off_origin"
  /** Nothing on the page says either way. */
  | "no_signal";

export type SignInVerdict = { signedIn: boolean; reason: SignInReason };

/**
 * The decision, ordered so the cheap certainties come first.
 *
 * The password check runs **before** the sign-out check on purpose. An
 * application page that offers both — a "change password" screen with a
 * sign-out link in its own header — reads as *not signed in*, which is wrong
 * and costs one button press. The other order would read a login page that
 * happens to link "Sign out" as signed in, and cost the scan. Between a wrong
 * answer that wastes a click and a wrong answer that wastes the founder's one
 * included Deep Scan, this picks the click.
 */
export function detectSignedIn(probe: SignInProbe): SignInVerdict {
  if (probe.path === null) return { signedIn: false, reason: "off_origin" };
  if (probe.passwordFieldPresent) return { signedIn: false, reason: "password_field_present" };
  if (isAuthPath(probe.path)) return { signedIn: false, reason: "on_auth_path" };
  if (probe.signOutAffordancePresent) return { signedIn: true, reason: "sign_out_offered" };
  if (probe.hasAppShell && probe.accountAffordancePresent) {
    return { signedIn: true, reason: "app_shell_and_account" };
  }
  return { signedIn: false, reason: "no_signal" };
}

/** Normalizes a browser URL to an origin-relative path, or `null` if elsewhere. */
export function probePathFor(url: string, origin: string): string | null {
  return toSameOriginPath(url, origin);
}

/**
 * How many consecutive positive readings start the scan by themselves.
 *
 * Two, not one. A single-page application paints its shell before its session
 * check resolves, so there is a moment where the nav is up, no password field
 * is on screen and the app is about to bounce the visitor back to `/login`.
 * One reading in that window is a plausible false positive; two, a poll apart,
 * is not.
 */
export const CONSECUTIVE_SIGNED_IN_PROBES = 2;

/**
 * Whether a run of readings is enough to start without being asked.
 *
 * A pure function of the readings so the rule is testable without a browser,
 * a timer, or a rendered dialog.
 */
export function shouldStartUnprompted(recent: readonly boolean[]): boolean {
  if (recent.length < CONSECUTIVE_SIGNED_IN_PROBES) return false;
  return recent.slice(-CONSECUTIVE_SIGNED_IN_PROBES).every(Boolean);
}
