import type { SupabaseClient } from "@supabase/supabase-js";
import { PRODUCT_UNDERSTANDING_CONFIG } from "@/modules/ai/operations";
import { UNDERSTANDING_EVIDENCE_VERSION } from "@/modules/product-understanding/evidence";
import { PROMPT_VERSION as PROFILE_PROMPT_VERSION } from "@/modules/product-understanding/prompt";
import {
  PRODUCT_PROFILE_SCHEMA_VERSION,
  PROFILE_BUILDER_VERSION,
} from "@/modules/product-understanding/schema";
import { computeProfileInputHash } from "@/modules/product-understanding/store";
import { fakeProductProfile } from "@/modules/product-understanding/test-support";
import type { OperationExecutor, StartOperationInput, StartOperationResult } from "./executor";

/**
 * Test doubles for durable execution (Sprint 7 §29).
 *
 * Two things are modelled honestly rather than approximately, because the
 * sprint's cost guarantees rest on them:
 *
 *  - the **partial unique indexes** from the migration, evaluated only over
 *    rows matching the index predicate, so a "one active operation" test fails
 *    for the same reason production would;
 *  - the **executor**, which counts starts. "Exactly one workflow" is the
 *    property under test, and a double that cannot count cannot prove it.
 *
 * Nothing here touches a network, a workflow platform, or a provider.
 */

export type Row = Record<string, unknown>;
type QueryError = { code?: string; message: string } | null;

const POSTGRES_UNIQUE_VIOLATION = "23505";
const POSTGRES_CHECK_VIOLATION = "23514";
const ACTIVE_OPERATION_STATUSES = ["queued", "running"];
const IN_FLIGHT_AUDIT_STATUSES = ["pending", "analyzing"];
const ACTIVE_VALIDATION_STATUSES = ["queued", "running"];
const ACTIVE_PREVIEW_STATUSES = ["starting", "running"];
/** Every outcome state that holds the identity lock — i.e. all but `failed`. */
const OUTCOME_IDENTITY_LOCK_STATUSES = [
  "queued",
  "observing",
  "verified",
  "partial",
  "not_observed",
];

type Filter =
  | { kind: "eq"; column: string; value: unknown }
  | { kind: "neq"; column: string; value: unknown }
  | { kind: "in"; column: string; values: unknown[] }
  | { kind: "is"; column: string; value: null }
  | { kind: "not_is"; column: string; value: null }
  | { kind: "gt"; column: string; value: unknown }
  | { kind: "gte"; column: string; value: unknown }
  | { kind: "lte"; column: string; value: unknown };

/**
 * Reads a column, following PostgREST's `column->>key` JSON accessor.
 *
 * Modelled because a store that filters on `metadata->>project_id` is issuing a
 * real query shape, and a fake that treats the whole string as a column name
 * silently matches nothing. A dedup lookup that always returns "nothing found"
 * does not fail — it just writes every time, which is exactly the bug the test
 * was written to catch.
 */
function readColumn(row: Row, column: string): unknown {
  const jsonAccessor = column.indexOf("->>");
  if (jsonAccessor === -1) return row[column];

  const container = row[column.slice(0, jsonAccessor)];
  if (!container || typeof container !== "object") return undefined;

  const value = (container as Record<string, unknown>)[column.slice(jsonAccessor + 3)];
  // `->>` yields text in Postgres, so a numeric or boolean member compares as
  // its string form rather than not at all.
  return value === undefined || value === null ? value : String(value);
}

function matches(row: Row, filters: Filter[]): boolean {
  return filters.every((filter) => {
    const value = readColumn(row, filter.column);
    if (filter.kind === "eq") return value === filter.value;
    if (filter.kind === "neq") return value !== filter.value;
    if (filter.kind === "in") return filter.values.includes(value);
    if (filter.kind === "is") return value === null || value === undefined;
    if (filter.kind === "not_is") return value !== null && value !== undefined;
    if (filter.kind === "gte") return String(value ?? "") >= String(filter.value);
    // Numeric when both sides are numbers, lexical otherwise.
    //
    // `gt`/`gte` above compare as strings, which is correct for the ISO
    // timestamps they are used on and wrong for numbers — `"500" >= "1000"`
    // is true. `lte` is used by the billing reservation predicate, where the
    // column is a credit balance, so it has to compare as arithmetic. The
    // older two are left alone deliberately rather than "fixed": changing how
    // every existing timestamp filter compares is not this sprint's business.
    if (filter.kind === "lte") {
      return typeof value === "number" && typeof filter.value === "number"
        ? value <= filter.value
        : String(value ?? "") <= String(filter.value);
    }
    return String(value ?? "") > String(filter.value);
  });
}

export class FakeDatabase {
  private readonly tables = new Map<string, Row[]>();

  /** Set to make the next write to a table fail, for persistence-failure tests. */
  failNextWriteWith: { table: string; code?: string; message: string } | null = null;

  rows(table: string): Row[] {
    let rows = this.tables.get(table);
    if (!rows) {
      rows = [];
      this.tables.set(table, rows);
    }
    return rows;
  }

