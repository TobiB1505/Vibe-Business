import type { DetectionContext } from "../context";
import { BUSINESS_SURFACE_LABELS } from "../schema";
import type {
  BusinessSurfaceId,
  BusinessSurfaceSignal,
  Evidence,
  IntegrationSignal,
  RouteIntelligence,
} from "../schema";

/**
 * Business surface signals (Sprint 2 §14) — the first bridge from "what
 * is this code" toward "what is this business".
 *
 * Strictly factual: a surface is either detected with evidence, or it is
 * not. No scoring, no ranking, no qualitative judgement ("your pricing is
 * weak") — that belongs to the later Business Readiness Audit, which will
 * consume these signals as input.
 */

function evidence(kind: Evidence["kind"], path: string, detail?: string): Evidence {
  return detail === undefined ? { kind, path } : { kind, path, detail };
}

/** Route-name patterns that indicate a surface, matched against inferred URLs. */
const ROUTE_PATTERNS: Partial<Record<BusinessSurfaceId, RegExp>> = {
  pricing_page: /^\/(pricing|plans|upgrade)(\/|$)/i,
  checkout_billing: /^\/(checkout|billing|subscribe|payment|account\/billing)(\/|$)/i,
  blog_content: /^\/(blog|posts|articles|changelog|news)(\/|$)/i,
  contact: /^\/(contact|support|help\/contact)(\/|$)/i,
  docs_help: /^\/(docs|documentation|help|guides|faq)(\/|$)/i,
  legal: /^\/(legal|privacy|terms|tos|imprint|impressum|cookie-policy)(\/|$)/i,
  onboarding: /^\/(onboarding|welcome|get-started|setup)(\/|$)/i,
  dashboard_app: /^\/(app|dashboard|console|admin)(\/|$)/i,
};

/**
 * File-backed surfaces claim that the *product serves* something, so only
 * locations a framework actually serves from may count. A file merely
 * *named* robots.ts, sitemap.ts or icon.tsx — a parser, a fixture, a React
 * component anywhere in `src/` — proves nothing, and matching by basename
 * alone produced a false positive that directly contradicted the live
 * crawl.
 *
 * Recognised locations:
 *   - a static asset directory served verbatim (`public/`, `static/`)
 *   - the repository root of a plain static site
 *   - the Next.js App Router file conventions, under `app/` or `src/app/`
 *
 * Each may sit under a monorepo workspace (`apps/web/…`, `packages/site/…`).
 */
const WORKSPACE_PREFIX = String.raw`(?:(?:apps|packages)/[^/]+/)?`;
/** Route groups organise files without contributing a URL segment. */
const ROUTE_GROUPS = String.raw`(?:\([^/]+\)/)*`;
/**
 * Any routable segment depth. `_private` directories are excluded because
 * Next.js opts them out of routing entirely, so nothing inside one is served.
 */
const ROUTABLE_SEGMENTS = String.raw`(?:[^_/][^/]*/)*`;
const ROUTE_FILE_EXTENSION = String.raw`(?:ts|tsx|js|jsx|mjs)`;

/** Served either as a static asset or through a `robots.ts`-style route. */
function servedFilePattern(name: string, staticExtension: string): RegExp {
  return new RegExp(
    `^${WORKSPACE_PREFIX}(?:` +
      String.raw`(?:public|static)/${name}\.${staticExtension}` +
      "|" +
      String.raw`${name}\.${staticExtension}` +
      "|" +
      `(?:src/)?app/${ROUTE_GROUPS}${name}\\.${ROUTE_FILE_EXTENSION}` +
      ")$",
    "i",
  );
}

const ROBOTS_PATH = servedFilePattern("robots", "txt");
const SITEMAP_PATH = servedFilePattern("sitemap", "xml");

/**
 * Next.js metadata images. Unlike robots/sitemap these apply per route
 * segment (`app/blog/opengraph-image.png` serves /blog), so they match at
 * any routable depth — but only inside the router, which is what makes
 * them metadata rather than an ordinary asset. A numeric suffix is the
 * convention for supplying several (`icon1.png`).
 */
const METADATA_IMAGE_EXTENSION = String.raw`(?:ts|tsx|js|jsx|mjs|ico|png|jpg|jpeg|gif|svg)`;
const METADATA_IMAGE_PATH = new RegExp(
  `^${WORKSPACE_PREFIX}(?:src/)?app/${ROUTABLE_SEGMENTS}` +
    String.raw`(?:opengraph-image|twitter-image|icon|apple-icon)\d*\.${METADATA_IMAGE_EXTENSION}$`,
  "i",
);

