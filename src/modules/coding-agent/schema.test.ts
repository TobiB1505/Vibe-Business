import { describe, expect, it } from "vitest";
import { checkedValues, migrationSql } from "@/modules/operations/migration-test-support";
import { EXECUTION_ACTIVITY_EVENTS, EXECUTION_INTERRUPT_TYPES } from "@/modules/execution-contract/schema";
import { EXECUTION_CAPABILITIES } from "@/modules/execution/schema";
import { OPERATION_STAGES, OPERATION_TYPES } from "@/modules/operations/schema";
import { AGENT_RUN_STATUSES } from "./schema";

/**
 * The TypeScript unions, pinned to the SQL CHECK constraints.
 *
 * This file exists because the drift it catches has happened repeatedly in this
 * repository, and the in-memory test database does not evaluate constraints —
 * so no behavioural test can see a union and a CHECK disagree.
 *
 * The most expensive instance is recorded in `20260812150000`: a v2 capability
 * insert passed every suite and would have failed on the first real click,
 * because the deployed constraint permitted only v1. Every value that can reach
 * an INSERT in this sprint is asserted here on the day the table is created.
 */

describe("agent_execution_runs constraints", () => {
  it("permits exactly the run statuses the store writes", () => {
    expect(checkedValues("agent_execution_runs", "status").sort()).toEqual(
      [...AGENT_RUN_STATUSES].sort(),
    );
  });

  /**
   * The idempotency guarantee §56 asks for, at the database.
   *
   * An application check cannot provide it: two clicks 20 ms apart both pass
   * one. A partial unique index over the live-or-successful statuses turns the
   * second insert into a constraint violation instead of a second coding agent.
   */
  it("permits at most one live run per identity", () => {
    const sql = migrationSql().join("\n");
    expect(sql).toContain("create unique index agent_execution_runs_single_active_idx");
    expect(sql).toContain(
      "where status in ('queued', 'running', 'needs_user_input', 'succeeded')",
    );
  });

  /**
   * Two counters, two columns, and no column named for both.
   *
   * `turns` counted model responses during a run and the harness's loop count
   * after it, under one name, against a ceiling in the second unit. Run
   * b33635a1 read 66 against a limit of 40 and overran nothing. The rename is
   * asserted here because an alias or a re-added `turns` would quietly restore
   * exactly the ambiguity that caused it.
   */
  it("names the two turn counters separately and keeps the ambiguous one gone", () => {
    const sql = migrationSql().join("\n");

    expect(sql).toContain("rename column turns to assistant_messages");
    expect(sql).toContain("add column sdk_loop_iterations integer");

    // Nullable on purpose: the harness reports it once, in its terminal
    // message, so a run that died before one has no honest value. A NOT NULL
    // default would mean writing the message count there.
    expect(sql).toContain("sdk_loop_iterations is null or sdk_loop_iterations >= 0");
  });

  /** A "succeeded" run with no artifact behind it would let a report claim work that never landed. */
  it("refuses a successful run with no prepared change", () => {
    expect(migrationSql().join("\n")).toContain("agent_execution_runs_succeeded_has_change");
  });

  it("refuses a failed run with no reason", () => {
    expect(migrationSql().join("\n")).toContain("agent_execution_runs_failed_has_code");
  });
});

describe("agent_activity_events constraints", () => {
  it("permits exactly the activity vocabulary the contract declares", () => {
    expect(checkedValues("agent_activity_events", "event").sort()).toEqual(
      [...EXECUTION_ACTIVITY_EVENTS].sort(),
    );
  });

  /**
   * §23 and Rule 43, enforced by absence.
   *
   * A schema that cannot express a sentence cannot leak a reasoning trace,
   * whatever a future caller intends. This asserts the table has no column a
   * model's narration could occupy.
   */
  it("has no column a model's narration could occupy", () => {
    const sql = migrationSql().join("\n");
    const table = sql.slice(
      sql.indexOf("create table public.agent_activity_events"),
      sql.indexOf("comment on table public.agent_activity_events"),
    );

    for (const forbidden of ["message", "reasoning", "thinking", "rationale", "summary", "narration"]) {
      expect(table, forbidden).not.toContain(`${forbidden} text`);
    }
  });
});

