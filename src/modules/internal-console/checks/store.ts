import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { LEDGER_STAMP_COLUMNS, selection } from "../columns";
import { SAMPLE_LIMIT } from "../schema";
import type { LedgerStampRow } from "./shape";

/**
 * The consistency checks' own reads.
 *
 * Under the same reviewed rule 53 exception as `../store.ts`, and for the same
 * reason: **no function here accepts a project id, a user id, or any other
 * selector from its caller.** There is nothing to forge because there is no
 * parameter to forge it in. What replaces the ownership filter is the operator
 * gate `service.ts` applies before any of this runs.
 *
 * Every query names its columns from `../columns.ts`, bounded and ordered, so a
 * busy ledger returns a bounded page rather than the whole book.
 */

/**
 * The rate card stamped on every charge, newest first.
 *
 * Charges only. A grant, a release and a hold are not priced by a rate card, so
 * including them would report "no version recorded" for rows that correctly
 * have none — a check that invents its own false positives stops being read
 * faster than one that finds nothing.
 */
export async function readLedgerStamps(
  client: SupabaseClient,
): Promise<readonly LedgerStampRow[]> {
  const { data, error } = await client
    .from("billing_credit_ledger")
    .select(selection(LEDGER_STAMP_COLUMNS))
    .eq("kind", "charge")
    .order("created_at", { ascending: false })
    .limit(SAMPLE_LIMIT);

  if (error) throw new Error(`internal-console: ledger stamp read failed (${error.code})`);
  return (data ?? []) as unknown as readonly LedgerStampRow[];
}
