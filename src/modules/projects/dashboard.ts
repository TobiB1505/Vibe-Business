import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuditEventRecord } from "@/modules/audit-log/queries";
import { mapAuditEventRow } from "@/modules/audit-log/queries";

/**
 * The global dashboard read model (Sprint UI-3).
 *
 * ## The question this answers
 *
 * `/app` used to answer "which projects do I have". The dashboard answers
 * "what needs my attention", and that needs a little more per project — a
 * score, how many moves are waiting, whether something is prepared, when
 * anything last happened.
 *
 * ## Why it is one module rather than reused per-project reads
 *
 * The per-project read models built in UI-2 are correct and cheap *for one
 * project*. Calling them in a loop is the N+1 this file exists to avoid: with
 * five projects, `getProjectWorkspaceCounts` alone would be ten round trips.
 *
 * Instead every query here is `.in(projectIds)` and grouped in memory. The
 * number of queries is **constant** — seven, whether the user has one project
 * or fifty.
 *
 * ## What it deliberately never touches
 *
 * No prepared workspace, no preview provider, no review-image signing, no
 * GitHub merge preflight, no Deep Scan model, no impact assembly, no audit
 * JSONB. The score comes from the `overall_score` column, not from parsing the
 * stored audit document.
 *
 * Merge-readiness is a deliberate omission from the attention model: deciding
 * whether a change can merge requires a live GitHub preflight per change, and
 * a dashboard that made an external call per project is exactly the thing this
 * module is shaped to prevent. See the sprint doc.
 */

export type ProjectScoreState = "scored" | "not_audited" | "insufficient_coverage";

export type DashboardProject = {
  id: string;
  name: string;
  repositoryFullName: string | null;
  defaultBranch: string | null;
  /** Null unless a completed audit produced one. Never zero as a stand-in. */
  score: number | null;
  scoreState: ProjectScoreState;
  /** Opportunities in the latest completed set. Null when never generated. */
  nextMovesCount: number | null;
  /** Prepared changes still in `prepared` status. */
  preparedCount: number;
  /** Prepared changes whose latest validation failed. */
  failedValidationCount: number;
  /**
   * The project's last few real business scores, oldest first.
   *
   * Empty or single-entry means there is no trend to show — not that the trend
   * is flat. See `buildScoreHistory`.
   */
  scoreHistory: number[];
  /**
   * Change from the previous scored audit to the latest one. Null when fewer
   * than two audits produced a score, which is a different fact from `0`.
   */
  scoreDelta: number | null;
};

/**
 * How many points a score trend is drawn from.
 *
 * A dashboard card is showing direction, not history — eight audits is already
 * more than the eye reads off a 100px line, and the page behind it is where a
 * full history belongs.
 */
export const SCORE_HISTORY_LIMIT = 8;

/**
 * The last few real scores, oldest first, from audit rows newest first.
 *
 * ## Why an audit with no score is skipped rather than zeroed
 *
 * A completed audit stores `overall_score = null` when the evidence could not
 * support a verdict (Sprint 4). That is "we looked and could not say" — it is
 * not a bad score, and CLAUDE.md rule 44 says it must never be counted as one.
 * Folded into a series as `0` it would draw a cliff down to the axis and back,
 * so the product would show a project collapsing because one scan found less
 * than usual. It is left out; the line simply joins the two real scores
 * either side of it.
 *
 * ## Why fewer than two points returns fewer than two points
 *
 * Nothing here pads, interpolates or invents a starting value. One audit means
 * one point, and the caller renders no trend at all — a single point drawn as
 * a flat line would claim a project has not moved when in fact it has only
 * been measured once.
 *
 * Pure and exported so it is tested directly, the same way `attention.ts` is.
 */
export function buildScoreHistory(
  rowsNewestFirst: readonly { overall_score: number | null }[],
  limit: number = SCORE_HISTORY_LIMIT,
): number[] {
  const newestFirst: number[] = [];

  for (const row of rowsNewestFirst) {
    if (row.overall_score === null) continue;
    newestFirst.push(row.overall_score);
    if (newestFirst.length === limit) break;
  }

  return newestFirst.reverse();
}

/** The latest score minus the one before it, or null when there is no pair. */
export function scoreDeltaFrom(history: readonly number[]): number | null {
  if (history.length < 2) return null;
  return history[history.length - 1] - history[history.length - 2];
}

