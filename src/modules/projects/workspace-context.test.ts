import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The workspace context stays a database read (UI-4 §3).
 *
 * It used to carry a live GitHub probe — an installation token mint plus a
 * repository listing, two round trips — and because an App Router layout does
 * not gate the routes beneath it, layout and route each resolved the context
 * independently. Four round trips per navigation, before anything painted,
 * for a value exactly one component displayed.
 *
 * These assertions are the guard on the shape of that fix, not on its
 * performance: they say the shared read reaches for no network, and that the
 * routes which resolve it per render have not quietly acquired one either.
 */

const CONTEXT = readFileSync(
  join(process.cwd(), "src/modules/projects/workspace-context.ts"),
  "utf8",
);

const ROUTE_DIR = join(process.cwd(), "src/app/app/projects/[projectId]");

function routePages(): { name: string; source: string }[] {
  const pages: { name: string; source: string }[] = [];

  for (const entry of readdirSync(ROUTE_DIR, { withFileTypes: true })) {
    if (entry.isFile() && entry.name === "page.tsx") {
      pages.push({ name: entry.name, source: readFileSync(join(ROUTE_DIR, entry.name), "utf8") });
    }

    if (entry.isDirectory()) {
      try {
        pages.push({
          name: `${entry.name}/page.tsx`,
          source: readFileSync(join(ROUTE_DIR, entry.name, "page.tsx"), "utf8"),
        });
      } catch {
        // Not every directory under the route is a route segment.
      }
    }
  }

  return pages;
}

describe("project workspace context", () => {
  it("makes no GitHub call", () => {
    expect(CONTEXT).not.toContain("checkInstallationStillAccessible");
    expect(CONTEXT).not.toContain("@/modules/github/");
  });

  it("exposes no reachability answer for a route to depend on", () => {
    // The field is gone rather than nulled: a route that wants live GitHub
    // state has to ask for it, in the one place that renders it.
    expect(CONTEXT).not.toContain("accessible");
  });

  it("keeps the workspace routes off the GitHub path", () => {
    const pages = routePages();
    expect(pages.length).toBeGreaterThan(5);

    for (const page of pages) {
      expect(page.source, `${page.name} reaches for GitHub during render`).not.toContain(
        "checkInstallationStillAccessible",
      );
    }
  });

  it("keeps live repository reachability out of the shared project shell", () => {
    const layout = readFileSync(join(ROUTE_DIR, "layout.tsx"), "utf8");

    // Repository identity and the stored connection state live in the project
    // switcher. A live GitHub probe belongs only to a consequential workflow,
    // never to furniture rendered on every route.
    expect(layout).not.toContain("RepositoryAccessPill");
    expect(layout).not.toContain("Suspense");
    expect(layout).not.toContain("await checkInstallationStillAccessible");
  });
});
