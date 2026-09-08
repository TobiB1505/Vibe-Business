import { describe, expect, it } from "vitest";

import { findSignInTarget } from "./sign-in-target";
import type { LiveProductIntelligenceSnapshot } from "@/modules/live-product-intelligence/schema";

/**
 * Where a founder's temporary browser opens.
 *
 * The reason this is a module with its own tests, rather than a line in
 * `startDeepScan`, is that it navigates a real browser to a path taken from
 * the customer's own website. Everything below is either "does it find the
 * page" or "does it refuse", and the refusals are the half that matters.
 */

const ORIGIN = "https://app.example.com";

function publicProduct(
  options: {
    pages?: { path: string; redirectedTo: string | null }[];
    surfaces?: { id: string; detected: boolean; path?: string }[];
    forms?: { kind: string; path: string }[];
  } = {},
): LiveProductIntelligenceSnapshot {
  return {
    pages: (options.pages ?? []).map((page) => ({ ...page, status: 200 })),
    productSurfaces: (options.surfaces ?? []).map((surface) => ({
      id: surface.id,
      name: surface.id,
      detected: surface.detected,
      confidence: "medium",
      evidence: [{ kind: "url_path", path: surface.path ?? "/login" }],
    })),
    conversionSignals: { forms: options.forms ?? [] },
  } as unknown as LiveProductIntelligenceSnapshot;
}

describe("findSignInTarget — what it finds", () => {
  it("takes the page a protected path redirected to", () => {
    const target = findSignInTarget({
      origin: ORIGIN,
      publicProduct: publicProduct({ pages: [{ path: "/app", redirectedTo: "/login" }] }),
    });

    // The product's own answer to "where do I sign in", stated by its server.
    expect(target).toEqual({ path: "/login", reason: "protected_redirect" });
  });

  it("takes a page carrying a login-shaped form", () => {
    const target = findSignInTarget({
      origin: ORIGIN,
      publicProduct: publicProduct({ forms: [{ kind: "login_like", path: "/sign-in" }] }),
    });

    expect(target).toEqual({ path: "/sign-in", reason: "login_form" });
  });

  it("falls back to a recognised login surface", () => {
    const target = findSignInTarget({
      origin: ORIGIN,
      publicProduct: publicProduct({
        surfaces: [{ id: "login", detected: true, path: "/account/login" }],
      }),
    });

    expect(target).toEqual({ path: "/account/login", reason: "login_surface" });
  });

  it("prefers the redirect over a form, because a server outranks a guess", () => {
    const target = findSignInTarget({
      origin: ORIGIN,
      publicProduct: publicProduct({
        pages: [{ path: "/app", redirectedTo: "/login" }],
        forms: [{ kind: "login_like", path: "/anmelden" }],
      }),
    });

    expect(target?.reason).toBe("protected_redirect");
  });

  it("strips a query string rather than carrying it into a navigation", () => {
    const target = findSignInTarget({
      origin: ORIGIN,
      // `?next=` and `?token=` are routine on a login redirect, and a token in
      // a browser Vibe opened is a token in Vibe's logs.
      publicProduct: publicProduct({
        pages: [{ path: "/app", redirectedTo: "/login?next=/app&token=abc" }],
      }),
    });

    expect(target?.path).toBe("/login");
  });
});

describe("findSignInTarget — what it refuses", () => {
  it("lands nowhere when there is no public scan", () => {
    expect(findSignInTarget({ origin: ORIGIN, publicProduct: null })).toBeNull();
  });

  it("refuses a signup page", () => {
    const target = findSignInTarget({
      origin: ORIGIN,
      // A registration form is not a way in for somebody who has an account,
      // and landing them on one is worse than landing them on the homepage.
      publicProduct: publicProduct({
        pages: [{ path: "/app", redirectedTo: "/signup" }],
        surfaces: [{ id: "signup", detected: true, path: "/signup" }],
      }),
    });

    expect(target).toBeNull();
  });

  it("refuses password reset and verification", () => {
    for (const path of ["/reset-password", "/forgot", "/verify", "/mfa"]) {
      const target = findSignInTarget({
        origin: ORIGIN,
        publicProduct: publicProduct({ pages: [{ path: "/app", redirectedTo: path }] }),
      });
      expect(target, path).toBeNull();
    }
  });

  it("refuses anything that ends a session or changes state", () => {
    for (const path of ["/logout", "/sign-out", "/login/delete", "/login/checkout"]) {
      const target = findSignInTarget({
        origin: ORIGIN,
        publicProduct: publicProduct({ forms: [{ kind: "login_like", path }] }),
      });
      expect(target, path).toBeNull();
    }
  });

  it("refuses another origin, however login-shaped it looks", () => {
    const target = findSignInTarget({
      origin: ORIGIN,
      // A hosted identity provider is a real pattern, and it is still not a
      // page Vibe opens a browser on: the founder signs in wherever their
      // product sends them, from a page on their product.
      publicProduct: publicProduct({
        pages: [{ path: "/app", redirectedTo: "https://accounts.google.com/login" }],
      }),
    });

    expect(target).toBeNull();
  });

  it("refuses plain http", () => {
    const target = findSignInTarget({
      origin: ORIGIN,
      publicProduct: publicProduct({
        pages: [{ path: "/app", redirectedTo: "http://app.example.com/login" }],
      }),
    });

    expect(target).toBeNull();
  });

  it("ignores a signup-shaped form even on a login-shaped path", () => {
    const target = findSignInTarget({
      origin: ORIGIN,
      publicProduct: publicProduct({ forms: [{ kind: "signup_like", path: "/login" }] }),
    });

    expect(target).toBeNull();
  });

  it("ignores a surface the public scan did not actually detect", () => {
    const target = findSignInTarget({
      origin: ORIGIN,
      publicProduct: publicProduct({ surfaces: [{ id: "login", detected: false }] }),
    });

    expect(target).toBeNull();
  });
});
