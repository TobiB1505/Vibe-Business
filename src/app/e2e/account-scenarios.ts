import type { AuditReading, DashboardProject } from "@/modules/projects/dashboard";

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
