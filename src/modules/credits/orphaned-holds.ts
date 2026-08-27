import type { CreditUnits } from "./units";

/**
 * A Credit hold left standing over an operation that has finished (VB-020).
 *
 * ## The window
 *
 * Completing an operation and finalizing its billing are two writes, and they
 * are deliberately not one: `completeOperationRun` runs, then
 * `settleOperationBilling` — or, on the failure path, `releaseOperationBilling`.
 * A crash between them leaves the operation terminal and its reservation
 * `active`. Nothing is wrong with the money; it is simply held against work
 * that is over, and it stays held.
 *
 * The customer sees Credits they cannot spend and no reason why. Until now the
 * only thing that could notice was a SQL query in a deployment checklist, run
 * by a person who remembered to run it — which is to say, during an activation
 * and never again.
 *
 * ## Why the grace window is not optional
 *
 * The two writes are *milliseconds* apart on the happy path, so "terminal with
 * an active hold" is a state every single successful operation passes through.
 * Detecting without a grace window would report every operation in flight.
 * {@link SETTLEMENT_GRACE_MS} is far longer than the gap could plausibly be and
 * far shorter than a customer's patience.
 *
 * ## What is owed differs, and that is why this reports rather than repairs
 *
 * A **failed or cancelled** operation delivered nothing, so its hold should
 * have been released — the repair is unambiguous and customer-favourable.
 *
 * A **completed** one delivered the work, so what was abandoned was a
 * *settlement*, and settling needs the actual usage the crashed path was
 * holding and this detector cannot reconstruct. Releasing instead would refund
 * work the customer received.
 *
 * Two different repairs, one of which cannot be performed from here — so this
 * establishes the fact and says which is owed, and the repair stays a separate
 * decision with its own authority model, the way ADR 0042 §P3 derived one for
 * materialization drift and for lot drift rather than assuming it.
 */

/** How long a hold may outlive its operation before it counts as orphaned. */
export const SETTLEMENT_GRACE_MS = 15 * 60 * 1000;

/** The operation statuses that mean the work is over, one way or another. */
const TERMINAL = new Set(["completed", "failed", "cancelled"]);

export type HeldReservation = {
  id: string;
  operationRunId: string | null;
  reservedCredits: CreditUnits;
};

export type TerminalOperation = {
  id: string;
  operationType: string;
  status: string;
  completedAt: string | null;
};

export type OrphanedHold = {
  reservationId: string;
  operationId: string;
  operationType: string;
  operationStatus: string;
  reservedCredits: CreditUnits;
  /** How long the hold has outlived its operation. */
  durationMs: number;
  /** What the crashed path would have done, had it got that far. */
  owed: "release" | "settlement";
};

export function findOrphanedHolds(params: {
  reservations: readonly HeldReservation[];
  operations: readonly TerminalOperation[];
  now: Date;
}): OrphanedHold[] {
  const byId = new Map(params.operations.map((operation) => [operation.id, operation]));
  const nowMs = params.now.getTime();

  const orphaned: OrphanedHold[] = [];

  for (const reservation of params.reservations) {
    // A hold with no operation behind it is a different question — a quote, or
    // a row this detector has no business judging — and is deliberately not
    // reported here rather than guessed at.
    if (!reservation.operationRunId) continue;

    const operation = byId.get(reservation.operationRunId);
    if (!operation || !TERMINAL.has(operation.status)) continue;

    // No terminal timestamp means no way to know whether the grace window has
    // passed. Silence is the right answer to "I cannot tell".
    if (!operation.completedAt) continue;
    const completedAt = Date.parse(operation.completedAt);
    if (!Number.isFinite(completedAt)) continue;

    const durationMs = nowMs - completedAt;
    if (durationMs < SETTLEMENT_GRACE_MS) continue;

    orphaned.push({
      reservationId: reservation.id,
      operationId: operation.id,
      operationType: operation.operationType,
      operationStatus: operation.status,
      reservedCredits: reservation.reservedCredits,
      durationMs,
      owed: operation.status === "completed" ? "settlement" : "release",
    });
  }

  return orphaned;
}
