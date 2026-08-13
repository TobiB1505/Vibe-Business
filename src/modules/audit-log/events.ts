import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Event types this sprint can actually produce. Extend as new layers
 * start emitting events — do not add speculative event types ahead of a
 * real caller, per ADR 0007 / CLAUDE.md rule 15.
 */
export type AuditEventType =
  | "github.authorization.started"
  | "github.identity.verified"
  | "github.installation.connected"
  | "repository.selected"
  | "project.created"
  | "project.disconnected"
  | "github.access.failed"
  | "repository.intelligence.started"
  | "repository.intelligence.completed"
  | "repository.intelligence.failed"
  | "repository.intelligence.reused"
  | "project.production_url.updated"
  | "live_product.intelligence.started"
  | "live_product.intelligence.completed"
  | "live_product.intelligence.failed"
  | "live_product.intelligence.reused"
  | "business_context.updated"
  | "business_audit.started"
  | "business_audit.completed"
  | "business_audit.failed"
  | "business_audit.reused"
  | "deep_scan.started"
  | "deep_scan.completed"
  | "deep_scan.failed"
  | "deep_scan.cancelled"
  // Execution lifecycle, distinct from the domain lifecycle above (Sprint 7
  // §22). `operation.*` says whether durable work started, finished or died;
  // `business_audit.*` says what the audit itself did. Emitting both from the
  // same moment would double every entry, so each layer owns its own: the
  // operation records execution, the audit records inference.
  | "operation.started"
  | "operation.completed"
  | "operation.failed"
  | "opportunities.completed"
  | "opportunities.failed"
  | "opportunities.reused"
  // Change preparation (Sprint 9B §17). Domain lifecycle, distinct from the
  // generic operation.* execution events.
  | "change_preparation.started"
  | "change_validation.started"
  | "change_validation.passed"
  | "change_validation.failed"
  | "change_validation.artifact_capture_failed"
  | "change_preparation.completed"
  | "change_preparation.failed"
  // Temporary preview (Sprint 10B-2). None of these may carry the preview
  // origin: an unlisted public URL to a VM serving untrusted code is
  // capability-like, and an audit log is exactly the kind of durable, widely
  // readable place it must not reach (§16).
  | "change_preview.started"
  | "change_preview.running"
  | "change_preview.integrity_failed"
  | "change_preview.failed"
  | "change_preview.stopped"
  | "change_preview.cleanup_incomplete"
  | "change_preview.expired";

export type RecordAuditEventParams = {
  userId: string;
  eventType: AuditEventType;
  /** Never include secrets/tokens here — see ADR 0008 and ADR 0009. */
  metadata?: Record<string, unknown>;
};

/**
 * Shared audit-log write path (ADR 0007) — route handlers and Server
 * Actions call this instead of inserting into `audit_events` directly, so
 * every insert goes through one place that enforces the metadata
 * discipline and error handling below.
 *
 * A failed audit write does not fail the calling action: the audit log
 * records what happened, it does not gate whether it's allowed to happen
 * (that's the RLS policies' and the caller's own logic's job). Failures
 * are logged server-side for operational visibility instead.
 */
export async function recordAuditEvent(
  supabase: SupabaseClient,
  params: RecordAuditEventParams,
): Promise<void> {
  const { error } = await supabase.from("audit_events").insert({
    user_id: params.userId,
    event_type: params.eventType,
    metadata: params.metadata ?? {},
  });

  if (error) {
    console.error(`[audit-log] failed to record "${params.eventType}":`, error.message);
  }
}