  seed(table: string, row: Row): Row {
    const stored = { id: row.id ?? `${table}_${this.rows(table).length + 1}`, ...row };
    this.rows(table).push(stored);
    return stored;
  }

  /** The migration's partial unique indexes, as Postgres would apply them. */
  checkConstraints(table: string, candidate: Row, excludeId?: unknown): QueryError {
    const others = this.rows(table).filter((row) => row.id !== excludeId);

    if (table === "operation_runs" && ACTIVE_OPERATION_STATUSES.includes(String(candidate.status))) {
      const clash = others.some(
        (row) =>
          row.project_id === candidate.project_id &&
          row.operation_type === candidate.operation_type &&
          row.input_identity === candidate.input_identity &&
          ACTIVE_OPERATION_STATUSES.includes(String(row.status)),
      );
      if (clash) return { code: POSTGRES_UNIQUE_VIOLATION, message: "one active operation per identity" };
    }

    // validation_runs_single_active_idx (Sprint 10A §21, narrowed after the
    // first 10B dogfood). Only in-flight rows conflict: a historical pass with
    // no usable artifact must not prevent an explicit re-validation. Modelled
    // so a double click still loses its second insert exactly as in Postgres.
    if (table === "validation_runs" && ACTIVE_VALIDATION_STATUSES.includes(String(candidate.status))) {
      const clash = others.some(
        (row) =>
          row.project_id === candidate.project_id &&
          row.validation_identity === candidate.validation_identity &&
          ACTIVE_VALIDATION_STATUSES.includes(String(row.status)),
      );
      if (clash) return { code: POSTGRES_UNIQUE_VIOLATION, message: "one live validation per identity" };
    }

    // validation_runs_artifact_only_when_passed.
    //
    // A CHECK rather than an index, and modelled here because the fake's
    // silence on CHECK constraints cost four dogfood rounds. The artifact was
    // being written one step before the verdict, while the row was still
    // `running`. Postgres refused it, the step failed, the retry found a
    // sandbox the successful snapshot had already stopped, and the run reported
    // `sandbox_lost` — with a 1.14 GB snapshot orphaned in provider storage and
    // every test green.
    //
    // The in-memory database will never evaluate constraints in general, but a
    // rule this load-bearing is worth stating twice.
    if (table === "validation_runs" && candidate.artifact_snapshot_id != null) {
      if (candidate.status !== "passed") {
        return {
          code: POSTGRES_CHECK_VIOLATION,
          message: "validation_runs_artifact_only_when_passed",
        };
      }
      if (candidate.artifact_expires_at == null) {
        return { code: POSTGRES_CHECK_VIOLATION, message: "validation_runs_artifact_has_expiry" };
      }
    }

    // preview_sessions_single_active_idx (Sprint 10B-2 §32). One live preview
    // per identity, so a double click loses its second insert here exactly as
    // it would in Postgres — otherwise the test would "prove" idempotency the
    // database provides.
    if (table === "preview_sessions" && ACTIVE_PREVIEW_STATUSES.includes(String(candidate.status))) {
      const clash = others.some(
        (row) =>
          row.project_id === candidate.project_id &&
          row.preview_identity === candidate.preview_identity &&
          ACTIVE_PREVIEW_STATUSES.includes(String(row.status)),
      );
      if (clash) return { code: POSTGRES_UNIQUE_VIOLATION, message: "one live preview per identity" };
    }

    // sandbox_usage_events_preview_unique_idx (§27). One ledger row per preview
    // session: a retried terminal step must not double-count a sandbox that
    // only ran once.
    if (table === "sandbox_usage_events" && candidate.preview_session_id != null) {
      const clash = others.some((row) => row.preview_session_id === candidate.preview_session_id);
      if (clash) return { code: POSTGRES_UNIQUE_VIOLATION, message: "usage already recorded for preview" };
    }

    // change_outcome_verifications_identity_idx (Sprint 12A §27). One
    // verification per exact question — the merge, the commit, the profile and
    // the two versions — in every state except `failed`. Modelled so a double
    // click loses its second insert here exactly as it would in Postgres,
    // rather than the test "proving" idempotency the database provides.
    if (
      table === "change_outcome_verifications" &&
      OUTCOME_IDENTITY_LOCK_STATUSES.includes(String(candidate.status))
    ) {
      const clash = others.some(
        (row) =>
          row.project_id === candidate.project_id &&
          row.verification_identity === candidate.verification_identity &&
          OUTCOME_IDENTITY_LOCK_STATUSES.includes(String(row.status)),
      );
      if (clash) {
        return { code: POSTGRES_UNIQUE_VIOLATION, message: "one verification per question" };
      }
    }

    // outcome_verified_has_observations (Sprint 12A §36).
    //
    // Stated twice on purpose, for the same reason the validation artifact CHECK
    // is: it is the constraint that stops a green outcome being stored without
    // the evidence that produced it, and the in-memory database will otherwise
    // never notice. A mutation that skips observation entirely must fail here as
    // it would in production.
    if (table === "change_outcome_verifications" && candidate.status === "verified") {
      if (
        candidate.check_results == null ||
        Number(candidate.attempt_count ?? 0) <= 0 ||
        candidate.observation_completed_at == null ||
        candidate.completed_at == null ||
        candidate.failure_code != null
      ) {
        return {
          code: POSTGRES_CHECK_VIOLATION,
          message: "outcome_verified_has_observations",
        };
      }
    }

    // outcome_product_answer_has_observations. `partial` and `not_observed` are
    // statements about what was seen; without a recorded observation they would
    // be statements about nothing.
    if (
      table === "change_outcome_verifications" &&
      (candidate.status === "partial" || candidate.status === "not_observed")
    ) {
      if (
        candidate.check_results == null ||
        Number(candidate.attempt_count ?? 0) <= 0 ||
        candidate.completed_at == null
      ) {
        return {
          code: POSTGRES_CHECK_VIOLATION,
          message: "outcome_product_answer_has_observations",
        };
      }
    }

    if (table === "business_readiness_audits" && IN_FLIGHT_AUDIT_STATUSES.includes(String(candidate.status))) {
      const clash = others.some(
        (row) =>
          row.project_id === candidate.project_id &&
          row.input_hash === candidate.input_hash &&
          IN_FLIGHT_AUDIT_STATUSES.includes(String(row.status)),
      );
      if (clash) return { code: POSTGRES_UNIQUE_VIOLATION, message: "one in-flight audit per input" };
    }

    // Unique ranks within an opportunity set (Sprint 8 §29).
    if (table === "business_opportunities") {
      const clash = others.some(
        (row) =>
          row.opportunity_set_id === candidate.opportunity_set_id && row.rank === candidate.rank,
      );
      if (clash) return { code: POSTGRES_UNIQUE_VIOLATION, message: "duplicate rank in set" };
    }

    // At most one in-flight opportunity set per project + input.
    if (table === "opportunity_sets" && IN_FLIGHT_AUDIT_STATUSES.includes(String(candidate.status))) {
      const clash = others.some(
        (row) =>
          row.project_id === candidate.project_id &&
          row.input_hash === candidate.input_hash &&
          IN_FLIGHT_AUDIT_STATUSES.includes(String(row.status)),
      );
      if (clash) return { code: POSTGRES_UNIQUE_VIOLATION, message: "one in-flight set per input" };
    }

    // action_plans_single_in_flight_idx (CORE-2b §54). At most one in-flight
    // plan per project + input, so a double submission loses its second insert
    // here exactly as it would in Postgres. Without this the idempotency test
    // would prove the application's pre-check rather than the guarantee the
    // database actually provides.
    if (table === "action_plans" && candidate.status === "planning") {
      const clash = others.some(
        (row) =>
          row.project_id === candidate.project_id &&
          row.input_hash === candidate.input_hash &&
          row.status === "planning",
      );
      if (clash) return { code: POSTGRES_UNIQUE_VIOLATION, message: "one in-flight plan per input" };
    }

    // action_plan_steps_capability_matches_support (CORE-2b §67).
    //
    // Stated twice on purpose, for the reason the validation-artifact CHECK is:
    // it is the constraint that stops a step claiming Vibe can act with nothing
    // behind it, and the in-memory database would otherwise never notice a bug
    // in the classifier that produced one.
    if (table === "action_plan_steps") {
      const executable = candidate.execution_support === "vibe_executes_now";
      if (executable !== (candidate.capability != null)) {
        return {
          code: POSTGRES_CHECK_VIOLATION,
          message: "action_plan_steps_capability_matches_support",
        };
      }

      const clash = others.some(
        (row) =>
          row.action_plan_id === candidate.action_plan_id &&
          row.step_order === candidate.step_order,
      );
      if (clash) return { code: POSTGRES_UNIQUE_VIOLATION, message: "duplicate order in plan" };
    }

    // At most one live-or-successful preparation per execution identity.
    if (table === "prepared_changes" && ["preparing", "prepared"].includes(String(candidate.status))) {
      const clash = others.some(
        (row) =>
          row.project_id === candidate.project_id &&
          row.execution_identity === candidate.execution_identity &&
          ["preparing", "prepared"].includes(String(row.status)),
      );
      if (clash) return { code: POSTGRES_UNIQUE_VIOLATION, message: "one active preparation per identity" };
    }

    // change_approvals_active_identity_idx (Sprint 11B §12). At most one
    // *active* approval per exact artifact, so a double click loses its second
    // insert here exactly as it would in Postgres. Without this the idempotency
    // test would be proving the application's pre-check rather than the
    // guarantee the database actually provides.
    if (table === "change_approvals" && candidate.status === "approved") {
      const clash = others.some(
        (row) =>
          row.project_id === candidate.project_id &&
          row.approval_identity === candidate.approval_identity &&
          row.status === "approved",
      );
      if (clash) {
        return { code: POSTGRES_UNIQUE_VIOLATION, message: "one active approval per identity" };
      }
    }

    // The approval table's CHECK constraints, modelled for the same reason the
    // validation artifact ones are: a rule that exists only in SQL is a rule
    // every in-memory test is blind to, and this one governs whether a
    // withdrawn approval can still read as standing authority.
    if (table === "change_approvals") {
      if (candidate.status === "revoked" && candidate.revoked_at == null) {
        return {
          code: POSTGRES_CHECK_VIOLATION,
          message: "change_approvals_revoked_has_timestamp",
        };
      }
      if (
        candidate.status === "invalidated" &&
        (candidate.invalidated_at == null || candidate.invalidation_reason == null)
      ) {
        return {
          code: POSTGRES_CHECK_VIOLATION,
          message: "change_approvals_invalidated_has_reason",
        };
      }
      if (
        candidate.status === "approved" &&
        (candidate.revoked_at != null || candidate.invalidated_at != null)
      ) {
        return {
          code: POSTGRES_CHECK_VIOLATION,
          message: "change_approvals_active_is_not_terminated",
        };
      }
    }

    // change_merges_written_identity_idx (Sprint 11C §20, §21). At most one
    // merge per exact artifact that is writing or written. This is the
    // guarantee "at most one consequential GitHub state transition" actually
    // rests on, so a test that proved idempotency without it would be proving
    // the application's own pre-check instead.
    if (table === "change_merges" && ["merging", "merged"].includes(String(candidate.status))) {
      const clash = others.some(
        (row) =>
          row.project_id === candidate.project_id &&
          row.merge_identity === candidate.merge_identity &&
          ["merging", "merged"].includes(String(row.status)),
      );
      if (clash) {
        return { code: POSTGRES_UNIQUE_VIOLATION, message: "one written merge per identity" };
      }
    }

    // The merge table's CHECK constraints. The first one is the most
    // load-bearing constraint in the schema: it is the database refusing to
    // store a successful merge whose independently observed result is anything
    // other than the commit a human approved. Modelled here because a mutation
    // that removes the application's read-back must fail a test rather than
    // only fail in Postgres, months later, on somebody's default branch.
    if (table === "change_merges") {
      if (
        candidate.status === "merged" &&
        (candidate.merged_at == null ||
          candidate.failure_code != null ||
          candidate.resulting_default_head_sha !== candidate.prepared_commit_sha)
      ) {
        return {
          code: POSTGRES_CHECK_VIOLATION,
          message: "change_merges_merged_matches_approved_commit",
        };
      }
      // `blocked` means the repository was never touched. A row that claims it
      // while carrying a write attempt is the one lie this table must not be
      // able to tell.
      if (
        candidate.status === "blocked" &&
        (candidate.failure_code == null ||
          candidate.failed_at == null ||
          candidate.started_at != null)
      ) {
        return { code: POSTGRES_CHECK_VIOLATION, message: "change_merges_blocked_wrote_nothing" };
      }
      if (
        candidate.status === "failed" &&
        (candidate.failure_code == null || candidate.failed_at == null)
      ) {
        return { code: POSTGRES_CHECK_VIOLATION, message: "change_merges_failed_has_reason" };
      }
      if (candidate.started_at != null && candidate.preflight_checked_at == null) {
        return { code: POSTGRES_CHECK_VIOLATION, message: "change_merges_write_follows_preflight" };
      }
    }

    // The ledger's idempotency guarantee: one usage event per job.
    if (table === "ai_usage_events" && candidate.job_id != null) {
      const clash = others.some((row) => row.job_id === candidate.job_id);
      if (clash) return { code: POSTGRES_UNIQUE_VIOLATION, message: "usage already recorded for job" };
    }

    /*
     * Billing (BILLING CORE-1 §47, §48, §49).
     *
     * These are modelled for the same reason every constraint above is: the
     * guarantees are the database's, and a test that only exercised the
     * application's pre-checks would prove the weaker half. On billing the
     * distinction is the whole sprint — an overspend prevented by an `if` is
     * prevented until two requests arrive at once.
     */

    // billing_credit_accounts_available_non_negative. The backstop that makes
    // an overspend impossible even if the reservation predicate were written
    // wrong. Without this the concurrency test would pass against a fake that
    // happily stores a negative available balance.
    if (table === "billing_credit_accounts") {
      // billing_credit_accounts_user_idx. One wallet per owner — a second
      // account would split a balance in two and make "available"
      // unanswerable, so `ensureCreditAccount` relies on losing this index to
      // re-read the winner's row. Modelled here because without it a
      // concurrency test proves nothing: ten simultaneous first-time
      // operations would each get their own wallet and every per-wallet
      // assertion would still pass.
      const duplicateOwner = others.some((row) => row.user_id === candidate.user_id);
      if (duplicateOwner) {
        return { code: POSTGRES_UNIQUE_VIOLATION, message: "billing_credit_accounts_user_idx" };
      }

      const posted = Number(candidate.posted_credits ?? 0);
      const reserved = Number(candidate.reserved_credits ?? 0);
      if (reserved < 0) {
        return { code: POSTGRES_CHECK_VIOLATION, message: "reserved_credits >= 0" };
      }
      if (posted - reserved < 0) {
        return {
          code: POSTGRES_CHECK_VIOLATION,
          message: "billing_credit_accounts_available_non_negative",
        };
      }
    }

    // billing_credit_ledger_idempotency_idx (§26). One posted entry per
    // (account, key), so a retried settlement, a replayed workflow step and a
    // double-clicked button all post exactly one charge.
    if (table === "billing_credit_ledger") {
      const clash = others.some(
        (row) =>
          row.credit_account_id === candidate.credit_account_id &&
          row.idempotency_key === candidate.idempotency_key,
      );
      if (clash) {
        return { code: POSTGRES_UNIQUE_VIOLATION, message: "billing_credit_ledger_idempotency_idx" };
      }

      // billing_credit_ledger_sign_matches_kind. A positive charge or a
      // negative grant is a bug the database refuses independently of TS.
      const delta = Number(candidate.credit_delta ?? 0);
      if (delta === 0) {
        return { code: POSTGRES_CHECK_VIOLATION, message: "credit_delta <> 0" };
      }
      if (["charge", "expiry"].includes(String(candidate.kind)) && delta > 0) {
        return { code: POSTGRES_CHECK_VIOLATION, message: "billing_credit_ledger_sign_matches_kind" };
      }
      if (["grant", "purchase", "refund"].includes(String(candidate.kind)) && delta < 0) {
        return { code: POSTGRES_CHECK_VIOLATION, message: "billing_credit_ledger_sign_matches_kind" };
      }
      // billing_credit_ledger_refund_references_charge.
      if ((candidate.kind === "refund") !== (candidate.refunds_ledger_entry_id != null)) {
        return {
          code: POSTGRES_CHECK_VIOLATION,
          message: "billing_credit_ledger_refund_references_charge",
        };
      }
    }

    if (table === "billing_credit_reservations") {
      // billing_credit_reservations_idempotency_idx (§49).
      const clash = others.some(
        (row) =>
          row.credit_account_id === candidate.credit_account_id &&
          row.idempotency_key === candidate.idempotency_key,
      );
      if (clash) {
        return {
          code: POSTGRES_UNIQUE_VIOLATION,
          message: "billing_credit_reservations_idempotency_idx",
        };
      }

      // billing_credit_reservations_single_active_operation_idx. A second
      // concurrent start for one operation loses here, exactly as
      // operation_runs_single_active_idx does for the run itself.
      if (candidate.operation_run_id != null && candidate.status === "active") {
        const active = others.some(
          (row) => row.operation_run_id === candidate.operation_run_id && row.status === "active",
        );
        if (active) {
          return {
            code: POSTGRES_UNIQUE_VIOLATION,
            message: "billing_credit_reservations_single_active_operation_idx",
          };
        }
      }

      // billing_credit_reservations_settled_within_reserved (§28). The ceiling
      // the customer approved, enforced by the database and not only by
      // decideSettlement.
      if (
        candidate.settled_credits != null &&
        Number(candidate.settled_credits) > Number(candidate.reserved_credits ?? 0)
      ) {
        return {
          code: POSTGRES_CHECK_VIOLATION,
          message: "billing_credit_reservations_settled_within_reserved",
        };
      }
    }

    // billing_credit_grants (BILLING CORE-2). The lot-level guarantees, modelled
    // for the same reason the account-level ones are: a rule enforced only by an
    // `if` is enforced right up until two requests arrive together.
    if (table === "billing_credit_grants") {
      // billing_credit_grants_ledger_entry_idx. One ledger entry owns at most
      // one lot — this is what carries the ledger's exactly-once guarantee
      // through to grant provenance, so a replayed webhook cannot mint a
      // second lot even if it reached the insert.
      const clash = others.some((row) => row.ledger_entry_id === candidate.ledger_entry_id);
      if (clash) {
        return { code: POSTGRES_UNIQUE_VIOLATION, message: "billing_credit_grants_ledger_entry_idx" };
      }

      // billing_credit_grants_capacity_not_exceeded. A lot can never give out
      // more than it holds — the structural backstop that makes over-allocation
      // impossible even if the application predicate were written wrong.
      const initial = Number(candidate.initial_credit_units ?? 0);
      const allocated = Number(candidate.allocated_credit_units ?? 0);
      const expired = Number(candidate.expired_credit_units ?? 0);
      if (allocated < 0 || expired < 0 || allocated + expired > initial) {
        return {
          code: POSTGRES_CHECK_VIOLATION,
          message: "billing_credit_grants_capacity_not_exceeded",
        };
      }

      // billing_credit_grants_expired_has_timestamp / _expired_had_a_date.
      // Only an expiring lot may expire: a purchased lot has no expiry date and
      // must never acquire one through an application bug.
      if ((candidate.status === "expired") !== (candidate.expired_at != null)) {
        return {
          code: POSTGRES_CHECK_VIOLATION,
          message: "billing_credit_grants_expired_has_timestamp",
        };
      }
      if (candidate.status === "expired" && candidate.expires_at == null) {
        return { code: POSTGRES_CHECK_VIOLATION, message: "billing_credit_grants_expired_had_a_date" };
      }

      // billing_credit_grants_period_matches_kind.
      const hasPeriod = candidate.period_start != null && candidate.period_end != null;
      if ((candidate.source_kind === "subscription") !== hasPeriod) {
        return { code: POSTGRES_CHECK_VIOLATION, message: "billing_credit_grants_period_matches_kind" };
      }
    }

    if (table === "billing_credit_allocations") {
      // billing_credit_allocations_consumed_within_held. A lot may never fund
      // more than it was asked to hold.
      const held = Number(candidate.credit_units ?? 0);
      if (candidate.consumed_units != null && Number(candidate.consumed_units) > held) {
        return {
          code: POSTGRES_CHECK_VIOLATION,
          message: "billing_credit_allocations_consumed_within_held",
        };
      }

      // billing_credit_allocations_consumed_has_amount / _has_timestamp.
      if ((candidate.status === "consumed") !== (candidate.consumed_units != null)) {
        return {
          code: POSTGRES_CHECK_VIOLATION,
          message: "billing_credit_allocations_consumed_has_amount",
        };
      }
      if ((candidate.status === "consumed") !== (candidate.settled_at != null)) {
        return {
          code: POSTGRES_CHECK_VIOLATION,
          message: "billing_credit_allocations_consumed_has_timestamp",
        };
      }
      if ((candidate.status === "released") !== (candidate.released_at != null)) {
        return {
          code: POSTGRES_CHECK_VIOLATION,
          message: "billing_credit_allocations_released_has_timestamp",
        };
      }
    }

    // billing_stripe_events_stripe_id_idx (§28). The claim that makes a replayed
    // webhook a no-op: the second delivery loses this index and is answered from
    // the existing row instead of re-running the handler.
    if (table === "billing_stripe_events") {
      const clash = others.some((row) => row.stripe_event_id === candidate.stripe_event_id);
      if (clash) {
        return { code: POSTGRES_UNIQUE_VIOLATION, message: "billing_stripe_events_stripe_id_idx" };
      }
    }

    // billing_stripe_customers: one Stripe customer per owner per mode, and one
    // owner per Stripe customer. Two simultaneous first purchases must not split
    // one person's payment history across two customers.
    if (table === "billing_stripe_customers") {
      const perUser = others.some(
        (row) => row.user_id === candidate.user_id && row.livemode === candidate.livemode,
      );
      if (perUser) {
        return { code: POSTGRES_UNIQUE_VIOLATION, message: "billing_stripe_customers_user_mode_idx" };
      }
      const perCustomer = others.some((row) => row.stripe_customer_id === candidate.stripe_customer_id);
      if (perCustomer) {
        return { code: POSTGRES_UNIQUE_VIOLATION, message: "billing_stripe_customers_stripe_id_idx" };
      }
    }

    if (table === "billing_subscriptions") {
      const clash = others.some(
        (row) => row.stripe_subscription_id === candidate.stripe_subscription_id,
      );
      if (clash) {
        return { code: POSTGRES_UNIQUE_VIOLATION, message: "billing_subscriptions_stripe_id_idx" };
      }
    }

    // billing_usage_events_source_sku_idx (§43). One source row projects to at
    // most one event per SKU, which is what makes reconciliation safe to run
    // twice — and what a "no duplicates on a second pass" test must be proving
    // rather than assuming.
    if (table === "billing_usage_events") {
      const clash = others.some(
        (row) =>
          row.source_kind === candidate.source_kind &&
          row.source_id === candidate.source_id &&
          row.sku === candidate.sku,
      );
      if (clash) {
        return { code: POSTGRES_UNIQUE_VIOLATION, message: "billing_usage_events_source_sku_idx" };
      }

      // billing_usage_events_rated_has_credits (§18). This is what makes
      // "unknown cost became zero credits" unrepresentable rather than merely
      // discouraged.
      if ((candidate.rating_status === "rated") !== (candidate.rated_credits != null)) {
        return { code: POSTGRES_CHECK_VIOLATION, message: "billing_usage_events_rated_has_credits" };
      }
      if ((candidate.cost_status === "costed") !== (candidate.raw_cost_nano_usd != null)) {
        return { code: POSTGRES_CHECK_VIOLATION, message: "billing_usage_events_costed_has_amount" };
      }
    }

    return null;
  }
}

