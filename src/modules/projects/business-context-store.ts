import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { recordAuditEvent } from "@/modules/audit-log/events";
import {
  hashBusinessContext,
  parseBusinessContext,
  type BusinessContext,
  type BusinessContextRejection,
} from "./business-context";

/**
 * Persistence for a project's business context (Sprint 4 §2).
 *
 * One row per project, upserted. The content hash is stored alongside so
 * audit reuse can tell an actual edit from a no-op re-save
 * (Sprint 4 §23).
 */

export type StoredBusinessContext = {
  context: BusinessContext;
  contextHash: string;
  updatedAt: string;
};

type ContextRow = {
  product_summary: string;
  target_customer: string | null;
  stage: BusinessContext["stage"];
  monetization_model: BusinessContext["monetizationModel"];
  primary_goal: BusinessContext["primaryGoal"];
  context_hash: string;
  updated_at: string;
};

export async function getBusinessContext(
  supabase: SupabaseClient,
  projectId: string,
): Promise<StoredBusinessContext | null> {
  const { data, error } = await supabase
    .from("project_business_context")
    .select("product_summary, target_customer, stage, monetization_model, primary_goal, context_hash, updated_at")
    .eq("project_id", projectId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const row = data as ContextRow;
  return {
    context: {
      productSummary: row.product_summary,
      targetCustomer: row.target_customer,
      stage: row.stage,
      monetizationModel: row.monetization_model,
      primaryGoal: row.primary_goal,
    },
    contextHash: row.context_hash,
    updatedAt: row.updated_at,
  };
}

export type SaveBusinessContextFailure = BusinessContextRejection | "project_not_found" | "save_failed";

export type SaveBusinessContextResult =
  | { ok: true; contextHash: string; changed: boolean }
  | { ok: false; error: SaveBusinessContextFailure };

export async function saveBusinessContext(
  supabase: SupabaseClient,
  params: {
    projectId: string;
    userId: string;
    input: {
      productSummary: unknown;
      targetCustomer?: unknown;
      stage?: unknown;
      monetizationModel?: unknown;
      primaryGoal?: unknown;
    };
  },
): Promise<SaveBusinessContextResult> {
  const parsed = parseBusinessContext(params.input);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", params.projectId)
    .eq("user_id", params.userId)
    .maybeSingle();

  if (!project) return { ok: false, error: "project_not_found" };

  const existing = await getBusinessContext(supabase, params.projectId);
  const contextHash = hashBusinessContext(parsed.context);
  const changed = existing?.contextHash !== contextHash;

  const { error } = await supabase.from("project_business_context").upsert(
    {
      project_id: params.projectId,
      product_summary: parsed.context.productSummary,
      target_customer: parsed.context.targetCustomer,
      stage: parsed.context.stage,
      monetization_model: parsed.context.monetizationModel,
      primary_goal: parsed.context.primaryGoal,
      context_hash: contextHash,
    },
    { onConflict: "project_id" },
  );

  if (error) return { ok: false, error: "save_failed" };

  if (changed) {
    await recordAuditEvent(supabase, {
      userId: params.userId,
      eventType: "business_context.updated",
      metadata: {
        projectId: params.projectId,
        // The hash, never the content: business context is customer text
        // and has no place in an audit-log row (Sprint 4 §32).
        contextHash,
        stage: parsed.context.stage,
        monetizationModel: parsed.context.monetizationModel,
        primaryGoal: parsed.context.primaryGoal,
      },
    });
  }

  return { ok: true, contextHash, changed };
}
