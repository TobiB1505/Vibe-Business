import type { LiveProductIntelligenceSnapshot } from "@/modules/live-product-intelligence/schema";
import { toSameOriginPath } from "./routes";

/**
 * Where the temporary browser should open, so the founder can sign in.
 *
 * ## The two minutes that were being spent on navigation
 *
 * The browser landed on `new URL(origin).origin` — the root — which for most
 * products is the marketing page. A founder then had two minutes to find
 * "Sign in" inside a canvas on their phone, tap it over a mobile connection,
 * wait for the page, and only then start typing. Reported from a phone on
 * LTE: the deadline ran out before the password did.
 *
 * Vibe usually already knows where the sign-in page is. The public scan
 * records which paths bounced to a login surface, which pages carry a
 * login-shaped form, and which surfaces it recognised. All of it was being
 * discarded at exactly the moment it was worth the most.
 *
 * ## Why this is not `detectAuthenticatedSurfaces`
 *
 * That function answers "is there a login here at all", and its evidence
 * paths are the *protected* pages, not the login page — `/app` is where the
 * redirect started, and `redirectedTo` is where it went. It also counts a
 * signup surface as evidence, which is right for its question and wrong for
 * this one: landing a founder on a registration form is worse than landing
 * them on the homepage.
 *
 * ## What it will not do
 *
 * The path comes from the customer's own site, which is untrusted data
 * (rule 36) — so it is never used as text. It is resolved against the
 * configured origin by `toSameOriginPath`, which requires https, refuses a
 * different origin, strips query and fragment, and bounds the length. Then it
 * must *also* look like a sign-in page and must not look like anything that
 * changes state. A candidate that fails either check is dropped, and dropping
 * every candidate is a supported answer: the browser opens at the root, which
 * is what it did before this existed.
 *
 * No model is involved anywhere in this, which is what keeps rule 57 intact.
 */

/** Why Vibe chose this page, for the sentence the founder is shown. */
export type SignInTargetReason =
  /** The product's own answer: a protected path redirected here. */
  | "protected_redirect"
  /** A page carrying a login-shaped form. */
  | "login_form"
  /** A login surface the public scan recognised. */
  | "login_surface";

export type SignInTarget = { path: string; reason: SignInTargetReason };

/**
 * Sign-in, and only sign-in.
 *
 * Registration, password reset and verification are all auth surfaces and
 * none of them is where somebody signs in. `AUTH_SURFACE_PATHS` in `routes.ts`
 * covers all four on purpose, because the *analysis* must avoid every one —
 * this is the narrower question and needs the narrower pattern.
 */
const SIGN_IN_PATH = /(^|\/)(login|signin|sign-in|log-in|anmelden)(\/|$)/i;

/**
 * Never open the browser here, whatever the evidence says.
 *
 * A sign-out link ends the session before the founder reaches it, and the
 * rest change state. This overlaps `NEVER_VISIT` deliberately rather than
 * importing it: that list forbids everything a *reader* must not touch,
 * including the login pages this function exists to find.
 */
const NEVER_LAND = [
  /(^|\/)(logout|log-out|signout|sign-out|abmelden)(\/|$)/i,
  /(^|\/)(delete|destroy|remove|cancel|deactivate|close-account)(\/|$)/i,
  /(^|\/)(checkout|payment|subscribe|upgrade)(\/|$)/i,
];

function landable(raw: string | null | undefined, origin: string): string | null {
  if (!raw) return null;
  const path = toSameOriginPath(raw, origin);
  if (path === null) return null;
  if (NEVER_LAND.some((pattern) => pattern.test(path))) return null;
  if (!SIGN_IN_PATH.test(path)) return null;
  return path;
}

export function findSignInTarget(input: {
  publicProduct: LiveProductIntelligenceSnapshot | null;
  origin: string;
}): SignInTarget | null {
  const { publicProduct, origin } = input;
  if (!publicProduct) return null;

  /*
   * 1. Where the product itself sent an anonymous visitor.
   *
   * A server that answers `/app` with a redirect to `/login` has stated where
   * its sign-in is. Nothing else here is that direct, so nothing else outranks
   * it.
   */
  for (const page of publicProduct.pages) {
    const path = landable(page.redirectedTo, origin);
    if (path) return { path, reason: "protected_redirect" };
  }

  /*
   * 2. A page that actually carries a login-shaped form.
   *
   * `signup_like` is a different kind and is not read here — the live module
   * already separates the two, and a registration form is not a way in for
   * somebody who already has an account.
   */
  for (const form of publicProduct.conversionSignals.forms) {
    if (form.kind !== "login_like") continue;
    const path = landable(form.path, origin);
    if (path) return { path, reason: "login_form" };
  }

  /*
   * 3. A login surface the public scan recognised. Weakest, because a
   *    surface can be recognised from a link label alone.
   */
  for (const surface of publicProduct.productSurfaces) {
    if (!surface.detected || surface.id !== "login") continue;
    for (const item of surface.evidence) {
      const path = landable(item.path, origin);
      if (path) return { path, reason: "login_surface" };
    }
  }

  return null;
}
