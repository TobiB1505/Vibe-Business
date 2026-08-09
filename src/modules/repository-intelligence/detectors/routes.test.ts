import { describe, expect, it } from "vitest";
import { detectRoutes } from "./routes";
import { contextFrom } from "../test-support";
import type { Detection } from "../schema";

const NEXT: Detection[] = [{ id: "nextjs", name: "Next.js", confidence: "high", evidence: [] }];

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

    const result = detectRoutes(context, NEXT);
    expect(result.mode).toBe("app_router");
    expect(pagePaths(result.routes)).toEqual(["/", "/login", "/pricing"]);
  });

  it("supports a top-level app directory without src", () => {
    const context = contextFrom([{ path: "app/page.tsx" }, { path: "app/about/page.tsx" }]);
    const result = detectRoutes(context, NEXT);
    expect(result.mode).toBe("app_router");
    expect(pagePaths(result.routes)).toEqual(["/", "/about"]);
  });

  it("strips route groups from the URL", () => {
    const context = contextFrom([{ path: "src/app/(marketing)/pricing/page.tsx" }]);
    expect(pagePaths(detectRoutes(context, NEXT).routes)).toEqual(["/pricing"]);
  });

  it("marks dynamic segments", () => {
    const context = contextFrom([{ path: "src/app/projects/[projectId]/page.tsx" }]);
    const route = detectRoutes(context, NEXT).routes[0];
    expect(route.path).toBe("/projects/[projectId]");
    expect(route.dynamic).toBe(true);
  });

  it("handles catch-all and optional catch-all segments", () => {
    const context = contextFrom([
      { path: "src/app/docs/[...slug]/page.tsx" },
      { path: "src/app/shop/[[...filters]]/page.tsx" },
    ]);

    const routes = detectRoutes(context, NEXT).routes;
    expect(routes.every((route) => route.dynamic)).toBe(true);
    expect(pagePaths(routes)).toEqual(expect.arrayContaining(["/docs/[...slug]", "/shop/[[...filters]]"]));
  });

  it("classifies route.ts as an API route", () => {
    const context = contextFrom([{ path: "src/app/api/webhook/route.ts" }]);
    const route = detectRoutes(context, NEXT).routes[0];
    expect(route.kind).toBe("api");
    expect(route.path).toBe("/api/webhook");
  });

  it("classifies layouts separately from pages", () => {
    const context = contextFrom([{ path: "src/app/layout.tsx" }, { path: "src/app/page.tsx" }]);
    const routes = detectRoutes(context, NEXT).routes;
    expect(routes.filter((route) => route.kind === "layout")).toHaveLength(1);
    expect(routes.filter((route) => route.kind === "page")).toHaveLength(1);
  });

  it("ignores non-route files inside app", () => {
    const context = contextFrom([
      { path: "src/app/page.tsx" },
      { path: "src/app/globals.css" },
      { path: "src/app/login/login-form.tsx" },
    ]);

    expect(detectRoutes(context, NEXT).routes).toHaveLength(1);
  });

  it("ignores private _folders", () => {
    const context = contextFrom([{ path: "src/app/_components/page.tsx" }, { path: "src/app/page.tsx" }]);
    expect(pagePaths(detectRoutes(context, NEXT).routes)).toEqual(["/"]);
  });

  it("never derives routes from build output", () => {
    const context = contextFrom([
      { path: "src/app/page.tsx" },
      { path: ".next/server/app/ghost/page.js" },
    ]);

    expect(pagePaths(detectRoutes(context, NEXT).routes)).toEqual(["/"]);
  });
});

describe("detectRoutes — Pages Router", () => {
  it("derives routes and maps index to the directory root", () => {
    const context = contextFrom([
      { path: "pages/index.tsx" },
      { path: "pages/about.tsx" },
      { path: "pages/blog/index.tsx" },
    ]);

    const result = detectRoutes(context, NEXT);
    expect(result.mode).toBe("pages_router");
    expect(pagePaths(result.routes)).toEqual(["/", "/about", "/blog"]);
  });

  it("classifies pages/api as API routes", () => {
    const context = contextFrom([{ path: "pages/api/hello.ts" }]);
    const route = detectRoutes(context, NEXT).routes[0];
    expect(route.kind).toBe("api");
    expect(route.path).toBe("/api/hello");
  });

  it("marks dynamic segments", () => {
    const context = contextFrom([{ path: "pages/posts/[slug].tsx" }]);
    const route = detectRoutes(context, NEXT).routes[0];
    expect(route.dynamic).toBe(true);
    expect(route.path).toBe("/posts/[slug]");
  });

  it("ignores framework internals such as _app", () => {
    const context = contextFrom([{ path: "pages/_app.tsx" }, { path: "pages/index.tsx" }]);
    expect(pagePaths(detectRoutes(context, NEXT).routes)).toEqual(["/"]);
  });

  it("prefers App Router when both directories exist", () => {
    const context = contextFrom([{ path: "src/app/page.tsx" }, { path: "pages/legacy.tsx" }]);
    expect(detectRoutes(context, NEXT).mode).toBe("app_router");
  });
});

describe("detectRoutes — unsupported frameworks", () => {
  it("reports limited for code-configured routing", () => {
    const context = contextFrom([{ path: "main.py" }]);
    const fastapi: Detection[] = [{ id: "fastapi", name: "FastAPI", confidence: "high", evidence: [] }];

    const result = detectRoutes(context, fastapi);
    expect(result.mode).toBe("limited");
    expect(result.routes).toEqual([]);
  });

  it("reports limited for Next.js without a recognised router directory", () => {
    const context = contextFrom([{ path: "src/index.ts" }]);
    expect(detectRoutes(context, NEXT).mode).toBe("limited");
  });

  it("reports none when no framework was detected", () => {
    expect(detectRoutes(contextFrom([{ path: "README.md" }]), []).mode).toBe("none");
  });
});
