import type { AuditReading, DashboardProject } from "@/modules/projects/dashboard";
import type { ProductOverviewItem } from "@/modules/projects/product-summary";
import type { ConnectedRepository } from "@/modules/projects/account-repositories";

/**
 * Browser fixtures for the account dashboard (CORE-6).
 *
 * ## What they exist to prove
 *
 * A density budget. `/app` is the calmest screen in the product and it is one
 * feature away from becoming the project workspace: every section anyone adds
 * here is defensible on its own, and the sum is an admin panel. A target
 * nothing enforces erodes on the next commit, so `e2e/account-dashboard.spec.ts`
 * counts what is on screen against these.
 *
 * ## Why the fixtures are `DashboardProject` and not a view model
 *
 * Because that is what `getDashboardOverview` returns and what `AccountHome`
 * takes. There is no view model between them to fake — the ordering, the
 * headline and the hero all derive from these rows inside the real component,
 * which is what makes a count taken from the browser a count of the real
 * screen.
 *
 * ## Why three products
 *
 * The budget is meaningless at one. Nine metadata pairs in one band is what
 * three cards produce, and one card cannot show an N+1 of anything.
 */

const CONTRACT = {
  schemaVersion: "1",
  auditVersion: "audit-v3",
  evidencePackVersion: "pack-v2",
  promptVersion: "prompt-v4",
  rubricVersion: "rubric-v2",
  provider: "anthropic",
  model: "claude-opus-5",
};

function reading(score: number | null, recordedAt: string, rubric?: string): AuditReading {
  return {
    score,
    recordedAt,
    contract: rubric ? { ...CONTRACT, rubricVersion: rubric } : CONTRACT,
  };
}

function project(overrides: Partial<DashboardProject> & { id: string; name: string }): DashboardProject {
  return {
    repositoryFullName: "founder/product",
    defaultBranch: "main",
    score: null,
    scoreState: "not_audited",
    topMove: null,
    lastAnalysedAt: null,
    scoreHistory: [],
    nextMovesCount: null,
    preparedCount: 0,
    failedValidationCount: 0,
    ...overrides,
  };
}

/** Three products, one of them blocked — so the hero has something to be about. */
const THREE_PRODUCTS: DashboardProject[] = [
  project({
    id: "project_e2e_settled",
    name: "Quietly Fine",
    score: 71,
    scoreState: "scored",
    lastAnalysedAt: "2026-08-20T09:00:00Z",
    scoreHistory: [
      reading(71, "2026-08-20T09:00:00Z"),
      reading(64, "2026-08-10T09:00:00Z"),
    ],
    nextMovesCount: 0,
  }),
  project({
    id: "project_e2e_blocked",
    name: "Needs You Now",
    score: 46,
    scoreState: "scored",
    lastAnalysedAt: "2026-08-22T09:00:00Z",
    scoreHistory: [
      reading(46, "2026-08-22T09:00:00Z"),
      reading(43, "2026-08-18T09:00:00Z"),
      reading(null, "2026-08-14T09:00:00Z"),
      // Before the rubric changed. The line must break here rather than
      // climbing from 39 to 46 as if the business had moved seven points.
      reading(39, "2026-08-02T09:00:00Z", "rubric-v1"),
    ],
    topMove: {
      id: "1-revenue-put-a-price-on-the-product",
      title: "Put a price on the product",
      problem: "Nobody can pay you. There is no pricing page and no checkout anywhere on the site.",
      impact: "high",
      effort: "medium",
    },
    nextMovesCount: 3,
    preparedCount: 1,
    failedValidationCount: 1,
  }),
  project({
    id: "project_e2e_waiting",
    name: "Half Set Up",
    score: 58,
    scoreState: "scored",
    lastAnalysedAt: "2026-08-19T09:00:00Z",
    scoreHistory: [reading(58, "2026-08-19T09:00:00Z")],
    topMove: {
      id: "1-positioning-say-who-the-product-is-for",
      title: "Say who the product is for",
      problem: "The homepage describes what it does and never says who should use it.",
      impact: "medium",
      effort: "low",
    },
    nextMovesCount: 2,
  }),
];

