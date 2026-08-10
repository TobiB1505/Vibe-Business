import { classifyAddress, isIpLiteral } from "./net/ip";

/**
 * URL policy and normalization (Sprint 3 §4, §22).
 *
 * A production URL is untrusted user input that later becomes the target
 * of outbound requests, so it is validated once, aggressively, and stored
 * only in normalized form. Everything downstream — the crawler, the
 * fetcher, the snapshot — works from the normalized value, never from the
 * raw string the user typed.
 *
 * Query strings and fragments are dropped rather than preserved: they are
 * never needed to reach a product's public homepage, and they are exactly
 * where session tokens, email addresses and tracking identifiers show up
 * (Sprint 3 §13, §22).
 */

export type UrlRejectionReason =
  | "empty"
  | "malformed"
  | "unsupported_scheme"
  | "insecure_scheme"
  | "credentials_present"
  | "missing_hostname"
  | "internal_hostname"
  | "unsafe_address";

export type UrlNormalizationResult =
  | { ok: true; url: string; origin: string; hostname: string }
  | { ok: false; reason: UrlRejectionReason };

/**
 * Hostnames that never refer to a customer's public product. Matched as
 * exact names or as dot-anchored suffixes so `notlocalhost.com` and
 * `mylocal.dev` are unaffected.
 */
const INTERNAL_HOST_SUFFIXES = [
  "localhost",
  "local",
  "localdomain",
  "internal",
  "intranet",
  "lan",
  "home.arpa",
  "in-addr.arpa",
  "ip6.arpa",
  "onion",
];

/** Query parameters dropped before a URL is used or persisted (Sprint 3 §22). */
const TRACKING_PARAMETERS = [
  /^utm_/i,
  /^_hs/i,
  /^mc_/i,
  /^pk_/i,
  /^ref$/i,
  /^referrer$/i,
  /^source$/i,
  /^gclid$/i,
  /^dclid$/i,
  /^fbclid$/i,
  /^msclkid$/i,
  /^twclid$/i,
  /^igshid$/i,
  /^yclid$/i,
  /^si$/i,
];

export function isTrackingParameter(name: string): boolean {
  return TRACKING_PARAMETERS.some((pattern) => pattern.test(name));
}

function isInternalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (host.length === 0) return true;

  for (const suffix of INTERNAL_HOST_SUFFIXES) {
    if (host === suffix || host.endsWith(`.${suffix}`)) return true;
  }

  // A single-label hostname (`intranet`, `db`, `metadata`) can only
  // resolve through internal search domains — never a public product.
  if (!host.includes(".") && !isIpLiteral(host)) return true;

  return false;
}

/**
 * Validates and normalizes a URL the user configured as their production
 * website.
 *
 * HTTPS is required. Plain HTTP is rejected rather than silently
 * upgraded, because a product served over HTTP would have every
 * subsequent redirect and response open to tampering — and because
 * accepting it invites `http://127.0.0.1`-shaped input. There is
 * deliberately no localhost/development escape hatch (Sprint 3 §4): the
 * feature analyses live products, and an exception would weaken the same
 * check that stops SSRF.
 */
export function normalizeProductionUrl(raw: string): UrlNormalizationResult {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: false, reason: "empty" };
  if (trimmed.length > 2000) return { ok: false, reason: "malformed" };

  // Accept `example.com` as a convenience, but only by adding the scheme
  // we would require anyway — never by inferring a weaker one.
  const candidate = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) ? trimmed : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return { ok: false, reason: "malformed" };
  }

  if (url.protocol === "http:") return { ok: false, reason: "insecure_scheme" };
  if (url.protocol !== "https:") return { ok: false, reason: "unsupported_scheme" };

  // `https://user:pass@host/` — credentials in a URL are both a secret we
  // refuse to store and a classic parser-confusion vector.
  if (url.username !== "" || url.password !== "") {
    return { ok: false, reason: "credentials_present" };
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (hostname.length === 0) return { ok: false, reason: "missing_hostname" };
  if (isInternalHostname(hostname)) return { ok: false, reason: "internal_hostname" };

  // A literal IP can be judged immediately; a name is only judged at
  // request time, once DNS has actually resolved it.
  if (isIpLiteral(hostname)) {
    const classification = classifyAddress(hostname);
    if (!classification.safe) return { ok: false, reason: "unsafe_address" };
  }

  url.hostname = hostname;
  url.hash = "";
  url.search = "";
  url.pathname = normalizePathname(url.pathname);

  return { ok: true, url: url.toString(), origin: url.origin, hostname };
}

/**
 * Collapses duplicate slashes and drops a trailing slash (except on the
 * root), so `/pricing`, `/pricing/` and `//pricing` are one page rather
 * than three crawl targets.
 */
export function normalizePathname(pathname: string): string {
  const collapsed = pathname.replace(/\/{2,}/g, "/");
  if (collapsed === "" || collapsed === "/") return "/";
  return collapsed.endsWith("/") ? collapsed.slice(0, -1) : collapsed;
}

/** File extensions that are never an HTML page worth crawling (Sprint 3 §7, §9). */
const NON_PAGE_EXTENSION =
  /\.(?:png|jpe?g|gif|webp|avif|svg|ico|bmp|tiff?|pdf|zip|gz|tar|rar|7z|dmg|exe|msi|pkg|deb|rpm|apk|mp[34]|m4[av]|wav|ogg|webm|mov|avi|mkv|css|js|mjs|map|woff2?|ttf|otf|eot|csv|xlsx?|docx?|pptx?|rss|atom|txt)$/i;

export function looksLikeNonPageAsset(pathname: string): boolean {
  return NON_PAGE_EXTENSION.test(pathname);
}

export type ResolvedLink =
  | { ok: true; url: URL; key: string; sameOrigin: boolean }
  | { ok: false; reason: "unsupported_scheme" | "malformed" | "asset" | "credentials_present" };

/**
 * Resolves a discovered `href` against the page it was found on.
 *
 * The returned `key` is the crawl identity of the page: origin plus
 * normalized pathname, with the query string deliberately excluded. That
 * single decision is what makes query explosion impossible — a thousand
 * `?utm_*`/`?page=` variants of `/blog` collapse to one crawl target — at
 * the documented cost of not analysing query-differentiated pages
 * separately (Sprint 3 §22).
 */
export function resolveLink(href: string, base: URL): ResolvedLink {
  const value = href.trim();
  if (value.length === 0) return { ok: false, reason: "malformed" };

  // Non-navigational hrefs, rejected before URL parsing so that
  // `javascript:` can never reach anything that might act on it.
  if (/^(?:javascript|data|mailto|tel|sms|blob|file|ftp|wss?|about):/i.test(value)) {
    return { ok: false, reason: "unsupported_scheme" };
  }
  if (value.startsWith("#")) return { ok: false, reason: "malformed" };

  let url: URL;
  try {
    url = new URL(value, base);
  } catch {
    return { ok: false, reason: "malformed" };
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, reason: "unsupported_scheme" };
  }
  if (url.username !== "" || url.password !== "") {
    return { ok: false, reason: "credentials_present" };
  }
  if (looksLikeNonPageAsset(url.pathname)) return { ok: false, reason: "asset" };

  url.hash = "";
  url.pathname = normalizePathname(url.pathname);

  // Tracking parameters are stripped from the URL we would request, on
  // top of the query being excluded from the crawl key.
  const params = url.searchParams;
  for (const name of [...params.keys()]) {
    if (isTrackingParameter(name)) params.delete(name);
  }

  return {
    ok: true,
    url,
    key: `${url.origin}${url.pathname}`,
    sameOrigin: url.origin === base.origin,
  };
}
