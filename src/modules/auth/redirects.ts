/**
 * The one place a post-authentication destination is decided.
 *
 * Email login and the OAuth callback both route through `sanitizeNextPath`.
 * Two implementations would mean two chances to get an open redirect wrong,
 * and the OAuth callback is the one an attacker can reach with a crafted URL
 * without ever touching our login form.
 *
 * ## Why an allowlist rather than a blocklist
 *
 * Because the blocklist is unbounded. Protocol-relative references,
 * backslash folding, percent-encoded slashes, `javascript:`, `data:` and
 * whatever the next parser quirk turns out to be all have to be enumerated
 * correctly, forever, and one miss is a working open redirect. An allowlist
 * inverts that: the value has to *prove* it is an internal Vibe path, and
 * everything that fails to prove it falls back to `/app`. A new bypass
 * technique produces a fallback, not a redirect to an attacker.
 */

import { NextResponse } from "next/server";

/** Where authenticated users land when no safe destination was requested. */
export const DEFAULT_POST_AUTH_PATH = "/app";

/**
 * Path prefixes a `next` parameter is allowed to name.
 *
 * Deliberately just the authenticated workspace. `/login`, `/signup` and the
 * `/auth/*` routes are excluded on purpose: sending a freshly authenticated
 * user back to an auth screen is how redirect loops start, and no legitimate
 * flow needs it.
 */
const ALLOWED_PREFIXES = ["/app"] as const;

/**
 * A dummy origin for structural parsing only. Never used to build a
 * user-visible URL — only to ask the URL parser "does this value stay on the
 * origin it was resolved against?".
 */
const PARSE_BASE = "https://vibe.invalid";

/**
 * Rejects control characters, whitespace and backslashes.
 *
 * Backslash matters because browsers and some servers fold it to `/` when
 * parsing a URL, which would turn `/\evil.com` into `//evil.com` — a
 * protocol-relative reference to another origin — after the leading-slash
 * check had already passed it. Control characters matter because a stray
 * newline or NUL can truncate a value differently in a header, a log and a
 * browser, so the three stop agreeing about where the redirect points.
 *
 * Written as code-point comparisons rather than a character-class regex so
 * the source file stays free of literal control bytes.
 */
function hasStructurallyUnsafeCharacters(value: string): boolean {
  for (const character of value) {
    if (character === "\\") return true;

    const code = character.codePointAt(0) ?? 0;
    // Everything at or below U+0020 is a C0 control or the space itself;
    // U+007F–U+009F is DEL plus the C1 controls.
    if (code <= 0x20) return true;
    if (code >= 0x7f && code <= 0x9f) return true;
  }
  return false;
}

/**
 * Percent-decodes as far as it converges, so a value is judged by what a
 * downstream parser could ultimately see rather than by its surface form.
 * Bounded because attacker input can otherwise be driven in circles, and
 * returns null on malformed escapes — malformed input is rejected rather
 * than repaired.
 */
function fullyDecode(value: string): string | null {
  let current = value;
  for (let i = 0; i < 4; i += 1) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(current);
    } catch {
      return null;
    }
    if (decoded === current) return current;
    current = decoded;
  }
  return null;
}

/** True when `pathname` is exactly an allowed prefix or a child segment of one. */
function isAllowedPathname(pathname: string): boolean {
  return ALLOWED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Reduces an untrusted `next` value to a safe internal path, or to `/app`
 * when it cannot be proven safe.
 *
 * Never throws and never returns an absolute URL, a protocol-relative
 * reference, or a non-`/app` path — so a caller can hand the result straight
 * to `redirect()` without a second check.
 */
export function sanitizeNextPath(raw: string | null | undefined): string {
  if (typeof raw !== "string") return DEFAULT_POST_AUTH_PATH;

  const trimmed = raw.trim();
  if (trimmed.length === 0) return DEFAULT_POST_AUTH_PATH;

  // Judge the fully-decoded form as well as the literal one: a value that
  // only looks safe until something decodes it must not pass.
  const decoded = fullyDecode(trimmed);
  if (decoded === null) return DEFAULT_POST_AUTH_PATH;

  for (const candidate of [trimmed, decoded]) {
    if (hasStructurallyUnsafeCharacters(candidate)) return DEFAULT_POST_AUTH_PATH;
    // A single leading slash and no second one: rejects both absolute URLs
    // (`https://evil.com`, `javascript:...`, `data:...`) and protocol-relative
    // references (`//evil.com`), which are the two ways off this origin.
    if (!candidate.startsWith("/") || candidate.startsWith("//")) {
      return DEFAULT_POST_AUTH_PATH;
    }
  }

  // Structural checks passed; now let the URL parser have the final word on
  // whether this really resolves to the same origin.
  let parsed: URL;
  try {
    parsed = new URL(trimmed, PARSE_BASE);
  } catch {
    return DEFAULT_POST_AUTH_PATH;
  }

  if (parsed.origin !== PARSE_BASE) return DEFAULT_POST_AUTH_PATH;
  if (!isAllowedPathname(parsed.pathname)) return DEFAULT_POST_AUTH_PATH;

  // The fragment is dropped deliberately: it never reaches the server, so
  // carrying it through a server-side redirect buys nothing.
  return `${parsed.pathname}${parsed.search}`;
}

/**
 * Builds the `/login?next=...` URL a guard redirects to, with the requested
 * path sanitized first — a guard must never echo an attacker-supplied value
 * back into a link it renders.
 *
 * Omits `next` when it would just repeat the default, keeping `/login` clean
 * for the common case.
 */
export function loginPathWithNext(requestedPath: string | null | undefined): string {
  const next = sanitizeNextPath(requestedPath);
  if (next === DEFAULT_POST_AUTH_PATH) return "/login";
  return `/login?next=${encodeURIComponent(next)}`;
}

/**
 * Builds a redirect whose `Location` is a path, never an absolute URL.
 *
 * ## Why not NextResponse.redirect()
 *
 * Because it requires an absolute URL, which means deciding what this app's
 * host is. `request.nextUrl.origin` inside a Route Handler was measured
 * against a production build and reported the server's own bound address
 * rather than the host the request named, and trusting `X-Forwarded-Host`
 * instead only moves the problem — that header is client-supplied.
 *
 * A relative `Location` sidesteps the question entirely. RFC 7231 permits it,
 * every browser resolves it against the URL actually requested, and a
 * redirect that is only ever a path is structurally incapable of pointing at
 * another origin. That is a stronger guarantee than sanitizing an absolute
 * URL correctly, because it does not depend on getting the sanitizing right.
 *
 * ## Route Handlers only
 *
 * Next's proxy layer parses a middleware response's `Location` as an absolute
 * URL and throws `ERR_INVALID_URL` on a path — verified against a production
 * build, where every guarded request 500'd. `src/lib/supabase/proxy.ts`
 * therefore builds its redirects from `request.nextUrl`, which is Next's own
 * resolved URL rather than a client-supplied header.
 */
export function internalRedirect(path: string): NextResponse {
  return new NextResponse(null, { status: 307, headers: { Location: path } });
}
