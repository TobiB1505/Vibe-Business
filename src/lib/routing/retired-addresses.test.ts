import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PROJECT_SECTIONS, PROJECT_SUBSECTIONS } from "@/components/layout/project-shell";
import { RETIRED_WORKSPACE_ADDRESSES, retiredAddressRedirects } from "./retired-addresses";

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

    expect(rules.map((rule) => rule.source)).toEqual([
      "/app/projects/:projectId/score",
      "/app/projects/:projectId/prepared",
      "/app/projects/:projectId/understanding",
    ]);
    expect(rules.map((rule) => rule.destination)).toEqual([
      "/app/projects/:projectId",
      "/app/projects/:projectId/agent",
      "/app/projects/:projectId/product",
    ]);
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
