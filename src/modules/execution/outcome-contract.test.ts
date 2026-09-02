import { describe, expect, it } from "vitest";
import type { RouteSummary } from "@/modules/repository-intelligence/schema";
import {
  OUTCOME_ROUTES,
  outcomeSnapshot,
  OUTCOME_ORIGIN,
} from "@/modules/outcome-verification/test-support";
import { outcomeCheckId } from "@/modules/outcome-verification/schema";
import { generateSeoFoundations } from "./generators/nextjs-seo-foundations";
import { excludedSurfacePrefixes, selectSitemapRoutes } from "./generators/route-classification";
import { outcomeProfileForCapability, resolveOutcomeContract } from "./outcome-contract";

/**
 * The outcome contract, and its coupling to the generator (Sprint 12A §4, §5).
 *
 * ## The property these tests exist for
 *
 * That the expectations are derived from **what the generator actually emits**,
 * not from a second opinion about what it probably emits. The last test in this
 * file is the one that matters: it generates the real files and asserts the
 * contract agrees with their contents. If someone changes the generator's route
 * selection without changing the contract, that test fails — which is the only
 * mechanism that keeps §5's "do not hard-code expectations that contradict the
 * actual v2 generator" true a year from now.
 */

function contract(routes: RouteSummary[] = OUTCOME_ROUTES, capability = "nextjs_seo_foundations_v2") {
  return resolveOutcomeContract({
    capability,
    publicOrigin: OUTCOME_ORIGIN,
    repository: outcomeSnapshot(routes),
    changedPaths: [],
  });
}

function checkIds(routes: RouteSummary[] = OUTCOME_ROUTES): string[] {
  const resolved = contract(routes);
  if (!resolved.supported) throw new Error("expected a supported contract");
  return resolved.expected.checks.map(outcomeCheckId);
}

describe("which capabilities have a verifier (§10)", () => {
  it("maps both SEO capability versions to the one deterministic profile", () => {
    // v1 and v2 differ in *which* routes they list, not in what a sitemap is —
    // and the contract derives the route lists from the capability's own
    // classification, so v1's historical commit is described correctly too.
    expect(outcomeProfileForCapability("nextjs_seo_foundations_v1")).toBe(
      "nextjs_seo_foundations_outcome_v1",
    );
    expect(outcomeProfileForCapability("nextjs_seo_foundations_v2")).toBe(
      "nextjs_seo_foundations_outcome_v1",
    );
  });

  it("refuses a capability it has never been written for", () => {
    expect(outcomeProfileForCapability("some_future_capability")).toBeNull();
    expect(contract(OUTCOME_ROUTES, "some_future_capability")).toEqual({
      supported: false,
      reason: "outcome_not_supported",
    });
  });

  it("refuses rather than guessing when the repository evidence is gone", () => {
    // A contract invented without the routes the generator consumed would be a
    // description of a different product (§5).
    expect(
      resolveOutcomeContract({
        capability: "nextjs_seo_foundations_v2",
        publicOrigin: OUTCOME_ORIGIN,
        repository: null,
        changedPaths: [],
      }),
    ).toEqual({ supported: false, reason: "outcome_expectation_unavailable" });
  });
});

