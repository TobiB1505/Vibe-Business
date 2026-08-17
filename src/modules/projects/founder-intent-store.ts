import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { recordAuditEvent } from "@/modules/audit-log/events";
import {
  EMPTY_FOUNDER_INTENT,
  hashFounderIntent,
  parseFounderIntent,
  type FounderIntent,
  type FounderIntentRejection,
} from "./founder-intent";

/**
 * Persistence for a project's founder intent (CORE-2 §4).
 *
 * One row per project, upserted. The content hash is stored alongside so audit
 * reuse can tell an actual edit from a no-op re-save (CORE-2 §7).
 *
 * Replaces `business-context-store.ts`, which is deleted rather than
 * deprecated: leaving a second writable product-understanding table in the
 * codebase is exactly how a "no parallel model" rule quietly stops being true.
 */

export type StoredFounderIntent = {
  intent: FounderIntent;
  intentHash: string;
  updatedAt: string;
};

type IntentRow = {
  stage: FounderIntent["stage"];
  monetization_model: FounderIntent["monetizationModel"];
  primary_goal: FounderIntent["primaryGoal"];
  intent_hash: string;
  updated_at: string;
};

/**
 * The project's stated intent, or the empty intent when nothing was stated.
 *
 * Returns a value rather than null on purpose. Founder intent is no longer an
 * audit prerequisite (see `founder-intent.ts`), so "the founder has said
 * nothing" is a normal state every caller must handle — and handing back a
 * real `FounderIntent` means none of them has to remember to.
 *
 * `intentHash` is therefore always a genuine hash, including for the empty
 * intent, which keeps audit identity honest: filling the form in for the first
 * time changes the hash and correctly buys a fresh audit.
 */
export async function getFounderIntent(
  supabase: SupabaseClient,
  projectId: string,
): Promise<StoredFounderIntent> {
  const { data, error } = await supabase
    .from("project_founder_intent")
    .select("stage, monetization_model, primary_goal, intent_hash, updated_at")
    .eq("project_id", projectId)
    .maybeSingle();

  if (error) throw error;

  if (!data) {
    return {
      intent: EMPTY_FOUNDER_INTENT,
      intentHash: hashFounderIntent(EMPTY_FOUNDER_INTENT),
      updatedAt: "",
    };
  }

  const row = data as IntentRow;
  return {
    intent: {
      stage: row.stage,
      monetizationModel: row.monetization_model,
      primaryGoal: row.primary_goal,
    },
    intentHash: row.intent_hash,
    updatedAt: row.updated_at,
  };
}

export type SaveFounderIntentFailure =
  | FounderIntentRejection
  | "project_not_found"
  | "save_failed";

export type SaveFounderIntentResult =
  | { ok: true; intentHash: string; changed: boolean }
  | { ok: false; error: SaveFounderIntentFailure };

export async function saveFounderIntent(
  supabase: SupabaseClient,
  params: {
    projectId: string;
    userId: string;
    input: {
      stage?: unknown;
      monetizationModel?: unknown;
      primaryGoal?: unknown;
    };
  },
): Promise<SaveFounderIntentResult> {
  const parsed = parseFounderIntent(params.input);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", params.projectId)
    .eq("user_id", params.userId)
    .maybeSingle();

  if (!project) return { ok: false, error: "project_not_found" };

  const existing = await getFounderIntent(supabase, params.projectId);
  const intentHash = hashFounderIntent(parsed.intent);
  const changed = existing.intentHash !== intentHash;

  const { error } = await supabase.from("project_founder_intent").upsert(
    {
      project_id: params.projectId,
      stage: parsed.intent.stage,
      monetization_model: parsed.intent.monetizationModel,
      primary_goal: parsed.intent.primaryGoal,
      intent_hash: intentHash,
    },
    { onConflict: "project_id" },
  );

  if (error) return { ok: false, error: "save_failed" };

  if (changed) {
    await recordAuditEvent(supabase, {
      userId: params.userId,
      eventType: "founder_intent.updated",
      metadata: {
        projectId: params.projectId,
        intentHash,
        // Safe to record in full: every field is a closed enum chosen by us.
        // The free-text fields that made the old `business_context.updated`
        // event record only a hash no longer exist in this layer.
        stage: parsed.intent.stage,
        monetizationModel: parsed.intent.monetizationModel,
        primaryGoal: parsed.intent.primaryGoal,
      },
    });
  }

  return { ok: true, intentHash, changed };
}
