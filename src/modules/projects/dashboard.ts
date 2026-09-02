import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { mapWithConcurrency, PER_CHANGE_CONCURRENCY } from "@/lib/async/concurrency";
import { readLatestPerGroup } from "@/lib/db/latest-per-change";
import { sanitizeCorrections } from "@/modules/product-understanding/store";

import type { AuditReading } from "./score-series";

import { liveConnections } from "./repository-connection";
/**
 * The global dashboard read model (Sprint UI-3).
 *
 * ## The question this answers
 *
 * `/app` used to answer "which projects do I have". The dashboard answers
 * "what needs my attention", and that needs a little more per project — a
 * score and how that score has moved, the top move by name, how many are
 * waiting, whether something is prepared, when the product was last analysed.
 *
 * It no longer reads the audit-event log. The activity strip that read it left
 * the account dashboard in CORE-6 (an append-only feed with no action on the
 * calmest screen in the product), and the query left with it rather than
 * staying to feed nothing.
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

/**
 * The highest-ranked Move, reduced to what a card can show.
 *
 * Four columns, no document. `why_now`, the evidence ids, the category and the
 * execution fields all stay on the Action Plan, where there is room to be
 * accurate about them — this is the one sentence and the two words a founder
 * needs to decide whether to click.
 */
export type DashboardMove = {
  /**
   * The Move's own id, so a card that names it can link to *it* (UI-S3 §6).
   *
   * One more column on a select that was already being made — the same
   * argument the reproducibility set below rides on. Without it, "Next move"
   * named one Move by title and linked to whatever rank 1 happened to be by
   * the time the founder clicked.
   */
  id: string;
  title: string;
  /** The Move's own statement of what is wrong. One sentence, model-written. */
  problem: string;
  impact: "high" | "medium" | "low";
  effort: "high" | "medium" | "low";
};

/**
 * One completed audit, reduced to what a trend needs: the number, when it was
 * produced, and the seven columns that decide whether it may be compared with
 * the reading beside it.
 *
 * The versions are carried rather than resolved here on purpose. Deciding what
 * "comparable" means is a rule with a history behind it, and it lives in
 * `score-series.ts` where it is tested; this module's job is to read columns.
 */
export type { AuditReading } from "./score-series";

export type DashboardProject = {
  id: string;
  name: string;
  repositoryFullName: string | null;
  defaultBranch: string | null;
  /** Captured GitHub visibility. Optional so older fixtures remain honest. */
  repositoryPrivate?: boolean | null;
  /** Exact Product Profile used by the latest completed audit, when recorded. */
  productProfileId?: string | null;
  /**
   * What the product calls itself, when Vibe read a name for it.
   *
   * Distinct from `name` above, which is the label the founder typed at
   * connection time — often a repository slug. Both surfaces that list
   * products take this from here rather than deriving it themselves, so the
   * heading, the search box and the name sort cannot describe different lists.
   */
  productName: string | null;
  /** A logo Vibe checked it can display, or null. Always https. */
  logoUrl: string | null;
  /** Null unless a completed audit produced one. Never zero as a stand-in. */
  score: number | null;
  scoreState: ProjectScoreState;
  /** Opportunities in the latest completed set. Null when never generated. */
  nextMovesCount: number | null;
  /**
   * The rank-1 Move of the latest completed set, so a card can name the work
   * rather than count it. Null when no set exists, and also when a set exists
   * and is empty — `nextMovesCount` beside it distinguishes those two.
   */
  topMove: DashboardMove | null;
  /**
   * When the latest completed audit ran.
   *
   * Deliberately *not* a last-activity timestamp. See the note above on why
   * `lastActivityAt` was refused: it cannot be read honestly here without an
   * N+1. This is one exact fact — when Vibe last judged this product — and any
   * label for it must say that rather than implying general activity.
   */
  lastAnalysedAt: string | null;
  /**
   * Every completed audit for this product, newest first.
   *
   * These rows were already fetched and already discarded: the query is
   * unbounded and ordered newest-first, and `firstPerKey` kept one per project
   * and threw the rest away. Keeping them costs no round trip and no extra
   * row — only seven small text columns per row on a select that was already
   * being made.
   *
   * It is deliberately the *readings*, not a chart. `buildScoreSeries` turns
   * them into something drawable, and it is the only thing that decides where
   * the line breaks.
   */
  scoreHistory: AuditReading[];
  /** Prepared changes still in `prepared` status. */
  preparedCount: number;
  /** Prepared changes whose latest validation failed. */
  failedValidationCount: number;
};

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
};

