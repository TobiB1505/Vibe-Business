import { classifyAddress, addressFamily, isIpLiteral } from "./ip";
import { TransportError, type DnsResolver, type HttpTransport, type ResolvedAddress } from "./ports";

/**
 * The single outbound HTTP door for live product inspection
 * (Sprint 3 §5, ADR 0010).
 *
 * Nothing in this module may bypass `safeFetch`. Every request follows
 * the same four steps, and a redirect re-enters at step 1 rather than
 * being handed to the transport's own follower:
 *
 *   1. URL policy   — scheme, credentials, hostname shape
 *   2. DNS          — resolve the hostname to concrete addresses
 *   3. Address gate — every resolved address must be publicly routable
 *   4. Pinned send  — connect to the exact address that just passed
 *
 * Step 4 is what makes step 3 meaningful. If the transport resolved the
 * hostname itself, an attacker's DNS server could answer "public" for our
 * check and "127.0.0.1" for the connection a moment later (DNS
 * rebinding). Pinning removes the second lookup, so there is no window to
 * exploit.
 */

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** Identifies our crawler honestly so site owners can recognise and block it (Sprint 3 §9). */
export const USER_AGENT =
  "VibeBusinessBot/1.0 (+https://github.com/TobiB1505/Vibe-Business; live product inspection)";

export type SafeFetchFailure =
  | "invalid_url"
  | "unsafe_destination"
  | "dns_resolution_failed"
  | "too_many_redirects"
  | "redirect_off_origin"
  | "unsupported_content_type"
  | "page_too_large"
  | "request_timeout"
  | "tls_error"
  | "site_rate_limited"
  | "site_forbidden"
  | "request_failed";

export type SafeFetchSuccess = {
  ok: true;
  /** Final URL after redirects — may differ from the requested one. */
  url: URL;
  status: number;
  contentType: string;
  body: string;
  bytesRead: number;
  truncated: boolean;
  /** Every URL visited before the final one, in order. */
  redirectChain: string[];
  /** `Retry-After` seconds, when the site asked us to slow down. */
  retryAfterSeconds: number | null;
};

export type SafeFetchResult = SafeFetchSuccess | { ok: false; error: SafeFetchFailure; status?: number };

export type ContentKind = "html" | "text" | "xml";

const ACCEPTED_CONTENT_TYPES: Record<ContentKind, RegExp> = {
  html: /^text\/html|^application\/xhtml\+xml/i,
  text: /^text\/plain/i,
  xml: /^(?:text|application)\/(?:xml|rss\+xml|atom\+xml)|\+xml$/i,
};

export type SafeFetchOptions = {
  /** Which content types are acceptable; anything else is rejected unread. */
  accept: ContentKind[];
  maxBytes: number;
  timeoutMs: number;
  maxRedirects: number;
  /**
   * When set, a redirect leaving this origin is refused rather than
   * followed. The homepage probe leaves this unset so an
   * `example.com` → `www.example.com` redirect can be adopted; every
   * in-crawl page sets it, keeping the crawl same-origin (Sprint 3 §7).
   */
  restrictToOrigin?: string;
};

export type SafeFetchDependencies = {
  resolveDns: DnsResolver;
  transport: HttpTransport;
};

/**
 * Validates one hop's destination and returns the address to connect to.
 *
 * Rejects if *any* resolved address is non-public. Picking only the safe
 * ones from a mixed answer would be a bug, not a kindness: a hostname
 * that resolves to both a public and a private address is not a
 * legitimate public website, it is the shape of an attack.
 */
async function resolveSafeAddress(
  url: URL,
  resolveDns: DnsResolver,
): Promise<{ ok: true; address: ResolvedAddress } | { ok: false; error: SafeFetchFailure }> {
  const hostname = url.hostname.replace(/^\[|\]$/g, "");

  if (isIpLiteral(hostname)) {
    const classification = classifyAddress(hostname);
    if (!classification.safe) return { ok: false, error: "unsafe_destination" };
    const family = addressFamily(hostname);
    if (family === null) return { ok: false, error: "unsafe_destination" };
    return { ok: true, address: { address: hostname, family } };
  }

  let resolved: ResolvedAddress[];
  try {
    resolved = await resolveDns(hostname);
  } catch {
    return { ok: false, error: "dns_resolution_failed" };
  }

  if (resolved.length === 0) return { ok: false, error: "dns_resolution_failed" };

  for (const candidate of resolved) {
    if (!classifyAddress(candidate.address).safe) {
      return { ok: false, error: "unsafe_destination" };
    }
  }

  return { ok: true, address: resolved[0] };
}

