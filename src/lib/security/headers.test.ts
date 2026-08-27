import { describe, expect, it } from "vitest";
import { buildContentSecurityPolicy, cspSourcesFromEnv, securityHeaders } from "./headers";

/**
 * VB-005 — the response header set.
 *
 * The live check the audit asks for (`curl -sI` against a running build) was
 * run and is what proved the headers actually reach a response; these pin the
 * decisions inside the policy so a later edit cannot quietly undo one.
 *
 * The two that matter most are the negatives: a missing environment variable
 * must **narrow** the policy rather than widen it, and the report-only header
 * must stay report-only until someone deliberately enforces it.
 */

const SOURCES = {
  supabaseOrigin: "https://project.supabase.co",
  sentryOrigin: "https://o1.ingest.sentry.io",
};

function directive(csp: string, name: string): string {
  const found = csp.split("; ").find((part) => part.startsWith(`${name} `));
  if (!found) throw new Error(`no ${name} directive in: ${csp}`);
  return found;
}

describe("the environment-derived origins", () => {
  it("takes the origin only, never the path or the DSN's credentials", () => {
    const sources = cspSourcesFromEnv({
      NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co/rest/v1",
      NEXT_PUBLIC_SENTRY_DSN: "https://publickey@o12345.ingest.sentry.io/999",
    });

    expect(sources.supabaseOrigin).toBe("https://project.supabase.co");
    expect(sources.sentryOrigin).toBe("https://o12345.ingest.sentry.io");
  });

  /**
   * The failure mode worth designing against: an unset or malformed variable
   * producing `connect-src ... undefined` or, worse, a wildcard. Absence has to
   * make the policy stricter.
   */
  it("omits an origin it cannot parse rather than widening the policy", () => {
    const sources = cspSourcesFromEnv({ NEXT_PUBLIC_SENTRY_DSN: "not-a-url" });
    expect(sources).toEqual({ supabaseOrigin: null, sentryOrigin: null });

    const csp = buildContentSecurityPolicy(sources);
    expect(directive(csp, "connect-src")).toBe("connect-src 'self' https://va.vercel-scripts.com");
    expect(csp).not.toContain("undefined");
    expect(csp).not.toContain("*");
  });
});

describe("the policy", () => {
  it("allows exactly the origins the application loads", () => {
    const csp = buildContentSecurityPolicy(SOURCES);

    expect(directive(csp, "script-src")).toContain("https://connect.facebook.net");
    expect(directive(csp, "script-src")).toContain("https://va.vercel-scripts.com");
    expect(directive(csp, "connect-src")).toContain(SOURCES.supabaseOrigin);
    expect(directive(csp, "connect-src")).toContain(SOURCES.sentryOrigin);
  });

  it("refuses framing, plugins, and a rewritten base URI", () => {
    const csp = buildContentSecurityPolicy(SOURCES);

    expect(directive(csp, "frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(directive(csp, "object-src")).toBe("object-src 'none'");
    expect(directive(csp, "base-uri")).toBe("base-uri 'self'");
    expect(directive(csp, "form-action")).toBe("form-action 'self'");
  });

  /**
   * Both weak points, pinned deliberately rather than left implicit. If either
   * is ever tightened these tests should fail and be updated — the point is
   * that the change is visible, not that the current value is right forever.
   */
  it("records the two deliberate weakenings", () => {
    const csp = buildContentSecurityPolicy(SOURCES);

    // Next injects inline bootstrap and RSC payload scripts; nonces deferred.
    expect(directive(csp, "script-src")).toContain("'unsafe-inline'");
    // Customer brand logos are plain <img> at arbitrary customer URLs.
    expect(directive(csp, "img-src")).toContain("https:");
  });
});

describe("the header set", () => {
  it("ships the CSP report-only, and nothing enforces it yet", () => {
    const keys = securityHeaders(SOURCES).map((header) => header.key);

    expect(keys).toContain("Content-Security-Policy-Report-Only");
    expect(keys).not.toContain("Content-Security-Policy");
  });

  it("carries every header the finding named", () => {
    const keys = securityHeaders(SOURCES).map((header) => header.key);

    for (const key of [
      "Strict-Transport-Security",
      "X-Content-Type-Options",
      "X-Frame-Options",
      "Referrer-Policy",
      "Permissions-Policy",
    ]) {
      expect(keys).toContain(key);
    }
  });

  /**
   * HSTS preload is a one-way door enforced by browser vendors: removal takes
   * months. It should be chosen once every subdomain is known HTTPS-only, not
   * inherited from the change that first turned headers on.
   */
  it("does not opt into HSTS preload", () => {
    const hsts = securityHeaders(SOURCES).find((h) => h.key === "Strict-Transport-Security");
    expect(hsts?.value).not.toContain("preload");
  });
});
