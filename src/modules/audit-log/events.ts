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
  // Historical. `project_business_context` was dropped in CORE-2 and nothing
  // emits this any more, but existing rows carry it and the activity feed must
  // still be able to render them.
  | "business_context.updated"
  // CORE-2 §4. What replaced it: stage, intended monetization and primary
  // goal, all closed enums.
  | "founder_intent.updated"
  | "business_audit.started"
  | "business_audit.completed"
  | "business_audit.failed"
  | "business_audit.reused"
  /**
   * The audit stopped and asked its founder something only they could answer
   * (CORE-2a.4). Carries the question's intent and the areas it affects — never
   * the founder's own words, which are not the audit log's business.
   */
  | "business_audit.needs_user"
  | "business_audit.question_answered"
  | "business_audit.resumed"
  // Product Understanding (CORE-1 §22). `completed_without_synthesis` is its
  // own event rather than a metadata flag: a profile derived with no model is
  // a materially different thing to have produced, and it should be findable
  // in the log without reading every completion's metadata.
  | "product_understanding.started"
  | "product_understanding.completed"
  | "product_understanding.completed_without_synthesis"
  | "product_understanding.reused"
  | "product_understanding.confirmed"
  | "product_understanding.corrected"
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
  // Action planning (CORE-2b). Its own lifecycle, for the same reason the
  // Opportunity Engine has one: the operation records execution, the domain
  // records what was concluded.
  | "action_plan.completed"
  | "action_plan.failed"
  | "action_plan.reused"
  // Change preparation (Sprint 9B §17). Domain lifecycle, distinct from the
  // generic operation.* execution events.
  | "change_preparation.started"
  | "change_validation.started"
  | "change_validation.passed"
  | "change_validation.failed"
  | "change_validation.artifact_capture_failed"
  | "change_preparation.completed"
  | "change_preparation.failed"
  // Agentic execution (EXECUTION CORE-4 §24). Domain lifecycle, distinct from
  // the generic operation.* execution events.
  //
  // What these carry is deliberately narrow: identifiers, the model, the
  // policy marker, and — on a rejection — the closed set of reasons the change
  // was refused. What they must never carry is a prompt, model output, a
  // reasoning trace, a file path's contents, a command's output, or the agent's
  // own description of what it did (§24, Rule 43).
  //
  // `change_rejected` is the most important of the six, for the same reason
  // `change_merge.blocked` is: it is the evidence that a safety check fired.
  //
  // `change_verified` carries the same payload for the other outcome, and it is
  // not a formality: an accepted change is the one a human is asked to approve
  // and the one that may reach a branch, so "which observed paths were withheld
  // and by which rule" matters more there, not less. Run #3 withheld twelve of
  // fourteen and the only record of which twelve was a platform log.
  | "agent_execution.started"
  | "agent_execution.needs_user_input"
  | "agent_execution.change_verified"
  | "agent_execution.change_rejected"
  | "agent_execution.completed"
  /**
   * Validation was handed the change a finished run prepared (Sprint 0048).
   *
   * Recorded for every outcome, including `failed`, because "the automatic
   * trigger did not fire" is the one thing about it that is invisible from the
   * outside — the manual button still works, so a silent miss looks exactly
   * like a user who has not clicked yet.
   */
  | "agent_execution.validation_enqueued"
  | "agent_execution.failed"
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
  | "change_outcome.failed"
  // Business outcome measurement (Sprint 12B §39). The first events describing
  // the customer's *business* rather than their product.
  //
  // They carry the metric key, the classification, the sample sizes and the
  // observed relative movement. They must never carry an OAuth token, a refresh
  // token, an API key, a vendor account identifier, a raw analytics payload, or
  // the daily series itself.
  //
  // `insufficient_data` is its own event rather than a field, for the same
  // reason `not_observed` was in 12A: it is an honest non-result, and a log
  // that could not distinguish it from a measured null would be unable to
  // answer whether anyone ever had enough data.
  | "business_measurement.created"
  | "business_measurement.started"
  | "business_measurement.completed"
  | "business_measurement.insufficient_data"
  | "business_measurement.failed"
  /**
   * Project activation (ONBOARDING-1).
   *
   * Deliberately parallel to the domain events rather than a replacement for
   * them. `product_understanding.started` says Vibe began deriving a profile;
   * `onboarding.product_understanding_started` says the activation flow reached
   * that step for this project. The same moment, but two different questions —
   * "what did Vibe do" and "how far did this founder get" — and a log that
   * collapsed them could answer neither where activation stalled nor why.
   *
   * They carry the project and the step. Never a URL the founder typed, never a
   * repository's contents, never the founder's own words.
   */
  | "onboarding.started"
  | "onboarding.github_connected"
  | "onboarding.repository_selected"
  | "onboarding.live_site_added"
  /** A real answer, not an absence: "there is no live product yet" is state. */
  | "onboarding.live_site_skipped"
  | "onboarding.product_scan_started"
  | "onboarding.product_scan_completed"
  | "onboarding.product_understanding_started"
  | "onboarding.product_understanding_completed"
  | "onboarding.product_confirmed"
  | "onboarding.audit_started"
  | "onboarding.audit_needs_user"
  | "onboarding.audit_completed"
  | "onboarding.first_move_started"
  | "onboarding.first_move_viewed"
  | "onboarding.completed"

  /*
   * Billing (BILLING CORE-1 §34).
   *
   * Every event that moves money or holds it. Deliberately absent: balances in
   * the event name, payment instruments, provider identifiers, and anything
   * about *why* a provider charged what it did — the metadata carries ids and
   * credit amounts only.
   *
   * There is no `credit_charge.attempted`. An attempt that did not post a
   * ledger entry did not happen, and an audit log that recorded intentions
   * alongside facts would make "was this customer charged?" ambiguous.
   */
  | "credit_account.created"
  | "credit_grant.posted"
  | "credit_reservation.created"
  | "credit_reservation.released"
  | "credit_charge.settled"
  | "credit_refund.posted"

  /*
   * Billing Core-2 (§68). Money, entitlements and real Credit consumption.
   *
   * Deliberately absent from every one of these: card data, Stripe secrets,
   * webhook signatures, payment amounts in currency, and any provider payload.
   * The metadata carries identifiers, Credit amounts and policy versions —
   * enough to answer "why does this account have these Credits?" and nothing
   * that would duplicate Stripe's own record of a payment.
   *
   * There is no `billing.checkout_completed`. A returning browser is not proof
   * of payment (§25), so the event that matters is the grant a verified Stripe
   * event produced, which `billing.credit_lot_granted` already records.
   */
  | "billing.credit_lot_granted"
  | "billing.credits_expired"
  | "billing.operation_reserved"
  | "billing.checkout_started"
  | "billing.subscription_updated"
  | "billing.stripe_event_ignored"

  /*
   * Agentic execution contract (EXECUTION CORE-3 §35).
   *
   * One event, because one thing durably happens in this sprint: an immutable
   * ExecutionSpec is recorded. §35 lists several others it *could* log —
   * `execution.resolved`, `execution.blocked`, `execution.needs_input`,
   * `execution.budget_bound` — and none is added, because resolution is a pure
   * function recomputed on every read and logging it would record page views
   * rather than events. `change_merge.not_eligible` already carries that
   * lesson, and it had to be deduplicated to survive it.
   *
   * The metadata carries identifiers, a mode, a risk class, a Credit ceiling
   * and policy versions. It must never carry the objective's text, the
   * compiled policy, a repository path, generated code, a prompt, a model
   * response or a reasoning trace.
   */
  | "execution.spec_created";

