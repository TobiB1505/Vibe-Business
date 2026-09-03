import type { LiveProductIntelligenceSnapshot } from "@/modules/live-product-intelligence/schema";
import type { RepositoryIntelligenceSnapshot } from "@/modules/repository-intelligence/schema";

/**
 * Repository intelligence in a real browser (Sprint UI-3.6).
 *
 * Sprint 11C.1 built this harness because assertions about a component's
 * *source* had repeatedly disagreed with what the screen actually did. The
 * same argument applies here for a different reason: this sprint's claim is
 * about what a person reads first, and "the conclusion comes before the file
 * paths" is not a property a unit test on a data structure can check.
 *
 * The fixtures below are the shape a real Next.js SaaS produces: accounts and
 * a database detected, Stripe present with no page to buy from, no analytics,
 * and a live check that reaches the homepage but no pricing page — so the
 * cross-check between the two layers renders too.
 */

const COMMIT = "2f05958e3410deaeb97029861abc05889139b4a7";

function repositorySnapshot(): RepositoryIntelligenceSnapshot {
  return {
    schemaVersion: "repository_intelligence.v1",
    source: {
      commitSha: COMMIT,
      branch: "main",
      analyzerVersion: "repo-intelligence-v2",
      treeComplete: true,
    },
    repository: { fullName: "acme/product", defaultBranch: "main", private: true },
    completeness: { status: "complete", reasons: [] },
    projectStructure: {
      totalTreeEntries: 812,
      sourceFileCount: 431,
      topLevelDirectories: ["src", "public", "supabase"],
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
    frameworks: [
      {
        id: "nextjs",
        name: "Next.js",
        confidence: "high",
        evidence: [{ kind: "manifest_dependency", path: "package.json", detail: "next" }],
      },
    ],
    packageManager: "pnpm",
    scripts: { declared: ["test", "typecheck", "lint", "build"], source: "package.json" },
    build: {
      targets: [
        {
          directory: ".",
          manifestPath: "package.json",
          buildScript: true,
          frameworks: ["nextjs", "react"],
          lockfile: { path: "pnpm-lock.yaml", packageManager: "pnpm", inTargetDirectory: true },
          declaresWorkspaces: false,
          moduleLinker: null,
        },
      ],
      truncated: false,
    },
    runtime: [],
    integrationSignals: [
      {
        id: "supabase_auth",
        name: "Supabase Auth",
        category: "auth",
        confidence: "high",
        evidence: [{ kind: "manifest_dependency", path: "package.json", detail: "@supabase/ssr" }],
      },
      {
        id: "supabase",
        name: "Supabase",
        category: "database",
        confidence: "high",
        evidence: [
          { kind: "manifest_dependency", path: "package.json", detail: "@supabase/supabase-js" },
          { kind: "config_file", path: "supabase/config.toml" },
        ],
      },
      {
        id: "stripe",
        name: "Stripe",
        category: "payments",
        confidence: "high",
        evidence: [{ kind: "manifest_dependency", path: "package.json", detail: "stripe" }],
      },
      {
        id: "vercel",
        name: "Vercel",
        category: "deployment",
        confidence: "medium",
        evidence: [{ kind: "config_file", path: "vercel.json" }],
      },
    ],
    routes: {
      mode: "app_router",
      truncated: false,
      routes: [
        { path: "/", kind: "page", dynamic: false, sourcePath: "src/app/page.tsx" },
        { path: "/login", kind: "page", dynamic: false, sourcePath: "src/app/(auth)/login/page.tsx" },
        {
          path: "/signup",
          kind: "page",
          dynamic: false,
          sourcePath: "src/app/(auth)/signup/page.tsx",
        },
        {
          path: "/api/checkout",
          kind: "api",
          dynamic: false,
          sourcePath: "src/app/api/checkout/route.ts",
        },
      ],
    },
    businessSurfaces: [
      {
        id: "authentication",
        name: "Authentication",
        detected: true,
        confidence: "high",
        evidence: [{ kind: "manifest_dependency", path: "package.json", detail: "@supabase/ssr" }],
      },
      {
        id: "payments",
        name: "Payments",
        detected: true,
        confidence: "high",
        evidence: [{ kind: "manifest_dependency", path: "package.json", detail: "stripe" }],
      },
      { id: "pricing_page", name: "Pricing page", detected: false, confidence: "high", evidence: [] },
      {
        id: "checkout_billing",
        name: "Checkout / billing",
        detected: false,
        confidence: "high",
        evidence: [],
      },
      { id: "analytics", name: "Analytics", detected: false, confidence: "high", evidence: [] },
      {
        id: "seo_metadata",
        name: "SEO metadata",
        detected: true,
        confidence: "medium",
        evidence: [{ kind: "file_path", path: "src/app/opengraph-image.png" }],
      },
      { id: "sitemap", name: "Sitemap", detected: false, confidence: "high", evidence: [] },
      { id: "robots", name: "robots.txt", detected: false, confidence: "high", evidence: [] },
      { id: "blog_content", name: "Blog / content", detected: false, confidence: "high", evidence: [] },
      { id: "contact", name: "Contact", detected: false, confidence: "high", evidence: [] },
      { id: "docs_help", name: "Docs / help", detected: false, confidence: "high", evidence: [] },
      { id: "legal", name: "Legal pages", detected: false, confidence: "high", evidence: [] },
      { id: "onboarding", name: "Onboarding", detected: false, confidence: "high", evidence: [] },
      {
        id: "dashboard_app",
        name: "Dashboard / app area",
        detected: false,
        confidence: "high",
        evidence: [],
      },
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
          value: "#00e5a0",
          token: "--color-primary",
          confidence: "high",
          evidence: [{ kind: "config_file", path: "src/app/globals.css", detail: "--color-primary" }],
        },
      ],
      typefaces: [
        {
          role: "body",
          family: "Space Grotesk",
          confidence: "high",
          evidence: [{ kind: "config_file", path: "src/app/globals.css", detail: "--font-sans" }],
        },
      ],
      tokenSources: ["src/app/globals.css"],
    },
    metrics: {
      treeEntriesConsidered: 812,
      candidatesSelected: 12,
      filesFetched: 4,
      bytesFetched: 27_264,
      durationMs: 1081,
    },
    warnings: [],
  };
}

