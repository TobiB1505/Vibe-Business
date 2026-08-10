import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { recordAuditEvent } from "@/modules/audit-log/events";
import { normalizeProductionUrl, type UrlRejectionReason } from "@/modules/live-product-intelligence/url";

/**
 * Setting and clearing a project's production URL (Sprint 3 §3).
 *
 * The URL is always stored normalized, never as typed: downstream code
 * (and the database check constraint) can then rely on it being HTTPS,
 * credential-free, and without a query string or fragment.
 *
 * A URL is only ever set by explicit user action. Vibe Business never
 * infers one from a deployment and persists it as truth.
 */

export type SetProductionUrlFailure = UrlRejectionReason | "project_not_found" | "save_failed";

export type SetProductionUrlResult =
  | { ok: true; url: string; changed: boolean }
  | { ok: false; error: SetProductionUrlFailure };

export async function setProductionUrl(
  supabase: SupabaseClient,
  params: { projectId: string; userId: string; rawUrl: string },
): Promise<SetProductionUrlResult> {
  const normalized = normalizeProductionUrl(params.rawUrl);
  if (!normalized.ok) return { ok: false, error: normalized.reason };

  const { data: project, error: loadError } = await supabase
    .from("projects")
    .select("id, production_url")
    .eq("id", params.projectId)
    .eq("user_id", params.userId)
    .maybeSingle();

  if (loadError) return { ok: false, error: "save_failed" };
  if (!project) return { ok: false, error: "project_not_found" };

  const previous: string | null = project.production_url;
  if (previous === normalized.url) return { ok: true, url: normalized.url, changed: false };

  const { error: updateError } = await supabase
    .from("projects")
    .update({ production_url: normalized.url })
    .eq("id", params.projectId)
    .eq("user_id", params.userId);

  if (updateError) return { ok: false, error: "save_failed" };

  await recordAuditEvent(supabase, {
    userId: params.userId,
    eventType: "project.production_url.updated",
    metadata: {
      projectId: params.projectId,
      // Origins only: normalization has already stripped query strings,
      // and recording the origin keeps the audit trail free of anything
      // that could carry a token (Sprint 3 §29).
      previousOrigin: previous ? safeOrigin(previous) : null,
      newOrigin: normalized.origin,
    },
  });

  return { ok: true, url: normalized.url, changed: true };
}

export async function clearProductionUrl(
  supabase: SupabaseClient,
  params: { projectId: string; userId: string },
): Promise<{ ok: boolean }> {
  const { data: project } = await supabase
    .from("projects")
    .select("id, production_url")
    .eq("id", params.projectId)
    .eq("user_id", params.userId)
    .maybeSingle();

  if (!project) return { ok: false };

  const { error } = await supabase
    .from("projects")
    .update({ production_url: null })
    .eq("id", params.projectId)
    .eq("user_id", params.userId);

  if (error) return { ok: false };

  await recordAuditEvent(supabase, {
    userId: params.userId,
    eventType: "project.production_url.updated",
    metadata: {
      projectId: params.projectId,
      previousOrigin: project.production_url ? safeOrigin(project.production_url) : null,
      newOrigin: null,
    },
  });

  return { ok: true };
}

/** Best-effort origin extraction for audit metadata; never throws on stored junk. */
function safeOrigin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}