/**
 * ## Why there is no `lastActivityAt`
 *
 * The obvious implementation — read the newest N events across all projects
 * and take the first per project — is wrong in a way that hides itself. On the
 * dogfood account one project had 16 real events and the other had 132 newer
 * ones, so the quieter project fell entirely outside the window and rendered
 * as "no activity" despite having a history. It gets worse the more the active
 * project is used, and it looks fine with one project.
 *
 * Doing it correctly needs either one indexed query per project (the N+1 this
 * module exists to avoid) or a `distinct on` that PostgREST does not expose.
 * A per-project "last activity" is worth a view or an aggregate column; it is
 * not worth a number that is silently wrong for whichever project you use
 * least.
 */

export type DashboardOverview = {
  projects: DashboardProject[];
  /** Newest events across every project the caller owns. */
  recentActivity: (AuditEventRecord & { projectId: string })[];
};

type ProjectRow = { id: string; name: string };
type RepoRow = { project_id: string; full_name: string; default_branch: string };
type AuditRow = {
  project_id: string;
  overall_score: number | null;
  assessed_dimensions: number | null;
  total_dimensions: number | null;
  created_at: string;
};
type SetRow = { id: string; project_id: string; created_at: string };
type OpportunityRow = { opportunity_set_id: string };
type PreparedRow = { id: string; project_id: string };
type ValidationRow = { prepared_change_id: string; status: string; created_at: string };
type EventRow = {
  id: string;
  project_id: string;
  event_type: string;
  created_at: string;
  metadata: Record<string, unknown> | null;
};

/** How many events the dashboard's activity strip shows. */
export const DASHBOARD_ACTIVITY_LIMIT = 8;

/**
 * Rows are fetched newest-first and reduced to the first per key. Postgres has
 * `distinct on`, PostgREST does not expose it, and adding a view for it would
 * be a schema change this sprint does not need at current volumes.
 */
function firstPerKey<T>(rows: T[], key: (row: T) => string): Map<string, T> {
  const result = new Map<string, T>();
  for (const row of rows) {
    const id = key(row);
    if (!result.has(id)) result.set(id, row);
  }
  return result;
}

/**
 * Every row per key, in the order they arrived.
 *
 * `firstPerKey`'s sibling, for the one case where the rest of the rows are not
 * waste: the audits query has always returned a project's whole completed
 * history and thrown all but the newest away.
 */
function groupPerKey<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const result = new Map<string, T[]>();
  for (const row of rows) {
    const id = key(row);
    const group = result.get(id);
    if (group) group.push(row);
    else result.set(id, [row]);
  }
  return result;
}

function countPerKey<T>(rows: T[], key: (row: T) => string): Map<string, number> {
  const result = new Map<string, number>();
  for (const row of rows) {
    const id = key(row);
    result.set(id, (result.get(id) ?? 0) + 1);
  }
  return result;
}