/** Reaches the homepage and the sign-in page; finds no pricing page. */
function liveSnapshot(): LiveProductIntelligenceSnapshot {
  return {
    productSurfaces: [
      { id: "homepage", name: "Homepage", detected: true, confidence: "high", evidence: [] },
      { id: "login", name: "Login", detected: true, confidence: "high", evidence: [] },
      { id: "pricing", name: "Pricing", detected: false, confidence: "none", evidence: [] },
      {
        id: "checkout_billing",
        name: "Checkout",
        detected: false,
        confidence: "none",
        evidence: [],
      },
    ],
  } as unknown as LiveProductIntelligenceSnapshot;
}

export type IntelligenceFixture = {
  snapshot: RepositoryIntelligenceSnapshot;
  analyzedAt: string;
  live: LiveProductIntelligenceSnapshot | null;
};

export const E2E_INTELLIGENCE_SCENARIOS = {
  /** Code only — no live check has run, so nothing is cross-checked. */
  repository_intelligence: (): IntelligenceFixture => ({
    snapshot: repositorySnapshot(),
    analyzedAt: "2026-08-14T08:22:59.917Z",
    live: null,
  }),

  /** Code and live product disagree about pricing (§11). */
  repository_intelligence_contradiction: (): IntelligenceFixture => ({
    snapshot: repositorySnapshot(),
    analyzedAt: "2026-08-14T08:22:59.917Z",
    live: liveSnapshot(),
  }),

  /** A framework whose routes are declared in code, so pages are unreadable. */
  repository_intelligence_limited_routes: (): IntelligenceFixture => {
    const snapshot = repositorySnapshot();
    return {
      snapshot: {
        ...snapshot,
        routes: { mode: "limited", routes: [], truncated: false },
        completeness: { status: "partial", reasons: ["tree_truncated"] },
      },
      analyzedAt: "2026-08-14T08:22:59.917Z",
      live: null,
    };
  },
} as const;

export type E2eIntelligenceScenario = keyof typeof E2E_INTELLIGENCE_SCENARIOS;

export function isE2eIntelligenceScenario(value: string): value is E2eIntelligenceScenario {
  return Object.hasOwn(E2E_INTELLIGENCE_SCENARIOS, value);
}
