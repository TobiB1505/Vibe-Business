import { redactCredentials } from "@/lib/security/credential-patterns";

/**
 * What an error event may carry out of this process (VB-021).
 *
 * Sentry is a third party. Everything below is about one question — *what does
 * an exception know that Sentry must not* — and the answers are not exotic.
 * A thrown `fetch` error stringifies the URL it was called with. A Supabase
 * client error can name the header it sent. A Server Action failure arrives
 * with the form data that caused it. None of that is a bug; it is what makes
 * the report useful locally and what makes it a disclosure remotely.
 *
 * ## Dropping beats redacting, where dropping is possible
 *
 * A pattern list is a guess about strings. Wholesale removal is not, so the
 * fields that are *reliably* sensitive and *rarely* diagnostic go entirely:
 *
 *  - **Request bodies.** A Server Action's payload is the customer's own
 *    input — an address, a repository name, a founder's prose. The stack tells
 *    us where it broke; the body only tells us whose data it was.
 *  - **Cookies.** The session cookie is a bearer token for that account.
 *  - **Authorization, apikey, cookie and Supabase auth headers.** Same.
 *  - **Query strings.** They routinely carry tokens, e-mail addresses and
 *    tracking identifiers — the same reasoning rule 37 applies to fetched web
 *    content, applied to our own URLs.
 *
 * What survives is the path, the method, the status, the stack and the
 * message, which is what a person actually reads.
 *
 * ## Then redaction, for what cannot be dropped
 *
 * A message and a stack frame are the whole value of the report, so they are
 * kept and passed through the credential patterns instead. That is the layer
 * that is a guess, and it is deliberately the last one rather than the only
 * one.
 *
 * ## It fails closed
 *
 * If scrubbing throws, the event is dropped. Losing an error report is a cost;
 * sending an unscrubbed one to a third party is a disclosure, and between the
 * two there is no argument for the second. This is the opposite default from
 * the sign-in throttle, which fails open — because that one degrades to the
 * protection that existed before it, and this one would degrade to the harm it
 * exists to prevent.
 */

/** Header names removed outright, compared lowercased. */
const DROPPED_HEADERS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "apikey",
  "api-key",
  "x-api-key",
  "x-supabase-authorization",
  "x-client-info",
  "proxy-authorization",
]);

type ScrubbableRequest = {
  url?: unknown;
  data?: unknown;
  cookies?: unknown;
  query_string?: unknown;
  headers?: unknown;
};

type ScrubbableEvent = {
  request?: unknown;
  message?: unknown;
  exception?: unknown;
  breadcrumbs?: unknown;
  extra?: unknown;
  [key: string]: unknown;
};

/** Strips the query string from a URL, keeping origin and path. */
function pathOnly(url: string): string {
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}

/**
 * Walks a value, redacting every string it contains.
 *
 * Depth-bounded because a Sentry event is arbitrary user-shaped data and a
 * cycle or a pathological nesting here would take the process down inside
 * `beforeSend` — which runs on the error path, where a second failure is the
 * least recoverable.
 */
function redactDeep(value: unknown, depth = 0): unknown {
  if (depth > 8) return value;
  if (typeof value === "string") return redactCredentials(value);
  if (Array.isArray(value)) return value.map((entry) => redactDeep(entry, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = redactDeep(entry, depth + 1);
    }
    return out;
  }
  return value;
}

function scrubHeaders(headers: unknown): unknown {
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) return undefined;
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(headers as Record<string, unknown>)) {
    if (DROPPED_HEADERS.has(name.toLowerCase())) continue;
    out[name] = redactDeep(value);
  }
  return out;
}

function scrubRequest(request: unknown): unknown {
  if (!request || typeof request !== "object") return request;
  const source = request as ScrubbableRequest;

  // Rebuilt rather than edited: an unknown future key is then absent by
  // default instead of carried through because nobody thought to delete it.
  const scrubbed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
    if (key === "data" || key === "cookies" || key === "query_string") continue;
    if (key === "headers") continue;
    if (key === "url") continue;
    scrubbed[key] = redactDeep(value);
  }

  if (typeof source.url === "string") scrubbed.url = redactCredentials(pathOnly(source.url));
  const headers = scrubHeaders(source.headers);
  if (headers) scrubbed.headers = headers;

  return scrubbed;
}

/**
 * The `beforeSend` body, as a plain function so it can be tested without Sentry.
 *
 * Returning `null` means "do not send this event", which is what both the
 * failure path and a caller with nothing to report rely on.
 */
export function scrubErrorEvent<T extends object>(event: T | null | undefined): T | null {
  if (!event) return null;

  try {
    const source = event as ScrubbableEvent;
    const scrubbed: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(source)) {
      if (key === "request") continue;
      scrubbed[key] = redactDeep(value);
    }
    if (source.request !== undefined) scrubbed.request = scrubRequest(source.request);
    return scrubbed as T;
  } catch {
    // Deliberately silent about the event's own content — a log line here is
    // another place the thing we failed to scrub could land.
    console.error("[observability] dropped an error event: scrubbing failed");
    return null;
  }
}
