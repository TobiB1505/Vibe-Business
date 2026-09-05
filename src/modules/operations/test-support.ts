import type { SupabaseClient } from "@supabase/supabase-js";
import { isAgenticCapability } from "@/modules/execution/schema";
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
/**
 * Statuses that hold an agent run's identity (EXECUTION CORE-4 §56).
 *
 * `succeeded` is inside the lock, mirroring the migration: a finished run still
 * owns its identity, so repeating the same work is a deliberate new spec rather
 * than a second attempt at this one.
 */
const ACTIVE_AGENT_RUN_STATUSES = ["queued", "running", "needs_user_input", "succeeded"];
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
  | { kind: "lte"; column: string; value: unknown }
  | { kind: "lt"; column: string; value: unknown };

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
    /*
     * Numeric, like `lte` and for the same reason.
     *
     * Its one caller is the monotonic turn counter — `update({turns}).lt("turns", turns)`
     * — which is what stops a poll that raced a stale read from walking a run's
     * observed turns backwards. Compared as strings, `"9" < "10"` is false and
     * the guard would silently stop working somewhere after turn nine.
     */
    if (filter.kind === "lt") {
      return typeof value === "number" && typeof filter.value === "number"
        ? value < filter.value
        : String(value ?? "") < String(filter.value);
    }
    return String(value ?? "") > String(filter.value);
  });
}

export class FakeDatabase {
  private readonly tables = new Map<string, Row[]>();

  /** Set to make the next write to a table fail, for persistence-failure tests. */
  failNextWriteWith: { table: string; code?: string; message: string } | null = null;

  /**
   * Set to make the next *read* of a table fail.
   *
   * The write hook above has existed for a while; this is its counterpart, and
   * it is needed for the same reason — a code path that only runs when a query
   * errors is otherwise untestable, so its error handling is asserted by
   * inspection. That is exactly how a `catch` that does the wrong thing
   * survives review (VB-020).
   */
  failNextReadWith: { table: string; code?: string; message: string } | null = null;

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
      const active = others.filter(
        (row) =>
          row.operation_type === candidate.operation_type &&
          row.input_identity === candidate.input_identity &&
          ACTIVE_OPERATION_STATUSES.includes(String(row.status)),
      );

      // Two indexes, and the split matters. `operation_runs_single_active_idx`
      // keys on `project_id`, and PostgreSQL's default NULLS DISTINCT means it
      // does **not** constrain account-level rows at all — which is the defect
      // ADR 0057 G3 measured. Modelling it as though `null === null` collided
      // would give a false pass on a guarantee the database provides through a
      // different index entirely.
      const projectScoped =
        candidate.project_id !== null &&
        candidate.project_id !== undefined &&
        active.some((row) => row.project_id === candidate.project_id);
      if (projectScoped) {
        return { code: POSTGRES_UNIQUE_VIOLATION, message: "one active operation per identity" };
      }

      // `operation_runs_single_active_account_idx` (ADR 0057 §3), which is what
      // actually stops a second erasure of the same account.
      const accountScoped =
        (candidate.project_id === null || candidate.project_id === undefined) &&
        active.some(
          (row) =>
            (row.project_id === null || row.project_id === undefined) &&
            row.user_id === candidate.user_id,
        );
      if (accountScoped) {
        return { code: POSTGRES_UNIQUE_VIOLATION, message: "one active operation per account" };
      }
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