class FakeQuery implements PromiseLike<{ data: unknown; error: QueryError }> {
  private filters: Filter[] = [];
  private orderColumn: string | null = null;
  private orderAscending = true;
  private limitCount: number | null = null;
  private countMode = false;
  private headOnly = false;

  constructor(
    private readonly db: FakeDatabase,
    private readonly table: string,
    private readonly mode: "select" | "insert" | "update" | "delete" | "upsert",
    private readonly payload?: Row | Row[],
    private readonly onConflict?: string,
  ) {}

  eq(column: string, value: unknown): this {
    this.filters.push({ kind: "eq", column, value });
    return this;
  }
  neq(column: string, value: unknown): this {
    this.filters.push({ kind: "neq", column, value });
    return this;
  }
  in(column: string, values: unknown[]): this {
    this.filters.push({ kind: "in", column, values });
    return this;
  }
  is(column: string, value: null): this {
    this.filters.push({ kind: "is", column, value });
    return this;
  }
  not(column: string, operator: "is", value: null): this {
    if (operator !== "is") throw new Error(`unsupported fake query operator: not ${operator}`);
    this.filters.push({ kind: "not_is", column, value });
    return this;
  }
  gt(column: string, value: unknown): this {
    this.filters.push({ kind: "gt", column, value });
    return this;
  }
  gte(column: string, value: unknown): this {
    this.filters.push({ kind: "gte", column, value });
    return this;
  }
  lte(column: string, value: unknown): this {
    this.filters.push({ kind: "lte", column, value });
    return this;
  }
  order(column: string, options?: { ascending?: boolean }): this {
    this.orderColumn = column;
    this.orderAscending = options?.ascending ?? true;
    return this;
  }
  limit(count: number): this {
    this.limitCount = count;
    return this;
  }
  select(_columns?: string, options?: { count?: "exact"; head?: boolean }): this {
    // The entitlement's abuse window counts rows rather than reading them, so
    // the double has to answer `count` too — otherwise the gate is untestable
    // against it, which is how the gate went unwired in the first place.
    if (options?.count === "exact") this.countMode = true;
    if (options?.head) this.headOnly = true;
    return this;
  }

