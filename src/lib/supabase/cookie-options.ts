import type { CookieOptions } from "@supabase/ssr";

/**
 * The auth cookie's transport rules, in one place (VB-006).
 *
 * Three factories write this cookie — `server.ts`, `proxy.ts` and `client.ts` —
 * and each one passed `@supabase/ssr` defaults. That left the session cookie
 * without `Secure`, so a single plain-HTTP request to the deployed host would
 * put a live session token on the wire in clear text. The defaults are not
 * wrong for a library that cannot know its deployment; they are wrong for this
 * one, which is only ever served over HTTPS.
 *
 * It is one exported constant rather than three literals for the reason the
 * proxy's own comment gives about cache headers: a cookie rule that is written
 * in three places is a cookie rule that will eventually differ in one of them,
 * and the one that differs is the one that leaks.
 *
 * ## Why `secure` is unconditional
 *
 * The obvious alternative is `secure: process.env.NODE_ENV === "production"`,
 * and it is worse. It introduces an environment check that can be wrong —
 * a preview build, a self-hosted runner, a misread variable — and being wrong
 * silently downgrades the cookie in exactly the environments nobody inspects.
 * Unconditional has no such failure mode.
 *
 * It costs nothing locally: browsers treat `localhost` and `127.0.0.1` as
 * trustworthy origins and accept `Secure` cookies from them, which covers
 * `next dev` and the Playwright suite's `127.0.0.1:3311`. The one case it does
 * break is development over a plain-HTTP LAN address — `http://192.168.x.x`,
 * typically a phone on the same network. That is a real cost, it is narrow,
 * and the fix for it is to serve that session over HTTPS rather than to weaken
 * the cookie for everyone.
 *
 * ## Why `httpOnly` is not set here
 *
 * Because it cannot be. `@supabase/ssr`'s browser client reads this cookie from
 * `document.cookie` to restore a session, so `httpOnly: true` would break the
 * client factory outright — the flag is not a default anyone forgot.
 *
 * The exposure that leaves is real and worth naming: any script running on the
 * page can read the session token, so an XSS becomes a session takeover. What
 * bounds it is the Content Security Policy, not this file — which is why
 * VB-005 and VB-006 are one piece of work and not two.
 */
export const AUTH_COOKIE_OPTIONS: CookieOptions = {
  secure: true,
  sameSite: "lax",
  path: "/",
};
