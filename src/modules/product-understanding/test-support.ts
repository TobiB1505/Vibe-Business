import type {
  AIProvider,
  StructuredRequest,
  StructuredResult,
  TokenCountResult,
} from "@/modules/ai/provider";
import type { LiveProductIntelligenceSnapshot } from "@/modules/live-product-intelligence/schema";
import type { RepositoryIntelligenceSnapshot } from "@/modules/repository-intelligence/schema";
import { SYNTHESIS_FIELDS } from "./wire-schema";

/**
 * Fixtures and a fake provider for the Product Understanding pipeline.
 *
 * The whole pipeline runs against these, so no test reaches the Anthropic API,
 * needs a key, or costs money.
 *
 * The snapshots below describe a plausible small SaaS rather than Vibe
 * Business specifically: accounts and a database, Stripe present, a pricing
 * page in code that the live site does not serve, no analytics. That shape is
 * what exercises the interesting rules — code-only versus served, and a
 * business signal that must stay an observation rather than becoming a verdict.
 */

export class FakeProvider implements AIProvider {
  readonly name = "fake";
  readonly requests: StructuredRequest[] = [];
  readonly countRequests: StructuredRequest[] = [];

  constructor(
    private readonly behaviour: {
      tokenCount?: TokenCountResult | TokenCountResult[];
      result?: StructuredResult;
    } = {},
  ) {}

  async countInputTokens(request: StructuredRequest): Promise<TokenCountResult> {
    this.countRequests.push(request);
    const configured = this.behaviour.tokenCount;
    if (Array.isArray(configured)) {
      // Successive counts, so the runner's trim-and-recount loop is testable.
      return configured[Math.min(this.countRequests.length - 1, configured.length - 1)];
    }
    return configured ?? { ok: true, inputTokens: 3_000 };
  }

  async generateStructured(request: StructuredRequest): Promise<StructuredResult> {
    this.requests.push(request);
    return (
      this.behaviour.result ?? {
        ok: true,
        data: buildModelOutput(),
        usage: { inputTokens: 3_000, outputTokens: 700, thinkingTokens: 200 },
        model: "claude-haiku-4-5-20251001",
        latencyMs: 2_100,
      }
    );
  }
}

/**
 * A well-formed model response in the **provider wire form**: `fields` is an
 * array whose entries each name their own `field`. Fixtures speak the
 * transport format because that is what a provider actually returns; the
 * runner normalizes it before any domain rule runs.
 */
