import "server-only";
import { cache } from "react";

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { applyCorrections } from "./assemble";
import { UNDERSTANDING_EVIDENCE_VERSION } from "./evidence";
import {
  EDITABLE_FIELDS,
  MAX_CORRECTION_LENGTH,
  PRODUCT_PROFILE_SCHEMA_VERSION,
  PROFILE_BUILDER_VERSION,
  type EditableField,
  type ProductProfile,
  type ProfileCorrections,
} from "./schema";

/**
 * Persistence for Product Understanding (CORE-1 §22, §25, §38).
 *
 * Two stores with different lifetimes, and keeping them apart is the whole
 * design:
 *
 *   product_profiles              derived. Replaced whenever evidence moves.
 *   product_profile_corrections   authored. Survives every re-scan.
 *
 * A stored profile is the **derived** document with no corrections baked in.
 * Corrections are overlaid on read. That is what makes "a new scan does not
 * blindly overwrite what the user confirmed" a structural property rather than
 * a rule someone has to remember at every call site.
 *
 * Every query runs through the caller's request-scoped Supabase client, so RLS
 * is always in force — there is no service-role path in this file. Durable
 * execution passes its own privileged client explicitly (ADR 0013), and every
 * such call filters on a project id taken from the persisted operation row.
 */

export type ProfileStatus = "pending" | "analyzing" | "completed" | "failed";

export type StoredProfile = {
  id: string;
  projectId: string;
  status: ProfileStatus;
  inputHash: string;
  /** The derived document, before any correction is applied. */
  result: ProductProfile | null;
  synthesized: boolean;
  failureCode: string | null;
  confirmedAt: string | null;
  createdAt: string;
  completedAt: string | null;
};

type ProfileRow = {
  id: string;
  project_id: string;
  status: ProfileStatus;
  input_hash: string;
  result: ProductProfile | null;
  synthesized: boolean;
  failure_code: string | null;
  confirmed_at: string | null;
  created_at: string;
  completed_at: string | null;
};

const PROFILE_COLUMNS =
  "id, project_id, status, input_hash, result, synthesized, failure_code, confirmed_at, created_at, completed_at";

