import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { recordAuditEvent } from "@/modules/audit-log/events";
import { analyzeLiveProduct } from "./analyzer";
import { LiveProductDomainError, type LiveProductErrorCode } from "./errors";
import { resolveDns } from "./net/node-dns";
import { nodeHttpTransport } from "./net/node-transport";
import {
  LIVE_PRODUCT_ANALYZER_VERSION,
  LIVE_PRODUCT_INTELLIGENCE_SCHEMA_VERSION,
} from "./schema";
import {
  completeLiveAnalysisRun,
  createLiveAnalysisRun,
  failLiveAnalysisRun,
  findReusableLiveSnapshot,
  type StoredLiveSnapshot,
} from "./store";
import { normalizeProductionUrl } from "./url";

/**
 * Application service tying ownership, reuse, analysis and persistence
 * together. This is the only entry point the UI calls.
 *
 * Ownership is verified from persisted data before any outbound request:
 * the caller supplies a project id, never a URL, so a user cannot point
 * Vibe Business at an arbitrary destination through this action. The URL
 * that gets crawled is the one stored on their own project, re-validated
 * on the way out.
 */

export type InspectLiveFailureCode = LiveProductErrorCode | "project_not_found" | "production_url_not_set" | "already_running";

export type InspectLiveResult =
  | { ok: true; snapshot: StoredLiveSnapshot; reused: boolean }
  | { ok: false; error: InspectLiveFailureCode };

export type InspectLiveOptions = {
  /** Skips freshness-based reuse and forces a fresh crawl. */
  force?: boolean;
};

function toFailureCode(error: unknown): InspectLiveFailureCode {
  if (error instanceof LiveProductDomainError) return error.code;
  return "analysis_failed";
}

/** Loads the production URL of a project the caller owns. RLS enforces ownership; the explicit filter documents it. */
async function loadOwnedProductionUrl(
  supabase: SupabaseClient,
  projectId: string,
  userId: string,
): Promise<{ productionUrl: string | null } | null> {
  const { data, error } = await supabase
    .from("projects")
    .select("id, production_url")
    .eq("id", projectId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return { productionUrl: data.production_url };
}

export async function inspectLiveProduct(
  supabase: SupabaseClient,
  params: { projectId: string; userId: string },
  options: InspectLiveOptions = {},
): Promise<InspectLiveResult> {
  const owned = await loadOwnedProductionUrl(supabase, params.projectId, params.userId);
  if (!owned) return { ok: false, error: "project_not_found" };
  if (!owned.productionUrl) return { ok: false, error: "production_url_not_set" };

  // Re-validated on read, not trusted because it was validated on write:
  // the policy may have tightened since, and this is the last checkpoint
  // before an outbound request.
  const normalized = normalizeProductionUrl(owned.productionUrl);
  if (!normalized.ok) return { ok: false, error: "invalid_production_url" };

  if (!options.force) {
    const reusable = await findReusableLiveSnapshot(supabase, {
      projectId: params.projectId,
      sourceOrigin: normalized.origin,
      analyzerVersion: LIVE_PRODUCT_ANALYZER_VERSION,
    });

    if (reusable) {
      await recordAuditEvent(supabase, {
        userId: params.userId,
        eventType: "live_product.intelligence.reused",
        metadata: {
          projectId: params.projectId,
          sourceOrigin: normalized.origin,
          analyzerVersion: LIVE_PRODUCT_ANALYZER_VERSION,
        },
      });
      return { ok: true, snapshot: reusable, reused: true };
    }
  }

  const run = await createLiveAnalysisRun(supabase, {
    projectId: params.projectId,
    sourceOrigin: normalized.origin,
    configuredUrl: normalized.url,
    analyzerVersion: LIVE_PRODUCT_ANALYZER_VERSION,
    schemaVersion: LIVE_PRODUCT_INTELLIGENCE_SCHEMA_VERSION,
  });

  if (!run.ok) {
    if (run.error === "already_running") return { ok: false, error: "already_running" };
    return { ok: false, error: "analysis_failed" };
  }

  await recordAuditEvent(supabase, {
    userId: params.userId,
    eventType: "live_product.intelligence.started",
    metadata: {
      projectId: params.projectId,
      // Origin only — never a full URL with a query string (Sprint 3 §29).
      sourceOrigin: normalized.origin,
      analyzerVersion: LIVE_PRODUCT_ANALYZER_VERSION,
    },
  });

  try {
    const snapshot = await analyzeLiveProduct({
      configuredUrl: normalized.url,
      dependencies: { resolveDns, transport: nodeHttpTransport },
    });

    await completeLiveAnalysisRun(supabase, run.snapshotId, snapshot);

    await recordAuditEvent(supabase, {
      userId: params.userId,
      eventType: "live_product.intelligence.completed",
      metadata: {
        projectId: params.projectId,
        sourceOrigin: snapshot.source.effectiveOrigin,
        analyzerVersion: LIVE_PRODUCT_ANALYZER_VERSION,
        completeness: snapshot.completeness.status,
        pagesInspected: snapshot.crawl.pagesInspected,
        bytesFetched: snapshot.metrics.bytesFetched,
        durationMs: snapshot.metrics.durationMs,
      },
    });

    const completedAt = new Date().toISOString();
    return {
      ok: true,
      reused: false,
      snapshot: {
        id: run.snapshotId,
        projectId: params.projectId,
        status: "completed",
        sourceOrigin: snapshot.source.effectiveOrigin,
        configuredUrl: normalized.url,
        analyzerVersion: LIVE_PRODUCT_ANALYZER_VERSION,
        completeness: snapshot.completeness.status,
        completenessReasons: snapshot.completeness.reasons,
        failureCode: null,
        result: snapshot,
        createdAt: completedAt,
        completedAt,
      },
    };
  } catch (error) {
    const code = toFailureCode(error);
    await failLiveAnalysisRun(supabase, run.snapshotId, code);
    await recordAuditEvent(supabase, {
      userId: params.userId,
      eventType: "live_product.intelligence.failed",
      metadata: { projectId: params.projectId, sourceOrigin: normalized.origin, reason: code },
    });
    return { ok: false, error: code };
  }
}