export function buildModelOutput(
  overrides: Partial<Record<(typeof SYNTHESIS_FIELDS)[number], Record<string, unknown>>> = {},
  extras: {
    category?: unknown;
    categoryConfidence?: unknown;
    categoryEvidenceIds?: unknown;
    primaryCapabilities?: unknown;
    limitations?: unknown;
  } = {},
): Record<string, unknown> {
  const defaults: Record<string, { value: string | null; confidence: string; evidenceIds: string[] }> = {
    name: { value: "Acme", confidence: "likely", evidenceIds: ["live.meta.title"] },
    shortDescription: {
      value: "A tool for scheduling shifts.",
      confidence: "likely",
      evidenceIds: ["live.meta.description"],
    },
    understanding: {
      value: "You've built a tool that helps small teams schedule shifts and see who is working when.",
      confidence: "likely",
      evidenceIds: ["live.meta.description", "live.heading.0"],
    },
    mainPurpose: {
      value: "Keep a team's schedule in one place.",
      confidence: "likely",
      evidenceIds: ["live.meta.description"],
    },
    mainPromise: {
      value: "Never wonder who is working today.",
      confidence: "likely",
      evidenceIds: ["live.heading.0"],
    },
    primaryAudience: {
      value: "Small teams that work in shifts",
      confidence: "likely",
      evidenceIds: ["live.meta.description"],
    },
    userType: { value: "Team managers", confidence: "unclear", evidenceIds: [] },
    problemSolved: {
      value: "Schedules live in spreadsheets nobody can find.",
      confidence: "likely",
      evidenceIds: ["live.heading.0"],
    },
    useCase: { value: null, confidence: "not_found", evidenceIds: [] },
    tone: { value: "direct", confidence: "likely", evidenceIds: ["live.heading.0"] },
    positioningLine: { value: null, confidence: "not_found", evidenceIds: [] },
  };

  for (const [field, override] of Object.entries(overrides)) {
    defaults[field] = { ...defaults[field], ...(override as Record<string, never>) };
  }

  return {
    fields: SYNTHESIS_FIELDS.map((field) => ({ field, ...defaults[field] })),
    category: extras.category ?? "saas_application",
    categoryConfidence: extras.categoryConfidence ?? "likely",
    categoryEvidenceIds: extras.categoryEvidenceIds ?? ["repo.framework.nextjs"],
    primaryCapabilities: extras.primaryCapabilities ?? [
      { capability: "create_account", evidenceIds: ["live.surface.signup"] },
      { capability: "use_dashboard", evidenceIds: ["repo.surface.dashboard_app"] },
    ],
    limitations: extras.limitations ?? ["Vibe has not seen anything behind your login."],
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
      analyzerVersion: "repo-intelligence-v3",
      treeComplete: true,
    },
    repository: { fullName: "acme/shifts", defaultBranch: "main", private: false },
    completeness: { status: "complete", reasons: [] },
    projectStructure: {
      totalTreeEntries: 240,
      sourceFileCount: 160,
      topLevelDirectories: ["src", "public", "tests"],
      monorepo: {
        detected: false,
        tool: null,
        apps: [],
        packages: [],
        evidence: [],
        ambiguous: false,
      },
    },
    languages: [{ id: "typescript", name: "TypeScript", confidence: "high", evidence: [] }],
    frameworks: [{ id: "nextjs", name: "Next.js", confidence: "high", evidence: [] }],
    packageManager: "pnpm",
    runtime: [],
    integrationSignals: [
      { id: "supabase", name: "Supabase", category: "database", confidence: "high", evidence: [] },
      { id: "stripe", name: "Stripe", category: "payments", confidence: "high", evidence: [] },
    ],
    routes: {
      mode: "app_router",
      truncated: false,
      routes: [
        { path: "/", kind: "page", dynamic: false, sourcePath: "src/app/page.tsx" },
        { path: "/pricing", kind: "page", dynamic: false, sourcePath: "src/app/pricing/page.tsx" },
        { path: "/settings", kind: "page", dynamic: false, sourcePath: "src/app/settings/page.tsx" },
      ],
    },
    businessSurfaces: [
      { id: "authentication", name: "Authentication", detected: true, confidence: "high", evidence: [] },
      { id: "payments", name: "Payments", detected: true, confidence: "high", evidence: [] },
      { id: "pricing_page", name: "Pricing page", detected: true, confidence: "medium", evidence: [] },
      { id: "analytics", name: "Analytics", detected: false, confidence: "high", evidence: [] },
      { id: "dashboard_app", name: "Dashboard / app area", detected: true, confidence: "high", evidence: [] },
      { id: "blog_content", name: "Blog / content", detected: false, confidence: "high", evidence: [] },
      { id: "docs_help", name: "Docs / help", detected: false, confidence: "high", evidence: [] },
      { id: "contact", name: "Contact", detected: false, confidence: "high", evidence: [] },
      { id: "checkout_billing", name: "Checkout / billing", detected: false, confidence: "high", evidence: [] },
      { id: "onboarding", name: "Onboarding", detected: false, confidence: "high", evidence: [] },
      { id: "seo_metadata", name: "SEO metadata", detected: true, confidence: "medium", evidence: [] },
      { id: "sitemap", name: "Sitemap", detected: false, confidence: "high", evidence: [] },
      { id: "robots", name: "robots.txt", detected: false, confidence: "high", evidence: [] },
      { id: "legal", name: "Legal pages", detected: false, confidence: "high", evidence: [] },
    ],
    brand: {
      assets: [
        {
          role: "logo",
          path: "public/logo.svg",
          servedPath: "/logo.svg",
          confidence: "high",
          evidence: [{ kind: "file_path", path: "public/logo.svg", detail: "logo" }],
        },
      ],
      colors: [
        {
          role: "primary",
          value: "#3355ff",
          token: "--color-primary",
          confidence: "high",
          evidence: [{ kind: "config_file", path: "src/app/globals.css", detail: "--color-primary" }],
        },
      ],
      typefaces: [
        {
          role: "body",
          family: "Inter",
          confidence: "high",
          evidence: [{ kind: "config_file", path: "src/app/globals.css", detail: "--font-sans" }],
        },
      ],
      tokenSources: ["src/app/globals.css"],
    },
    metrics: {
      treeEntriesConsidered: 240,
      candidatesSelected: 8,
      filesFetched: 3,
      bytesFetched: 18_000,
      durationMs: 900,
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
      configuredUrl: "https://acme.test",
      effectiveOrigin: "https://acme.test",
      analyzerVersion: "live-product-analyzer-v2",
      redirected: false,
      analyzedAt: "2026-08-15T12:00:00.000Z",
    },
    crawl: {
      pagesInspected: 3,
      pagesDiscovered: 6,
      maxDepthReached: 1,
      robotsTxtPresent: true,
      robotsRespected: true,
      sitemapPresent: false,
      sitemapUrlsConsidered: 0,
      redirectsFollowed: 0,
    },
    siteMetadata: {
      title: "Acme — shift scheduling for small teams",
      description: "Keep your team's schedule in one place.",
      language: "en",
      canonical: "https://acme.test/",
      openGraph: { "og:site_name": "Acme" },
      structuredDataTypes: [],
    },
    pages: [
      {
        path: "/",
        status: 200,
        redirectedTo: null,
        title: "Acme — shift scheduling for small teams",
        headingCount: 6,
        formCount: 0,
        linkCount: 14,
        ctas: ["Start free", "Sign in"],
        surfaces: ["homepage"],
        bytes: 24_000,
      },
      {
        path: "/login",
        status: 200,
        redirectedTo: null,
        title: "Sign in — Acme",
        headingCount: 1,
        formCount: 1,
        linkCount: 3,
        ctas: ["Sign in"],
        surfaces: ["login"],
        bytes: 9_000,
      },
      {
        path: "/signup",
        status: 200,
        redirectedTo: null,
        title: "Create an account — Acme",
        headingCount: 1,
        formCount: 1,
        linkCount: 3,
        ctas: ["Start free"],
        surfaces: ["signup"],
        bytes: 9_500,
      },
    ],
    productSurfaces: [
      { id: "homepage", name: "Homepage", detected: true, confidence: "high", evidence: [] },
      { id: "login", name: "Login", detected: true, confidence: "high", evidence: [] },
      { id: "signup", name: "Sign-up", detected: true, confidence: "high", evidence: [] },
      // In the code, not on the live site — the disagreement that makes the
      // two collectors worth keeping separate.
      { id: "pricing", name: "Pricing", detected: false, confidence: "high", evidence: [] },
      { id: "dashboard_app", name: "Dashboard / app", detected: false, confidence: "medium", evidence: [] },
      { id: "checkout_billing", name: "Checkout / billing", detected: false, confidence: "high", evidence: [] },
      { id: "onboarding", name: "Onboarding", detected: false, confidence: "high", evidence: [] },
      { id: "contact", name: "Contact", detected: false, confidence: "high", evidence: [] },
      { id: "docs_help", name: "Docs / help", detected: false, confidence: "high", evidence: [] },
      { id: "blog_content", name: "Blog / content", detected: false, confidence: "high", evidence: [] },
      { id: "privacy", name: "Privacy", detected: false, confidence: "high", evidence: [] },
      { id: "terms", name: "Terms", detected: false, confidence: "high", evidence: [] },
    ],
    seoSignals: [],
    conversionSignals: {
      primaryCta: {
        category: "get_started",
        label: "Start free",
        confidence: "high",
        path: "/",
        inNav: true,
      },
      ctas: [
        { category: "get_started", label: "Start free", confidence: "high", path: "/", inNav: true },
        { category: "login", label: "Sign in", confidence: "high", path: "/", inNav: true },
      ],
      signupCtaPresent: true,
      pricingCtaPresent: false,
      contactCtaPresent: false,
      formCount: 2,
      forms: [
        { kind: "login_like", confidence: "high", fieldTypes: ["email", "password"], fieldCount: 2, path: "/login" },
        { kind: "signup_like", confidence: "high", fieldTypes: ["email", "password"], fieldCount: 2, path: "/signup" },
      ],
      conversionPathLinks: ["/signup"],
    },
    brandSignals: {
      siteName: "Acme",
      assets: [
        {
          role: "favicon",
          path: "/favicon.svg",
          label: null,
          confidence: "high",
          evidence: [{ kind: "url_path", path: "/", detail: "icon" }],
        },
        {
          role: "logo",
          path: "/logo.svg",
          label: "Acme logo",
          confidence: "high",
          evidence: [{ kind: "nav_label", path: "/", detail: "Acme logo" }],
        },
      ],
      colors: [
        {
          source: "theme_color_meta",
          value: "#3355ff",
          token: null,
          confidence: "high",
          evidence: [{ kind: "http_header", path: "/", detail: "theme-color" }],
        },
      ],
      typefaces: ["Inter"],
    },
    metrics: { pagesFetched: 3, bytesFetched: 42_500, requestCount: 4, durationMs: 1_800 },
    completeness: { status: "complete", reasons: [] },
    warnings: [],
    ...overrides,
  };
}

/** A fixed clock, so an assembled profile is byte-identical across runs. */
export const FIXED_NOW = "2026-08-15T12:30:00.000Z";
export const fixedNow = () => FIXED_NOW;
