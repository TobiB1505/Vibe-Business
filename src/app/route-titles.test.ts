import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every route names itself in the browser tab (UX audit F-1).
 *
 * [`UX-CONTRACT.md`](../../UX-CONTRACT.md) opens its navigation section with
 * "Every route has a truthful metadata title." That was true of seven routes
 * out of twenty-nine. The other twenty-two inherited the root layout's bare
 * `Vibe Business`, which made every tab, every bookmark and every history
 * entry identical — you could not tell your Plan tab from your Billing tab.
 *
 * ## Why a test and not a convention
 *
 * Because the failure is invisible from inside the app. A missing title breaks
 * nothing, renders nothing wrong, and shows up only in a place no test looked:
 * the browser's own chrome. Twenty-two routes accumulated it without anybody
 * noticing, over the whole life of the product.
 *
 * ## The two deliberate exemptions
 *
 * The landing page takes the root layout's `default`, which is the product
 * name and is the right title for the product's front page. The fixture route
 * exists only under `VIBE_E2E_FIXTURES` and ships in no deployed build.
 */

const ROUTES = join(process.cwd(), "src/app");

const WITHOUT_THEIR_OWN_TITLE: readonly { route: string; why: string }[] = [
  {
    route: "page.tsx",
    why: "The landing page. The root layout's `default` is the product name, which is what this page should be called.",
  },
  {
    route: "e2e/[scenario]/page.tsx",
    why: "The fixture harness. It exists only when VIBE_E2E_FIXTURES is set, which the Playwright web server does and no deployed build does.",
  },
];

function pageFiles(dir: string = ROUTES): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return pageFiles(full);
    return entry === "page.tsx" ? [full] : [];
  });
}

function titled(file: string): boolean {
  const source = readFileSync(file, "utf8");
  return source.includes("export const metadata") || source.includes("generateMetadata");
}

describe("every route names itself", () => {
  it("finds the route tree", () => {
    // An empty list would pass every assertion below while proving nothing.
    expect(pageFiles().length).toBeGreaterThan(20);
  });

  it("leaves no route relying on the inherited product name", () => {
    const exempt = new Set(WITHOUT_THEIR_OWN_TITLE.map((entry) => entry.route));
    const untitled = pageFiles()
      .map((file) => relative(ROUTES, file).replaceAll("\\", "/"))
      .filter((route) => !exempt.has(route))
      .filter((route) => !titled(join(ROUTES, route)));

    expect(untitled).toEqual([]);
  });

  it("keeps no exemption for a route that no longer exists", () => {
    // A stale exemption silently pre-approves whatever is written at that path.
    const live = new Set(pageFiles().map((f) => relative(ROUTES, f).replaceAll("\\", "/")));
    expect(WITHOUT_THEIR_OWN_TITLE.filter((e) => !live.has(e.route)).map((e) => e.route)).toEqual([]);
  });

  it("appends the product name once, through the layout's template", () => {
    // Routes set their own short name only. Without the template they would
    // read as a bare "Billing"; with a title that spelled out the suffix they
    // would read as "Billing — Vibe Business — Vibe Business".
    const layout = readFileSync(join(ROUTES, "layout.tsx"), "utf8");
    expect(layout).toContain('template: "%s — Vibe Business"');

    for (const file of pageFiles()) {
      const title = readFileSync(file, "utf8").match(/title: "([^"]*)"/)?.[1];
      if (title) expect(title, relative(ROUTES, file)).not.toContain("Vibe Business");
    }
  });
});
