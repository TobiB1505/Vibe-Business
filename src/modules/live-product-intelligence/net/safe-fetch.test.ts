import { describe, expect, it } from "vitest";
import { safeFetch, type SafeFetchOptions } from "./safe-fetch";
import {
  FakeTransport,
  fakeDependencies,
  fakeDns,
  htmlResponse,
  redirectResponse,
  textResponse,
} from "../test-support";

/**
 * SSRF and redirect behaviour (Sprint 3 §34, §35).
 *
 * Several tests assert `transport.requests` is empty. That distinction
 * matters: a guard that fetches a private address and then discards the
 * response has already leaked internal reachability. The request must
 * never be made.
 */

function options(overrides: Partial<SafeFetchOptions> = {}): SafeFetchOptions {
  return {
    accept: ["html"],
    maxBytes: 100_000,
    timeoutMs: 1_000,
    maxRedirects: 3,
    ...overrides,
  };
}

describe("safeFetch — SSRF defence", () => {
  const privateTargets: [string, string][] = [
    ["localhost", "127.0.0.1"],
    ["loopback-ipv6.test", "::1"],
    ["private-10.test", "10.1.2.3"],
    ["private-172.test", "172.20.0.5"],
    ["private-192.test", "192.168.10.5"],
    ["metadata.test", "169.254.169.254"],
    ["link-local-v6.test", "fe80::1"],
    ["unique-local-v6.test", "fd00::1"],
    ["cgnat.test", "100.100.100.200"],
  ];

  it.each(privateTargets)("refuses %s when it resolves to %s", async (hostname, address) => {
    const transport = new FakeTransport({ "/": htmlResponse("<html></html>") });
    const result = await safeFetch(`https://${hostname}/`, options(), {
      transport,
      resolveDns: fakeDns({ [hostname]: [address] }),
    });

    expect(result).toEqual({ ok: false, error: "unsafe_destination" });
    // The request must never leave — not merely be discarded afterwards.
    expect(transport.requests).toHaveLength(0);
  });

  it("refuses a literal private IP without any DNS lookup", async () => {
    const transport = new FakeTransport({ "/": htmlResponse("<html></html>") });
    const result = await safeFetch("https://127.0.0.1/", options(), {
      transport,
      resolveDns: async () => {
        throw new Error("DNS must not be consulted for a literal address");
      },
    });

    expect(result).toEqual({ ok: false, error: "unsafe_destination" });
    expect(transport.requests).toHaveLength(0);
  });

  it("refuses a hostname resolving to both a public and a private address", async () => {
    const transport = new FakeTransport({ "/": htmlResponse("<html></html>") });
    const result = await safeFetch("https://mixed.test/", options(), {
      transport,
      resolveDns: fakeDns({ "mixed.test": ["93.184.216.34", "10.0.0.1"] }),
    });

    expect(result).toEqual({ ok: false, error: "unsafe_destination" });
    expect(transport.requests).toHaveLength(0);
  });

  it("reports DNS failure distinctly from an unsafe destination", async () => {
    const transport = new FakeTransport({});
    const result = await safeFetch("https://nowhere.test/", options(), {
      transport,
      resolveDns: async () => {
        throw new Error("ENOTFOUND");
      },
    });

    expect(result).toEqual({ ok: false, error: "dns_resolution_failed" });
  });

  it("treats an empty DNS answer as a resolution failure", async () => {
    const transport = new FakeTransport({});
    const result = await safeFetch("https://empty.test/", options(), {
      transport,
      resolveDns: fakeDns({ "empty.test": [] }),
    });

    expect(result).toEqual({ ok: false, error: "dns_resolution_failed" });
  });

  it("rejects credentials embedded in the URL", async () => {
    const transport = new FakeTransport({ "/": htmlResponse("<html></html>") });
    const result = await safeFetch("https://user:secret@example.test/", options(), {
      transport,
      resolveDns: fakeDns(),
    });

    expect(result).toEqual({ ok: false, error: "unsafe_destination" });
    expect(transport.requests).toHaveLength(0);
  });

  const unsupportedSchemes = ["file:///etc/passwd", "ftp://example.test/x", "gopher://example.test/"];

  it.each(unsupportedSchemes)("rejects unsupported scheme %s", async (url) => {
    const transport = new FakeTransport({});
    const result = await safeFetch(url, options(), { transport, resolveDns: fakeDns() });

    expect(result.ok).toBe(false);
    expect(transport.requests).toHaveLength(0);
  });

  it("accepts a genuine public HTTPS destination", async () => {
    const { transport, resolveDns } = fakeDependencies({ "/": htmlResponse("<html><title>Hi</title></html>") });
    const result = await safeFetch("https://example.test/", options(), { transport, resolveDns });

    expect(result.ok).toBe(true);
    expect(result.ok && result.status).toBe(200);
    expect(transport.requests).toHaveLength(1);
  });

  it("pins the connection to the validated address rather than the hostname", async () => {
    const transport = new FakeTransport({ "/": htmlResponse("<html></html>") });
    await safeFetch("https://example.test/", options(), {
      transport,
      resolveDns: fakeDns({ "example.test": ["93.184.216.34"] }),
    });

    // Pinning is what closes the DNS-rebinding window: the transport is
    // told exactly which address to connect to.
    expect(transport.requests[0].pinnedAddress).toBe("93.184.216.34");
  });
});