/*
 * There is deliberately no `credit_usage.reconciled`. Shadow reconciliation
 * sweeps every project at once and has no single user to attribute an event
 * to, and `audit_events` is a per-user record — so the honest place for that
 * signal is structured server logging, not this log. An event type with no
 * caller is exactly what ADR 0007 and rule 15 exist to prevent.
 */

export type RecordAuditEventParams = {
  userId: string;
  eventType: AuditEventType;
  /**
   * The project this event is about, when it is about one.
   *
   * Optional because several event types are genuinely account-level —
   * `github.authorization.started` happens before any project exists. Passing
   * it writes the real `project_id` column (Sprint UI-2.5), which is what the
   * Activity read filters and indexes on.
   */
  projectId?: string | null;
  /** Never include secrets/tokens here — see ADR 0008 and ADR 0009. */
  metadata?: Record<string, unknown>;
};

/**
 * Callers have carried the project id in `metadata` since Sprint 1, and most
 * still do. Reading it back keeps every existing call site writing the column
 * without being edited; an explicit `projectId` argument wins over it.
 *
 * **Both spellings are accepted, and that is not tidiness.** The earlier
 * modules use `projectId`; merge, approval, outcome and measurement — added
 * from Sprint 11B onwards — use `project_id`. Reading only one of them silently
 * dropped 13 real events out of the Activity feed, including the merge that
 * moved a default branch. That was found by querying the deployed table rather
 * than by reading the writers, and it is exactly the class of bug a convention
 * produces when nothing enforces it.
 *
 * The metadata keys are deliberately **not** removed on write. Other readers
 * may rely on them, and dropping them would be a breaking change disguised as
 * a refactor.
 */
function resolveProjectId(params: RecordAuditEventParams): string | null {
  if (params.projectId !== undefined && params.projectId !== null) return params.projectId;

  for (const key of ["projectId", "project_id"] as const) {
    const value = params.metadata?.[key];
    if (typeof value === "string" && value.length > 0) return value;
  }

  return null;
}

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
    // Null for account-level events. The column is nullable permanently: a
    // NOT NULL would force `github.authorization.started` — which happens
    // before any project exists — to invent a project id.
    project_id: resolveProjectId(params),
    metadata: params.metadata ?? {},
  });

  if (error) {
    console.error(`[audit-log] failed to record "${params.eventType}":`, error.message);
  }
}
