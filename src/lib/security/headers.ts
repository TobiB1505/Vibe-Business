/**
 * Response security headers (VB-005, ADR 0059).
 *
 * Vibe served none of these. Every header below is additive — nothing here
 * changes what the application does, only what a browser is willing to do with
 * what it receives.
 *
 * ## Why the CSP is report-only
 *
 * Because the launch gate says so: *"CSP report-only ≥1 week, then enforced"*.
 * A first CSP written from reading the code is a guess about what a browser
 * actually loads, and an enforced guess breaks the product for whoever hits the
 * case the author missed. Report-only produces the violation data that turns
 * the guess into a measurement, and costs nothing while it does.
 *
 * The consequence to be honest about: **a report-only CSP stops no attack.**
 * It is the instrument, not the defence. The defence arrives when it is
 * enforced, and that step is a separate decision that belongs with the reports.
 *
 * ## Two directives that are weaker than they look, and why
 *
 * `script-src` carries `'unsafe-inline'` because Next injects inline bootstrap
 * and RSC-payload scripts on every page. Removing it means per-request nonces,
 * which means generating one in `proxy.ts` — the most safety-critical file in
 * this repository, whose own comments explain how a mistake there hands one
 * user another user's session. That work is worth doing and is deliberately not
 * bundled into the change that first turns headers on.
 *
 * `img-src` allows any HTTPS origin because the product renders customer brand
 * logos as plain `<img>` elements pointing at arbitrary customer-controlled
 * URLs (`ProductLogo`, `Avatar`). `'self'` would blank every logo on the
 * dashboard. An image is not a script, and the alternative — proxying every
 * customer logo through Vibe — is a product change, not a header change.
 *
 * Both are recorded rather than quietly shipped, because a CSP whose weak
 * points are undocumented is one nobody can tighten later.
 */

/** Where the browser may load, connect and submit — everything else is refused. */
type CspSources = {
  /** The Supabase project, from `NEXT_PUBLIC_SUPABASE_URL`. */
  supabaseOrigin: string | null;
  /** The Sentry ingest host, derived from `NEXT_PUBLIC_SENTRY_DSN`. */
  sentryOrigin: string | null;
};

/** Meta Pixel's loader. `src/lib/analytics/meta-pixel.ts` fetches exactly this. */
const META_PIXEL_SCRIPT_ORIGIN = "https://connect.facebook.net";

/** Vercel Analytics and Speed Insights, both mounted in `app/layout.tsx`. */
const VERCEL_SCRIPT_ORIGIN = "https://va.vercel-scripts.com";

/**
 * An origin from a URL, or null when the value is absent or unparseable.
 *
 * Null rather than a thrown error and never a wildcard: a missing environment
 * variable must narrow the policy, never widen it. A build without Sentry
 * configured should refuse Sentry's origin, not allow everything.
 */
function originOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/** The two env-derived origins, read where the header is built. */
export function cspSourcesFromEnv(
  env: Record<string, string | undefined> = process.env,
): CspSources {
  return {
    supabaseOrigin: originOf(env.NEXT_PUBLIC_SUPABASE_URL),
    sentryOrigin: originOf(env.NEXT_PUBLIC_SENTRY_DSN),
  };
}

export function buildContentSecurityPolicy(sources: CspSources): string {
  const connect = [
    "'self'",
    sources.supabaseOrigin,
    sources.sentryOrigin,
    VERCEL_SCRIPT_ORIGIN,
  ].filter((source): source is string => source !== null);

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    // See the docblock: Next's inline bootstrap, and nonces deferred.
    "script-src": ["'self'", "'unsafe-inline'", META_PIXEL_SCRIPT_ORIGIN, VERCEL_SCRIPT_ORIGIN],
    // Tailwind and Next both emit inline style attributes.
    "style-src": ["'self'", "'unsafe-inline'"],
    // `https:` for customer logos; `data:`/`blob:` for inline and generated images.
    "img-src": ["'self'", "data:", "blob:", "https:"],
    "font-src": ["'self'", "data:"],
    "connect-src": connect,
    // Vibe is never framed, and never frames anyone.
    "frame-ancestors": ["'none'"],
    "frame-src": ["'none'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
  };

  return Object.entries(directives)
    .map(([directive, values]) => `${directive} ${values.join(" ")}`)
    .join("; ");
}

/**
 * The headers applied to every route.
 *
 * `Strict-Transport-Security` carries no `preload`. Preloading is a one-way
 * door enforced by browser vendors rather than by us, and it should be a
 * deliberate decision taken once the apex domain and every subdomain are known
 * to be HTTPS-only — not a side effect of turning headers on.
 */
export function securityHeaders(
  sources: CspSources = cspSourcesFromEnv(),
): { key: string; value: string }[] {
  return [
    {
      key: "Content-Security-Policy-Report-Only",
      value: buildContentSecurityPolicy(sources),
    },
    { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    // Redundant with `frame-ancestors` for modern browsers, kept for old ones.
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
    },
  ];
}
