import { pathBasename, pathExtension } from "../path-policy";
import type { DetectionContext } from "../context";
import type { Detection, RouteIntelligence, RouteKind, RouteSummary } from "../schema";

/**
 * Route inference from file paths (Sprint 2 §15).
 *
 * Only Next.js is supported, because its file-system router makes routes
 * derivable from paths alone. For frameworks where routes are declared in
 * code (Express, FastAPI, Django, ...) we report `limited` and return no
 * routes rather than guessing — knowing routes would require executing or
 * parsing application code, which is out of scope and unsafe.
 *
 * Nothing here reads file contents; only path structure.
 */

const ROUTE_FILE_EXTENSIONS = new Set(["ts", "tsx", "js", "jsx", "mjs"]);
const MAX_ROUTES = 200;

/** Locates the router directory, supporting both `src/app` and top-level `app`. */
function findRouterRoot(context: DetectionContext, directory: "app" | "pages"): string | null {
  const candidates = [`src/${directory}/`, `${directory}/`];
  for (const prefix of candidates) {
    if (context.sourcePaths.some((path) => path.startsWith(prefix))) return prefix;
  }
  return null;
}

/**
 * App Router: a URL exists where a `page`/`route` file exists. Segment
 * rules: `(group)` is organisational and contributes nothing to the URL,
 * `[id]`/`[...slug]` are dynamic, and `_private` folders are ignored by
 * Next.js entirely.
 */
function appRouterSegmentToUrl(segment: string): { text: string | null; dynamic: boolean } {
  if (segment.startsWith("(") && segment.endsWith(")")) return { text: null, dynamic: false };
  if (segment.startsWith("@")) return { text: null, dynamic: false }; // parallel route slot
  if (/^\[\[?\.\.\..+?\]\]?$/.test(segment)) return { text: segment, dynamic: true }; // [...slug] / [[...slug]]
  if (/^\[.+\]$/.test(segment)) return { text: segment, dynamic: true };
  return { text: segment, dynamic: false };
}

function buildUrl(segments: string[]): string {
  const joined = segments.filter((segment) => segment.length > 0).join("/");
  return joined.length === 0 ? "/" : `/${joined}`;
}

function detectAppRouterRoutes(context: DetectionContext, root: string): RouteSummary[] {
  const routes: RouteSummary[] = [];

  for (const path of context.sourcePaths) {
    if (!path.startsWith(root)) continue;

    const extension = pathExtension(path);
    if (!ROUTE_FILE_EXTENSIONS.has(extension)) continue;

    const basename = pathBasename(path).replace(/\.[^.]+$/, "");
    let kind: RouteKind;
    if (basename === "page") kind = "page";
    else if (basename === "route") kind = "api";
    else if (basename === "layout") kind = "layout";
    else continue;

    const relative = path.slice(root.length);
    const segments = relative.split("/").slice(0, -1); // drop the filename

    // `_folder` is a Next.js private directory: never routable.
    if (segments.some((segment) => segment.startsWith("_"))) continue;

    const urlSegments: string[] = [];
    let dynamic = false;
    for (const segment of segments) {
      const mapped = appRouterSegmentToUrl(segment);
      if (mapped.text === null) continue;
      if (mapped.dynamic) dynamic = true;
      urlSegments.push(mapped.text);
    }

    routes.push({ path: buildUrl(urlSegments), kind, dynamic, sourcePath: path });
  }

  return routes;
}

/**
 * Pages Router: every file is a route, `index` maps to the directory
 * root, and anything under `pages/api/` is an API route.
 */
function detectPagesRouterRoutes(context: DetectionContext, root: string): RouteSummary[] {
  const routes: RouteSummary[] = [];

  for (const path of context.sourcePaths) {
    if (!path.startsWith(root)) continue;

    const extension = pathExtension(path);
    if (!ROUTE_FILE_EXTENSIONS.has(extension)) continue;

    const relative = path.slice(root.length);
    const withoutExtension = relative.replace(/\.[^.]+$/, "");
    const segments = withoutExtension.split("/");

    // Framework internals (_app, _document, _middleware) are not routes.
    if (segments.some((segment) => segment.startsWith("_"))) continue;

    const isApi = segments[0] === "api";

    const urlSegments: string[] = [];
    let dynamic = false;
    for (const [index, segment] of segments.entries()) {
      // A trailing `index` maps to its parent directory's URL.
      if (segment === "index" && index === segments.length - 1) continue;
      if (/^\[.+\]$/.test(segment)) dynamic = true;
      urlSegments.push(segment);
    }

    routes.push({
      path: buildUrl(urlSegments),
      kind: isApi ? "api" : "page",
      dynamic,
      sourcePath: path,
    });
  }

  return routes;
}

/** Frameworks whose routes cannot be derived from paths without running code. */
const CODE_ROUTED_FRAMEWORKS = new Set([
  "express",
  "nestjs",
  "fastapi",
  "django",
  "flask",
  "laravel",
  "rails",
]);

export function detectRoutes(
  context: DetectionContext,
  frameworks: Detection[],
): RouteIntelligence {
  const isNext = frameworks.some((framework) => framework.id === "nextjs");

  if (isNext) {
    const appRoot = findRouterRoot(context, "app");
    const pagesRoot = findRouterRoot(context, "pages");

    // A project may contain both during a migration; App Router wins
    // because that is what Next.js itself prioritises.
    if (appRoot) {
      return finalize("app_router", detectAppRouterRoutes(context, appRoot));
    }
    if (pagesRoot) {
      return finalize("pages_router", detectPagesRouterRoutes(context, pagesRoot));
    }
    return { mode: "limited", routes: [], truncated: false };
  }

  if (frameworks.some((framework) => CODE_ROUTED_FRAMEWORKS.has(framework.id))) {
    return { mode: "limited", routes: [], truncated: false };
  }

  return { mode: "none", routes: [], truncated: false };
}

function finalize(mode: "app_router" | "pages_router", routes: RouteSummary[]): RouteIntelligence {
  const deduped = new Map<string, RouteSummary>();
  for (const route of routes) {
    // Layouts are useful structure but must never shadow a real page at
    // the same URL.
    const key = `${route.kind}:${route.path}`;
    if (!deduped.has(key)) deduped.set(key, route);
  }

  const sorted = [...deduped.values()].sort((a, b) => a.path.localeCompare(b.path));
  return {
    mode,
    routes: sorted.slice(0, MAX_ROUTES),
    truncated: sorted.length > MAX_ROUTES,
  };
}
