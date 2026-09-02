import { describe, expect, it } from "vitest";
import type { Database } from "@/types/database";
import type { AgentExecutionRunRow, ExecutionInterruptRow } from "./store";

/**
 * The two hand-written row shapes, held against the database.
 *
 * ## Why these are not derived like every other store's
 *
 * The seven stores converted alongside this one declared
 * `Record<string, unknown>` and were unchecked, so deriving their rows from
 * the generated schema was a straight improvement. These two were written out
 * in full and, checked column by column, they are **correct** — no phantom
 * column, no nullability disagreement.
 *
 * They are also better in a way a generated type cannot be. The database says
 * `status: text` and `interrupt_type: text`, because what narrows those to a
 * closed set is a CHECK constraint and a generator cannot see one. Declaring
 * the domain unions makes a status nobody defined a compile error; deriving
 * the row would make it a string.
 *
 * ## So this asserts the agreement instead of removing the duplication
 *
 * The risk a hand-written row carries is drift: a migration renames a column,
 * nothing regenerates, and the store keeps compiling against a shape the
 * database no longer has. `NoUnknownColumns` is that check, and it is
 * type-level, so `pnpm typecheck` enforces it.
 */

type RunSchemaRow = Database["public"]["Tables"]["agent_execution_runs"]["Row"];
type InterruptSchemaRow = Database["public"]["Tables"]["execution_interrupts"]["Row"];

/**
 * No column is declared that the table does not have.
 *
 * This is the assertion that catches a rename, which is the drift that
 * actually happens. Completeness is deliberately not asserted the other way
 * round: five columns exist on `agent_execution_runs` that this store does not
 * read, which is a decision about the select list rather than a defect.
 */
type NoUnknownColumns<Declared, Schema> = Exclude<keyof Declared, keyof Schema>;

/**
 * `[T] extends [never]`, not `T extends never`.
 *
 * The naked form distributes, so it answers `never` for a non-empty union and
 * the check passes exactly when it should fail. The first version of this file
 * annotated an empty array with the union instead, which is worse still: `[]`
 * satisfies `"anything"[]`, so a planted rename produced no error at all. Both
 * failures look like a passing check, which is the only kind worth guarding
 * against.
 */
type NoneOf<T> = [T] extends [never] ? true : { columnsTheTableDoesNotHave: T };

const RUN_HAS_NO_UNKNOWN_COLUMNS: NoneOf<
  NoUnknownColumns<AgentExecutionRunRow, RunSchemaRow>
> = true;
const INTERRUPT_HAS_NO_UNKNOWN_COLUMNS: NoneOf<
  NoUnknownColumns<ExecutionInterruptRow, InterruptSchemaRow>
> = true;

/**
 * Where the declared type is deliberately not the generated one.
 *
 * Both entries are places the hand-written side says something truer than the
 * generator can, so a check that demanded assignability would be demanding the
 * wrong thing. They are listed rather than skipped, because an unexplained
 * exemption is how a real disagreement hides.
 */
const DELIBERATE_TYPE_DIFFERENCES: readonly { column: string; why: string }[] = [
  {
    column: "agent_execution_runs.post_edit_provider_cost_usd",
    why:
      "The column is numeric(12,6) and the generator maps every numeric to `number`. " +
      "That is a claim that the value always fits a JS number, which is exactly what " +
      "numeric exists not to promise. The declared `string | number | null` makes no such " +
      "claim and the mapper calls Number() either way, so the defensive shape is the " +
      "correct one and the generated one is the optimistic one.",
  },
  {
    column: "execution_interrupts.response_schema",
    why:
      "The column is jsonb, so the generator says `Json`. The declared type is the " +
      "discriminated union the application actually stores, which is narrower and is the " +
      "reason a malformed schema is a compile error rather than a runtime surprise. A " +
      "union of object literals is not assignable to `Json` — TypeScript will not give " +
      "one an implicit index signature — which is a property of the checker, not a " +
      "disagreement about the data.",
  },
];

describe("the hand-written agent rows", () => {
  it("declare no column the table does not have", () => {
    // The assertion is the annotation above; `pnpm typecheck` enforces it.
    // This body makes the failure visible in a test report as well.
    expect(RUN_HAS_NO_UNKNOWN_COLUMNS).toBe(true);
    expect(INTERRUPT_HAS_NO_UNKNOWN_COLUMNS).toBe(true);
  });

  it("name a reason for every column whose type is deliberately not the generated one", () => {
    for (const entry of DELIBERATE_TYPE_DIFFERENCES) {
      expect(entry.column, "an exemption with no column is not an exemption").toMatch(/^\w+\.\w+$/);
      expect(entry.why.length, entry.column).toBeGreaterThan(80);
    }
  });

  /**
   * The list is not allowed to grow quietly. A third entry is a decision
   * somebody should have to make on purpose, in a diff that shows it.
   */
  it("has exactly the two exemptions that were argued", () => {
    expect(DELIBERATE_TYPE_DIFFERENCES.map((entry) => entry.column)).toEqual([
      "agent_execution_runs.post_edit_provider_cost_usd",
      "execution_interrupts.response_schema",
    ]);
  });
});