describe("what the SEO contract expects (§5)", () => {
  it("names both endpoints, and only those two", () => {
    const resolved = contract();
    if (!resolved.supported) throw new Error("expected supported");

    // §13: the site root is deliberately *not* fetched. "Is the homepage in the
    // sitemap" is a question about the sitemap.
    expect(resolved.expected.resources).toEqual(["robots_txt", "sitemap_xml"]);
  });

  it("expects both files to be reachable and the sitemap to be declared", () => {
    expect(checkIds()).toEqual(
      expect.arrayContaining([
        "robots_reachable",
        "robots_declares_sitemap",
        "sitemap_reachable",
        "sitemap_parsed",
        "sitemap_includes_public_root:/",
      ]),
    );
  });

  it("expects the login and signup surfaces to be excluded from the sitemap", () => {
    // The defect the v2 capability exists to prevent, now checkable in
    // production rather than only at generation time.
    expect(checkIds()).toEqual(
      expect.arrayContaining([
        "sitemap_excludes_private_prefix:/login",
        "sitemap_excludes_private_prefix:/signup",
      ]),
    );
  });

  it("expects the application and API subtrees to be excluded too", () => {
    expect(checkIds()).toEqual(
      expect.arrayContaining([
        "sitemap_excludes_private_prefix:/app",
        "sitemap_excludes_private_prefix:/api",
      ]),
    );
  });

  it("does not expect robots.txt to disallow /login", () => {
    // The generator deliberately does not emit that, with a comment explaining
    // why: omitting from a sitemap and disallowing a fetch are different claims.
    // Expecting it here would fail a correct product (§5).
    const ids = checkIds();
    expect(ids.some((id) => id.startsWith("robots_disallows"))).toBe(false);
  });

  it("asserts the absence only of surfaces the repository actually has", () => {
    // No `/admin` route means no `/admin` expectation. A check that can only
    // ever pass inflates the evidence list without adding evidence.
    const withoutAuth: RouteSummary[] = [
      { path: "/", kind: "page", dynamic: false, sourcePath: "src/app/page.tsx" },
      { path: "/pricing", kind: "page", dynamic: false, sourcePath: "src/app/pricing/page.tsx" },
    ];

    const ids = checkIds(withoutAuth);
    expect(ids.some((id) => id.startsWith("sitemap_excludes_private_prefix"))).toBe(false);
  });

  it("does not assert the absence of a dynamic route", () => {
    // `/blog/[slug]` is excluded from a sitemap because a template is not a
    // URL — nobody claimed it must never be indexed, and it cannot appear
    // literally anyway.
    const ids = checkIds([
      { path: "/", kind: "page", dynamic: false, sourcePath: "src/app/page.tsx" },
      { path: "/blog/[slug]", kind: "page", dynamic: true, sourcePath: "src/app/blog/[slug]/page.tsx" },
    ]);

    expect(ids.some((id) => id.includes("/blog"))).toBe(false);
  });

  it("is deterministic — the same inputs produce the same expectations", () => {
    // What makes the frozen snapshot in §9 meaningful.
    expect(JSON.stringify(contract())).toEqual(JSON.stringify(contract()));
  });

  it("never produces an empty check list for a supported capability", () => {
    // An empty contract would classify as `verified` for free (§20).
    const resolved = contract([]);
    if (!resolved.supported) throw new Error("expected supported");
    expect(resolved.expected.checks.length).toBeGreaterThan(0);
  });
});

describe("the contract agrees with the bytes the generator writes (§5)", () => {
  /**
   * The coupling test.
   *
   * Rather than asserting the contract against a remembered description of the
   * generator, this runs the generator and reads its output. A change to route
   * selection that is not reflected here breaks this test.
   */
  const generated = generateSeoFoundations({
    origin: OUTCOME_ORIGIN,
    appRoot: "src/app/",
    routes: OUTCOME_ROUTES,
  });

  const sitemapSource =
    generated.find((file) => file.path.endsWith("sitemap.ts"))?.content ?? "";
  const robotsSource = generated.find((file) => file.path.endsWith("robots.ts"))?.content ?? "";

  it("expects exactly the public paths the generator put in the sitemap", () => {
    const expectedPaths = selectSitemapRoutes(OUTCOME_ROUTES);
    const contractPaths = checkIds()
      .filter((id) => id.startsWith("sitemap_includes_path:"))
      .map((id) => id.slice("sitemap_includes_path:".length));

    expect(contractPaths).toEqual(expectedPaths);

    // And the generator really did emit them.
    for (const path of expectedPaths) {
      expect(sitemapSource).toContain(`${OUTCOME_ORIGIN}${path}`);
    }
  });

  it("expects the site root, which the generator always emits", () => {
    expect(sitemapSource).toContain(`url: "${OUTCOME_ORIGIN}"`);
    expect(checkIds()).toContain("sitemap_includes_public_root:/");
  });

  it("asserts the absence of every prefix the generator kept out of the sitemap", () => {
    for (const prefix of excludedSurfacePrefixes(OUTCOME_ROUTES)) {
      // Not in the generated file…
      expect(sitemapSource).not.toContain(`url: "${OUTCOME_ORIGIN}${prefix}"`);
      // …and the contract says so out loud.
      expect(checkIds()).toContain(`sitemap_excludes_private_prefix:${prefix}`);
    }
  });

  it("expects the sitemap URL the generated robots.txt actually declares", () => {
    expect(robotsSource).toContain(`sitemap: "${OUTCOME_ORIGIN}/sitemap.xml"`);
    expect(checkIds()).toContain("robots_declares_sitemap");
  });
});

/**
 * The agentic contract (ADR 0071).
 *
 * A different kind of contract from the one above, and these tests are written
 * to hold the difference in place. The SEO contract is derived from what a
 * generator emits and is coupled to that generator's own functions. This one is
 * derived from **what changed** — two of Vibe's own observations, intersected —
 * and the property worth defending is that it never widens past them.
 */
function agentic(changedPaths: string[], routes: RouteSummary[] = OUTCOME_ROUTES) {
  return resolveOutcomeContract({
    capability: "agentic_execution_v1",
    publicOrigin: OUTCOME_ORIGIN,
    repository: outcomeSnapshot(routes),
    changedPaths,
  });
}