type ProjectRow = { id: string; name: string };
type RepoRow = {
  project_id: string;
  full_name: string;
  default_branch: string;
  private: boolean;
};
type AuditRow = {
  project_id: string;
  product_profile_id: string | null;
  overall_score: number | null;
  created_at: string;
  // The reproducibility set. Seven `not null` text columns, already on the
  // table since Sprint 4 — no migration was needed to chart the trend.
  schema_version: string;
  audit_version: string;
  evidence_pack_version: string;
  prompt_version: string;
  rubric_version: string;
  provider: string;
  model: string;
};
type SetRow = { id: string; project_id: string; created_at: string };
type ProductIdentityRow = {
  project_id: string;
  product_name: string | null;
  product_logo_url: string | null;
};
type CorrectionsRow = { project_id: string; corrections: unknown };
type OpportunityRow = {
  id: string;
  opportunity_set_id: string;
  rank: number;
  title: string;
  problem: string;
  impact: DashboardMove["impact"];
  effort: DashboardMove["effort"];
};
type PreparedRow = { id: string; project_id: string };
type ValidationRow = { prepared_change_id: string; status: string; created_at: string };
/**
 * One string rather than a concatenation: `supabase-js` reads the select list
 * at the type level, and a `+` between two fragments erases the row type.
 *
 * The last seven are the reproducibility set. They ride along on a query that
 * was already being made, which is the whole reason the Business Signal trend
 * needed no migration.
 */
const AUDIT_COLUMNS =
  "project_id, product_profile_id, overall_score, created_at, schema_version, audit_version, evidence_pack_version, prompt_version, rubric_version, provider, model";

/**
 * How much audit history one dashboard render may transfer, per project
 * (VB-025).
 *
 * The read was unbounded: every completed audit of every project the user owns,
 * on every render, forever. It feeds two things — each card's *current* score
 * and its score trend — and only the second wants more than one row.
 *
 * The budget is per project rather than absolute so a second project does not
 * shorten the first one's trend. It is still a global `limit`, though, and a
 * project with unusually deep history can therefore crowd others out of the
 * response: the repair below is what stops that becoming a card that says a
 * project has never been audited when it has. What it can shorten is a trend,
 * which is honest degradation; what it must never do is lose a score.
 */
const AUDIT_HISTORY_PER_PROJECT = 12;

/**
 * How many prepared changes' validation runs one render may transfer.
 *
 * Same shape, same reason: only the newest run per change decides anything, and
 * `validation_runs` grows every time a customer re-validates.
 */
const VALIDATION_ROWS_PER_CHANGE = 4;

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
 * The same rows, all of them, grouped rather than reduced. Input order is
 * preserved inside each group, so a newest-first read stays newest-first.
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

/** Column names to field names. Nothing is dropped and nothing is derived. */
function dashboardMove(row: OpportunityRow | undefined): DashboardMove | null {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    problem: row.problem,
    impact: row.impact,
    effort: row.effort,
  };
}

/** Column names to field names. No rule lives here — see `score-series.ts`. */
function auditReading(row: AuditRow): AuditReading {
  return {
    score: row.overall_score,
    recordedAt: row.created_at,
    contract: {
      schemaVersion: row.schema_version,
      auditVersion: row.audit_version,
      evidencePackVersion: row.evidence_pack_version,
      promptVersion: row.prompt_version,
      rubricVersion: row.rubric_version,
      provider: row.provider,
      model: row.model,
    },
  };
}