    // execution_specs (EXECUTION CORE-3 §10). Two rules, both stated twice on
    // purpose.
    //
    // The unique identity is what makes re-resolving an unchanged world
    // idempotent, so without it the store test would prove the application's
    // lookup rather than the guarantee the database provides.
    //
    // `execution_specs_mode_matches_authority` is the constraint that stops a
    // spec claiming an agentic grant *and* a deterministic capability at once —
    // a row nothing downstream could route — and the in-memory database would
    // otherwise never notice a bug in the builder that produced one.
    if (table === "execution_specs") {
      const agentic = candidate.mode === "agentic";
      const wellFormed = agentic
        ? candidate.execution_class != null && candidate.capability == null
        : candidate.execution_class == null && candidate.capability != null;

      if (!wellFormed) {
        return {
          code: POSTGRES_CHECK_VIOLATION,
          message: "execution_specs_mode_matches_authority",
        };
      }

      const clash = others.some(
        (row) =>
          row.project_id === candidate.project_id &&
          row.spec_identity === candidate.spec_identity,
      );
      if (clash) return { code: POSTGRES_UNIQUE_VIOLATION, message: "one spec per identity" };
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

    /*
     * The ledger's idempotency guarantee: one usage event per job — for every
     * operation that makes one call per job.
     *
     * `agentic_execution` is excluded, exactly as the partial unique index in
     * `20260819010000_agent_usage_cardinality.sql` excludes it. An agent run is
     * a loop: forty turns is forty billed requests and forty rows, and the
     * Agent Gateway reads them back to decide whether the run has spent its
     * authorization. Modelling the exclusion here is what lets a test prove the
     * gateway's ceilings actually accumulate.
     */
    if (
      table === "ai_usage_events" &&
      candidate.job_id != null &&
      candidate.operation !== "agentic_execution"
    ) {
      const clash = others.some(
        (row) => row.job_id === candidate.job_id && row.operation !== "agentic_execution",
      );
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

    /*
     * agent_execution_runs (EXECUTION CORE-4 §56).
     *
     * `agent_execution_runs_single_active_idx` is the guarantee that a double
     * click buys one coding agent rather than two. Modelled here for the reason
     * every index above is: without it a test would be proving the
     * application's pre-check rather than the guarantee Postgres provides, and
     * the pre-check is precisely what two clicks 20 ms apart both pass.
     *
     * `succeeded` is inside the lock deliberately — it mirrors the migration.
     * A finished run still owns its identity, so re-running the same work is a
     * deliberate new spec rather than a second attempt at this one.
     */
    if (
      table === "agent_execution_runs" &&
      ACTIVE_AGENT_RUN_STATUSES.includes(String(candidate.status))
    ) {
      const clash = others.some(
        (row) =>
          row.project_id === candidate.project_id &&
          row.run_identity === candidate.run_identity &&
          ACTIVE_AGENT_RUN_STATUSES.includes(String(row.status)),
      );
      if (clash) {
        return { code: POSTGRES_UNIQUE_VIOLATION, message: "one live agent run per identity" };
      }
    }

    /*
     * The agent run's CHECK constraints, stated twice for the reason the merge
     * table's are: a "succeeded" run with no prepared change behind it is the
     * row that would let a report claim work that never landed, and the
     * in-memory database would otherwise never notice a bug that produced one.
     */
    if (table === "agent_execution_runs") {
      if (candidate.status === "succeeded" && candidate.prepared_change_id == null) {
        return {
          code: POSTGRES_CHECK_VIOLATION,
          message: "agent_execution_runs_succeeded_has_change",
        };
      }
      if (candidate.status === "failed" && candidate.failure_code == null) {
        return {
          code: POSTGRES_CHECK_VIOLATION,
          message: "agent_execution_runs_failed_has_code",
        };
      }
    }

    /*
     * execution_interrupts_one_open_per_run_idx (§25).
     *
     * One open question per run. A run that could accumulate open questions
     * would be a chat, which CORE-3 §21 refuses — and a test asserting "the
     * second question finds the first" must be proving the index rather than
     * the lookup that precedes it.
     */
    if (table === "execution_interrupts" && candidate.status === "open") {
      const clash = others.some(
        (row) =>
          row.agent_execution_run_id === candidate.agent_execution_run_id &&
          row.status === "open",
      );
      if (clash) {
        return { code: POSTGRES_UNIQUE_VIOLATION, message: "one open question per run" };
      }
    }

    if (table === "execution_interrupts") {
      if (candidate.status === "answered" && (candidate.answer == null || candidate.answered_at == null)) {
        return {
          code: POSTGRES_CHECK_VIOLATION,
          message: "execution_interrupts_answered_has_answer",
        };
      }
      if (candidate.status === "open" && candidate.answer != null) {
        return {
          code: POSTGRES_CHECK_VIOLATION,
          message: "execution_interrupts_open_has_no_answer",
        };
      }
    }

    if (table === "project_founder_input_requests") {
      const samePlanStep = others.some(
        (row) =>
          row.action_plan_id === candidate.action_plan_id &&
          row.action_plan_step_key === candidate.action_plan_step_key,
      );
      if (samePlanStep) {
        return { code: POSTGRES_UNIQUE_VIOLATION, message: "one request per plan step" };
      }
      if (candidate.status === "open") {
        const sameOpenSubject = others.some(
          (row) =>
            row.project_id === candidate.project_id &&
            row.input_kind === candidate.input_kind &&
            row.subject_key === candidate.subject_key &&
            row.status === "open",
        );
        if (sameOpenSubject) {
          return { code: POSTGRES_UNIQUE_VIOLATION, message: "one open founder input subject" };
        }
      }
    }

    if (table === "project_founder_resolutions" && candidate.superseded_at == null) {
      const sameActiveSubject = others.some(
        (row) =>
          row.project_id === candidate.project_id &&
          row.input_kind === candidate.input_kind &&
          row.subject_key === candidate.subject_key &&
          row.superseded_at == null,
      );
      if (sameActiveSubject) {
        return { code: POSTGRES_UNIQUE_VIOLATION, message: "one active founder resolution" };
      }
    }

    /*
     * prepared_changes_opportunity_required_for_generators (§29).
     *
     * The columns became nullable so an agentic change — which traces to a plan
     * step, not to an opportunity set — is representable. A generator-produced
     * change must still name both, and this is what stops the nullability from
     * quietly becoming permission.
     */
    if (
      table === "prepared_changes" &&
      !isAgenticCapability(String(candidate.execution_capability)) &&
      (candidate.opportunity_set_id == null || candidate.opportunity_id == null)
    ) {
      return {
        code: POSTGRES_CHECK_VIOLATION,
        message: "prepared_changes_opportunity_required_for_generators",
      };
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
    /**
     * PostgREST's `ignoreDuplicates`, which is `ON CONFLICT DO NOTHING`.
     *
     * A different operation from the default upsert, not a flag on it: the
     * default *updates* the conflicting row, and for `billing_usage_events`
     * that would silently rewrite financial history every time a repair pass
     * ran. Modelled here because the billing projection depends on the
     * difference, and a fake that ignored it would report rows as inserted
     * that Postgres had skipped.
     */
    private readonly ignoreDuplicates = false,
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
  lt(column: string, value: unknown): this {
    this.filters.push({ kind: "lt", column, value });
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
  /**
   * PostgREST's `count` on a **write**, which `.update(values, { count: "exact" })`
   * asks for and which the real client answers with the number of rows the
   * statement actually touched.
   *
   * Modelled because a caller reads that number to tell "updated nothing" from
   * "updated a row" — a distinction that carries ownership and lifecycle gates
   * (a detached repository matches no row). A double that returned `undefined`
   * there would report every such refusal as a success, which is the wrong way
   * round for a gate to fail.
   */
  counting(options?: { count?: "exact" }): this {
    if (options?.count === "exact") this.countMode = true;
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

  private readFailure(): QueryError {
    const pending = this.db.failNextReadWith;
    if (pending && pending.table === this.table) {
      this.db.failNextReadWith = null;
      return { code: pending.code, message: pending.message };
    }
    return null;
  }

  private resolveRows(): Row[] {
    let rows = this.db.rows(this.table).filter((row) => matches(row, this.filters));

    if (this.orderColumn) {
      const column = this.orderColumn;
      rows = [...rows].sort((a, b) => {
        const direction = this.orderAscending ? 1 : -1;
        const left = a[column];
        const right = b[column];

        /*
         * Numbers compare as numbers.
         *
         * Everything used to be stringified before comparison, which sorts an
         * integer column as text: `sequence` came back 1, 10, 11, … 2, 20. Every
         * ordered read in the product that is keyed on a counter rather than a
         * timestamp was therefore modelled wrongly — the Product Scan timeline,
         * the agent execution events, the agent activity feed, all of which order
         * by `sequence` and several of which then cap the result, so the fake
         * would hand back a different *set* of rows than Postgres would, not just
         * a different order.
         */
        if (typeof left === "number" && typeof right === "number") {
          return (left - right) * direction;
        }

        return String(left ?? "").localeCompare(String(right ?? "")) * direction;
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

        // `operation_runs.pause_cycle smallint not null default 0` (ADR 0042
        // §P2). `createOperationRun` deliberately never sends this column, so
        // without the default modelled here `pauseOperationForUser`'s read
        // would see `undefined` where Postgres always fills `0`.
        if (this.table === "operation_runs") row.pause_cycle ??= 0;

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
      return this.countMode
        ? ({ data: targets, error: null, count: targets.length } as {
            data: unknown;
            error: QueryError;
          })
        : { data: targets, error: null };
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

      // Arrays and composite conflict targets, both because a real caller uses
      // them: the agent tool trail upserts a whole run's events at once, keyed
      // on `(agent_execution_run_id, sequence)`. Without either, a replayed
      // durable step would appear to store one opaque row and every assertion
      // about the trail would be about the double rather than about Postgres.
      const payloads = (Array.isArray(this.payload) ? this.payload : [this.payload ?? {}]) as Row[];
      const conflictColumns = this.onConflict
        ? this.onConflict.split(",").map((column) => column.trim())
        : [];
      const results: Row[] = [];

      for (const payload of payloads) {
        const existing =
          conflictColumns.length > 0
            ? this.db
                .rows(this.table)
                .find((row) => conflictColumns.every((column) => row[column] === payload[column]))
            : undefined;

        if (existing) {
          // `DO NOTHING` leaves the row alone *and* returns nothing for it, so
          // a caller counting the returned rows counts what was actually
          // written. That count is what reconciliation reports as `inserted`.
          if (this.ignoreDuplicates) continue;

          const candidate = { ...existing, ...payload, updated_at: new Date().toISOString() };
          const violation = this.db.checkConstraints(this.table, candidate, existing.id);
          if (violation) return { data: null, error: violation };
          Object.assign(existing, candidate);
          results.push(existing);
          continue;
        }

        const row: Row = {
          id: `${this.table}_${this.db.rows(this.table).length + 1}`,
          created_at: new Date().toISOString(),
          ...payload,
        };
        const violation = this.db.checkConstraints(this.table, row);
        if (violation) return { data: null, error: violation };
        this.db.rows(this.table).push(row);
        results.push(row);
      }

      return { data: results, error: null };
    }

    const readFailure = this.readFailure();
    if (readFailure) return { data: null, error: readFailure };

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

/**
 * Hand-written mirrors of the five ADR 0042 §P3 Postgres functions
 * (`supabase/migrations/20260823010000_billing_reconciliation_primitives.sql`),
 * for the same reason `checkConstraints` mirrors the migration's CHECKs: a
 * fake that stays silent about what a real function does is not testing the
 * hot path, it is testing an approximation of it. Every write below goes
 * through `checkConstraints`, so a correction this codebase would refuse in
 * Postgres (an overspend, over-allocation) is refused here too — the same
 * `23514` a real constraint violation raises.
 *
 * Kept intentionally close to the SQL line by line, so a change to one is
 * easy to miss in the other only if nobody is looking — not because the
 * shapes have drifted apart.
 */
function updateWithConstraints(db: FakeDatabase, table: string, target: Row, patch: Row): QueryError {
  const candidate = { ...target, ...patch, updated_at: new Date().toISOString() };
  const violation = db.checkConstraints(table, candidate, target.id);
  if (violation) return violation;
  Object.assign(target, candidate);
  return null;
}

function fakeMaterializeLedgerEntry(db: FakeDatabase, entryId: unknown): QueryError {
  const entry = db.rows("billing_credit_ledger").find((row) => row.id === entryId);
  if (!entry) return { message: `materialize_ledger_entry: no ledger entry ${String(entryId)}` };
  if (entry.materialized_at != null) return null;

  const account = db.rows("billing_credit_accounts").find((row) => row.id === entry.credit_account_id);
  if (!account) return { message: `materialize_ledger_entry: no account ${String(entry.credit_account_id)}` };

  const violation = updateWithConstraints(db, "billing_credit_accounts", account, {
    posted_credits: Number(account.posted_credits ?? 0) + Number(entry.credit_delta ?? 0),
  });
  if (violation) return violation;

  entry.materialized_at = new Date().toISOString();
  return null;
}

function fakeMaterializeReservationHold(db: FakeDatabase, reservationId: unknown): QueryError {
  const reservation = db.rows("billing_credit_reservations").find((row) => row.id === reservationId);
  if (!reservation) {
    return { message: `materialize_reservation_hold: no reservation ${String(reservationId)}` };
  }

  const account = db
    .rows("billing_credit_accounts")
    .find((row) => row.id === reservation.credit_account_id);
  if (!account) {
    return { message: `materialize_reservation_hold: no account ${String(reservation.credit_account_id)}` };
  }

  const reservedCredits = Number(reservation.reserved_credits ?? 0);

  if (reservation.status === "active" && reservation.admitted_at == null) {
    const violation = updateWithConstraints(db, "billing_credit_accounts", account, {
      reserved_credits: Number(account.reserved_credits ?? 0) + reservedCredits,
    });
    if (violation) return violation;
    reservation.admitted_at = new Date().toISOString();
    return null;
  }

  const terminal = ["settled", "released", "expired"].includes(String(reservation.status));
  if (terminal && reservation.admitted_at != null && reservation.hold_released_at == null) {
    const violation = updateWithConstraints(db, "billing_credit_accounts", account, {
      reserved_credits: Number(account.reserved_credits ?? 0) - reservedCredits,
    });
    if (violation) return violation;
    reservation.hold_released_at = new Date().toISOString();
    return null;
  }

  // Nothing pending for this row's current phase — idempotent no-op.
  return null;
}

function fakeMaterializeAllocationCapacity(db: FakeDatabase, allocationId: unknown): QueryError {
  const allocation = db.rows("billing_credit_allocations").find((row) => row.id === allocationId);
  if (!allocation) {
    return { message: `materialize_allocation_capacity: no allocation ${String(allocationId)}` };
  }

  if (!["consumed", "released"].includes(String(allocation.status))) return null;
  if (allocation.capacity_materialized_at != null) return null;

  const grant = db.rows("billing_credit_grants").find((row) => row.id === allocation.grant_id);
  if (!grant) return { message: `materialize_allocation_capacity: no lot ${String(allocation.grant_id)}` };

  const creditUnits = Number(allocation.credit_units ?? 0);
  const consumedUnits = Number(allocation.consumed_units ?? 0);
  const returnedUnits = creditUnits - consumedUnits;

  if (returnedUnits > 0) {
    const violation = updateWithConstraints(db, "billing_credit_grants", grant, {
      allocated_credit_units: Number(grant.allocated_credit_units ?? 0) - returnedUnits,
    });
    if (violation) return violation;
  }

  allocation.capacity_materialized_at = new Date().toISOString();
  return null;
}

function fakeRepairAccountBalance(db: FakeDatabase, accountId: unknown): QueryError {
  const entries = db
    .rows("billing_credit_ledger")
    .filter((row) => row.credit_account_id === accountId && row.materialized_at == null);
  for (const entry of entries) {
    const violation = fakeMaterializeLedgerEntry(db, entry.id);
    if (violation) return violation;
  }

  const reservations = db.rows("billing_credit_reservations").filter((row) => {
    if (row.credit_account_id !== accountId) return false;
    if (row.status === "active" && row.admitted_at == null) return true;
    return (
      ["settled", "released", "expired"].includes(String(row.status)) &&
      row.admitted_at != null &&
      row.hold_released_at == null
    );
  });
  for (const reservation of reservations) {
    const violation = fakeMaterializeReservationHold(db, reservation.id);
    if (violation) return violation;
  }

  return null;
}

function fakeRepairLotAllocation(db: FakeDatabase, grantId: unknown): QueryError {
  const allocations = db
    .rows("billing_credit_allocations")
    .filter(
      (row) =>
        row.grant_id === grantId &&
        ["consumed", "released"].includes(String(row.status)) &&
        row.capacity_materialized_at == null,
    );
  for (const allocation of allocations) {
    const violation = fakeMaterializeAllocationCapacity(db, allocation.id);
    if (violation) return violation;
  }
  return null;
}

/**
 * What a fake RPC answers.
 *
 * Every handler until VB-025 was a *procedure* — it mutated the fake database
 * and returned only an error or `null`, so the double could model
 * `rpc(...)` returning nothing. `sum_ledger_deltas` is the first that has an
 * answer, and a double that could only say `null` would have let the caller's
 * reconciliation read a zero balance in every test.
 */
type FakeRpcResult = QueryError | { data: unknown };

function isRpcData(result: FakeRpcResult): result is { data: unknown } {
  return result !== null && typeof result === "object" && "data" in result;
}

const FAKE_RPC_HANDLERS: Record<string, (db: FakeDatabase, params: Record<string, unknown>) => FakeRpcResult> = {
  /**
   * ADR 0056 §8's scrub, modelled only as far as the orchestrator is
   * responsible for it.
   *
   * The JSONB transform itself is deliberately **not** reproduced here. It is a
   * recursive, irreversible rewrite whose correctness is proven against real
   * PostgreSQL in `supabase/tests/audit-scrub.migration.ts`, against a fixture
   * covering every event category — and a second implementation of it in a test
   * helper would drift from the first exactly when it mattered.
   *
   * What this models is what an orchestrator test can meaningfully assert: the
   * routine ran, for this identity's rows and nobody else's, and the payload no
   * longer carries the two keys that must go together with the column (§8).
   */
  erase_account_audit_metadata: (db, params) => {
    if (!params.p_user_id) return { message: "erase_account_audit_metadata requires a user id" };

    for (const row of db.rows("audit_events")) {
      if (row.user_id !== params.p_user_id) continue;
      row.project_id = null;
      const metadata = { ...((row.metadata as Record<string, unknown> | undefined) ?? {}) };
      delete metadata.projectId;
      delete metadata.project_id;
      row.metadata = metadata;
    }

    return null;
  },
  raise_execution_founder_input_request: (db, params) => {
    const run = db
      .rows("agent_execution_runs")
      .find((row) => row.id === params.p_agent_execution_run_id);
    if (!run || !["queued", "running", "needs_user_input"].includes(String(run.status))) {
      return { message: "agent_execution_run_not_open" };
    }

    const spec = db
      .rows("execution_specs")
      .find((row) => row.id === run.execution_spec_id && row.project_id === run.project_id);
    if (!spec) return { message: "runtime_founder_input_spec_missing" };

    let interrupt = db
      .rows("execution_interrupts")
      .find(
        (row) =>
          row.agent_execution_run_id === run.id &&
          row.status === "open",
      );
    if (!interrupt) {
      interrupt = db.seed("execution_interrupts", {
        project_id: run.project_id,
        user_id: run.user_id,
        execution_spec_id: run.execution_spec_id,
        agent_execution_run_id: run.id,
        interrupt_type: params.p_interrupt_type,
        question: params.p_question,
        response_schema: params.p_response_schema,
        founder_input_request_id: null,
        status: "open",
        answer: null,
        answered_at: null,
        created_at: new Date().toISOString(),
      });
    }

    if (interrupt.founder_input_request_id == null) {
      let request = db
        .rows("project_founder_input_requests")
        .find(
          (row) =>
            row.project_id === run.project_id &&
            row.input_kind === params.p_input_kind &&
            row.subject_key === params.p_subject_key &&
            row.status === "open",
        );
      if (!request) {
        request = db.seed("project_founder_input_requests", {
          project_id: run.project_id,
          action_plan_id: null,
          action_plan_step_key: null,
          execution_interrupt_id: interrupt.id,
          origin: "execution_blocker",
          input_kind: params.p_input_kind,
          subject_key: params.p_subject_key,
          question: params.p_question,
          why_needed: params.p_why_needed,
          response_type: params.p_response_type,
          recommendation: params.p_recommendation,
          alternatives: params.p_alternatives,
          allow_custom: params.p_allow_custom,
          context_hash: spec.spec_identity,
          status: "open",
          resolved_at: null,
          created_at: new Date().toISOString(),
        });
      }
      interrupt.founder_input_request_id = request.id;
    }

    return null;
  },
  materialize_ledger_entry: (db, params) => fakeMaterializeLedgerEntry(db, params.p_entry_id),
  materialize_reservation_hold: (db, params) => fakeMaterializeReservationHold(db, params.p_reservation_id),
  materialize_allocation_capacity: (db, params) =>
    fakeMaterializeAllocationCapacity(db, params.p_allocation_id),
  repair_account_balance: (db, params) => fakeRepairAccountBalance(db, params.p_account_id),
  repair_lot_allocation: (db, params) => fakeRepairLotAllocation(db, params.p_grant_id),

  /**
   * `sum_ledger_deltas` (VB-025).
   *
   * The one handler that answers rather than acts. Modelled as the migration
   * defines it — a plain sum over the account's entries, zero when it has
   * none — so a test asserting reconciliation is asserting the same arithmetic
   * production does.
   */
  sum_ledger_deltas: (db, params) => ({
    data: db
      .rows("billing_credit_ledger")
      .filter((row) => row.credit_account_id === params.p_credit_account_id)
      .reduce((total, row) => total + Number(row.credit_delta ?? 0), 0),
  }),

  /**
   * `sum_lot_allocation_capacity` (PERF-018).
   *
   * Modelled as the migration defines it, including the two things the billing
   * page's drift detection depends on. The occupancy rule is the CASE: a held
   * allocation occupies its full amount, a consumed one only what it charged,
   * a released one nothing. And a lot with **no** allocations produces no row
   * at all rather than a zero — `group by` cannot emit one, and a fake that
   * invented it would let a caller forget its own `?? ZERO_CREDITS`.
   *
   * `supabase/tests/lot-capacity.migration.ts` proves the same arithmetic
   * against a real cluster. That is what makes this handler a model rather than
   * a second implementation nobody checked — the failure Sprint 0115 recorded,
   * where a fake answered a question production answered differently.
   */
  sum_lot_allocation_capacity: (db, params) => {
    const grantIds = new Set((params.p_grant_ids as string[] | undefined) ?? []);
    const occupied = new Map<string, number>();

    for (const row of db.rows("billing_credit_allocations")) {
      const grantId = String(row.grant_id);
      if (!grantIds.has(grantId)) continue;

      const status = String(row.status);
      const units =
        status === "held"
          ? Number(row.credit_units ?? 0)
          : status === "consumed"
            ? Number(row.consumed_units ?? 0)
            : 0;

      occupied.set(grantId, (occupied.get(grantId) ?? 0) + units);
    }

    return {
      data: [...occupied].map(([grant_id, occupied_units]) => ({ grant_id, occupied_units })),
    };
  },

  /**
   * `sum_agent_run_usage` (PERF-002).
   *
   * Modelled as the migration defines it, including the two things the
   * gateway's ceiling depends on: every row the run wrote counts, whatever its
   * status (VB-016), and a run with no rows answers zero rather than nothing.
   * Shaped as `returns table(...)` reaches PostgREST — an array of one row —
   * so the caller's unwrapping is exercised here too.
   */
  sum_agent_run_usage: (db, params) => {
    const rows = db.rows("ai_usage_events").filter((row) => row.job_id === params.p_run_id);
    return {
      data: [
        {
          spent_output_tokens: rows.reduce((total, row) => total + Number(row.output_tokens ?? 0), 0),
          forwarded_requests: rows.length,
        },
      ],
    };
  },

  /**
   * `list_ai_usage_events_for_run`. Modelled as the migration defines it: the
   * row-level counterpart to `sum_agent_run_usage`, filtered by both the run
   * and the project rather than relying on RLS the fake does not simulate.
   */
  list_ai_usage_events_for_run: (db, params) => ({
    data: db
      .rows("ai_usage_events")
      .filter((row) => row.job_id === params.p_run_id && row.project_id === params.p_project_id)
      .map((row) => ({
        status: row.status,
        input_tokens: row.input_tokens ?? null,
        output_tokens: row.output_tokens ?? null,
        cache_read_input_tokens: row.cache_read_input_tokens ?? null,
        cache_creation_input_tokens: row.cache_creation_input_tokens ?? null,
        thinking_tokens: row.thinking_tokens ?? null,
        provider_cost_usd: row.provider_cost_usd ?? null,
        latency_ms: row.latency_ms ?? null,
        created_at: row.created_at ?? null,
      })),
  }),
};

/**
 * What a read model actually asked the database for (VB-023).
 *
 * ## Why a count, when a source assertion already exists
 *
 * Because `workspace-cost.test.ts` is textual and says so: it proves nobody
 * wrote `await` inside a loop, which is one shape of the mistake. It cannot
 * see a fan-out spread across six modules' services, where every individual
 * call site looks correct and the cost is only visible in the total.
 *
 * One table name is pushed per query, so a test can assert both the number and
 * which tables it was spent on — "six reads" and "six reads of the same table"
 * are different defects.
 */
export type QueryRecorder = {
  reads: string[];
  writes: string[];
  /**
   * `table:columns` for every read, so a test can assert *what* was asked for
   * (VB-022).
   *
   * Counting queries catches a read model asking the same question twice.
   * It cannot catch one asking for a two-hundred-kilobyte JSONB document in
   * order to test a boolean, which is the other half of the same finding — and
   * the half a reader of the code will not notice, because `Boolean(x?.result)`
   * looks free.
   */
  selects: string[];
};

export function newQueryRecorder(): QueryRecorder {
  return { reads: [], writes: [], selects: [] };
}

/** Every column list one table was read with. */
export function selectsOf(recorder: QueryRecorder, table: string): string[] {
  return recorder.selects
    .filter((entry) => entry.startsWith(`${table}:`))
    .map((entry) => entry.slice(table.length + 1));
}

/** How many times one table was read. */
export function readsOf(recorder: QueryRecorder, table: string): number {
  return recorder.reads.filter((entry) => entry === table).length;
}

export function fakeSupabase(db: FakeDatabase, recorder?: QueryRecorder): SupabaseClient {
  const read = (
    table: string,
    columns?: string,
    options?: { count?: "exact"; head?: boolean },
  ) => {
    recorder?.reads.push(table);
    recorder?.selects.push(`${table}:${columns ?? ""}`);
    // The options were dropped here until VB-022, so a `head`-only count query
    // came back as an ordinary row read and answered zero. `FakeQuery.select`
    // has understood them all along; nothing was passing them on.
    return new FakeQuery(db, table, "select").select(columns, options);
  };
  const write = <T>(table: string, build: () => T): T => {
    recorder?.writes.push(table);
    return build();
  };

  return {
    from(table: string) {
      return {
        select: (columns?: string, options?: { count?: "exact"; head?: boolean }) =>
          read(table, columns, options),
        insert: (payload: Row | Row[]) =>
          write(table, () => new FakeQuery(db, table, "insert", payload)),
        update: (payload: Row, options?: { count?: "exact" }) =>
          write(table, () => new FakeQuery(db, table, "update", payload).counting(options)),
        delete: () => write(table, () => new FakeQuery(db, table, "delete")),
        upsert: (
          payload: Row | Row[],
          options?: { onConflict?: string; ignoreDuplicates?: boolean },
        ) =>
          write(
            table,
            () =>
              new FakeQuery(
                db,
                table,
                "upsert",
                payload,
                options?.onConflict,
                options?.ignoreDuplicates ?? false,
              ),
          ),
      };
    },
    rpc(name: string, params?: Record<string, unknown>) {
      recorder?.reads.push(`rpc:${name}`);
      const handler = FAKE_RPC_HANDLERS[name];
      const run = async (): Promise<{ data: unknown; error: QueryError }> => {
        if (!handler) return { data: null, error: { message: `fakeSupabase: unknown rpc "${name}"` } };
        const result = handler(db, params ?? {});
        if (isRpcData(result)) return { data: result.data, error: null };
        return { data: null, error: result };
      };
      return {
        then: (onfulfilled?: (value: { data: unknown; error: QueryError }) => unknown, onrejected?: (reason: unknown) => unknown) =>
          run().then(onfulfilled, onrejected),
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
