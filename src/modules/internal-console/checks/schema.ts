/**
 * What a consistency check can find, as a closed vocabulary.
 *
 * ## Why this exists beside the console's other panels
 *
 * Everything else the console shows is a **measurement**: how many operations
 * ran, what they cost, where projects stand. A measurement is never wrong, only
 * uninteresting. These are **contradictions** — two places in the system that
 * disagree, where one of them has to be false and nobody found out.
 *
 * Four of those turned up in one week, all the same species and none of them
 * visible from any screen: a fallback that stamped eleven charges with a card
 * that did not price them, a panel reading a table with no writer, a hardcoded
 * version literal a policy change would outlive, and two migrations applied to
 * the production database with no file in the repository.
 *
 * `src/lib/consistency/` closes the half of that species which is checkable
 * from source alone, in CI, on every pull request. This is the other half: the
 * part that needs the live database, and therefore cannot be a unit test.
 *
 * The division is deliberate rather than incidental. "A table nobody writes"
 * looks like it belongs here — count the rows, find the zero — and it does not:
 * a new table legitimately has no rows, so the data can only ever raise a
 * suspicion, while the source answers it outright. It stays in
 * `table-writers.test.ts`, where it is decidable.
 *
 * ## Acknowledged is not the same as fixed
 *
 * A check that is red forever stops being read. Some contradictions are
 * genuinely historical — a stamp naming a book that a decision deleted is not
 * a defect, it is what that decision means. Those are listed with a reason and
 * shown apart, so an **unacknowledged** finding keeps its meaning: something
 * disagrees that nobody has explained yet.
 */

export const CONSISTENCY_CHECKS = [
  /** A charge names a rate card that no policy registry defines. */
  "unknown_rate_card",
  /** A running operation is past the deadline its own type declares. */
  "stalled_operation",
  /** An operation has sat queued long enough that nothing is going to pick it up. */
  "queued_too_long",
] as const;
export type ConsistencyCheck = (typeof CONSISTENCY_CHECKS)[number];

/**
 * One contradiction, at the grain it was found.
 *
 * `subject` is whatever the check is about — a rate card version, an operation
 * type, a table name. Never an id, never customer content: this panel obeys the
 * same rule as the rest of the console, and a finding is a shape rather than a
 * row.
 */
export type ConsistencyFinding = {
  check: ConsistencyCheck;
  subject: string;
  /** How many rows are in this state. A floor when `truncated` is set. */
  count: number;
  /** Short, from a closed vocabulary. Never free text from a row. */
  detail: string | null;
  /** True when this is a known, explained state rather than news. */
  acknowledged: boolean;
};

/**
 * The contradictions that are already understood, and why.
 *
 * Every entry is a decision somebody made, not a defect somebody tolerated —
 * the same shape `read-bounds.test.ts` and `service-boundary.test.ts` use,
 * where the allowlist is the review record. An entry earns its place by naming
 * what made the state correct.
 */
export const ACKNOWLEDGED: readonly {
  check: ConsistencyCheck;
  subject: string;
  why: string;
}[] = [
  {
    check: "unknown_rate_card",
    subject: "core4-dogfood-budget-v1",
    why:
      "Thirteen agent charges from the CORE-4 dogfood carry a budget policy version in a rate " +
      "card column. The value that belonged there, `internal-dogfood-v1`, names the internal " +
      "book ADR 0092 deleted; rewriting them would make that era look like it never had " +
      "economics of its own. The amount, 100 Credits, is unambiguous either way.",
  },
  {
    check: "unknown_rate_card",
    subject: "(none)",
    why:
      "Three charges from 2026-08-17 predate the column being populated at all. There is no " +
      "card to name, and inventing one would be the same mistake as the fallback that started " +
      "this — a recorded reason that is checkable and false.",
  },
];

/** Whether this exact finding is one somebody already explained. */
export function isAcknowledged(check: ConsistencyCheck, subject: string): boolean {
  return ACKNOWLEDGED.some((entry) => entry.check === check && entry.subject === subject);
}

/**
 * How long a queued operation may wait before nothing is going to start it.
 *
 * Deliberately generous and deliberately **not** derived from
 * `OPERATION_STALE_DEADLINE_MS`, which measures how long a *running* operation
 * may take. This measures a different failure — an operation that was recorded
 * and never picked up — and the sweep does not touch those on purpose, because
 * failing a `queued` row races a run about to start.
 *
 * Reporting is not sweeping. A check may say "this has been queued for eight
 * days" where the sweep must stay quiet, and that gap is exactly where the
 * hanging account erasure lived for eight days without any surface saying so.
 */
export const QUEUED_TOO_LONG_MS = 60 * 60 * 1000;

/** Everything one consistency pass produces. */
export type ConsistencyReport = {
  /** Contradictions nobody has explained. The number that matters. */
  findings: readonly ConsistencyFinding[];
  /** Known, explained states, kept apart so the list above stays meaningful. */
  acknowledged: readonly ConsistencyFinding[];
  /**
   * True when a bounded read reached its bound, so every count is a floor.
   *
   * The same honesty the rest of the console owes: an operator told "at least
   * this much" can act on it, one shown a quiet undercount cannot.
   */
  truncated: boolean;
};
