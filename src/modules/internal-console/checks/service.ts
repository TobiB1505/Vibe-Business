import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { RETAIL_PRICE_POLICIES } from "@/modules/credits/retail";
import { isPastStaleDeadline } from "@/modules/operations/staleness";
import type { OperationType } from "@/modules/operations/schema";
import type { OperationStatus } from "@/modules/operations/schema";
import { SAMPLE_LIMIT } from "../schema";
import type { OperationRunRow } from "../shape";
import { readLedgerStamps } from "./store";
import type { ConsistencyReport } from "./schema";
import { buildConsistencyReport, buildStalledOperations, buildUnknownRateCards } from "./shape";

/**
 * One consistency pass over the live database.
 *
 * ## What this is, next to `src/lib/consistency/`
 *
 * Those are static rules: they read the repository as text, run in CI on every
 * pull request, and take under half a second. They cannot see a single row.
 *
 * This is the other half. Every contradiction below needs the database to be
 * visible at all — a stamp naming a card no registry defines, an operation
 * nothing is carrying. Neither could ever be a unit test, and both were found
 * by hand this week, which is the argument for a surface that looks without
 * being asked.
 *
 * ## Why "stuck" is imported rather than defined
 *
 * `isPastStaleDeadline` is the product's own answer, derived from each
 * operation type's declared timeout and acted on by `expireStaleOperation`. A
 * check that re-derived it would be a second definition of one word — which is
 * the species of defect this whole panel exists to find, so writing one here
 * would be an unusually direct kind of irony.
 */

/**
 * The rate cards a charge may name.
 *
 * From the registry, so a `launch-v2` counts as known the day it is added and
 * there is no second list to remember — the same reason
 * `policy-version-literals.test.ts` imports rather than enumerates.
 */
function knownRateCards(): readonly string[] {
  return RETAIL_PRICE_POLICIES.map((policy) => policy.version);
}

/**
 * The findings reachable from rows the console already reads.
 *
 * `unfinished` is passed in rather than re-queried: the console's snapshot has
 * it, and a second read of the same rows could disagree with the first about
 * what is in flight at the moment an operator is looking.
 */
export async function loadConsistencyReport(
  client: SupabaseClient,
  unfinished: readonly OperationRunRow[],
  now: number,
): Promise<ConsistencyReport> {
  const stamps = await readLedgerStamps(client);

  return buildConsistencyReport(
    [
      ...buildUnknownRateCards(stamps, knownRateCards()),
      ...buildStalledOperations(unfinished, now, (row) =>
        isPastStaleDeadline(
          {
            // The console types these as `string` on purpose, so an unfamiliar
            // value from the database renders instead of throwing. The lookup
            // inside `isPastStaleDeadline` answers `false` for a type it does
            // not know, which is the safe direction: an unrecognised operation
            // is never reported as stuck.
            status: row.status as OperationStatus,
            operationType: row.operationType as OperationType,
            startedAt: row.startedAt,
          },
          () => now,
        ),
      ),
    ],
    stamps.length >= SAMPLE_LIMIT,
  );
}
