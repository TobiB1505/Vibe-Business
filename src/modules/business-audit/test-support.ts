import type { AIProvider, StructuredRequest, StructuredResult, TokenCountResult } from "@/modules/ai/provider";
import type { RepositoryIntelligenceSnapshot } from "@/modules/repository-intelligence/schema";
import type { LiveProductIntelligenceSnapshot } from "@/modules/live-product-intelligence/schema";
import type {
  AuthenticatedPageSummary,
  AuthenticatedProductIntelligenceSnapshot,
} from "@/modules/authenticated-product-intelligence/schema";
import type { BusinessContext } from "@/modules/projects/business-context";
import type { FounderIntent } from "@/modules/projects/founder-intent";
import { AUDIT_DIMENSIONS, BUSINESS_LENSES } from "./schema";

/**
 * Fixtures and a fake provider (Sprint 4 §35, §36).
 *
 * The whole audit pipeline runs against these, so no test ever reaches the
 * Anthropic API, needs a key, or costs money.
 */

export class FakeProvider implements AIProvider {
  readonly name = "fake";
  readonly requests: StructuredRequest[] = [];
  readonly countRequests: StructuredRequest[] = [];

  constructor(
    private readonly behaviour: {
      tokenCount?: TokenCountResult;
      result?: StructuredResult;
    } = {},
  ) {}

  async countInputTokens(request: StructuredRequest): Promise<TokenCountResult> {
    this.countRequests.push(request);
    return this.behaviour.tokenCount ?? { ok: true, inputTokens: 2_500 };
  }

  async generateStructured(request: StructuredRequest): Promise<StructuredResult> {
    this.requests.push(request);
    return (
      this.behaviour.result ?? {
        ok: true,
        data: buildModelOutput(),
        usage: { inputTokens: 2_500, outputTokens: 900, thinkingTokens: 400 },
        model: "claude-sonnet-5",
        latencyMs: 4_200,
      }
    );
  }
}

/**
 * A well-formed model response citing evidence ids that exist in the default
 * pack, in the **provider wire form**: `dimensions` is an array whose entries
 * each name their own `dimension` (see `wire-schema.ts`). Fixtures speak the
 * transport format because that is what the provider actually returns; the
 * runner normalizes it before any domain rule runs.
 */
export function buildModelOutput(
  overrides: Partial<Record<(typeof AUDIT_DIMENSIONS)[number], Record<string, unknown>>> = {},
  extras: {
    lenses?: unknown;
    overallConclusion?: unknown;
    conclusions?: unknown;
    limitations?: unknown;
  } = {},
): Record<string, unknown> {
  const base = (score: number | null, status: string, evidenceIds: string[]) => ({
    assessmentStatus: status,
    score,
    confidence: "medium",
    summary: "A plain summary of the current state.",
    strengths: ["Something works"],
    gaps: ["Something is missing"],
    unknowns: ["Something is unobservable"],
    evidenceIds,
  });

  const dimensions: Record<string, unknown> = {
    product: base(78, "assessable", ["profile.identity.description", "live.site.title"]),
    monetization: base(35, "partial", ["profile.signal.pricing_surface", "intent.monetization_model"]),
    distribution: base(null, "insufficient_evidence", []),
    conversion: base(61, "assessable", ["live.conversion.primary_cta"]),
    retention: base(null, "insufficient_evidence", []),
  };

  for (const [dimension, override] of Object.entries(overrides)) {
    dimensions[dimension] = { ...(dimensions[dimension] as Record<string, unknown>), ...override };
  }

  return {
    dimensions: AUDIT_DIMENSIONS.map((dimension) => ({
      dimension,
      ...(dimensions[dimension] as Record<string, unknown>),
    })),
    // Every lens assessed exactly once, which is what the contract asks for.
    lenses:
      extras.lenses ??
      BUSINESS_LENSES.map((lens) => ({
        lens,
        health: "adequate",
        score: 60,
        materiality: "soon",
        summary: `Internal reasoning for ${lens}.`,
        evidenceIds: ["live.site.title"],
        missingContext: [],
      })),
    overallConclusion:
      extras.overallConclusion ??
      "You have a real product, but the path from interest to revenue is still incomplete.",
    // The synthesis, in the shape CORE-2a.1 asks for: one conclusion grouping
    // several pieces of evidence, not one conclusion per observation.
    conclusions: extras.conclusions ?? [
      {
        headline: "People can understand and start using your product.",
        explanation:
          "Vibe found a consistent product message and a clear way to sign up and get in.",
        whyItMatters: null,
        tone: "positive",
        confidence: "high",
        dimensions: ["product", "conversion"],
        lenses: ["offer", "conversion"],
        evidenceIds: ["profile.identity.description", "live.site.title"],
      },
      {
        headline: "People still don't have a clear path to paying you.",
        explanation:
          "Vibe couldn't find a way to see prices or buy anything, on the site or in the product.",
        whyItMatters:
          "Someone can like what you built and still leave because they don't know what it costs.",
        tone: "critical",
        confidence: "high",
        dimensions: ["monetization", "conversion"],
        lenses: ["revenue_economics", "conversion"],
        evidenceIds: ["profile.signal.pricing_surface", "intent.monetization_model"],
      },
    ],
    limitations: extras.limitations ?? ["No traffic or usage data is available."],
  };
}

