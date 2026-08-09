import type { DetectionContext } from "../context";
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

const SURFACE_NAMES: Record<BusinessSurfaceId, string> = {
  authentication: "Authentication",
  payments: "Payments",
  pricing_page: "Pricing page",
  checkout_billing: "Checkout / billing",
  analytics: "Analytics",
  seo_metadata: "SEO metadata",
  sitemap: "Sitemap",
  robots: "robots.txt",
  blog_content: "Blog / content",
  contact: "Contact",
  docs_help: "Docs / help",
  legal: "Legal pages",
  onboarding: "Onboarding",
  dashboard_app: "Dashboard / app area",
};

function notDetected(id: BusinessSurfaceId): BusinessSurfaceSignal {
  return { id, name: SURFACE_NAMES[id], detected: false, confidence: "high", evidence: [] };
}

function detected(
  id: BusinessSurfaceId,
  items: Evidence[],
  confidence: BusinessSurfaceSignal["confidence"] = "high",
): BusinessSurfaceSignal {
  return { id, name: SURFACE_NAMES[id], detected: true, confidence, evidence: items };
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
      ? detected("authentication", authSignals.flatMap((signal) => signal.evidence))
      : notDetected("authentication"),
  );

  const paymentSignals = byCategory("payments");
  results.push(
    paymentSignals.length > 0
      ? detected("payments", paymentSignals.flatMap((signal) => signal.evidence))
      : notDetected("payments"),
  );

  const analyticsSignals = byCategory("analytics");
  results.push(
    analyticsSignals.length > 0
      ? detected("analytics", analyticsSignals.flatMap((signal) => signal.evidence))
      : notDetected("analytics"),
  );

  // --- Surfaces backed by a known file --------------------------------
  const robots = context.findByBasename(/^robots\.(txt|ts|js)$/i)[0];
  results.push(robots ? detected("robots", [evidence("file_path", robots)]) : notDetected("robots"));

  const sitemap = context.findByBasename(/^sitemap(\.xml|\.ts|\.js)?$/i)[0];
  results.push(sitemap ? detected("sitemap", [evidence("file_path", sitemap)]) : notDetected("sitemap"));

  // Next.js exposes SEO metadata through a `metadata` export or a
  // generated OG image; both are conventional filenames, so presence is
  // detectable without reading code.
  const metadataFiles = context.findByBasename(/^(opengraph-image|twitter-image|icon|apple-icon)\.[\w]+$/i);
  const manifestFile = context.findByBasename(/^(manifest\.json|site\.webmanifest)$/i)[0];
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

    const matches = routes.routes.filter((route) => route.kind === "page" && pattern.test(route.path));
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
