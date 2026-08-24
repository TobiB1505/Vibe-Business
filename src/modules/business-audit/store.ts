import "server-only";

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AUDIT_START_LIMITS, type AuditAccessMode } from "./entitlement";
import type { PendingQuestion } from "./needs-user";
import type { BusinessReadinessAudit } from "./schema";

/**
 * Persistence for business readiness audits.
 *
 * Every query runs through the caller's request-scoped Supabase client, so
 * RLS is always in force — there is no service-role path here.
 */

/**
 * `needs_user` is a waiting state, not a failure: the run has claimed its slot
 * and prepared its evidence, and has stopped before inference because a
 * founder-only answer would change the result (CORE-2a.4). It has spent
 * nothing, and it may wait for hours.
 */
export type AuditStatus = "pending" | "analyzing" | "needs_user" | "completed" | "failed";

export type StoredAudit = {
  id: string;
  projectId: string;
  status: AuditStatus;
  /** How the run was funded. Decides whether completing it spends the grant. */
  accessMode: AuditAccessMode;
  inputHash: string;
  overallScore: number | null;
  assessedDimensions: number | null;
  totalDimensions: number | null;
  failureCode: string | null;
  result: BusinessReadinessAudit | null;
  /**
   * The exact understanding and founder answers this run reasoned from.
   *
   * Read back so a later run can tell whether those facts have since moved —
   * which is what decides whether this audit's lens assessments may still be
   * treated as describing the current business (CORE-2a.4).
   */
  productProfileId: string | null;
  founderIntentHash: string | null;
  /**
   * The repository and live snapshots this run reasoned from.
   *
   * Written since the table existed and, until now, never read back — which is
   * why a consumer rebuilding this audit's evidence pack had no way to check
   * that it was rebuilding from the same observations. See
   * `operations/opportunities/execution.ts`'s `loadSources`.
   */
  repositorySnapshotId: string | null;
  liveSnapshotId: string | null;
  /**
   * The reproducibility set, as this row recorded it.
   *
   * Read back so that `verifyPackProvenance` can recompute this audit's own
   * `input_hash` from the row's versions and a fresh load of its five sources.
   * The versions have to come from the row rather than from the current
   * constants: comparing against today's constants would answer "is this audit
   * reproducible now?", and the question being asked is the narrower "are these
   * the observations it reasoned from?".
   *
   * The Deep Scan is the reason this exists. `computeAuditInputHash` hashes
   * `authenticatedSnapshotId`, but no column stores it, so it is the one source
   * a field-by-field comparison structurally cannot reach. Through the hash it
   * is covered like every other.
   */
  schemaVersion: string;
  auditVersion: string;
  evidencePackVersion: string;
  promptVersion: string;
  rubricVersion: string;
  productProfileSchemaVersion: string | null;
  productProfileBuilderVersion: string | null;
  provider: string;
  model: string;
  createdAt: string;
  completedAt: string | null;
};

type AuditRow = {
  id: string;
  project_id: string;
  status: AuditStatus;
  access_mode: AuditAccessMode;
  input_hash: string;
  overall_score: number | null;
  assessed_dimensions: number | null;
  total_dimensions: number | null;
  failure_code: string | null;
  result: BusinessReadinessAudit | null;
  product_profile_id: string | null;
  founder_intent_hash: string | null;
  repository_snapshot_id: string | null;
  live_snapshot_id: string | null;
  schema_version: string;
  audit_version: string;
  evidence_pack_version: string;
  prompt_version: string;
  rubric_version: string;
  product_profile_schema_version: string | null;
  product_profile_builder_version: string | null;
  provider: string;
  model: string;
  created_at: string;
  completed_at: string | null;
};

const AUDIT_COLUMNS =
  "id, project_id, status, access_mode, input_hash, overall_score, assessed_dimensions, total_dimensions, failure_code, result, product_profile_id, founder_intent_hash, repository_snapshot_id, live_snapshot_id, schema_version, audit_version, evidence_pack_version, prompt_version, rubric_version, product_profile_schema_version, product_profile_builder_version, provider, model, created_at, completed_at";

