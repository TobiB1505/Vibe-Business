import type { AIProvider, StructuredRequest, StructuredResult, TokenCountResult } from "@/modules/ai/provider";
import type { RepositoryIntelligenceSnapshot } from "@/modules/repository-intelligence/schema";
import type { LiveProductIntelligenceSnapshot } from "@/modules/live-product-intelligence/schema";
import type { BusinessContext } from "@/modules/projects/business-context";
import { AUDIT_DIMENSIONS } from "./schema";

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

/** A well-formed model response citing evidence ids that exist in the default pack. */
export function buildModelOutput(
  overrides: Partial<Record<(typeof AUDIT_DIMENSIONS)[number], Record<string, unknown>>> = {},
  extras: { keyFindings?: unknown; limitations?: unknown } = {},
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
    product: base(78, "assessable", ["business.product_summary", "live.site.title"]),
    monetization: base(35, "partial", ["live.surface.pricing", "business.monetization_model"]),
    distribution: base(null, "insufficient_evidence", []),
    conversion: base(61, "assessable", ["live.conversion.primary_cta"]),
    retention: base(null, "insufficient_evidence", []),
  };

  for (const [dimension, override] of Object.entries(overrides)) {
    dimensions[dimension] = { ...(dimensions[dimension] as Record<string, unknown>), ...override };
  }

  return {
    dimensions,
    keyFindings: extras.keyFindings ?? [
      { finding: "The product is understandable but not monetized.", evidenceIds: ["business.product_summary"] },
    ],
    limitations: extras.limitations ?? ["No traffic or usage data is available."],
  };
}

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
    runtime: [],
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
