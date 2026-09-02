import { describe, expect, it } from "vitest";
import { checkedValues, migrationSql } from "@/modules/operations/migration-test-support";
import { PREPARED_CHANGE_STATUSES } from "./schema";

/**
 * The status union, pinned to the CHECK that admits it.
 *
 * This test exists because the two disagreed for the life of the table and
 * nothing noticed: `superseded` sat in the TypeScript union while the CHECK
 * listed three values, so the one status a caller might have reached for was
 * the one the database would have refused. The in-memory test database does not
 * evaluate constraints, so the disagreement survived every suite.
 */
describe("prepared_changes.status", () => {
  it("admits exactly the statuses the module declares", () => {
    expect(checkedValues("prepared_changes", "status").sort()).toEqual(
      [...PREPARED_CHANGE_STATUSES].sort(),
    );
  });

  /**
   * A discarded change was `prepared` a moment earlier, so it already carries a
   * `completed_at`. Without widening the terminal constraint alongside the
   * status one, every discard would be refused by *that* — a rejection that
   * reads as a bug rather than as a rule.
   */
  it("counts a discarded change as terminal", () => {
    const terminal = migrationSql()
      .flatMap((sql) => [...sql.matchAll(/status in \(([^)]*)\)\) = \(completed_at is not null\)/g)])
      .map((match) => [...match[1].matchAll(/'([^']+)'/g)].map((value) => value[1]))
      .at(-1);

    expect(terminal).toEqual(["prepared", "failed", "discarded"]);
  });

  /**
   * The mechanism the whole feature rests on: the partial unique index is
   * scoped to the active statuses, so discarding a change frees its execution
   * identity and the same step becomes runnable again. Widening this index to
   * include `discarded` would silently take that away.
   */
  it("keeps the single-active index scoped to the statuses that are still live", () => {
    const scope = migrationSql()
      .flatMap((sql) => [
        ...sql.matchAll(
          /create unique index prepared_changes_single_active_idx[\s\S]*?where status in \(([^)]*)\)/g,
        ),
      ])
      .map((match) => [...match[1].matchAll(/'([^']+)'/g)].map((value) => value[1]))
      .at(-1);

    expect(scope).toEqual(["preparing", "prepared"]);
  });
});