/**
 * The newest audit per project, with the crowding case repaired (VB-025).
 *
 * The batched read is ordered newest-first *globally* and capped, so a project
 * whose entire history sits below another project's can be missing from the
 * response entirely. For the trend that is a shorter line; for the score it
 * would be a card claiming the project has never been audited, which is a
 * different sentence and a false one.
 *
 * So a project with no row is re-read individually — but only when the budget
 * was actually spent, because a response short of its limit saw everything and
 * "no row" then means no audit. That is the same rule
 * `readLatestPerGroup` applies, stated here because this read wants the
 * history as well as the latest and so cannot delegate to it.
 */
async function repairMissingLatestAudits(
  supabase: SupabaseClient,
  params: { projects: ProjectRow[]; auditRows: AuditRow[]; budget: number },
): Promise<Map<string, AuditRow>> {
  const latest = firstPerKey(params.auditRows, (row) => row.project_id);
  if (params.auditRows.length < params.budget) return latest;

  const missing = params.projects.filter((project) => !latest.has(project.id));

  const recovered = await mapWithConcurrency(missing, PER_CHANGE_CONCURRENCY, async (project) => {
    const { data, error } = await supabase
      .from("business_readiness_audits")
      .select(AUDIT_COLUMNS)
      .eq("project_id", project.id)
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return (data ?? null) as AuditRow | null;
  });

  for (const row of recovered) if (row) latest.set(row.project_id, row);
  return latest;
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
  if (projects.length === 0) return { projects: [] };

  const projectIds = projects.map((project) => project.id);

  // Four `.in(...)` queries, run together, then two dependent ones below.
  // None of them scales with the number of projects — that is the design.
  const [repos, audits, sets, prepared] = await Promise.all([
    liveConnections(supabase, "project_id, full_name, default_branch, private").in(
      "project_id",
      projectIds,
    ),
    supabase
      // `overall_score` is a column. The audit's JSONB document is never read
      // here: a dashboard does not need dimensions, evidence or findings.
      .from("business_readiness_audits")
      .select(AUDIT_COLUMNS)
      .in("project_id", projectIds)
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(projects.length * AUDIT_HISTORY_PER_PROJECT),
    // Only the newest set per project is ever read, so this is the shape
    // `readLatestPerGroup` exists for: bounded, and repaired for any project
    // a full response crowded out (VB-023, VB-025).
    readLatestPerGroup(supabase, {
      table: "opportunity_sets",
      columns: "id, project_id, created_at",
      groupColumn: "project_id",
      groupIds: projectIds,
      filters: { status: "completed" },
    }),
    supabase
      .from("prepared_changes")
      .select("id, project_id")
      .in("project_id", projectIds)
      // The same filter the Prepared route lists by, so a count here and the
      // page behind it cannot disagree.
      .eq("status", "prepared"),
  ]);

  for (const result of [repos, audits, prepared]) {
    if (result.error) throw result.error;
  }

  // The connection boundary widens the select string, so the row shape is
  // stated here rather than inferred — see `repository-connection.ts`.
  const repoRows = (repos.data ?? []) as unknown as RepoRow[];
  const repoByProject = firstPerKey(repoRows, (row) => row.project_id);
  const auditRows = (audits.data ?? []) as AuditRow[];
  const auditsByProject = groupPerKey(auditRows, (row) => row.project_id);
  const latestAuditByProject = await repairMissingLatestAudits(supabase, {
    projects,
    auditRows,
    budget: projects.length * AUDIT_HISTORY_PER_PROJECT,
  });
  const latestSetByProject = sets as Map<string, SetRow>;
  const preparedRows = (prepared.data ?? []) as PreparedRow[];
  const preparedByProject = countPerKey(preparedRows, (row) => row.project_id);

  // Four dependent queries, each still a single round trip for all projects.
  const setIds = [...latestSetByProject.values()].map((set) => set.id);
  const preparedIds = preparedRows.map((row) => row.id);
  const profileIds = [...latestAuditByProject.values()].flatMap((audit) =>
    audit?.product_profile_id ? [audit.product_profile_id] : [],
  );

  const [opportunities, validations, identities, corrections] = await Promise.all([
    setIds.length > 0
      ? supabase
          .from("business_opportunities")
          // The Move's own columns ride along on the query that was already
          // counting these rows, so naming the top Move costs no round trip.
          // Ordering by rank is what lets `firstPerKey` below return rank 1 by
          // construction rather than by a second pass.
          .select("id, opportunity_set_id, rank, title, problem, impact, effort")
          .in("opportunity_set_id", setIds)
          .order("rank", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    preparedIds.length > 0
      ? supabase
          .from("validation_runs")
          .select("prepared_change_id, status, created_at")
          .in("prepared_change_id", preparedIds)
          .order("created_at", { ascending: false })
          .limit(preparedIds.length * VALIDATION_ROWS_PER_CHANGE)
      : Promise.resolve({ data: [], error: null }),
    /*
     * Columns, never the document.
     *
     * `result` is a full product-profile.v1 with evidence arrays on every
     * field, and one per project is exactly what a dashboard must not ship.
     * These two are denormalised beside it for this read — the same trade
     * `overall_score` already makes against the audit document.
     */
    profileIds.length > 0
      ? supabase
          .from("product_profiles")
          .select("project_id, product_name, product_logo_url")
          .in("id", profileIds)
      : Promise.resolve({ data: [], error: null }),
    /*
     * A founder's correction to the name outranks the derived one, here as
     * everywhere else. It is not baked into the column on purpose: corrections
     * survive a re-scan and the derived half does not, so the authority has to
     * be resolved on read or the next derivation silently wins.
     *
     * Small and bounded — seven fields, each capped at MAX_CORRECTION_LENGTH —
     * which is why this document is fine to read here and `result` is not.
     */
    supabase
      .from("product_profile_corrections")
      .select("project_id, corrections")
      .in("project_id", projectIds),
  ]);

  if (opportunities.error) throw opportunities.error;
  if (validations.error) throw validations.error;
  if (identities.error) throw identities.error;
  if (corrections.error) throw corrections.error;

  const identityByProject = new Map(
    ((identities.data ?? []) as ProductIdentityRow[]).map((row) => [row.project_id, row] as const),
  );
  const correctedNameByProject = new Map(
    ((corrections.data ?? []) as CorrectionsRow[]).flatMap((row) => {
      const name = sanitizeCorrections(row.corrections).name;
      return name ? [[row.project_id, name] as const] : [];
    }),
  );

  const opportunityRows = (opportunities.data ?? []) as OpportunityRow[];
  const opportunityCountBySet = countPerKey(opportunityRows, (row) => row.opportunity_set_id);
  // Ordered by rank above, so the first row for a set *is* rank 1.
  const topMoveBySet = firstPerKey(opportunityRows, (row) => row.opportunity_set_id);

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
    const audit = latestAuditByProject.get(project.id) ?? null;
    const set = latestSetByProject.get(project.id) ?? null;
    const repo = repoByProject.get(project.id) ?? null;

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
      repositoryPrivate: repo?.private ?? null,
      productProfileId: audit?.product_profile_id ?? null,
      productName:
        correctedNameByProject.get(project.id) ??
        identityByProject.get(project.id)?.product_name ??
        null,
      logoUrl: identityByProject.get(project.id)?.product_logo_url ?? null,
      score: audit?.overall_score ?? null,
      scoreState,
      topMove: (set && dashboardMove(topMoveBySet.get(set.id))) || null,
      lastAnalysedAt: audit?.created_at ?? null,
      scoreHistory: (auditsByProject.get(project.id) ?? []).map(auditReading),
      nextMovesCount: set ? (opportunityCountBySet.get(set.id) ?? 0) : null,
      preparedCount: preparedByProject.get(project.id) ?? 0,
      failedValidationCount: failedByProject.get(project.id) ?? 0,
    };
  });

  return { projects: dashboardProjects };
}