function mapRow(row: AuditRow): StoredAudit {
  return {
    id: row.id,
    projectId: row.project_id,
    status: row.status,
    accessMode: row.access_mode,
    inputHash: row.input_hash,
    overallScore: row.overall_score,
    assessedDimensions: row.assessed_dimensions,
    totalDimensions: row.total_dimensions,
    failureCode: row.failure_code,
    result: row.result,
    productProfileId: row.product_profile_id,
    founderIntentHash: row.founder_intent_hash,
    repositorySnapshotId: row.repository_snapshot_id,
    liveSnapshotId: row.live_snapshot_id,
    schemaVersion: row.schema_version,
    auditVersion: row.audit_version,
    evidencePackVersion: row.evidence_pack_version,
    promptVersion: row.prompt_version,
    rubricVersion: row.rubric_version,
    productProfileSchemaVersion: row.product_profile_schema_version,
    productProfileBuilderVersion: row.product_profile_builder_version,
    provider: row.provider,
    model: row.model,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

/**
 * The identity of an audit's inputs (Sprint 4 §23, CORE-2 §7).
 *
 * Every input that can change the answer is included: the evidence
 * snapshots, the Product Profile the audit reasoned from, the founder's
 * stated intent, and the full reproducibility set (prompt, rubric, model,
 * versions). Change any one and the hash changes, which correctly invalidates
 * reuse and buys a fresh audit. Change nothing and the existing audit is
 * returned for free.
 *
 * ## Why the profile enters by id *and* by version
 *
 * `productProfileId` covers "the understanding changed" — a profile row is
 * replaced wholesale whenever evidence moves, so a new commit produces a new
 * profile with a new id and this hash follows.
 *
 * The two version fields cover something the id cannot: a profile carrying the
 * *same* id means the same derivation only while the derivation itself is
 * unchanged. Recording the schema and builder versions is what makes CORE-2 §7
 * answerable later — "audit #X used Product Profile v4" — from the stored row
 * rather than from a guess about what the code did that week.
 *
 * Corrections are deliberately absent, for the same reason they are absent
 * from the profile's own hash: they are applied on read, so editing a
 * description must not silently buy a new paid audit. What a correction
 * changes is the *content* of the profile the audit is handed, and a user who
 * wants that reflected re-runs the audit deliberately.
 *
 * `authenticatedSnapshotId` is part of that identity and `null` is a real
 * value, not a missing one (Sprint 6 §7). An audit run before any Deep Scan
 * and an audit run after one saw different evidence, so they must not share a
 * hash — otherwise the first Deep Scan would silently return the stale
 * pre-Deep-Scan audit and the user would never see their new evidence used.
 *
 * Field order is fixed rather than derived from object keys, so the hash is
 * stable across refactors.
 */
export function computeAuditInputHash(params: {
  repositorySnapshotId: string;
  liveSnapshotId: string;
  /** The exact Product Profile this audit reasons from (CORE-2 §3). */
  productProfileId: string;
  founderIntentHash: string;
  /** The latest successful Deep Scan snapshot, or null when none exists. */
  authenticatedSnapshotId: string | null;
  schemaVersion: string;
  auditVersion: string;
  evidencePackVersion: string;
  promptVersion: string;
  rubricVersion: string;
  profileSchemaVersion: string;
  profileBuilderVersion: string;
  provider: string;
  model: string;
}): string {
  const canonical = JSON.stringify([
    params.repositorySnapshotId,
    params.liveSnapshotId,
    params.productProfileId,
    params.founderIntentHash,
    // `null` is carried through as JSON null rather than mapped to a sentinel
    // string: JSON keeps null distinct from every possible id, so "no Deep
    // Scan" can never be forged by a snapshot whose id happens to match.
    params.authenticatedSnapshotId,
    params.schemaVersion,
    params.auditVersion,
    params.evidencePackVersion,
    params.promptVersion,
    params.rubricVersion,
    params.profileSchemaVersion,
    params.profileBuilderVersion,
    params.provider,
    params.model,
  ]);
  return createHash("sha256").update(canonical).digest("hex");
}

/** The audit shown on the project page: the newest successful run. */
export async function getLatestSuccessfulAudit(
  supabase: SupabaseClient,
  projectId: string,
): Promise<StoredAudit | null> {
  const { data, error } = await supabase
    .from("business_readiness_audits")
    .select(AUDIT_COLUMNS)
    .eq("project_id", projectId)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ? mapRow(data as AuditRow) : null;
}

type AuditReadingRow = {
  overall_score: number | null;
  created_at: string;
  schema_version: string;
  audit_version: string;
  evidence_pack_version: string;
  prompt_version: string;
  rubric_version: string;
  provider: string;
  model: string;
};

export type StoredAuditReading = {
  score: number | null;
  recordedAt: string;
  contract: {
    schemaVersion: string;
    auditVersion: string;
    evidencePackVersion: string;
    promptVersion: string;
    rubricVersion: string;
    provider: string;
    model: string;
  };
};

/**
 * The project-scoped history needed by Business Health.
 *
 * This intentionally reads the score column and reproducibility columns only.
 * The Business Brain never opens historical audit documents merely to draw a
 * trend, and the comparability rule remains owned by `score-series.ts`.
 */
export async function getProjectAuditReadings(
  supabase: SupabaseClient,
  projectId: string,
): Promise<StoredAuditReading[]> {
  const { data, error } = await supabase
    .from("business_readiness_audits")
    .select(
      "overall_score, created_at, schema_version, audit_version, evidence_pack_version, prompt_version, rubric_version, provider, model",
    )
    .eq("project_id", projectId)
    .eq("status", "completed")
    .order("created_at", { ascending: false });

  if (error) throw error;

  return ((data ?? []) as AuditReadingRow[]).map((row) => ({
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
  }));
}

/**
 * Finds an existing successful audit for identical inputs. Reuse is the
 * default because inference costs real money and an identical input
 * provably yields an equivalent answer (Sprint 4 §23).
 */
export async function findReusableAudit(
  supabase: SupabaseClient,
  params: { projectId: string; inputHash: string },
): Promise<StoredAudit | null> {
  const { data, error } = await supabase
    .from("business_readiness_audits")
    .select(AUDIT_COLUMNS)
    .eq("project_id", params.projectId)
    .eq("input_hash", params.inputHash)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ? mapRow(data as AuditRow) : null;
}

/** One audit row by id. Used by durable execution to detect a replay. */
/**
 * One audit, scoped to the project that must own it (UI-S2 §32).
 *
 * `getAuditById` takes an id alone, which is correct for its callers — they
 * hold an id they already resolved from a row they own. Move lineage is a new
 * lookup boundary: it reads an audit named by a *different* record, so the
 * project is stated in the query rather than assumed from the caller's context.
 *
 * RLS would already refuse another user's audit. This additionally refuses
 * another **project's** audit belonging to the same user, which RLS does not,
 * and which is the failure mode that would let one project's finding appear
 * under another project's Move.
 */
export async function getProjectAuditById(
  supabase: SupabaseClient,
  params: { projectId: string; auditId: string },
): Promise<StoredAudit | null> {
  const { data, error } = await supabase
    .from("business_readiness_audits")
    .select(AUDIT_COLUMNS)
    .eq("id", params.auditId)
    .eq("project_id", params.projectId)
    .maybeSingle();

  if (error) throw error;
  return data ? mapRow(data as AuditRow) : null;
}

export async function getAuditById(
  supabase: SupabaseClient,
  auditId: string,
): Promise<StoredAudit | null> {
  const { data, error } = await supabase
    .from("business_readiness_audits")
    .select(AUDIT_COLUMNS)
    .eq("id", auditId)
    .maybeSingle();

  if (error) throw error;
  return data ? mapRow(data as AuditRow) : null;
}

export type CreateAuditRunResult =
  | { ok: true; auditId: string }
  | { ok: false; error: "already_running" }
  | { ok: false; error: "unknown"; message: string };

const POSTGRES_UNIQUE_VIOLATION = "23505";

/**
 * Claims an audit run. The partial unique index on in-flight rows turns a
 * double submission into a unique-constraint violation, reported as
 * `already_running` — so a user cannot accidentally buy two identical
 * inference calls by clicking twice (Sprint 4 §24).
 */
export async function createAuditRun(
  supabase: SupabaseClient,
  params: {
    projectId: string;
    repositorySnapshotId: string;
    liveSnapshotId: string;
    /** The Product Profile this audit reasons from (CORE-2 §7). */
    productProfileId: string;
    profileSchemaVersion: string;
    profileBuilderVersion: string;
    founderIntentHash: string;
    inputHash: string;
    schemaVersion: string;
    auditVersion: string;
    evidencePackVersion: string;
    promptVersion: string;
    rubricVersion: string;
    provider: string;
    model: string;
    accessMode: AuditAccessMode;
  },
): Promise<CreateAuditRunResult> {
  const { data, error } = await supabase
    .from("business_readiness_audits")
    .insert({
      project_id: params.projectId,
      repository_snapshot_id: params.repositorySnapshotId,
      live_snapshot_id: params.liveSnapshotId,
      product_profile_id: params.productProfileId,
      product_profile_schema_version: params.profileSchemaVersion,
      product_profile_builder_version: params.profileBuilderVersion,
      founder_intent_hash: params.founderIntentHash,
      // Historical column, kept `not null` for the rows that predate CORE-2.
      // The business context it was named for no longer exists, so the
      // founder-intent hash is what occupies it now — see the migration.
      business_context_hash: params.founderIntentHash,
      input_hash: params.inputHash,
      schema_version: params.schemaVersion,
      audit_version: params.auditVersion,
      evidence_pack_version: params.evidencePackVersion,
      prompt_version: params.promptVersion,
      rubric_version: params.rubricVersion,
      provider: params.provider,
      model: params.model,
      access_mode: params.accessMode,
      status: "analyzing",
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === POSTGRES_UNIQUE_VIOLATION) return { ok: false, error: "already_running" };
    return { ok: false, error: "unknown", message: error.message };
  }

  return { ok: true, auditId: data.id };
}

export async function completeAuditRun(
  supabase: SupabaseClient,
  auditId: string,
  audit: BusinessReadinessAudit,
): Promise<void> {
  const { error } = await supabase
    .from("business_readiness_audits")
    .update({
      status: "completed",
      result: audit,
      overall_score: audit.overall.score,
      assessed_dimensions: audit.overall.assessedDimensions,
      total_dimensions: audit.overall.totalDimensions,
      completed_at: new Date().toISOString(),
    })
    .eq("id", auditId);

  if (error) throw error;
}

/**
 * Marks a run failed with a typed code only. A failed row never carries a
 * `result`, so it cannot displace the latest successful audit the user sees
 * (Sprint 4 §27).
 */
export async function failAuditRun(
  supabase: SupabaseClient,
  auditId: string,
  failureCode: string,
): Promise<void> {
  const { error } = await supabase
    .from("business_readiness_audits")
    .update({
      status: "failed",
      failure_code: failureCode,
      completed_at: new Date().toISOString(),
    })
    .eq("id", auditId)
    // Only a run still in flight can fail. Without this, a late failure on the
    // operation carrying an audit that already completed would overwrite a
    // real, paid-for result with `failed` — and the audit is now failed from
    // two places, so the window is real rather than theoretical.
    .in("status", ["pending", "analyzing", "needs_user"]);

  if (error) {
    console.error("[business-audit] failed to record run failure", { auditId });
  }
}

// ---------------------------------------------------------------------
// Pausing for the founder (CORE-2a.4)
// ---------------------------------------------------------------------

/**
 * Stops the run in front of a question, before anything has been spent.
 *
 * `analyzing → needs_user`. The row keeps its claims — it is still the audit
 * for this input hash, and still the one consuming the entitlement if that is
 * how it was funded — so nothing else can start while a person is thinking.
 *
 * The intent is appended here, at the moment of *asking*, not when the answer
 * arrives. A founder who honestly says "I haven't decided" leaves the
 * underlying field empty, and without this record the gate would see an
 * unresolved fact and ask the same question forever.
 */
export async function pauseAuditForQuestion(
  supabase: SupabaseClient,
  params: { auditId: string; question: PendingQuestion },
): Promise<void> {
  const asked = await getAskedIntents(supabase, params.auditId);

  const { error } = await supabase
    .from("business_readiness_audits")
    .update({
      status: "needs_user",
      pending_question: params.question,
      asked_intents: asked.includes(params.question.intent)
        ? asked
        : [...asked, params.question.intent],
    })
    .eq("id", params.auditId)
    // Only a run that is actually working may be paused. Without this, a
    // replayed step could re-pause an audit the founder has already answered
    // and put the same question back in front of them.
    .in("status", ["pending", "analyzing"]);

  if (error) throw error;
}

/**
 * Clears the question and lets the run continue.
 *
 * Idempotent by construction (§38, §53): it matches on `status = needs_user`,
 * so a second submission of the same answer updates nothing and cannot start a
 * second inference. The answer itself was already written to its canonical
 * store before this is called — losing the answer while un-pausing would be
 * the one unrecoverable failure here (§39).
 */
export async function resumeAuditAfterAnswer(
  supabase: SupabaseClient,
  auditId: string,
): Promise<{ resumed: boolean }> {
  const { data, error } = await supabase
    .from("business_readiness_audits")
    .update({ status: "analyzing", pending_question: null })
    .eq("id", auditId)
    .eq("status", "needs_user")
    .select("id")
    .maybeSingle();

  if (error) throw error;
  return { resumed: data !== null };
}

/**
 * Re-stamps a resumed run with the identity its own question created.
 *
 * Both rows, because both carry the hash: the operation guards against a second
 * run for the same inputs, and the audit's in-flight unique index does the same
 * one layer down. Leaving either on the old value would keep the run blocked by
 * the guard it just satisfied.
 *
 * Returns `ok: false` on a unique-index collision rather than throwing. A
 * collision means another audit already holds this exact identity — which is
 * the reuse path finding a real answer, not a failure to paper over.
 */
export async function adoptResumedAuditIdentity(
  supabase: SupabaseClient,
  params: { operationId: string; auditId: string; inputHash: string },
): Promise<{ ok: boolean }> {
  const audit = await supabase
    .from("business_readiness_audits")
    .update({ input_hash: params.inputHash })
    .eq("id", params.auditId);

  if (audit.error) return { ok: false };

  const operation = await supabase
    .from("operation_runs")
    .update({ input_identity: params.inputHash })
    .eq("id", params.operationId);

  return { ok: operation.error === null };
}

export type PausedAudit = {
  auditId: string;
  question: PendingQuestion;
  askedIntents: string[];
};

/** The audit currently waiting on this project's founder, if any. */
export async function getPausedAudit(
  supabase: SupabaseClient,
  projectId: string,
): Promise<PausedAudit | null> {
  const { data, error } = await supabase
    .from("business_readiness_audits")
    .select("id, pending_question, asked_intents")
    .eq("project_id", projectId)
    .eq("status", "needs_user")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (data === null || data.pending_question === null) return null;

  return {
    auditId: data.id as string,
    question: data.pending_question as PendingQuestion,
    askedIntents: (data.asked_intents as string[] | null) ?? [],
  };
}

/** Which questions this run has already put to the founder. */
export async function getAskedIntents(
  supabase: SupabaseClient,
  auditId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("business_readiness_audits")
    .select("asked_intents")
    .eq("id", auditId)
    .maybeSingle();

  if (error) throw error;
  return (data?.asked_intents as string[] | null) ?? [];
}

// ---------------------------------------------------------------------
// Free audit entitlement (CORE-2 §16, §17)
// ---------------------------------------------------------------------

/**
 * The project-scoped half of consumption.
 *
 * Derived, never a flag: a completed audit funded by the included entitlement
 * *is* the proof it was spent. A failed or in-flight row proves nothing, which
 * is exactly what makes an internal failure free (CORE-2 §17).
 */
export async function hasCompletedIncludedAudit(
  supabase: SupabaseClient,
  projectId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("business_readiness_audits")
    .select("id")
    .eq("project_id", projectId)
    .eq("status", "completed")
    .eq("access_mode", "included_first_audit")
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data !== null;
}

/**
 * True while an audit is claimed but not finished.
 *
 * `needs_user` counts (CORE-2a.4). An audit paused for a founder-only question
 * has claimed its slot and prepared its evidence; it is waiting, not finished.
 * Excluding it would let a second run start while the first holds the answer
 * it is about to receive, and both would then spend a paid call.
 */
export async function hasRunningAudit(
  supabase: SupabaseClient,
  projectId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("business_readiness_audits")
    .select("id")
    .eq("project_id", projectId)
    .in("status", ["pending", "analyzing", "needs_user"])
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data !== null;
}

/**
 * Audit starts inside the abuse window (CORE-2 §59).
 *
 * Counts every claimed run regardless of outcome, because the point is to
 * bound how often inference can be *attempted*, not how often it succeeded.
 * The entitlement is a separate question and is not touched by this number —
 * an outage must not read as abuse.
 */
export async function countRecentAuditStarts(
  supabase: SupabaseClient,
  projectId: string,
): Promise<number> {
  const since = new Date(Date.now() - AUDIT_START_LIMITS.windowMs).toISOString();

  const { count, error } = await supabase
    .from("business_readiness_audits")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .gte("created_at", since);

  if (error) throw error;
  return count ?? 0;
}

/**
 * The durable half of consumption, scoped to a GitHub repository rather than
 * a project so disconnecting and reconnecting cannot mint a second free audit
 * (CORE-2 §16).
 */
export async function hasFreeAuditGrant(
  supabase: SupabaseClient,
  params: { userId: string; githubRepositoryId: number },
): Promise<boolean> {
  const { data, error } = await supabase
    .from("free_audit_grants")
    .select("id")
    .eq("user_id", params.userId)
    .eq("github_repository_id", params.githubRepositoryId)
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data !== null;
}

/**
 * Records that the free audit was consumed for one repository.
 *
 * Called from durable execution with the service-role client, immediately
 * after an audit completes and never before — so an internal failure leaves no
 * trace here and costs the user nothing.
 *
 * A duplicate is not an error. The unique constraint is the authority on
 * "already granted", and a replayed step arriving second should be a no-op
 * rather than a failure that would fail an audit which has already succeeded.
 */
export async function recordFreeAuditGrant(
  supabase: SupabaseClient,
  params: { userId: string; githubRepositoryId: number; auditId: string },
): Promise<void> {
  const { error } = await supabase.from("free_audit_grants").insert({
    user_id: params.userId,
    github_repository_id: params.githubRepositoryId,
    audit_id: params.auditId,
  });

  if (error && error.code !== POSTGRES_UNIQUE_VIOLATION) {
    // Deliberately not thrown. The audit itself is already committed and
    // readable; losing the durable grant costs at most one extra free audit
    // after a disconnect, which is a far better outcome than failing a run the
    // user has already paid for in time.
    console.error("[business-audit] failed to record free audit grant", { auditId: params.auditId });
  }
}