  private failure(): QueryError {
    const pending = this.db.failNextWriteWith;
    if (pending && pending.table === this.table) {
      this.db.failNextWriteWith = null;
      return { code: pending.code, message: pending.message };
    }
    return null;
  }

  private resolveRows(): Row[] {
    let rows = this.db.rows(this.table).filter((row) => matches(row, this.filters));

    if (this.orderColumn) {
      const column = this.orderColumn;
      rows = [...rows].sort((a, b) => {
        const left = String(a[column] ?? "");
        const right = String(b[column] ?? "");
        return this.orderAscending ? left.localeCompare(right) : right.localeCompare(left);
      });
    }

    if (this.limitCount !== null) rows = rows.slice(0, this.limitCount);
    return rows;
  }

  private run(): { data: unknown; error: QueryError } {
    if (this.mode === "insert") {
      const failure = this.failure();
      if (failure) return { data: null, error: failure };

      // Supabase accepts a single row or an array; the opportunity store
      // inserts a whole set at once, so the double has to as well.
      const payloads = Array.isArray(this.payload) ? this.payload : [this.payload ?? {}];
      const inserted: Row[] = [];

      for (const payload of payloads) {
        const row: Row = { id: `${this.table}_${this.db.rows(this.table).length + 1}`, ...payload };
        row.created_at ??= new Date().toISOString();
        row.updated_at ??= new Date().toISOString();

        // `approved_at timestamptz not null default now()`. The application
        // deliberately does not send this column — a database default is what
        // makes it impossible for the app to backdate an approval — so without
        // the default modelled here the fake would report `undefined` for a
        // value Postgres always fills.
        if (this.table === "change_approvals") row.approved_at ??= row.created_at;

        const violation = this.db.checkConstraints(this.table, row);
        if (violation) return { data: null, error: violation };

        this.db.rows(this.table).push(row);
        inserted.push(row);
      }

      return { data: Array.isArray(this.payload) ? inserted : inserted[0], error: null };
    }

    if (this.mode === "update") {
      const failure = this.failure();
      if (failure) return { data: null, error: failure };

      const targets = this.db.rows(this.table).filter((row) => matches(row, this.filters));
      for (const target of targets) {
        const candidate = { ...target, ...this.payload, updated_at: new Date().toISOString() };
        const violation = this.db.checkConstraints(this.table, candidate, target.id);
        if (violation) return { data: null, error: violation };
        Object.assign(target, candidate);
      }
      return { data: targets, error: null };
    }

    if (this.mode === "delete") {
      const failure = this.failure();
      if (failure) return { data: null, error: failure };

      const rows = this.db.rows(this.table);
      const removed = rows.filter((row) => matches(row, this.filters));
      for (const row of removed) rows.splice(rows.indexOf(row), 1);
      return { data: removed, error: null };
    }

    /*
     * `upsert` with `onConflict`, modelled the way Postgres behaves rather than
     * as "insert or replace": the conflict target decides whether an existing
     * row is updated, and everything else inserts. Subscription snapshots
     * depend on it — a renewal must update the row Stripe already told us
     * about, not accumulate one row per webhook.
     */
    if (this.mode === "upsert") {
      const failure = this.failure();
      if (failure) return { data: null, error: failure };

      const payload = this.payload as Row;
      const conflictColumn = this.onConflict;
      const existing = conflictColumn
        ? this.db.rows(this.table).find((row) => row[conflictColumn] === payload[conflictColumn])
        : undefined;

      if (existing) {
        const candidate = { ...existing, ...payload, updated_at: new Date().toISOString() };
        const violation = this.db.checkConstraints(this.table, candidate, existing.id);
        if (violation) return { data: null, error: violation };
        Object.assign(existing, candidate);
        return { data: [existing], error: null };
      }

      const row: Row = {
        id: `${this.table}_${this.db.rows(this.table).length + 1}`,
        created_at: new Date().toISOString(),
        ...payload,
      };
      const violation = this.db.checkConstraints(this.table, row);
      if (violation) return { data: null, error: violation };
      this.db.rows(this.table).push(row);
      return { data: [row], error: null };
    }

    const rows = this.resolveRows();
    // A `head: true` count query returns no rows and a `count`, which is what
    // the entitlement's abuse window reads.
    if (this.countMode) {
      return { data: this.headOnly ? null : rows, error: null, count: rows.length } as {
        data: unknown;
        error: QueryError;
      };
    }
    return { data: rows, error: null };
  }

