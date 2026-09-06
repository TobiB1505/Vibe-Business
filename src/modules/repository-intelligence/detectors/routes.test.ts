import { describe, expect, it } from "vitest";
import { detectRoutes } from "./routes";
import { contextFrom } from "../test-support";
import type { BuildIntelligence, Detection } from "../schema";

const NEXT: Detection[] = [{ id: "nextjs", name: "Next.js", confidence: "high", evidence: [] }];

/**
 * A repository whose build detector found nothing to describe.
 *
 * Every case below is a single application at the repository root, and this is
 * how the detector sees one: no build targets, so the router search falls back
 * to `.` — the behaviour that was the *only* behaviour before applications
 * could live in a subdirectory.
 */
const NO_BUILD: BuildIntelligence = { targets: [], truncated: false };

/** One application, at `directory`, declaring Next.js. */
function buildAt(...directories: string[]): BuildIntelligence {
  return {
    targets: directories.map((directory) => ({
      directory,
      manifestPath: directory === "." ? "package.json" : `${directory}/package.json`,
      buildScript: true,
      frameworks: ["nextjs"],
      lockfile: null,
      declaresWorkspaces: false,
      moduleLinker: null,
    })),
    truncated: false,
  };
}

function pagePaths(routes: { path: string; kind: string }[]): string[] {
  return routes.filter((route) => route.kind === "page").map((route) => route.path);
}

describe("detectRoutes — App Router", () => {
  it("derives page routes from src/app", () => {
    const context = contextFrom([
      { path: "src/app/page.tsx" },
      { path: "src/app/login/page.tsx" },
      { path: "src/app/pricing/page.tsx" },
    ]);

    const result = detectRoutes(context, NEXT, NO_BUILD);
    expect(result.mode).toBe("app_router");
    expect(pagePaths(result.routes)).toEqual(["/", "/login", "/pricing"]);
  });

  it("supports a top-level app directory without src", () => {
    const context = contextFrom([{ path: "app/page.tsx" }, { path: "app/about/page.tsx" }]);
    const result = detectRoutes(context, NEXT, NO_BUILD);
    expect(result.mode).toBe("app_router");
    expect(pagePaths(result.routes)).toEqual(["/", "/about"]);
  });

  it("strips route groups from the URL", () => {
    const context = contextFrom([{ path: "src/app/(marketing)/pricing/page.tsx" }]);
    expect(pagePaths(detectRoutes(context, NEXT, NO_BUILD).routes)).toEqual(["/pricing"]);
  });

  it("marks dynamic segments", () => {
    const context = contextFrom([{ path: "src/app/projects/[projectId]/page.tsx" }]);
    const route = detectRoutes(context, NEXT, NO_BUILD).routes[0];
    expect(route.path).toBe("/projects/[projectId]");
    expect(route.dynamic).toBe(true);
  });

  it("handles catch-all and optional catch-all segments", () => {
    const context = contextFrom([
      { path: "src/app/docs/[...slug]/page.tsx" },
      { path: "src/app/shop/[[...filters]]/page.tsx" },
    ]);

    const routes = detectRoutes(context, NEXT, NO_BUILD).routes;
    expect(routes.every((route) => route.dynamic)).toBe(true);
    expect(pagePaths(routes)).toEqual(
      expect.arrayContaining(["/docs/[...slug]", "/shop/[[...filters]]"]),
    );
  });

  it("classifies route.ts as an API route", () => {
    const context = contextFrom([{ path: "src/app/api/webhook/route.ts" }]);
    const route = detectRoutes(context, NEXT, NO_BUILD).routes[0];
    expect(route.kind).toBe("api");
    expect(route.path).toBe("/api/webhook");
  });

  it("classifies layouts separately from pages", () => {
    const context = contextFrom([{ path: "src/app/layout.tsx" }, { path: "src/app/page.tsx" }]);
    const routes = detectRoutes(context, NEXT, NO_BUILD).routes;
    expect(routes.filter((route) => route.kind === "layout")).toHaveLength(1);
    expect(routes.filter((route) => route.kind === "page")).toHaveLength(1);
  });

  it("ignores non-route files inside app", () => {
    const context = contextFrom([
      { path: "src/app/page.tsx" },
      { path: "src/app/globals.css" },
      { path: "src/app/login/login-form.tsx" },
    ]);

    expect(detectRoutes(context, NEXT, NO_BUILD).routes).toHaveLength(1);
  });

  it("ignores private _folders", () => {
    const context = contextFrom([
      { path: "src/app/_components/page.tsx" },
      { path: "src/app/page.tsx" },
    ]);
    expect(pagePaths(detectRoutes(context, NEXT, NO_BUILD).routes)).toEqual(["/"]);
  });

  it("never derives routes from build output", () => {
    const context = contextFrom([
      { path: "src/app/page.tsx" },
      { path: ".next/server/app/ghost/page.js" },
    ]);

    expect(pagePaths(detectRoutes(context, NEXT, NO_BUILD).routes)).toEqual(["/"]);
  });
});