export const E2E_ACCOUNT_SCENARIOS = {
  /** The budget case. */
  "account-three-products": (): DashboardProject[] => THREE_PRODUCTS,

  /** One product, never analysed: the hero must offer a sentence, not a zero. */
  "account-unscored": (): DashboardProject[] => [
    project({ id: "project_e2e_new", name: "Just Connected" }),
  ],

  /** No products at all. */
  "account-empty": (): DashboardProject[] => [],
} as const;

export type E2eAccountScenario = keyof typeof E2E_ACCOUNT_SCENARIOS;

export function isE2eAccountScenario(value: string): value is E2eAccountScenario {
  return value in E2E_ACCOUNT_SCENARIOS;
}

const PRODUCT_CONTEXT = [
  {
    shortDescription: "A calm command center for turning product evidence into business action.",
    mainPurpose: "Turns product evidence into a ranked growth plan.",
    primaryAudience: "Independent founders and small product teams",
    founderGoal: "Grow revenue",
    category: "SaaS application",
  },
  {
    shortDescription: "A focused workspace for validating and shipping the next business move.",
    mainPurpose: "Finds the most important business gap and prepares the work around it.",
    primaryAudience: "Founders with a product already in market",
    founderGoal: "Start monetizing",
    category: "Web app",
  },
  {
    shortDescription: null,
    mainPurpose: null,
    primaryAudience: null,
    founderGoal: null,
    category: null,
  },
] as const;

export const E2E_PRODUCTS_SCENARIOS = {
  "account-products": (): ProductOverviewItem[] =>
    THREE_PRODUCTS.map((item, index) => ({
      ...item,
      repositoryPrivate: index !== 0,
      productProfileId: index === 2 ? null : `profile_${index}`,
      ...PRODUCT_CONTEXT[index],
      ...(index === 2
        ? {
            score: null,
            scoreState: "not_audited" as const,
            lastAnalysedAt: null,
            scoreHistory: [],
            nextMovesCount: null,
            topMove: null,
          }
        : {}),
    })),
} as const;

export type E2eProductsScenario = keyof typeof E2E_PRODUCTS_SCENARIOS;

export function isE2eProductsScenario(value: string): value is E2eProductsScenario {
  return value in E2E_PRODUCTS_SCENARIOS;
}

const REPOSITORY_NAMES = [
  ["Vibe Business", "vibe-business", false, "main"],
  ["SaaS Analyzer", "saas-analyzer", true, "main"],
  ["Landing Pro", "landing-pro", true, "develop"],
  ["Idea Capture", "idea-capture", false, "main"],
  ["Team Monitor", "team-monitor", true, "develop"],
  ["Invoice Studio", "invoice-studio", true, "main"],
  ["Launch Notes", "launch-notes", false, "release"],
] as const;

export const E2E_REPOSITORIES_SCENARIOS = {
  "account-repositories": (): ConnectedRepository[] =>
    REPOSITORY_NAMES.map(([projectName, name, privateRepository, defaultBranch], index) => ({
      projectId: `repository_project_${index}`,
      projectName,
      owner: "TobiB1505",
      name,
      fullName: `TobiB1505/${name}`,
      defaultBranch,
      private: privateRepository,
      htmlUrl: `https://github.com/TobiB1505/${name}`,
      connectedAt: `2026-08-${String(24 - index).padStart(2, "0")}T10:00:00Z`,
      // One repository whose installation was removed on GitHub, so the
      // browser suite meets the state a customer creates by revoking access
      // rather than only the happy list (VB-041).
      accessRevokedAt: index === 2 ? "2026-08-27T09:00:00Z" : null,
    })),
  "account-repositories-empty": (): ConnectedRepository[] => [],
} as const;

export type E2eRepositoriesScenario = keyof typeof E2E_REPOSITORIES_SCENARIOS;

export function isE2eRepositoriesScenario(value: string): value is E2eRepositoriesScenario {
  return value in E2E_REPOSITORIES_SCENARIOS;
}