  async maybeSingle(): Promise<{ data: Row | null; error: QueryError }> {
    const { data, error } = this.run();
    if (error) return { data: null, error };
    const rows = data as Row[];
    return { data: rows.length > 0 ? rows[0] : null, error: null };
  }

  async single(): Promise<{ data: Row; error: QueryError }> {
    const { data, error } = this.run();
    if (error) return { data: null as unknown as Row, error };
    const row = Array.isArray(data) ? (data as Row[])[0] : (data as Row);
    return row
      ? { data: row, error: null }
      : { data: null as unknown as Row, error: { message: "no rows returned" } };
  }

  then<TResult1 = { data: unknown; error: QueryError }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: QueryError }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected);
  }
}

export function fakeSupabase(db: FakeDatabase): SupabaseClient {
  return {
    from(table: string) {
      return {
        select: () => new FakeQuery(db, table, "select"),
        insert: (payload: Row | Row[]) => new FakeQuery(db, table, "insert", payload),
        update: (payload: Row) => new FakeQuery(db, table, "update", payload),
        delete: () => new FakeQuery(db, table, "delete"),
        upsert: (payload: Row, options?: { onConflict?: string }) =>
          new FakeQuery(db, table, "upsert", payload, options?.onConflict),
      };
    },
  } as unknown as SupabaseClient;
}