export async function getDashboardOverview(
  supabase: SupabaseClient,
  userId: string,
): Promise<DashboardOverview> {
  // RLS already scopes this to the caller; the explicit filter is the second
  // layer, consistent with every other read in the product.
  const { data: projectRows, error: projectsError } = await supabase
    .from("projects")
    .select("id, name")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (projectsError) throw projectsError;

  const projects = (projectRows ?? []) as ProjectRow[];
  if (projects.length === 0) return { projects: [], recentActivity: [] };

  const projectIds = projects.map((project) => project.id);

  // Five `.in(...)` queries, run together, then two dependent ones below.
  // None of them scales with the number of projects — that is the design.
  const [repos, audits, sets, prepared, events] = await Promise.all([
    supabase
      .from("repository_connections")
      .select("project_id, full_name, default_branch")
      .in("project_id", projectIds),
    supabase
      // `overall_score` is a column. The audit's JSONB document is never read
      // here: a dashboard does not need dimensions, evidence or findings.
      //
      // Known and deliberately left alone (UI-8): this read has no `.limit()`,
      // so it grows with a project's audit history. Adding one would introduce
      // the starvation bug documented above for `lastActivityAt` — an actively
      // audited project would consume the window and a quieter one would lose
      // its *current* score, which is far worse than reading a few extra rows.
      // The fix is a `distinct on` view or a latest-audit column, not a cap.
      .from("business_readiness_audits")
      .select("project_id, overall_score, assessed_dimensions, total_dimensions, created_at")
      .in("project_id", projectIds)
      .eq("status", "completed")
      .order("created_at", { ascending: false }),
    supabase
      .from("opportunity_sets")
      .select("id, project_id, created_at")
      .in("project_id", projectIds)
      .eq("status", "completed")
      .order("created_at", { ascending: false }),
    supabase
      .from("prepared_changes")
      .select("id, project_id")
      .in("project_id", projectIds)
      // The same filter the Prepared route lists by, so a count here and the
      // page behind it cannot disagree.
      .eq("status", "prepared"),
    supabase
      .from("audit_events")
      .select("id, project_id, event_type, created_at, metadata")
      .eq("user_id", userId)
      .in("project_id", projectIds)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      // Only the activity strip reads this, and it shows eight. The margin is
      // for events that resolve to a project the caller no longer owns.
      .limit(DASHBOARD_ACTIVITY_LIMIT * 3),
  ]);

  for (const result of [repos, audits, sets, prepared, events]) {
    if (result.error) throw result.error;
  }

  const repoByProject = firstPerKey((repos.data ?? []) as RepoRow[], (row) => row.project_id);
  /*
   * Grouped rather than reduced. The newest row per project is the score; the
   * rows behind it are the trend, and they were already fetched and discarded.
   * A score history therefore costs no extra query — which is the only reason
   * this dashboard can show one at all (`dashboard-contract.test.ts`).
   */
  const auditsByProject = groupPerKey((audits.data ?? []) as AuditRow[], (row) => row.project_id);
  const latestSetByProject = firstPerKey((sets.data ?? []) as SetRow[], (row) => row.project_id);
  const preparedRows = (prepared.data ?? []) as PreparedRow[];
  const preparedByProject = countPerKey(preparedRows, (row) => row.project_id);
  const eventRows = (events.data ?? []) as EventRow[];

  // Two dependent queries, each still a single round trip for all projects.
  const setIds = [...latestSetByProject.values()].map((set) => set.id);
  const preparedIds = preparedRows.map((row) => row.id);

  const [opportunities, validations] = await Promise.all([
    setIds.length > 0
      ? supabase.from("business_opportunities").select("opportunity_set_id").in("opportunity_set_id", setIds)
      : Promise.resolve({ data: [], error: null }),
    preparedIds.length > 0
      ? supabase
          .from("validation_runs")
          .select("prepared_change_id, status, created_at")
          .in("prepared_change_id", preparedIds)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (opportunities.error) throw opportunities.error;
  if (validations.error) throw validations.error;

  const opportunityCountBySet = countPerKey(
    (opportunities.data ?? []) as OpportunityRow[],
    (row) => row.opportunity_set_id,
  );

  // Only the *latest* run per change decides: an earlier failure followed by a
  // passing re-run is not a failure.
  const latestValidationByChange = firstPerKey(
    (validations.data ?? []) as ValidationRow[],
    (row) => row.prepared_change_id,
  );
  const failedByProject = new Map<string, number>();
  for (const row of preparedRows) {
    if (latestValidationByChange.get(row.id)?.status === "failed") {
      failedByProject.set(row.project_id, (failedByProject.get(row.project_id) ?? 0) + 1);
    }
  }

  const dashboardProjects: DashboardProject[] = projects.map((project) => {
    const auditRows = auditsByProject.get(project.id) ?? [];
    const audit = auditRows[0] ?? null;
    const set = latestSetByProject.get(project.id) ?? null;
    const repo = repoByProject.get(project.id) ?? null;
    const scoreHistory = buildScoreHistory(auditRows);

    /**
     * Three states, not two. A completed audit with too little evidence
     * coverage stores a null `overall_score` deliberately (Sprint 4) — that is
     * "we looked and could not say", which is a different sentence from "we
     * never looked", and neither of them is a zero.
     */
    const scoreState: ProjectScoreState = !audit
      ? "not_audited"
      : audit.overall_score === null
        ? "insufficient_coverage"
        : "scored";

    return {
      id: project.id,
      name: project.name,
      repositoryFullName: repo?.full_name ?? null,
      defaultBranch: repo?.default_branch ?? null,
      score: audit?.overall_score ?? null,
      scoreState,
      nextMovesCount: set ? (opportunityCountBySet.get(set.id) ?? 0) : null,
      preparedCount: preparedByProject.get(project.id) ?? 0,
      failedValidationCount: failedByProject.get(project.id) ?? 0,
      scoreHistory,
      scoreDelta: scoreDeltaFrom(scoreHistory),
    };
  });

  const recentActivity = eventRows.slice(0, DASHBOARD_ACTIVITY_LIMIT).map((row) => ({
    ...mapAuditEventRow(row),
    projectId: row.project_id,
  }));

  return { projects: dashboardProjects, recentActivity };
}