/**
 * Historical. Used only by `evidence.test.ts` and `evidence-v2.test.ts`, which
 * pin what the v1 and v2 packs meant for audits already stored under those
 * versions. Nothing new builds one — see `fakeFounderIntent`.
 */
export function fakeBusinessContext(overrides: Partial<BusinessContext> = {}): BusinessContext {
  return {
    productSummary: "Vibe Business helps people who vibe-coded a product turn it into a business.",
    targetCustomer: "Solo builders who shipped something with AI tools",
    stage: "launched_no_users",
    monetizationModel: "planned",
    primaryGoal: "get_first_users",
    ...overrides,
  };
}

export function fakeFounderIntent(overrides: Partial<FounderIntent> = {}): FounderIntent {
  return {
    stage: "launched_no_users",
    monetizationModel: "planned",
    primaryGoal: "get_first_users",
    ...overrides,
  };
}

/**
 * Re-exported so audit tests have one import for their fixtures while the
 * profile itself keeps a single definition in the module that owns it.
 */
export { fakeProductProfile } from "@/modules/product-understanding/test-support";

export function fakeRepositorySnapshot(
  overrides: Partial<RepositoryIntelligenceSnapshot> = {},
): RepositoryIntelligenceSnapshot {
  return {
    schemaVersion: "repository_intelligence.v1",
    source: {
      commitSha: "abc1234def5678",
      branch: "main",
      analyzerVersion: "repo-intelligence-v1",
      treeComplete: true,
    },
    repository: { fullName: "acme/app", defaultBranch: "main", private: false },
    completeness: { status: "complete", reasons: [] },
    projectStructure: {
      totalTreeEntries: 120,
      sourceFileCount: 80,
      topLevelDirectories: ["src", "docs"],
      monorepo: { detected: false, tool: null, apps: [], packages: [], evidence: [], ambiguous: false },
    },
    languages: [{ id: "typescript", name: "TypeScript", confidence: "high", evidence: [] }],
    frameworks: [{ id: "nextjs", name: "Next.js", confidence: "high", evidence: [] }],
    packageManager: "pnpm",
    scripts: { declared: ["test", "typecheck", "lint", "build"], source: "package.json" },
    runtime: [],
    brand: { assets: [], colors: [], typefaces: [], tokenSources: [] },
    integrationSignals: [
      { id: "supabase", name: "Supabase", category: "database", confidence: "high", evidence: [] },
    ],
    routes: {
      mode: "app_router",
      routes: [
        { path: "/", kind: "page", dynamic: false, sourcePath: "src/app/page.tsx" },
        { path: "/login", kind: "page", dynamic: false, sourcePath: "src/app/login/page.tsx" },
      ],
      truncated: false,
    },
    businessSurfaces: [
      { id: "authentication", name: "Authentication", detected: true, confidence: "high", evidence: [] },
      { id: "payments", name: "Payments", detected: false, confidence: "high", evidence: [] },
      { id: "pricing_page", name: "Pricing page", detected: false, confidence: "high", evidence: [] },
    ],
    metrics: {
      treeEntriesConsidered: 120,
      candidatesSelected: 8,
      filesFetched: 6,
      bytesFetched: 40_000,
      durationMs: 1_200,
    },
    warnings: [],
    ...overrides,
  };
}