describe("detectRoutes — Pages Router", () => {
  it("derives routes and maps index to the directory root", () => {
    const context = contextFrom([
      { path: "pages/index.tsx" },
      { path: "pages/about.tsx" },
      { path: "pages/blog/index.tsx" },
    ]);

    const result = detectRoutes(context, NEXT, NO_BUILD);
    expect(result.mode).toBe("pages_router");
    expect(pagePaths(result.routes)).toEqual(["/", "/about", "/blog"]);
  });

  it("classifies pages/api as API routes", () => {
    const context = contextFrom([{ path: "pages/api/hello.ts" }]);
    const route = detectRoutes(context, NEXT, NO_BUILD).routes[0];
    expect(route.kind).toBe("api");
    expect(route.path).toBe("/api/hello");
  });

  it("marks dynamic segments", () => {
    const context = contextFrom([{ path: "pages/posts/[slug].tsx" }]);
    const route = detectRoutes(context, NEXT, NO_BUILD).routes[0];
    expect(route.dynamic).toBe(true);
    expect(route.path).toBe("/posts/[slug]");
  });

  it("ignores framework internals such as _app", () => {
    const context = contextFrom([{ path: "pages/_app.tsx" }, { path: "pages/index.tsx" }]);
    expect(pagePaths(detectRoutes(context, NEXT, NO_BUILD).routes)).toEqual(["/"]);
  });

  it("prefers App Router when both directories exist", () => {
    const context = contextFrom([{ path: "src/app/page.tsx" }, { path: "pages/legacy.tsx" }]);
    expect(detectRoutes(context, NEXT, NO_BUILD).mode).toBe("app_router");
  });
});

describe("detectRoutes — unsupported frameworks", () => {
  it("reports limited for code-configured routing", () => {
    const context = contextFrom([{ path: "main.py" }]);
    const fastapi: Detection[] = [
      { id: "fastapi", name: "FastAPI", confidence: "high", evidence: [] },
    ];

    const result = detectRoutes(context, fastapi, NO_BUILD);
    expect(result.mode).toBe("limited");
    expect(result.routes).toEqual([]);
  });

  it("reports limited for Next.js without a recognised router directory", () => {
    const context = contextFrom([{ path: "src/index.ts" }]);
    expect(detectRoutes(context, NEXT, NO_BUILD).mode).toBe("limited");
  });

  it("reports none when no framework was detected", () => {
    expect(detectRoutes(contextFrom([{ path: "README.md" }]), [], NO_BUILD).mode).toBe("none");
  });
});

/**
 * The application is not always at the repository root.
 *
 * This is the case the detector was blind to, and the blindness did not look
 * like a failure: `frontend/src/app/page.tsx` produced `limited` with an empty
 * route list — the same answer a repository with no router at all gets. Read
 * off a real project, `planner-agent` reported zero routes while being a
 * Next.js App Router application.
 */
describe("detectRoutes — where the application actually is", () => {
  it("reads an application in a subdirectory", () => {
    const context = contextFrom([
      { path: "frontend/src/app/page.tsx" },
      { path: "frontend/src/app/login/page.tsx" },
      { path: "backend/main.py" },
    ]);

    const result = detectRoutes(context, NEXT, buildAt("frontend"));

    expect(result.mode).toBe("app_router");
    expect(pagePaths(result.routes)).toEqual(["/", "/login"]);
  });

  it("records which directory the routes came from", () => {
    // Recorded rather than left to be re-derived: every consumer that rebuilt
    // this from a source path rebuilt a repository-root assumption with it.
    const context = contextFrom([{ path: "frontend/app/page.tsx" }]);

    expect(detectRoutes(context, NEXT, buildAt("frontend")).root).toBe("frontend/app/");
    expect(detectRoutes(contextFrom([{ path: "src/app/page.tsx" }]), NEXT, NO_BUILD).root).toBe(
      "src/app/",
    );
  });

  it("prefers src/app over app inside one application, as Next.js does", () => {
    const context = contextFrom([
      { path: "frontend/src/app/page.tsx" },
      { path: "frontend/app/legacy.tsx" },
    ]);

    expect(detectRoutes(context, NEXT, buildAt("frontend")).root).toBe("frontend/src/app/");
  });

  /*
   * Two applications with routers is a question this detector cannot answer,
   * and answering it anyway would put a guess where a fact belongs. Refusing is
   * the same discipline `resolveAppRoot` already applied to *writing* — moved
   * one layer earlier, to where the evidence is.
   */
  it("refuses rather than picking one of two applications with routers", () => {
    const context = contextFrom([
      { path: "apps/web/src/app/page.tsx" },
      { path: "apps/admin/src/app/page.tsx" },
    ]);

    const result = detectRoutes(context, NEXT, buildAt("apps/web", "apps/admin"));

    expect(result.mode).toBe("limited");
    expect(result.routes).toEqual([]);
    expect(result.root).toBeUndefined();
  });

  it("ignores a router belonging to no application Vibe can build", () => {
    // The build targets are the list of applications. A stray `app/` directory
    // beside them is not one, and reading routes out of it would describe
    // something Vibe could never act on.
    const context = contextFrom([
      { path: "frontend/src/app/page.tsx" },
      { path: "docs/app/page.tsx" },
    ]);

    expect(detectRoutes(context, NEXT, buildAt("frontend")).root).toBe("frontend/src/app/");
  });

  it("falls back to the repository root when no build target was found", () => {
    // A snapshot of a repository the build detector could not describe still
    // gets the search it always had, rather than nothing.
    const context = contextFrom([{ path: "app/page.tsx" }]);

    expect(detectRoutes(context, NEXT, NO_BUILD).mode).toBe("app_router");
  });
});
