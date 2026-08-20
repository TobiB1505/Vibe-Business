import { describe, expect, it } from "vitest";
import { checkedValues, migrationSql } from "@/modules/operations/migration-test-support";
import { EVENT_AUDIENCES, EXECUTION_EVENT_TYPES, EXECUTION_PHASES } from "./events";

/**
 * The TypeScript unions, pinned to the SQL CHECK constraints.
 *
 * The same reason `schema.test.ts` exists: the in-memory test database does not
 * evaluate constraints, so a union and a CHECK can disagree through every
 * suite and fail on the first real write. This table's vocabulary is closed
 * *deliberately* — an open `type` column is a free-text column with extra
 * steps, and free text is where model narration ends up — so the closure has to
 * be asserted rather than assumed.
 */

describe("agent_execution_events constraints", () => {
  it("permits exactly the event vocabulary the module declares", () => {
    expect(checkedValues("agent_execution_events", "type").sort()).toEqual(
      [...EXECUTION_EVENT_TYPES].sort(),
    );
  });

  it("permits exactly the phases the timeline renders", () => {
    expect(checkedValues("agent_execution_events", "phase").sort()).toEqual(
      [...EXECUTION_PHASES].sort(),
    );
  });

  it("permits exactly the two audiences", () => {
    expect(checkedValues("agent_execution_events", "audience").sort()).toEqual(
      [...EVENT_AUDIENCES].sort(),
    );
  });

  /**
   * The idempotency key, at the database.
   *
   * Every poll re-offers the whole progress file, and the durable write is an
   * upsert on the sequence the harness itself assigned. Without the unique
   * index that upsert is an insert, and a twenty-minute run would write its
   * first event four hundred times.
   */
  it("makes (run, sequence) unique so a re-entered poll rewrites rather than duplicates", () => {
    expect(migrationSql().join("\n")).toContain("agent_execution_events_unique_sequence");
  });

  /**
   * The outer bound on a storage amplification.
   *
   * The file names in these rows come from a customer's repository and an agent
   * can be induced to touch files in a loop. The code caps the batch; this caps
   * what a bypassed writer could store.
   */
  it("bounds the sequence, the summary and the metadata in SQL as well as in code", () => {
    const sql = migrationSql().join("\n");

    expect(sql).toContain("sequence > 0 and sequence <= 100000");
    expect(sql).toContain("char_length(summary) between 1 and 300");
    expect(sql).toContain("pg_column_size(metadata) <= 8192");
  });

  /**
   * Read-only to the browser.
   *
   * RLS cannot tell a Server Action from a browser holding the public anon key,
   * so an insert policy here would let anyone forge a run's history — including
   * the evidence a human approval is later shown.
   */
  it("grants select and nothing else", () => {
    const sql = migrationSql().join("\n");

    expect(sql).toContain('create policy "select own agent_execution_events"');

    // Every policy declared on this table, whatever it is called.
    const policies = [
      ...sql.matchAll(/on public\.agent_execution_events\s+for\s+(\w+)/g),
    ].map((match) => match[1]);

    expect(policies).toEqual(["select"]);
  });
});