/**
 * Ports a customer's product can legitimately be served from (VB-030).
 *
 * The address check below already refuses a private or link-local destination,
 * which is what stops this reaching *our* infrastructure. What it cannot see is
 * a **public** host running something that is not a website: a Redis on 6379, a
 * database on 5432, an SSH banner on 22. Those are somebody's services, they
 * are reachable, and nothing about "this resolves to a public address" says
 * they are a web page.
 *
 * An empty port means the protocol's default, which is 80 or 443 either way.
 */
const ALLOWED_PORTS = new Set(["", "80", "443"]);

/** URL-shape policy applied identically to the initial request and to every redirect target. */
function checkUrlPolicy(url: URL): SafeFetchFailure | null {
  if (url.protocol !== "https:" && url.protocol !== "http:") return "unsafe_destination";
  if (url.username !== "" || url.password !== "") return "unsafe_destination";
  if (url.hostname.length === 0) return "unsafe_destination";
  // Checked on every redirect target too, because that is the hop a hostile
  // site controls: a page on 443 answering with `Location: http://host:6379/`.
  if (!ALLOWED_PORTS.has(url.port)) return "unsafe_destination";
  return null;
}

function parseRetryAfter(value: string | undefined): number | null {
  if (!value) return null;
  const seconds = Number.parseInt(value.trim(), 10);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  const date = Date.parse(value);
  if (Number.isNaN(date)) return null;
  return Math.max(0, Math.round((date - Date.now()) / 1000));
}

function contentTypeAccepted(contentType: string, accept: ContentKind[]): boolean {
  return accept.some((kind) => ACCEPTED_CONTENT_TYPES[kind].test(contentType));
}

export async function safeFetch(
  target: URL | string,
  options: SafeFetchOptions,
  dependencies: SafeFetchDependencies,
): Promise<SafeFetchResult> {
  let current: URL;
  try {
    current = typeof target === "string" ? new URL(target) : new URL(target.toString());
  } catch {
    return { ok: false, error: "invalid_url" };
  }

  const redirectChain: string[] = [];

  for (let hop = 0; hop <= options.maxRedirects; hop += 1) {
    const policyFailure = checkUrlPolicy(current);
    if (policyFailure) return { ok: false, error: policyFailure };

    const resolution = await resolveSafeAddress(current, dependencies.resolveDns);
    if (!resolution.ok) return { ok: false, error: resolution.error };

    let response;
    try {
      response = await dependencies.transport.request({
        url: current,
        pinnedAddress: resolution.address.address,
        addressFamily: resolution.address.family,
        timeoutMs: options.timeoutMs,
        maxBytes: options.maxBytes,
        headers: {
          "user-agent": USER_AGENT,
          accept: "text/html,application/xhtml+xml,text/plain;q=0.9,application/xml;q=0.8,*/*;q=0.1",
          "accept-language": "*",
        },
      });
    } catch (error) {
      if (error instanceof TransportError) {
        if (error.failure === "timeout") return { ok: false, error: "request_timeout" };
        if (error.failure === "tls_error") return { ok: false, error: "tls_error" };
        if (error.failure === "too_large") return { ok: false, error: "page_too_large" };
      }
      return { ok: false, error: "request_failed" };
    }

    const retryAfterSeconds = parseRetryAfter(response.headers["retry-after"]);

    if (REDIRECT_STATUSES.has(response.status)) {
      const location = response.headers["location"];
      if (!location) return { ok: false, error: "request_failed", status: response.status };
      if (hop === options.maxRedirects) return { ok: false, error: "too_many_redirects" };

      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        return { ok: false, error: "unsafe_destination" };
      }

      if (options.restrictToOrigin && next.origin !== options.restrictToOrigin) {
        return { ok: false, error: "redirect_off_origin" };
      }

      redirectChain.push(current.toString());
      next.hash = "";
      current = next;
      // Loop restarts at the policy check, so the new destination is
      // validated from scratch — a redirect is never trusted because the
      // hop before it was safe.
      continue;
    }

    if (response.status === 429) return { ok: false, error: "site_rate_limited", status: 429 };
    if (response.status === 401 || response.status === 403) {
      return { ok: false, error: "site_forbidden", status: response.status };
    }
    if (response.status >= 400) {
      return { ok: false, error: "request_failed", status: response.status };
    }

    const contentType = (response.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
    if (!contentTypeAccepted(contentType, options.accept)) {
      return { ok: false, error: "unsupported_content_type", status: response.status };
    }

    return {
      ok: true,
      url: current,
      status: response.status,
      contentType,
      body: response.body,
      bytesRead: response.bytesRead,
      truncated: response.truncated,
      redirectChain,
      retryAfterSeconds,
    };
  }

  return { ok: false, error: "too_many_redirects" };
}
