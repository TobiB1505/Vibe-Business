import { describe, expect, it } from "vitest";
import { fakeRoute } from "../test-support";
import { classifyRouteForSitemap, selectSitemapRoutes } from "./route-classification";

/**
 * Sitemap route selection (Sprint 9 post-dogfood §3, §4, §11).
 *
 * The first real execution published `/login` and `/signup` in a sitemap. No
 * safety invariant failed — the write was exactly what was intended — but the
 * intent was wrong. These tests pin the corrected intent.
 *
 * Almost every case is an exclusion, for the same reason the preflight tests
 * are almost all refusals: the conservative default is only proven by the
 * routes it keeps out.
 */

function indexable(path: string, overrides: Parameters<typeof fakeRoute>[1] = {}): boolean {
  return classifyRouteForSitemap(fakeRoute(path, overrides)).indexable;
}

describe("route classification — what gets published (§11)", () => {
  it("includes the site root", () => {
    expect(indexable("/")).toBe(true);
  });

  it("includes a real public marketing route", () => {
    expect(indexable("/pricing")).toBe(true);
    expect(indexable("/blog")).toBe(true);
    expect(indexable("/about")).toBe(true);
  });
});

describe("route classification — authentication surfaces (§3, §5)", () => {
  it.each([
    "/login",
    "/logout",
    "/signin",
    "/sign-in",
    "/signup",
    "/sign-up",
    "/register",
    "/forgot-password",
    "/reset-password",
  ])("excludes %s", (path) => {
    expect(classifyRouteForSitemap(fakeRoute(path))).toEqual({
      indexable: false,
      reason: "authentication_surface",
    });
  });

  it("excludes signup as deliberate V0.1 policy, not as an SEO law (§5)", () => {
    // A signup page can legitimately be indexed. Vibe does not yet hold the
    // business context needed to make that call, so it declines to make it.
    // Documented as policy so a future capability can revisit it knowingly.
    expect(indexable("/signup")).toBe(false);
  });

  it("excludes everything under an auth prefix, not just its root", () => {
    expect(indexable("/auth/callback")).toBe(false);
    expect(indexable("/login/sso")).toBe(false);
  });
});

describe("route classification — application and API surfaces (§3)", () => {
  it("excludes the signed-in application", () => {
    expect(classifyRouteForSitemap(fakeRoute("/app"))).toEqual({
      indexable: false,
      reason: "application_surface",
    });
  });

  it("excludes a deep application route", () => {
    // First-segment matching means a rule covers a subtree it has never seen.
    expect(indexable("/app/projects/123")).toBe(false);
  });

  it("excludes API routes", () => {
    expect(classifyRouteForSitemap(fakeRoute("/api/foo", { kind: "api" }))).toEqual({
      indexable: false,
      reason: "api_surface",
    });
    expect(indexable("/api")).toBe(false);
  });

  it("excludes administrative and account surfaces", () => {
    expect(classifyRouteForSitemap(fakeRoute("/admin"))).toEqual({
      indexable: false,
      reason: "administrative_surface",
    });
    expect(indexable("/admin/users")).toBe(false);
    expect(indexable("/settings")).toBe(false);
    expect(indexable("/billing")).toBe(false);
  });
});

describe("route classification — uncertainty resolves to omission (§4)", () => {
  it("excludes a dynamic route", () => {
    // `/blog/[slug]` is a template. Turning it into URLs needs the customer's
    // data, which this capability does not read.
    expect(classifyRouteForSitemap(fakeRoute("/blog/[slug]", { dynamic: true }))).toEqual({
      indexable: false,
      reason: "dynamic_route",
    });
  });

  it("excludes layouts", () => {
    expect(classifyRouteForSitemap(fakeRoute("/pricing", { kind: "layout" }))).toEqual({
      indexable: false,
      reason: "not_a_page",
    });
  });

  it("reports the surface reason before the kind reason", () => {
    // `/api/webhook` is an API surface. Saying "not a page" would be true and
    // useless.
    expect(classifyRouteForSitemap(fakeRoute("/api/webhook", { kind: "api" })).indexable).toBe(false);
  });
});

describe("selectSitemapRoutes", () => {
  it("keeps only public pages, deduplicated and ordered", () => {
    const selected = selectSitemapRoutes([
      fakeRoute("/pricing"),
      fakeRoute("/login"),
      fakeRoute("/about"),
      fakeRoute("/pricing"),
      fakeRoute("/app/projects/[projectId]", { dynamic: true }),
    ]);

    expect(selected).toEqual(["/about", "/pricing"]);
  });

  it("omits the root, which the generator supplies from the verified origin", () => {
    expect(selectSitemapRoutes([fakeRoute("/")])).toEqual([]);
  });

  it("returns nothing when route detection found nothing", () => {
    // A degraded analysis must produce a small sitemap, never an error and
    // never a guess (§4).
    expect(selectSitemapRoutes([])).toEqual([]);
  });

  it("is stable regardless of input order", () => {
    const routes = [fakeRoute("/zebra"), fakeRoute("/alpha"), fakeRoute("/middle")];

    expect(selectSitemapRoutes(routes)).toEqual(selectSitemapRoutes([...routes].reverse()));
  });
});