function agenticPaths(changedPaths: string[], routes: RouteSummary[] = OUTCOME_ROUTES): string[] {
  const resolved = agentic(changedPaths, routes);
  if (!resolved.supported) throw new Error(`expected supported, got ${resolved.reason}`);
  return resolved.expected.checks.map((check) => check.target ?? "");
}

describe("the agentic capability now has a verifier (ADR 0071)", () => {
  it("maps agentic execution to the public-routes profile", () => {
    expect(outcomeProfileForCapability("agentic_execution_v1")).toBe(
      "agentic_public_routes_outcome_v1",
    );
  });

  it("expects exactly the public routes the changed files serve", () => {
    // `src/app/pricing/page.tsx` serves `/pricing` **in this repository**, which
    // is the analyzer's conclusion rather than a guess from the filename.
    expect(agenticPaths(["src/app/pricing/page.tsx"])).toEqual(["/pricing"]);
    expect(agenticPaths(["src/app/page.tsx", "src/app/pricing/page.tsx"])).toEqual([
      "/",
      "/pricing",
    ]);
  });

  it("names `public_route` as its only resource, and takes every path from a check", () => {
    const resolved = agentic(["src/app/pricing/page.tsx"]);
    if (!resolved.supported) throw new Error("expected supported");

    expect(resolved.expected.resources).toEqual(["public_route"]);
    // The path lives on the check, not on a resource path table — which is what
    // stops a second page from being fetched without a check that names it.
    expect(resolved.expected.checks.map(outcomeCheckId)).toEqual([
      "public_route_serves_page:/pricing",
    ]);
  });

  it("ignores a changed file the route table does not connect to a page", () => {
    // A route handler, a library module, a test: real changes, no public page.
    // Under-claiming is the safe direction — the alternative is reporting on
    // pages this change never touched.
    expect(agentic(["src/app/api/hook/route.ts"])).toEqual({
      supported: false,
      reason: "outcome_no_public_surface",
    });
    expect(agentic(["src/modules/billing/catalog.ts"])).toEqual({
      supported: false,
      reason: "outcome_no_public_surface",
    });
  });

  it("never probes a dynamic route, because it is a template and not a URL", () => {
    // Requesting `/app/projects/[projectId]` literally observes a 404 and would
    // report it as the change having broken a page.
    expect(agentic(["src/app/app/projects/[projectId]/page.tsx"])).toEqual({
      supported: false,
      reason: "outcome_no_public_surface",
    });
  });

  it("refuses rather than guessing when the repository evidence is gone", () => {
    expect(
      resolveOutcomeContract({
        capability: "agentic_execution_v1",
        publicOrigin: OUTCOME_ORIGIN,
        repository: null,
        changedPaths: ["src/app/page.tsx"],
      }),
    ).toEqual({ supported: false, reason: "outcome_expectation_unavailable" });
  });

  it("refuses when route analysis was limited, rather than probing nothing", () => {
    // `resolveExecutionSurface` returns an empty resolution for a `limited` or
    // `none` route mode, so the intersection is empty and the honest answer is
    // that there is no public surface to look at.
    const snapshot = outcomeSnapshot();
    const limited = {
      ...snapshot,
      routes: { ...snapshot.routes, mode: "limited" },
    } as typeof snapshot;

    expect(
      resolveOutcomeContract({
        capability: "agentic_execution_v1",
        publicOrigin: OUTCOME_ORIGIN,
        repository: limited,
        changedPaths: ["src/app/page.tsx"],
      }),
    ).toEqual({ supported: false, reason: "outcome_no_public_surface" });
  });

  it("bounds the page list and says so, rather than probing everything", () => {
    const many: RouteSummary[] = Array.from({ length: 9 }, (_, index) => ({
      path: `/p${index}`,
      kind: "page",
      dynamic: false,
      sourcePath: `src/app/p${index}/page.tsx`,
    }));

    const resolved = agentic(
      many.map((route) => route.sourcePath),
      many,
    );
    if (!resolved.supported) throw new Error("expected supported");

    expect(resolved.expected.checks).toHaveLength(4);
    // Reaching the budget marks the expectation rather than silently narrowing
    // what was checked (CLAUDE.md rule 27).
    expect(resolved.expected.truncated).toBe(true);
  });

  it("is deterministic: the same change always produces the same expectation", () => {
    expect(agenticPaths(["src/app/pricing/page.tsx", "src/app/page.tsx"])).toEqual(
      agenticPaths(["src/app/page.tsx", "src/app/pricing/page.tsx"]),
    );
  });
});
