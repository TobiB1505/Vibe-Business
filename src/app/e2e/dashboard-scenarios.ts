import { buildScoreHistory, scoreDeltaFrom, type DashboardProject } from "@/modules/projects/dashboard";

/**
 * The dashboard's project cards in a real browser (UI-8).
 *
 * ## What this suite is for
 *
 * The card is where a `null` becomes pixels, and this project has paid for
 * that boundary before: a score the domain never produced rendered as a zero
 * is a product telling a founder their business scored badly when in fact
 * nothing was measurable. Rule 44 is enforced in `dashboard.ts` and asserted
 * by unit tests — this is the same rule asserted where a person would actually
 * see it break.
 *
 * ## Why the history is *built* rather than written
 *
 * Every fixture runs the real `buildScoreHistory` and `scoreDeltaFrom` over
 * audit rows in the shape the read model's own query returns. So a change to
 * the skip-unscored rule changes what the browser sees, instead of leaving a
 * hand-written array to drift away from the rule it demonstrates.
 *
 * ## What it cannot prove
 *
 * That `page.tsx` assembles the right props, or that RLS scopes the read. The
 * same documented floor every suite in this harness carries.
 */

function project(overrides: Partial<DashboardProject>): DashboardProject {
  return {
    id: "project_e2e",
    name: "Example Product",
    repositoryFullName: "vibe-e2e/example",
    defaultBranch: "main",
    score: null,
    scoreState: "not_audited",
    nextMovesCount: null,
    preparedCount: 0,
    failedValidationCount: 0,
    scoreHistory: [],
    scoreDelta: null,
    ...overrides,
  };
}

/** A scored project whose history is derived from real audit rows. */
function scored(
  overrides: Partial<DashboardProject>,
  auditsNewestFirst: (number | null)[],
): DashboardProject {
  const rows = auditsNewestFirst.map((overall_score) => ({ overall_score }));
  const scoreHistory = buildScoreHistory(rows);
  const latest = auditsNewestFirst[0] ?? null;

  return project({
    score: latest,
    scoreState: latest === null ? "insufficient_coverage" : "scored",
    scoreHistory,
    scoreDelta: scoreDeltaFrom(scoreHistory),
    ...overrides,
  });
}

export const E2E_DASHBOARD_SCENARIOS = {
  /**
   * Connected, never analysed. The card must say "Not analysed" and show no
   * number at all — the case where a `?? 0` anywhere in the chain would put a
   * zero on screen.
   */
  "dashboard-never-analysed": () => [
    project({ name: "Never Analysed", scoreState: "not_audited" }),
  ],

  /**
   * One audit. There is a score but no direction, and a single point drawn as
   * a flat line would claim the business has not moved.
   */
  "dashboard-single-audit": () => [scored({ name: "First Audit" }, [72])],

  /** A rising score across three audits. */
  "dashboard-rising": () => [
    scored({ name: "Rising Product", nextMovesCount: 3, preparedCount: 1 }, [78, 72, 61]),
  ],

  /**
   * A falling score. Amber, not coral: coral is failure across this product,
   * and a score that dropped is something to look at, not something that broke.
   */
  "dashboard-falling": () => [scored({ name: "Falling Product" }, [64, 79])],

  /**
   * Measured twice, unchanged. "0" here is a real comparison and must read
   * differently from a project that has nothing to compare against.
   */
  "dashboard-unchanged": () => [scored({ name: "Steady Product" }, [68, 68])],

  /**
   * The case rule 44 exists for: a completed audit that could not be scored,
   * sitting between two real ones. The trend must join 72 to 78 — a `0` folded
   * into the series would draw a collapse and a recovery that never happened.
   */
  "dashboard-coverage-gap": () => [scored({ name: "Patchy Coverage" }, [78, null, 72])],

  /**
   * The latest audit found too little evidence. The card says so instead of
   * showing a number, and shows no trend beside a score it is not displaying.
   */
  "dashboard-insufficient-coverage": () => [scored({ name: "Thin Evidence" }, [null, 72])],

  /** Setup never finished: no repository, so nothing can be analysed yet. */
  "dashboard-no-repository": () => [
    project({ name: "Unconnected", repositoryFullName: null, defaultBranch: null }),
  ],

  /** A portfolio, to see the grid rather than a single card. */
  "dashboard-portfolio": () => [
    scored({ id: "p1", name: "Rising Product", nextMovesCount: 3 }, [78, 72, 61]),
    scored({ id: "p2", name: "Falling Product", preparedCount: 2 }, [64, 79]),
    project({ id: "p3", name: "Never Analysed" }),
  ],
} as const;

export type E2eDashboardScenario = keyof typeof E2E_DASHBOARD_SCENARIOS;

export function isE2eDashboardScenario(value: string): value is E2eDashboardScenario {
  return value in E2E_DASHBOARD_SCENARIOS;
}