/** Counts starts, because "exactly one workflow" is the property under test. */
export class FakeExecutor implements OperationExecutor {
  readonly name = "fake_executor";
  readonly starts: StartOperationInput[] = [];

  constructor(private readonly behaviour: { fail?: boolean } = {}) {}

  async start(input: StartOperationInput): Promise<StartOperationResult> {
    this.starts.push(input);
    if (this.behaviour.fail) return { ok: false, error: "execution_start_failed" };
    return { ok: true, runId: `run_${this.starts.length}` };
  }
}

/**
 * Seeds the two rows CORE-2 made prerequisites of an audit: a completed
 * Product Profile and the project's founder intent.
 *
 * Shared rather than repeated per test file, because the profile has to be
 * *structurally* valid — `getLatestProfile` overlays corrections on read, which
 * walks `identity` and `audience` — and six copies of a hand-written profile
 * would drift the first time the schema moves.
 */
export function seedProductUnderstanding(
  db: FakeDatabase,
  options: {
    projectId: string;
    profileId?: string;
    intentHash?: string;
    createdAt?: string;
    /** Override to seed a deliberately stale profile. */
    inputHash?: string;
  },
): void {
  const profile = fakeProductProfile();

  /*
   * The profile's input hash is *computed* from whatever snapshots the caller
   * already seeded, not invented.
   *
   * `getAuditReadiness` decides staleness by recomputing this hash and
   * comparing, so a placeholder would make every seeded profile look stale and
   * every audit refuse — which is exactly what happened when the entitlement
   * gate was first wired in and 20 tests went red at once. Deriving it means a
   * seeded profile is current by construction, and a test that *wants* a stale
   * one can pass its own `inputHash`.
   */
  const latest = (table: string): string | null => {
    const rows = db
      .rows(table)
      .filter((row) => row.project_id === options.projectId && row.status === "completed" && row.result);
    const newest = rows[rows.length - 1];
    return newest ? String(newest.id) : null;
  };

  const inputHash =
    options.inputHash ??
    computeProfileInputHash({
      repositorySnapshotId: latest("repository_intelligence_snapshots"),
      liveSnapshotId: latest("live_product_intelligence_snapshots"),
      authenticatedSnapshotId: latest("authenticated_product_intelligence_snapshots"),
      schemaVersion: PRODUCT_PROFILE_SCHEMA_VERSION,
      builderVersion: PROFILE_BUILDER_VERSION,
      evidenceVersion: UNDERSTANDING_EVIDENCE_VERSION,
      promptVersion: PROFILE_PROMPT_VERSION,
      provider: "anthropic",
      model: PRODUCT_UNDERSTANDING_CONFIG.model,
    });

  db.seed("product_profiles", {
    id: options.profileId ?? "profile_1",
    project_id: options.projectId,
    status: "completed",
    input_hash: inputHash,
    result: profile,
    synthesized: true,
    failure_code: null,
    confirmed_at: null,
    created_at: options.createdAt ?? "2026-08-01T00:00:00.000Z",
    completed_at: options.createdAt ?? "2026-08-01T00:00:00.000Z",
  });

  db.seed("project_founder_intent", {
    id: "intent_1",
    project_id: options.projectId,
    stage: "prototype",
    monetization_model: "none",
    primary_goal: "launch",
    intent_hash: options.intentHash ?? "c".repeat(64),
    updated_at: "2026-08-01T00:00:00.000Z",
  });
}
