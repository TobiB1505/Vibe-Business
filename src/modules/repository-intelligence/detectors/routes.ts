import { pathBasename, pathExtension } from "../path-policy";
import type { DetectionContext } from "../context";
import type {
  BuildIntelligence,
  Detection,
  RouteIntelligence,
  RouteKind,
  RouteSummary,
} from "../schema";

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

/**
 * Where the applications are, for a router search that is not root-relative.
 *
 * The whole detector used to look in `src/app/` and `app/` and nowhere else, so
 * a Next.js application in `frontend/` reported **zero routes** — not "we could
 * not read it", but an empty route table indistinguishable from a project that
 * has none. Everything downstream inherited that: no app root to write a
 * `robots.ts` into, no route table for the review classifier, no surfaces
 * derived from routes.
 *
 * Build targets are the answer already computed one detector over: directories
 * holding a manifest Vibe could install and build. `.` when there are none, so
 * a repository the build detector cannot describe still gets today's search.
 */
function applicationDirectories(build: BuildIntelligence): readonly string[] {
  const next = build.targets.filter((target) => target.frameworks.includes("nextjs"));
  const candidates = next.length > 0 ? next : build.targets;

  return candidates.length > 0 ? candidates.map((target) => target.directory) : ["."];
}

/**
 * The one router directory, or null when there is not exactly one.
 *
 * Within a single application `src/app/` wins over `app/`, which is Next.js's
 * own resolution order rather than a preference of ours. **Across** applications
 * nothing wins: two applications with routers is a question this detector
 * cannot answer, and picking the first would put a guess where a fact belongs.
 * That is the discipline `resolveAppRoot` already applied to writing, moved one
 * layer earlier to where the evidence actually is.
 */
function findRouterRoot(
  context: DetectionContext,
  build: BuildIntelligence,
  directory: "app" | "pages",
): string | null {
  const found = new Set<string>();

  for (const application of applicationDirectories(build)) {
    const base = application === "." ? "" : `${application}/`;
    for (const prefix of [`${base}src/${directory}/`, `${base}${directory}/`]) {
      if (context.sourcePaths.some((path) => path.startsWith(prefix))) {
        found.add(prefix);
        break;
      }
    }
  }

  return found.size === 1 ? [...found][0] : null;
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
  build: BuildIntelligence,
): RouteIntelligence {
  const isNext = frameworks.some((framework) => framework.id === "nextjs");

  if (isNext) {
    const appRoot = findRouterRoot(context, build, "app");
    const pagesRoot = findRouterRoot(context, build, "pages");

    // A project may contain both during a migration; App Router wins
    // because that is what Next.js itself prioritises.
    if (appRoot) {
      return finalize("app_router", detectAppRouterRoutes(context, appRoot), appRoot);
    }
    if (pagesRoot) {
      return finalize("pages_router", detectPagesRouterRoutes(context, pagesRoot), pagesRoot);
    }
    return { mode: "limited", routes: [], truncated: false };
  }

  if (frameworks.some((framework) => CODE_ROUTED_FRAMEWORKS.has(framework.id))) {
    return { mode: "limited", routes: [], truncated: false };
  }

  return { mode: "none", routes: [], truncated: false };
}

function finalize(
  mode: "app_router" | "pages_router",
  routes: RouteSummary[],
  root: string,
): RouteIntelligence {
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
    root,
  };
}
