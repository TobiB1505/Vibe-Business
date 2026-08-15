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
  | "change_preview.expired"
  // Visual review (Sprint 11A). None of these may carry a signed screenshot
  // URL: it is a bearer credential for a customer's product image, and an
  // audit log is exactly the durable place it must not reach (§16).
  | "change_review.started"
  | "change_review.ready"
  | "change_review.failed"
  // Human approval (Sprint 11B §17). These carry a commit SHA deliberately: an
  // approval record that cannot say *what* was approved documents nothing, and
  // a commit SHA identifies content rather than granting access to it. What
  // they must never carry is the review's evidence — no signed screenshot URL,
  // no image path, no page content.
  | "change_approval.created"
  | "change_approval.revoked"
  // Written when a read notices the approved artifact has moved on. Not a user
  // action, which is why it is its own event rather than a variant of revoked:
  // "you withdrew this" and "this stopped applying" are different histories.
  | "change_approval.invalidated"
  // Safe merge (Sprint 11C §27). The first events in this log that describe a
  // write to a customer's DEFAULT branch, so they carry both SHAs deliberately:
  // "what moved from where to where" is the entire content of the record, and a
  // commit SHA identifies content rather than granting access to it.
  //
  // What they must never carry: installation tokens, raw provider error text,
  // diff content, or any claim about deployment.
  | "change_merge.requested"
  | "change_merge.preflight_passed"
  // Refused before any write — from the request path or from the durable
  // preflight. The most important events in this list, because they are the
  // evidence that the safety checks fired.
  | "change_merge.blocked"
  /**
   * An approved change was observed to be unmergeable, recorded once.
   *
   * Deliberately **not** `change_merge.blocked`. That event means *a human
   * asked for a merge and was refused*; this one means *Vibe looked and could
   * not offer one*. Conflating them would make the log unable to answer the
   * only question it is really asked here — whether anyone tried.
   *
   * Written from a read path, so it is deduplicated against the last recorded
   * reason for the same prepared change: the preflight runs on every page load,
   * and an event per render would log page views rather than events.
   */
  | "change_merge.not_eligible"
  /** The one event that means GitHub was asked to move the branch. */
  | "change_merge.default_branch_updated"
  /** The branch was read back independently and matched the approved commit. */
  | "change_merge.verified"
  | "change_merge.failed"
  // Production outcome verification (Sprint 12A §35). The first events in this
  // log that describe the customer's *product* rather than Vibe's own pipeline.
  //
  // They carry the merged commit SHA and the public origin — a content
  // identifier and a hostname, both already public — plus counts of how many
  // checks landed in each status. They must never carry a response body, HTML,
  // XML, a sitemap URL read out of a fetched document, a query string, a
  // header, or any claim about deployment.
  //
  // Four terminal events rather than one with a field, because the difference
  // between them is the whole product distinction this sprint exists to make:
  // `not_observed` is about the product, `failed` is about Vibe.
  | "change_outcome.started"
  | "change_outcome.verified"
  | "change_outcome.partial"
  | "change_outcome.not_observed"
  | "change_outcome.failed";

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