export function fakeLiveSnapshot(
  overrides: Partial<LiveProductIntelligenceSnapshot> = {},
): LiveProductIntelligenceSnapshot {
  return {
    schemaVersion: "live-product-intelligence.v1",
    source: {
      configuredUrl: "https://acme.test/",
      effectiveOrigin: "https://acme.test",
      analyzerVersion: "live-product-analyzer-v1",
      redirected: false,
      analyzedAt: "2026-08-10T00:00:00.000Z",
    },
    crawl: {
      pagesInspected: 3,
      pagesDiscovered: 3,
      maxDepthReached: 1,
      robotsTxtPresent: false,
      robotsRespected: true,
      sitemapPresent: false,
      sitemapUrlsConsidered: 0,
      redirectsFollowed: 0,
    },
    siteMetadata: {
      title: "Acme — Ship faster",
      description: "Acme helps teams ship faster.",
      language: "en",
      canonical: null,
      openGraph: {},
      structuredDataTypes: [],
    },
    pages: [
      {
        path: "/",
        status: 200,
        redirectedTo: null,
        title: "Acme",
        headingCount: 1,
        formCount: 0,
        linkCount: 3,
        ctas: ["Get started"],
        surfaces: ["homepage"],
        bytes: 8_000,
      },
      {
        path: "/app",
        status: 200,
        redirectedTo: "/login",
        title: "Log in",
        headingCount: 1,
        formCount: 1,
        linkCount: 1,
        ctas: [],
        surfaces: ["login", "dashboard_app"],
        bytes: 9_000,
      },
    ],
    productSurfaces: [
      { id: "homepage", name: "Homepage", detected: true, confidence: "high", evidence: [] },
      { id: "pricing", name: "Pricing", detected: false, confidence: "high", evidence: [] },
      { id: "login", name: "Login", detected: true, confidence: "high", evidence: [] },
      { id: "signup", name: "Signup", detected: true, confidence: "high", evidence: [] },
    ],
    seoSignals: [
      { id: "title", name: "Title", present: true, evidence: [] },
      { id: "canonical", name: "Canonical URL", present: false, evidence: [] },
      { id: "sitemap", name: "Sitemap", present: false, evidence: [] },
    ],
    brandSignals: { siteName: null, assets: [], colors: [], typefaces: [] },
    conversionSignals: {
      primaryCta: {
        category: "get_started",
        label: "Get started",
        confidence: "high",
        path: "/",
        inNav: false,
      },
      ctas: [],
      signupCtaPresent: true,
      pricingCtaPresent: false,
      contactCtaPresent: false,
      formCount: 1,
      forms: [
        { kind: "login_like", confidence: "high", fieldTypes: ["email", "password"], fieldCount: 2, path: "/login" },
      ],
      conversionPathLinks: ["/signup"],
    },
    metrics: { pagesFetched: 3, bytesFetched: 27_000, requestCount: 3, durationMs: 800 },
    completeness: { status: "complete", reasons: [] },
    warnings: [],
    ...overrides,
  };
}

/**
 * A Deep Scan snapshot fixture. Deliberately shaped like the first real one:
 * an app shell, one detected surface and one undetected surface.
 */
export function fakeAuthenticatedPage(overrides: Partial<AuthenticatedPageSummary> = {}): AuthenticatedPageSummary {
  return {
    path: "/app",
    source: "landing",
    status: 200,
    title: "Vibe Business",
    mainHeading: null,
    headingCount: 2,
    navLabels: [],
    actionLabels: [],
    formCount: 0,
    formFieldTypes: [],
    tableCount: 0,
    emptyStatePresent: false,
    emptyStateLabels: [],
    surfaces: [],
    depth: 0,
    ...overrides,
  };
}

export function fakeAuthenticatedSnapshot(
  overrides: Partial<AuthenticatedProductIntelligenceSnapshot> = {},
): AuthenticatedProductIntelligenceSnapshot {
  return {
    schemaVersion: "authenticated-product-intelligence.v1",
    source: {
      origin: "https://app.example.com",
      analyzerVersion: "v1",
      browserProvider: "browserbase",
      analyzedAt: "2026-08-11T00:00:00.000Z",
    },
    session: { sessionId: "s", landingPath: "/app", ignoredTabCount: 0 },
    crawl: {
      pagesInspected: 4,
      candidatesConsidered: 9,
      maxDepthReached: 1,
      candidateSources: {
        landing: 1,
        repository_route: 2,
        public_protected_redirect: 1,
        authenticated_link: 5,
      },
    },
    pages: [fakeAuthenticatedPage()],
    productSurfaces: [
      { id: "dashboard", name: "Dashboard", detected: true, confidence: "high", evidence: [] },
      { id: "billing", name: "Billing", detected: false, confidence: "low", evidence: [] },
    ],
    navigation: { labels: ["Dashboard", "Settings"], paths: ["/app", "/app/settings"] },
    applicationSignals: {
      appShellPresent: true,
      authenticatedAreaReached: true,
      reachableSurfaceCount: 4,
      dataTablePresent: true,
      emptyStatePresent: false,
      settingsPresent: true,
      billingPresent: false,
      onboardingPresent: false,
    },
    metrics: { pagesInspected: 4, navigationCount: 4, durationMs: 100, browserSessionDurationMs: 200 },
    completeness: { status: "complete", reasons: [] },
    warnings: [],
    ...overrides,
  } as AuthenticatedProductIntelligenceSnapshot;
}
