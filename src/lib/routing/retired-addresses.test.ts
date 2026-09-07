import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PROJECT_SECTIONS, PROJECT_SUBSECTIONS } from "@/components/layout/project-shell";
import {
  MOVED_ACCOUNT_SECTIONS,
  RETIRED_WORKSPACE_ADDRESSES,
  retiredAddressRedirects,
} from "./retired-addresses";

/**
 * A redirect is only worth having if it lands somewhere (PERF-023).
 *
 * The failure this guards is quiet: a section is renamed, these keep pointing
 * at what it used to be, and a bookmark that used to 404 now redirects to a
 * different 404 — which is worse, because the address bar says the product
 * answered.
 */
describe("retired workspace addresses", () => {
  it("answers each one with the section that replaced it", () => {
    const rules = retiredAddressRedirects();

    const workspace = rules.filter((rule) => rule.source.startsWith("/app/projects/"));
    expect(workspace.map((rule) => rule.source)).toEqual([
      "/app/projects/:projectId/score",
      "/app/projects/:projectId/prepared",
      "/app/projects/:projectId/understanding",
    ]);
    expect(workspace.map((rule) => rule.destination)).toEqual([
      "/app/projects/:projectId",
      "/app/projects/:projectId/agent",
      "/app/projects/:projectId/product",
    ]);
  });

  /**
   * The account sections moved under Settings, and the old addresses are the
   * ones a founder has: the old rail linked them, and `requireSession` sends
   * people to them after a login.
   */
  it("answers each moved account section, index and anything under it", () => {
    const rules = retiredAddressRedirects();

    for (const segment of MOVED_ACCOUNT_SECTIONS) {
      expect(rules).toContainEqual({
        source: `/app/${segment}`,
        destination: `/app/settings/${segment}`,
        permanent: false,
      });
      expect(rules).toContainEqual({
        source: `/app/${segment}/:path*`,
        destination: `/app/settings/${segment}/:path*`,
        permanent: false,
      });
    }
  });

  it("points every moved section at a route that exists", () => {
    for (const segment of MOVED_ACCOUNT_SECTIONS) {
      expect(
        existsSync(join(process.cwd(), `src/app/app/(account)/settings/${segment}/page.tsx`)),
        `/app/settings/${segment} has no page`,
      ).toBe(true);
      // And the old address must not still be a route, or it would shadow the
      // redirect and the move would be invisible.
      expect(
        existsSync(join(process.cwd(), `src/app/app/(account)/${segment}/page.tsx`)),
        `/app/${segment} is still a route`,
      ).toBe(false);
    }
  });

  /**
   * A 308 lives in browser caches indefinitely, which would settle a routing
   * decision somewhere this repository cannot edit it.
   */
  it("keeps them temporary", () => {
    for (const rule of retiredAddressRedirects()) {
      expect(rule.permanent, `${rule.source} is permanent`).toBe(false);
    }
  });

  it("points every one at a section that exists today", () => {
    const segments = new Set<string>(
      [...PROJECT_SECTIONS, ...PROJECT_SUBSECTIONS].map((section) => section.segment),
    );

    for (const { to } of RETIRED_WORKSPACE_ADDRESSES) {
      expect(segments.has(to), `"${to}" is not a workspace section`).toBe(true);
    }
  });

  /**
   * A retired address that is also a live route would shadow the route.
   */
  it("never redirects away from a section that came back", () => {
    const segments = new Set<string>(
      [...PROJECT_SECTIONS, ...PROJECT_SUBSECTIONS].map((section) => section.segment),
    );

    for (const { from } of RETIRED_WORKSPACE_ADDRESSES) {
      expect(segments.has(from), `"${from}" is a live section and a redirect`).toBe(false);
    }
  });

  /**
   * The table is only reachable if the config asks for it. `next.config.ts`
   * cannot be imported outside a Next build — its plugin wrappers resolve to
   * an empty object — so this is a source assertion by necessity.
   */
  it("is what next.config.ts serves", () => {
    const config = readFileSync(join(process.cwd(), "next.config.ts"), "utf8");

    expect(config).toContain("retiredAddressRedirects");
    expect(config).toMatch(/async redirects\(\)/);
  });
});