/**
 * Web app manifest. A repository-root `manifest.json` is deliberately not
 * accepted: that name is just as commonly a browser-extension or tooling
 * manifest, and an ambiguous match is exactly the failure being fixed.
 * `site.webmanifest` names only one thing, so it counts at the root of a
 * plain static site.
 */
const MANIFEST_PATH = new RegExp(
  `^${WORKSPACE_PREFIX}(?:` +
    String.raw`(?:public|static)/(?:manifest\.json|site\.webmanifest)` +
    "|" +
    String.raw`site\.webmanifest` +
    "|" +
    `(?:src/)?app/${ROUTE_GROUPS}manifest\\.(?:${ROUTE_FILE_EXTENSION}|json|webmanifest)` +
    ")$",
  "i",
);

function notDetected(id: BusinessSurfaceId): BusinessSurfaceSignal {
  return {
    id,
    name: BUSINESS_SURFACE_LABELS[id],
    detected: false,
    confidence: "high",
    evidence: [],
  };
}

function detected(
  id: BusinessSurfaceId,
  items: Evidence[],
  confidence: BusinessSurfaceSignal["confidence"] = "high",
): BusinessSurfaceSignal {
  return { id, name: BUSINESS_SURFACE_LABELS[id], detected: true, confidence, evidence: items };
}

export function detectBusinessSurfaces(
  context: DetectionContext,
  signals: IntegrationSignal[],
  routes: RouteIntelligence,
): BusinessSurfaceSignal[] {
  const results: BusinessSurfaceSignal[] = [];

  // --- Surfaces backed by an integration signal -----------------------
  const byCategory = (category: IntegrationSignal["category"]) =>
    signals.filter((signal) => signal.category === category);

  const authSignals = byCategory("auth");
  results.push(
    authSignals.length > 0
      ? detected(
          "authentication",
          authSignals.flatMap((signal) => signal.evidence),
        )
      : notDetected("authentication"),
  );

  const paymentSignals = byCategory("payments");
  results.push(
    paymentSignals.length > 0
      ? detected(
          "payments",
          paymentSignals.flatMap((signal) => signal.evidence),
        )
      : notDetected("payments"),
  );

  const analyticsSignals = byCategory("analytics");
  results.push(
    analyticsSignals.length > 0
      ? detected(
          "analytics",
          analyticsSignals.flatMap((signal) => signal.evidence),
        )
      : notDetected("analytics"),
  );

  // --- Surfaces backed by a known file --------------------------------
  const robots = context.sourcePaths.find((path) => ROBOTS_PATH.test(path));
  results.push(
    robots ? detected("robots", [evidence("file_path", robots)]) : notDetected("robots"),
  );

  const sitemap = context.sourcePaths.find((path) => SITEMAP_PATH.test(path));
  results.push(
    sitemap ? detected("sitemap", [evidence("file_path", sitemap)]) : notDetected("sitemap"),
  );

  // Next.js exposes SEO metadata through a `metadata` export or a
  // generated OG image; both are conventional filenames in conventional
  // places, so presence is detectable without reading code.
  const metadataFiles = context.sourcePaths.filter((path) => METADATA_IMAGE_PATH.test(path));
  const manifestFile = context.sourcePaths.find((path) => MANIFEST_PATH.test(path));
  const seoEvidence: Evidence[] = [
    ...metadataFiles.slice(0, 3).map((path) => evidence("file_path", path)),
    ...(manifestFile ? [evidence("file_path", manifestFile)] : []),
  ];
  results.push(
    seoEvidence.length > 0
      ? detected("seo_metadata", seoEvidence, "medium")
      : notDetected("seo_metadata"),
  );

  // --- Surfaces inferred from routes ----------------------------------
  // Only meaningful when route detection actually worked; otherwise the
  // honest answer is "not detected", not "absent".
  const routeSurfaces: BusinessSurfaceId[] = [
    "pricing_page",
    "checkout_billing",
    "blog_content",
    "contact",
    "docs_help",
    "legal",
    "onboarding",
    "dashboard_app",
  ];

  for (const id of routeSurfaces) {
    const pattern = ROUTE_PATTERNS[id];
    if (!pattern) {
      results.push(notDetected(id));
      continue;
    }

    const matches = routes.routes.filter(
      (route) => route.kind === "page" && pattern.test(route.path),
    );
    results.push(
      matches.length > 0
        ? detected(
            id,
            matches.slice(0, 3).map((route) => evidence("file_path", route.sourcePath, route.path)),
          )
        : notDetected(id),
    );
  }

  return results;
}