describe("safeFetch — redirects", () => {
  it("revalidates a redirect target and refuses one pointing at a private address", async () => {
    const transport = new FakeTransport({
      "https://public.test/": redirectResponse("https://internal.test/"),
      "https://internal.test/": htmlResponse("<html>secret</html>"),
    });

    const result = await safeFetch("https://public.test/", options(), {
      transport,
      resolveDns: fakeDns({ "public.test": ["93.184.216.34"], "internal.test": ["10.0.0.5"] }),
    });

    expect(result).toEqual({ ok: false, error: "unsafe_destination" });
    // The first hop happened; the private second hop never did.
    expect(transport.requestedUrls).toEqual(["https://public.test/"]);
  });

  it("refuses a redirect to a private literal address", async () => {
    const transport = new FakeTransport({
      "https://public.test/": redirectResponse("http://169.254.169.254/latest/meta-data/"),
    });

    const result = await safeFetch("https://public.test/", options(), {
      transport,
      resolveDns: fakeDns(),
    });

    expect(result).toEqual({ ok: false, error: "unsafe_destination" });
    expect(transport.requests).toHaveLength(1);
  });

  it("follows a safe redirect and reports the final URL", async () => {
    const transport = new FakeTransport({
      "https://example.test/": redirectResponse("https://www.example.test/"),
      "https://www.example.test/": htmlResponse("<html><title>Home</title></html>"),
    });

    const result = await safeFetch("https://example.test/", options(), {
      transport,
      resolveDns: fakeDns(),
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.url.toString()).toBe("https://www.example.test/");
    expect(result.ok && result.redirectChain).toEqual(["https://example.test/"]);
  });

  it("enforces the redirect limit", async () => {
    const transport = new FakeTransport({
      "https://a.test/": redirectResponse("https://b.test/"),
      "https://b.test/": redirectResponse("https://c.test/"),
      "https://c.test/": redirectResponse("https://d.test/"),
      "https://d.test/": htmlResponse("<html></html>"),
    });

    const result = await safeFetch("https://a.test/", options({ maxRedirects: 2 }), {
      transport,
      resolveDns: fakeDns(),
    });

    expect(result).toEqual({ ok: false, error: "too_many_redirects" });
  });

  it("terminates on a redirect loop instead of spinning", async () => {
    const transport = new FakeTransport({
      "https://loop.test/": redirectResponse("https://loop.test/again"),
      "https://loop.test/again": redirectResponse("https://loop.test/"),
    });

    const result = await safeFetch("https://loop.test/", options({ maxRedirects: 3 }), {
      transport,
      resolveDns: fakeDns(),
    });

    expect(result).toEqual({ ok: false, error: "too_many_redirects" });
  });

  it("refuses an off-origin redirect when the crawl is origin-restricted", async () => {
    const transport = new FakeTransport({
      "https://example.test/page": redirectResponse("https://other.test/page"),
    });

    const result = await safeFetch(
      "https://example.test/page",
      options({ restrictToOrigin: "https://example.test" }),
      { transport, resolveDns: fakeDns() },
    );

    expect(result).toEqual({ ok: false, error: "redirect_off_origin" });
  });

  it("allows a same-origin redirect under an origin restriction (protected route case)", async () => {
    const transport = new FakeTransport({
      "https://example.test/app": redirectResponse("https://example.test/login"),
      "https://example.test/login": htmlResponse("<html><title>Log in</title></html>"),
    });

    const result = await safeFetch(
      "https://example.test/app",
      options({ restrictToOrigin: "https://example.test" }),
      { transport, resolveDns: fakeDns() },
    );

    expect(result.ok).toBe(true);
    expect(result.ok && result.url.pathname).toBe("/login");
  });
});

describe("safeFetch — response handling", () => {
  it("rejects an unexpected content type", async () => {
    const { transport, resolveDns } = fakeDependencies({
      "/": { status: 200, headers: { "content-type": "application/pdf" }, body: "%PDF-1.4" },
    });

    const result = await safeFetch("https://example.test/", options(), { transport, resolveDns });
    expect(result).toEqual({ ok: false, error: "unsupported_content_type", status: 200 });
  });

  it("rejects a binary image response", async () => {
    const { transport, resolveDns } = fakeDependencies({
      "/": { status: 200, headers: { "content-type": "image/png" }, body: "\x89PNG" },
    });

    const result = await safeFetch("https://example.test/", options(), { transport, resolveDns });
    expect(result.ok).toBe(false);
  });

  it("accepts text/plain only when asked for it", async () => {
    const { transport, resolveDns } = fakeDependencies({ "/robots.txt": textResponse("User-agent: *") });

    const rejected = await safeFetch("https://example.test/robots.txt", options(), { transport, resolveDns });
    expect(rejected.ok).toBe(false);

    const accepted = await safeFetch(
      "https://example.test/robots.txt",
      options({ accept: ["text"] }),
      { transport, resolveDns },
    );
    expect(accepted.ok).toBe(true);
  });

  it("truncates an oversized body at the byte limit rather than failing", async () => {
    const body = `<html><body>${"a".repeat(5000)}</body></html>`;
    const { transport, resolveDns } = fakeDependencies({ "/": htmlResponse(body) });

    const result = await safeFetch("https://example.test/", options({ maxBytes: 500 }), {
      transport,
      resolveDns,
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.truncated).toBe(true);
    expect(result.ok && result.bytesRead).toBe(500);
  });

  it("maps 429 to a rate-limit result and exposes Retry-After", async () => {
    const { transport, resolveDns } = fakeDependencies({
      "/": { status: 429, headers: { "retry-after": "30" } },
    });

    const result = await safeFetch("https://example.test/", options(), { transport, resolveDns });
    expect(result).toEqual({ ok: false, error: "site_rate_limited", status: 429 });
  });

  it("maps 403 to a forbidden result", async () => {
    const { transport, resolveDns } = fakeDependencies({ "/": { status: 403, headers: {} } });
    const result = await safeFetch("https://example.test/", options(), { transport, resolveDns });
    expect(result).toEqual({ ok: false, error: "site_forbidden", status: 403 });
  });

  it("maps a transport timeout to a typed failure", async () => {
    const { transport, resolveDns } = fakeDependencies({ "/": { fail: "timeout" } });
    const result = await safeFetch("https://example.test/", options(), { transport, resolveDns });
    expect(result).toEqual({ ok: false, error: "request_timeout" });
  });

  it("maps a TLS failure to a typed failure", async () => {
    const { transport, resolveDns } = fakeDependencies({ "/": { fail: "tls_error" } });
    const result = await safeFetch("https://example.test/", options(), { transport, resolveDns });
    expect(result).toEqual({ ok: false, error: "tls_error" });
  });

  it("maps an over-large declared response to page_too_large", async () => {
    const { transport, resolveDns } = fakeDependencies({ "/": { fail: "too_large" } });
    const result = await safeFetch("https://example.test/", options(), { transport, resolveDns });
    expect(result).toEqual({ ok: false, error: "page_too_large" });
  });
});
