import { describe, expect, it } from "vitest";
import {
  DEFAULT_POST_AUTH_PATH,
  internalRedirect,
  loginPathWithNext,
  sanitizeNextPath,
} from "./redirects";

/**
 * The open-redirect surface, exercised as one table.
 *
 * The point of these cases is not that each individual string is dangerous —
 * it is that the fallback is what happens to *anything* that cannot prove it
 * is an internal path. So the rejection table deliberately mixes known attack
 * shapes with malformed junk: both must produce `/app`, and neither may throw.
 */

describe("sanitizeNextPath", () => {
  describe("accepts internal workspace paths", () => {
    it.each([
      ["/app", "/app"],
      ["/app/", "/app/"],
      ["/app/example", "/app/example"],
      ["/app/action-plan/123", "/app/action-plan/123"],
      ["/app/projects/abc/moves", "/app/projects/abc/moves"],
      ["/app/projects/1?tab=score", "/app/projects/1?tab=score"],
    ])("keeps %s", (input, expected) => {
      expect(sanitizeNextPath(input)).toBe(expected);
    });

    it("drops a fragment, which never reaches the server anyway", () => {
      expect(sanitizeNextPath("/app/projects/1#section")).toBe("/app/projects/1");
    });
  });

  describe("rejects anything that leaves this origin", () => {
    it.each([
      // Absolute URLs.
      "https://evil.com",
      "http://evil.com",
      "https://evil.com/app",
      "HTTPS://EVIL.COM",
      // Protocol-relative.
      "//evil.com",
      "//evil.com/app",
      "///evil.com",
      // Backslash variants, which browsers fold to "/".
      "\\evil.com",
      "\\\\evil.com",
      "/\\evil.com",
      "/\\/evil.com",
      // Dangerous schemes.
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      // Scheme-ish shapes that some parsers normalise onto another origin.
      "https:/evil.com",
      "https:evil.com",
    ])("rejects %s", (input) => {
      expect(sanitizeNextPath(input)).toBe(DEFAULT_POST_AUTH_PATH);
    });
  });

  describe("rejects encoded and control-character bypasses", () => {
    it.each([
      "%2f%2fevil.com",
      "/%2f%2fevil.com",
      "%2F%2Fevil.com",
      "%5Cevil.com",
      "/%5Cevil.com",
      // Double-encoded: only visible once decoding converges.
      "%252f%252fevil.com",
      "%68ttps://evil.com",
      // Malformed escapes are rejected, not repaired.
      "/app/%zz",
      "/app/%",
      // Whitespace and control characters that truncate differently per parser.
      "/app\nnext",
      "/app\r\nLocation: https://evil.com",
      "/app\tnext",
      " //evil.com",
      "java\nscript:alert(1)",
    ])("rejects %j", (input) => {
      expect(sanitizeNextPath(input)).toBe(DEFAULT_POST_AUTH_PATH);
    });

    it("rejects a NUL-truncated path", () => {
      expect(sanitizeNextPath("/app\u0000/../../evil")).toBe(DEFAULT_POST_AUTH_PATH);
    });
  });

  describe("rejects internal paths outside the allowlist", () => {
    it.each([
      "/",
      "/login",
      "/signup",
      "/auth/callback",
      "/application",
      "/appfoo",
      "/apps/x",
      "/api/internal",
    ])("rejects %s", (input) => {
      expect(sanitizeNextPath(input)).toBe(DEFAULT_POST_AUTH_PATH);
    });

    it("rejects a traversal that escapes /app", () => {
      // `new URL` normalises this to "/", which is not in the allowlist.
      expect(sanitizeNextPath("/app/../login")).toBe(DEFAULT_POST_AUTH_PATH);
    });
  });

  describe("falls back for absent or empty input", () => {
    it.each([[null], [undefined], [""], ["   "]])("falls back for %j", (input) => {
      expect(sanitizeNextPath(input as string | null | undefined)).toBe(
        DEFAULT_POST_AUTH_PATH,
      );
    });

    it("falls back for a non-string value crossing an untyped boundary", () => {
      expect(sanitizeNextPath(42 as unknown as string)).toBe(DEFAULT_POST_AUTH_PATH);
      expect(sanitizeNextPath({} as unknown as string)).toBe(DEFAULT_POST_AUTH_PATH);
    });
  });

  it("never throws, whatever it is handed", () => {
    const hostile = [
      "%",
      "%%%%",
      "/app/".repeat(5000),
      "%25".repeat(500),
      "/app?" + "a=1&".repeat(2000),
    ];
    for (const input of hostile) {
      expect(() => sanitizeNextPath(input)).not.toThrow();
    }
  });

  it("never returns a value that could leave the origin", () => {
    const inputs = [
      "https://evil.com",
      "//evil.com",
      "/app/ok",
      "/app",
      "%2f%2fevil.com",
      "/login",
    ];
    for (const input of inputs) {
      const result = sanitizeNextPath(input);
      expect(result.startsWith("/")).toBe(true);
      expect(result.startsWith("//")).toBe(false);
      expect(result.includes("\\")).toBe(false);
      expect(new URL(result, "https://vibe.test").origin).toBe("https://vibe.test");
    }
  });
});

describe("loginPathWithNext", () => {
  it("carries a safe requested path through as an encoded parameter", () => {
    expect(loginPathWithNext("/app/action-plan/123")).toBe(
      "/login?next=%2Fapp%2Faction-plan%2F123",
    );
  });

  it("omits next when the destination is just the default", () => {
    expect(loginPathWithNext("/app")).toBe("/login");
  });

  it("never echoes a hostile requested path back into the link", () => {
    expect(loginPathWithNext("https://evil.com")).toBe("/login");
    expect(loginPathWithNext("//evil.com")).toBe("/login");
    expect(loginPathWithNext("/app/../../evil")).toBe("/login");
  });

  it("encodes a query string so it cannot break out of the parameter", () => {
    const result = loginPathWithNext("/app/projects/1?tab=score&x=1");
    expect(result).toBe("/login?next=%2Fapp%2Fprojects%2F1%3Ftab%3Dscore%26x%3D1");
    // Round-trips back to exactly the requested path.
    const next = new URL(result, "https://vibe.test").searchParams.get("next");
    expect(next).toBe("/app/projects/1?tab=score&x=1");
  });
});

describe("internalRedirect", () => {
  it("emits a relative Location, never an absolute URL", () => {
    for (const path of ["/app", "/login?error=oauth_failed", "/forgot-password?error=expired_link"]) {
      const response = internalRedirect(path);
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(path);
    }
  });

  /**
   * The structural guarantee: because the header is a path, no host-resolution
   * mistake and no forwarded-header spoof can turn one of our redirects into a
   * redirect to somebody else's site.
   */
  it("cannot express another origin at all", () => {
    const location = internalRedirect(sanitizeNextPath("https://evil.com")).headers.get(
      "location",
    );
    expect(location).toBe("/app");
    expect(location?.startsWith("/")).toBe(true);
    expect(location?.startsWith("//")).toBe(false);
  });
});
