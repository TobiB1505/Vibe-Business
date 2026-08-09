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
  | "github.access.failed";

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
