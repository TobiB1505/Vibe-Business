import type { DnsResolver, HttpTransport, TransportRequest, TransportResponse } from "./net/ports";
import { TransportError, type TransportFailure } from "./net/ports";
import type { SafeFetchDependencies } from "./net/safe-fetch";

/**
 * In-memory network doubles (Sprint 3 §34).
 *
 * The entire fetch, crawl and detection stack runs against these in
 * tests, so CI never resolves a real hostname or opens a socket. Requests
 * are recorded so a test can assert not only what came back, but that a
 * blocked destination was never contacted at all — which is the only way
 * to prove an SSRF guard actually stops a request rather than merely
 * discarding its result.
 */

export type FakeResponse = {
  status?: number;
  headers?: Record<string, string>;
  body?: string;
  /** Simulates a transport-level failure instead of a response. */
  fail?: TransportFailure;
};

export type FakeSiteRoutes = Record<string, FakeResponse>;

export function htmlResponse(body: string, headers: Record<string, string> = {}): FakeResponse {
  return { status: 200, headers: { "content-type": "text/html; charset=utf-8", ...headers }, body };
}

export function redirectResponse(location: string, status = 302): FakeResponse {
  return { status, headers: { location } };
}

export function textResponse(body: string, contentType = "text/plain"): FakeResponse {
  return { status: 200, headers: { "content-type": contentType }, body };
}

export function xmlResponse(body: string): FakeResponse {
  return { status: 200, headers: { "content-type": "application/xml" }, body };
}

export type RecordedRequest = { url: string; pinnedAddress: string; maxBytes: number };

export class FakeTransport implements HttpTransport {
  readonly requests: RecordedRequest[] = [];

  constructor(private readonly routes: FakeSiteRoutes) {}

  async request(request: TransportRequest): Promise<TransportResponse> {
    this.requests.push({
      url: request.url.toString(),
      pinnedAddress: request.pinnedAddress,
      maxBytes: request.maxBytes,
    });

    // Routes are keyed by full URL first, then by pathname, so a fixture
    // can stay terse while still supporting multi-origin redirects.
    const route =
      this.routes[request.url.toString()] ??
      this.routes[`${request.url.origin}${request.url.pathname}`] ??
      this.routes[request.url.pathname];

    if (!route) {
      return { status: 404, headers: { "content-type": "text/html" }, body: "", bytesRead: 0, truncated: false };
    }

    if (route.fail) throw new TransportError(route.fail);

    const body = route.body ?? "";
    const encoded = Buffer.byteLength(body, "utf8");
    const truncated = encoded > request.maxBytes;

    return {
      status: route.status ?? 200,
      headers: route.headers ?? {},
      body: truncated ? body.slice(0, request.maxBytes) : body,
      bytesRead: truncated ? request.maxBytes : encoded,
      truncated,
    };
  }

  get requestedUrls(): string[] {
    return this.requests.map((request) => request.url);
  }
}

/** DNS double: every unlisted hostname resolves to a public address. */
export function fakeDns(mapping: Record<string, string[]> = {}, fallback = "93.184.216.34"): DnsResolver {
  return async (hostname: string) => {
    const addresses = mapping[hostname] ?? [fallback];
    if (addresses.length === 0) throw new Error("ENOTFOUND");
    return addresses.map((address) => ({
      address,
      family: address.includes(":") ? (6 as const) : (4 as const),
    }));
  };
}

export function fakeDependencies(
  routes: FakeSiteRoutes,
  dnsMapping: Record<string, string[]> = {},
): SafeFetchDependencies & { transport: FakeTransport } {
  const transport = new FakeTransport(routes);
  return { transport, resolveDns: fakeDns(dnsMapping) };
}

/** Minimal but realistic SaaS landing page fixture. */
export function landingPageHtml(options: { ctaLabel?: string; withPricingLink?: boolean } = {}): string {
  const { ctaLabel = "Start free", withPricingLink = true } = options;
  return `<!doctype html>
<html lang="en">
<head>
  <title>Acme — Ship faster</title>
  <meta name="description" content="Acme helps teams ship faster.">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="canonical" href="https://acme.test/">
  <meta property="og:title" content="Acme">
</head>
<body>
  <nav><a href="/pricing">Pricing</a><a href="/login">Log in</a></nav>
  <h1>Ship faster</h1>
  <a href="/signup">${ctaLabel}</a>
  ${withPricingLink ? '<a href="/pricing">See pricing</a>' : ""}
  <footer><a href="/privacy">Privacy</a><a href="/terms">Terms</a></footer>
</body>
</html>`;
}
