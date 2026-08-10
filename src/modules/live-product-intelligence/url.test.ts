import { describe, expect, it } from "vitest";
import {
  isTrackingParameter,
  looksLikeNonPageAsset,
  normalizePathname,
  normalizeProductionUrl,
  resolveLink,
} from "./url";

describe("normalizeProductionUrl", () => {
  it("accepts a plain HTTPS URL and normalizes it", () => {
    const result = normalizeProductionUrl("https://Example.COM/");
    expect(result).toEqual({ ok: true, url: "https://example.com/", origin: "https://example.com", hostname: "example.com" });
  });

  it("adds the required scheme to a bare domain rather than guessing a weaker one", () => {
    const result = normalizeProductionUrl("example.com");
    expect(result.ok && result.url).toBe("https://example.com/");
  });

  it("strips the fragment", () => {
    const result = normalizeProductionUrl("https://example.com/pricing#plans");
    expect(result.ok && result.url).toBe("https://example.com/pricing");
  });

  it("strips the query string, which may carry tokens or emails", () => {
    const result = normalizeProductionUrl("https://example.com/?token=secret&email=a@b.c");
    expect(result.ok && result.url).toBe("https://example.com/");
  });

  it("normalizes a trailing slash on a subpath", () => {
    expect(normalizeProductionUrl("https://example.com/app/").ok && normalizeProductionUrl("https://example.com/app/")).toMatchObject({
      url: "https://example.com/app",
    });
  });

  it("normalizes a trailing dot on the hostname", () => {
    const result = normalizeProductionUrl("https://example.com./");
    expect(result.ok && result.hostname).toBe("example.com");
  });

  it("rejects plain HTTP rather than silently upgrading it", () => {
    expect(normalizeProductionUrl("http://example.com")).toEqual({ ok: false, reason: "insecure_scheme" });
  });

  const unsupported = [
    "file:///etc/passwd",
    "ftp://example.com",
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "ws://example.com",
    "gopher://example.com",
  ];

  it.each(unsupported)("rejects unsupported scheme: %s", (input) => {
    const result = normalizeProductionUrl(input);
    expect(result.ok).toBe(false);
  });

  it("rejects credentials in the URL", () => {
    expect(normalizeProductionUrl("https://user:pass@example.com")).toEqual({
      ok: false,
      reason: "credentials_present",
    });
  });

  const internal = ["https://localhost", "https://foo.local", "https://db.internal", "https://intranet", "https://x.home.arpa"];

  it.each(internal)("rejects internal hostname %s", (input) => {
    expect(normalizeProductionUrl(input)).toEqual({ ok: false, reason: "internal_hostname" });
  });

  it("rejects a single-label hostname that can only resolve internally", () => {
    expect(normalizeProductionUrl("https://metadata")).toEqual({ ok: false, reason: "internal_hostname" });
  });

  it("rejects a literal private address immediately, without waiting for DNS", () => {
    expect(normalizeProductionUrl("https://127.0.0.1")).toEqual({ ok: false, reason: "unsafe_address" });
    expect(normalizeProductionUrl("https://169.254.169.254")).toEqual({ ok: false, reason: "unsafe_address" });
    expect(normalizeProductionUrl("https://[::1]")).toEqual({ ok: false, reason: "unsafe_address" });
  });

  it("does not mistake a public hostname that merely looks internal", () => {
    expect(normalizeProductionUrl("https://notlocalhost.com").ok).toBe(true);
    expect(normalizeProductionUrl("https://mylocal.dev").ok).toBe(true);
  });

  it("rejects empty and absurdly long input", () => {
    expect(normalizeProductionUrl("   ")).toEqual({ ok: false, reason: "empty" });
    expect(normalizeProductionUrl(`https://example.com/${"a".repeat(3000)}`)).toEqual({
      ok: false,
      reason: "malformed",
    });
  });
});

describe("normalizePathname", () => {
  it("collapses duplicate slashes and drops a trailing slash", () => {
    expect(normalizePathname("//pricing//")).toBe("/pricing");
    expect(normalizePathname("/pricing/")).toBe("/pricing");
    expect(normalizePathname("/")).toBe("/");
    expect(normalizePathname("")).toBe("/");
  });
});

describe("resolveLink", () => {
  const base = new URL("https://example.com/");

  it("resolves a relative link against its page", () => {
    const result = resolveLink("/pricing", base);
    expect(result.ok && result.url.toString()).toBe("https://example.com/pricing");
    expect(result.ok && result.sameOrigin).toBe(true);
  });

  it("marks an external domain as not same-origin", () => {
    const result = resolveLink("https://other.com/page", base);
    expect(result.ok && result.sameOrigin).toBe(false);
  });

  const nonNavigational = ["mailto:a@b.com", "tel:+123", "javascript:alert(1)", "data:text/html,x", "#section"];

  it.each(nonNavigational)("refuses non-navigational href %s", (href) => {
    expect(resolveLink(href, base).ok).toBe(false);
  });

  it("refuses asset links", () => {
    expect(resolveLink("/logo.png", base).ok).toBe(false);
    expect(resolveLink("/report.pdf", base).ok).toBe(false);
    expect(resolveLink("/bundle.js", base).ok).toBe(false);
  });

  it("collapses query-string variants onto one crawl key", () => {
    const a = resolveLink("/blog?utm_source=x", base);
    const b = resolveLink("/blog?page=2", base);
    const c = resolveLink("/blog/", base);

    expect(a.ok && a.key).toBe("https://example.com/blog");
    expect(b.ok && b.key).toBe("https://example.com/blog");
    expect(c.ok && c.key).toBe("https://example.com/blog");
  });

  it("strips tracking parameters from the URL that would be requested", () => {
    const result = resolveLink("/pricing?utm_source=news&plan=pro&fbclid=abc", base);
    expect(result.ok && result.url.search).toBe("?plan=pro");
  });

  it("refuses credentials smuggled into a link", () => {
    expect(resolveLink("https://user:pass@example.com/x", base)).toEqual({
      ok: false,
      reason: "credentials_present",
    });
  });
});

describe("tracking parameters and assets", () => {
  it("recognises common tracking parameters", () => {
    for (const name of ["utm_source", "utm_campaign", "gclid", "fbclid", "mc_eid"]) {
      expect(isTrackingParameter(name)).toBe(true);
    }
    expect(isTrackingParameter("plan")).toBe(false);
    expect(isTrackingParameter("page")).toBe(false);
  });

  it("recognises non-page assets", () => {
    expect(looksLikeNonPageAsset("/a.png")).toBe(true);
    expect(looksLikeNonPageAsset("/a.PDF")).toBe(true);
    expect(looksLikeNonPageAsset("/pricing")).toBe(false);
  });
});