function mapRow(row: ProfileRow): StoredProfile {
  return {
    id: row.id,
    projectId: row.project_id,
    status: row.status,
    inputHash: row.input_hash,
    result: row.result,
    synthesized: row.synthesized,
    failureCode: row.failure_code,
    confirmedAt: row.confirmed_at,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

/**
 * The identity of a profile's inputs (CORE-1 §22).
 *
 * Everything that can change the answer, and nothing that cannot. The three
 * snapshot ids cover "the product changed"; the version set covers "our
 * derivation changed". A new commit produces a new repository snapshot, whose
 * new id changes this hash, which is what makes "refresh on a new commit" fall
 * out of the identity rather than needing an invalidation system of its own.
 *
 * `null` is a real value here, not a missing one. A profile built before a
 * Deep Scan and one built after saw different evidence, so they must not share
 * a hash — otherwise the first Deep Scan would silently return the stale
 * profile and the user would never see their new evidence used.
 *
 * Corrections are deliberately **absent**. They are applied on read, so
 * editing a description must not invalidate a profile and buy a new inference
 * call. Field order is fixed rather than derived from object keys, so the hash
 * survives refactors.
 */
export function computeProfileInputHash(params: {
  repositorySnapshotId: string | null;
  liveSnapshotId: string | null;
  authenticatedSnapshotId: string | null;
  schemaVersion: string;
  builderVersion: string;
  evidenceVersion: string;
  promptVersion: string;
  provider: string;
  model: string;
}): string {
  const canonical = JSON.stringify([
    params.repositorySnapshotId,
    params.liveSnapshotId,
    params.authenticatedSnapshotId,
    params.schemaVersion,
    params.builderVersion,
    params.evidenceVersion,
    params.promptVersion,
    params.provider,
    params.model,
  ]);
  return createHash("sha256").update(canonical).digest("hex");
}

// ---------------------------------------------------------------------
// Corrections
// ---------------------------------------------------------------------

/**
 * Accepts only known fields, trimmed and bounded.
 *
 * A closed allowlist rather than a filter over whatever arrived: this value is
 * written to a JSONB column and read back into the profile, and "whatever the
 * client sent" is not something to store under any circumstances. Free text
 * here is untrusted DATA and is never used as an instruction to anything.
 */
export function sanitizeCorrections(raw: unknown): ProfileCorrections {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};

  const record = raw as Record<string, unknown>;
  const corrections: ProfileCorrections = {};

  for (const field of EDITABLE_FIELDS) {
    const value = record[field];
    if (typeof value !== "string") continue;
    const text = value.replace(/\s+/g, " ").trim();
    // An empty string is how a user clears a correction, so it removes the key
    // rather than storing a blank that would render as an empty answer.
    if (text === "" || text.length > MAX_CORRECTION_LENGTH) continue;
    corrections[field as EditableField] = text;
  }

  return corrections;
}

export async function getCorrections(
  supabase: SupabaseClient,
  projectId: string,
): Promise<ProfileCorrections> {
  const { data, error } = await supabase
    .from("product_profile_corrections")
    .select("corrections")
    .eq("project_id", projectId)
    .maybeSingle();

  if (error) throw error;
  return sanitizeCorrections((data as { corrections: unknown } | null)?.corrections);
}

export async function saveCorrections(
  supabase: SupabaseClient,
  params: { projectId: string; corrections: ProfileCorrections },
): Promise<void> {
  const { error } = await supabase.from("product_profile_corrections").upsert(
    {
      project_id: params.projectId,
      corrections: sanitizeCorrections(params.corrections),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "project_id" },
  );

  if (error) throw error;
}

// ---------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------

/**
 * The profile the understanding screen shows: the newest successful one, with
 * the user's corrections already applied.
 *
 * Overlaying here rather than at every call site is what makes the correction
 * rule hold everywhere — including in code written later that has forgotten
 * this file exists.
 */
/**
 * Deduplicated per request (VB-022).
 *
 * The Business Health render asks fourteen questions at once and several of the
 * services answering them re-read the same documents underneath — the audit
 * three times, the repository snapshot four. Each is a JSONB document, so the
 * cost is bytes off the wire and parse time, repeated.
 *
 * `cache()` is per-render, keyed on the arguments — which works here only
 * because every caller in a render shares the one `supabase` instance
 * `requireProjectAccess` returned. A caller that made its own client would miss
 * the cache rather than get a stale answer, which is the right way round.
 *
 * Outside a render it does not memoize at all — measured, not assumed — so
 * durable execution keeps reading fresh state. That is what makes this safe to
 * put on a store shared with the workflow steps.
 */
async function getLatestProfileUncached(
  supabase: SupabaseClient,
  projectId: string,
): Promise<{ stored: StoredProfile; profile: ProductProfile } | null> {
  const [{ data, error }, corrections] = await Promise.all([
    supabase
      .from("product_profiles")
      .select(PROFILE_COLUMNS)
      .eq("project_id", projectId)
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    getCorrections(supabase, projectId),
  ]);

  if (error) throw error;
  if (!data) return null;

  const stored = mapRow(data as ProfileRow);
  if (!stored.result) return null;

  return { stored, profile: applyCorrections(stored.result, corrections) };
}

export const getLatestProfile = cache(getLatestProfileUncached);

export async function findReusableProfile(
  supabase: SupabaseClient,
  params: { projectId: string; inputHash: string },
): Promise<StoredProfile | null> {
  const { data, error } = await supabase
    .from("product_profiles")
    .select(PROFILE_COLUMNS)
    .eq("project_id", params.projectId)
    .eq("input_hash", params.inputHash)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ? mapRow(data as ProfileRow) : null;
}

export async function getProfileById(
  supabase: SupabaseClient,
  profileId: string,
): Promise<StoredProfile | null> {
  const { data, error } = await supabase
    .from("product_profiles")
    .select(PROFILE_COLUMNS)
    .eq("id", profileId)
    .maybeSingle();

  if (error) throw error;
  return data ? mapRow(data as ProfileRow) : null;
}

export type CreateProfileRunResult =
  | { ok: true; profileId: string }
  | { ok: false; error: "already_running" }
  | { ok: false; error: "unknown"; message: string };

const POSTGRES_UNIQUE_VIOLATION = "23505";

/**
 * Claims a derivation run. The partial unique index on in-flight rows turns a
 * double submission into a constraint violation reported as `already_running`,
 * so a user cannot buy two identical inference calls by clicking twice
 * (CLAUDE.md rule 48).
 */
export async function createProfileRun(
  supabase: SupabaseClient,
  params: {
    projectId: string;
    repositorySnapshotId: string | null;
    liveSnapshotId: string | null;
    authenticatedSnapshotId: string | null;
    inputHash: string;
    promptVersion: string;
    provider: string;
    model: string;
  },
): Promise<CreateProfileRunResult> {
  const { data, error } = await supabase
    .from("product_profiles")
    .insert({
      project_id: params.projectId,
      repository_snapshot_id: params.repositorySnapshotId,
      live_snapshot_id: params.liveSnapshotId,
      authenticated_snapshot_id: params.authenticatedSnapshotId,
      input_hash: params.inputHash,
      schema_version: PRODUCT_PROFILE_SCHEMA_VERSION,
      builder_version: PROFILE_BUILDER_VERSION,
      evidence_version: UNDERSTANDING_EVIDENCE_VERSION,
      // Written on completion, not on claim: a run that never reaches the
      // model must not carry a prompt version it did not use, and the
      // `synthesis_is_attributed` constraint enforces exactly that.
      prompt_version: null,
      provider: null,
      model: null,
      status: "analyzing",
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === POSTGRES_UNIQUE_VIOLATION) return { ok: false, error: "already_running" };
    return { ok: false, error: "unknown", message: error.message };
  }

  return { ok: true, profileId: data.id };
}

export async function completeProfileRun(
  supabase: SupabaseClient,
  params: {
    profileId: string;
    profile: ProductProfile;
    synthesized: boolean;
  },
): Promise<void> {
  const { error } = await supabase
    .from("product_profiles")
    .update({
      status: "completed",
      result: params.profile,
      synthesized: params.synthesized,
      // Kept consistent with `synthesized` so the attribution constraint holds
      // whichever way the run went.
      prompt_version: params.synthesized ? params.profile.promptVersion : null,
      provider: params.synthesized ? params.profile.provider : null,
      model: params.synthesized ? params.profile.model : null,
      completed_at: new Date().toISOString(),
    })
    .eq("id", params.profileId);

  if (error) throw error;
}

/**
 * Marks a run failed with a typed code only. A failed row never carries a
 * result, so it cannot displace the latest successful profile the user sees.
 */
export async function failProfileRun(
  supabase: SupabaseClient,
  profileId: string,
  failureCode: string,
): Promise<void> {
  const { error } = await supabase
    .from("product_profiles")
    .update({
      status: "failed",
      failure_code: failureCode,
      completed_at: new Date().toISOString(),
    })
    .eq("id", profileId);

  if (error) {
    console.error("[product-understanding] failed to record run failure", { profileId });
  }
}

/**
 * Records that a person confirmed one specific profile (CORE-1 §23).
 *
 * Scoped by project as well as by id, so a guessed profile id belonging to
 * another project cannot be confirmed even if RLS were ever relaxed. Already
 * confirmed is a no-op rather than an error — a second click on "Yes, that's
 * my product" is not a failure state.
 */
export async function confirmProfile(
  supabase: SupabaseClient,
  params: { projectId: string; profileId: string },
): Promise<boolean> {
  const { data, error } = await supabase
    .from("product_profiles")
    .update({ confirmed_at: new Date().toISOString() })
    .eq("id", params.profileId)
    .eq("project_id", params.projectId)
    .eq("status", "completed")
    .is("confirmed_at", null)
    .select("id");

  if (error) throw error;
  return (data?.length ?? 0) > 0;
}