describe("agent_tool_events constraints", () => {
  it("records a reason for every denial", () => {
    expect(migrationSql().join("\n")).toContain("agent_tool_events_denied_has_reason");
  });

  it("stores no content, output or credential column", () => {
    const sql = migrationSql().join("\n");
    const table = sql.slice(
      sql.indexOf("create table public.agent_tool_events"),
      sql.indexOf("comment on table public.agent_tool_events"),
    );

    for (const forbidden of ["content", "output", "token", "secret", "stdout", "stderr"]) {
      expect(table, forbidden).not.toContain(`${forbidden} text`);
    }
  });
});

describe("execution_interrupts constraints", () => {
  it("permits exactly the interrupt vocabulary the contract declares", () => {
    expect(checkedValues("execution_interrupts", "interrupt_type").sort()).toEqual(
      [...EXECUTION_INTERRUPT_TYPES].sort(),
    );
  });

  /**
   * One open question per run. A run that could accumulate open questions would
   * be a chat, which CORE-3 §21 explicitly refuses.
   */
  it("permits at most one open question per run", () => {
    const sql = migrationSql().join("\n");
    expect(sql).toContain("create unique index execution_interrupts_one_open_per_run_idx");
    expect(sql).toContain("where status = 'open'");
  });

  it("refuses an answered interrupt with no answer, and an open one with one", () => {
    const sql = migrationSql().join("\n");
    expect(sql).toContain("execution_interrupts_answered_has_answer");
    expect(sql).toContain("execution_interrupts_open_has_no_answer");
  });

  /**
   * §49: no browser may forge another user's interrupt answer.
   *
   * The RLS policy is the boundary — a signed-in owner may update only an
   * interrupt attached to a project they own, and the store additionally scopes
   * the read by `user_id` and the write by `status = 'open'`.
   */
  it("scopes answering to the project's owner", () => {
    const sql = migrationSql().join("\n");
    expect(sql).toContain("alter table public.execution_interrupts enable row level security");
    expect(sql).toContain('create policy "answer own execution_interrupts"');
    expect(sql).toContain("p.user_id = auth.uid()");
  });
});

describe("existing tables accept the new work", () => {
  it("permits every operation type and stage the application knows about", () => {
    const types = checkedValues("operation_runs", "operation_type");
    for (const type of OPERATION_TYPES) expect(types, type).toContain(type);

    const stages = checkedValues("operation_runs", "stage");
    for (const stage of OPERATION_STAGES) expect(stages, stage).toContain(stage);
  });

  /**
   * The exact drift that cost a real click in Sprint 9: a capability the code
   * can produce that the deployed constraint refuses.
   */
  it("permits every execution capability, including the agentic one", () => {
    const permitted = checkedValues("prepared_changes", "execution_capability");
    for (const capability of EXECUTION_CAPABILITIES) {
      expect(permitted, capability).toContain(capability);
    }
  });

  /**
   * An agentic change traces to a plan step rather than to an opportunity set,
   * so both columns became nullable — but only for that capability. A
   * generator-produced change must still name both.
   */
  it("still requires an opportunity for a generator-produced change", () => {
    const sql = migrationSql().join("\n");
    expect(sql).toContain("prepared_changes_opportunity_required_for_generators");
    expect(sql).toContain("execution_capability = 'agentic_execution_v1'");
  });

  it("adds cache accounting to the AI usage ledger", () => {
    const sql = migrationSql().join("\n");
    expect(sql).toContain("add column if not exists cache_read_input_tokens");
    expect(sql).toContain("add column if not exists cache_creation_input_tokens");
  });
});
