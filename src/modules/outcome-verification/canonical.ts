import { normalizePathname } from "@/modules/live-product-intelligence/url";

/**
 * Canonical URL comparison for outcome checks (Sprint 12A §16).
 *
 * ## The two mistakes this file exists to avoid
 *
 * **Failing on formatting.** `https://example.com`, `https://example.com/` and
 * `https://Example.com/` are the same homepage. A verifier that reported "the
 * homepage is missing from your sitemap" because of a trailing slash would be
 * confidently wrong about somebody's product, which is worse than saying
 * nothing.
 *
 * **Passing on the wrong origin.** `https://example.com.evil.test/` is not the
 * homepage, and neither is `https://cdn.example.com/`. Comparison is therefore
 * exact on host and port after normalization — never a substring test, never a
 * suffix test, never `startsWith`.
 *
 * ## Scheme
 *
 * Compared, not ignored. The origin Vibe verifies is always `https:` (the
 * production-URL policy refuses anything else), so a sitemap entry naming
 * `http://` is a genuinely different URL that a crawler will treat differently.
 * The one accommodation is that the *observed* origin — the one actually served
 * after redirects — is accepted alongside the configured one, because
 * `example.com` → `www.example.com` is a legitimate adoption the safe fetcher
 * already revalidated hop by hop.
 */

export type CanonicalUrl = {
  /** Scheme + host + port, lowercased. */
  origin: string;
  /** Collapsed, de-trailing-slashed pathname. `/` for the root. */
  path: string;
};

/**
 * Parses a URL found in a fetched document into comparable parts.
 *
 * Returns null for anything that is not an absolute http(s) URL. Sitemaps are
 * required to contain absolute URLs, so a relative `<loc>` is malformed rather
 * than something to resolve helpfully — resolving it would invent a claim the
 * document did not make.
 */
export function canonicalizeUrl(raw: string): CanonicalUrl | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > 2000) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username !== "" || url.password !== "") return null;
  if (url.hostname.length === 0) return null;

  url.hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  url.hash = "";
  // Dropped rather than compared. A query string is never part of a sitemap
  // entry's identity for our purposes, and it is exactly where tokens, emails
  // and tracking identifiers appear — which must not reach a stored evidence
  // row (CLAUDE.md rule 37).
  url.search = "";

  return { origin: url.origin, path: normalizePathname(url.pathname) };
}

/** Normalizes a path the same way, so contract targets and observations agree. */
export function canonicalPath(path: string): string {
  return normalizePathname(path.startsWith("/") ? path : `/${path}`);
}

/**
 * Is this URL the given path on one of the origins we accept?
 *
 * `acceptedOrigins` is the configured public origin plus, once known, the
 * origin actually served. Both are Vibe-resolved; neither comes from the
 * fetched document.
 */
export function matchesPath(
  url: CanonicalUrl,
  path: string,
  acceptedOrigins: readonly string[],
): boolean {
  return acceptedOrigins.includes(url.origin) && url.path === canonicalPath(path);
}

/**
 * Is this URL inside a private subtree we asserted must not be advertised?
 *
 * Prefix matching is **segment-aware**: `/app` covers `/app` and `/app/projects`
 * but must not cover `/application`. A naive `startsWith` would report a
 * perfectly ordinary marketing page as a leaked private surface, and the
 * resulting `partial` would be a false accusation about the customer's product.
 */
export function isUnderPrefix(
  url: CanonicalUrl,
  prefix: string,
  acceptedOrigins: readonly string[],
): boolean {
  if (!acceptedOrigins.includes(url.origin)) return false;

  const normalized = canonicalPath(prefix);
  if (normalized === "/") return true;

  return url.path === normalized || url.path.startsWith(`${normalized}/`);
}
