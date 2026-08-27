import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The one place `repository_connections` is queried from (VB-001 M5).
 *
 * ## Why a boundary rather than a filter everyone remembers
 *
 * A connection row now outlives the connection. ADR 0056 §1 makes Disconnect
 * non-destructive, and the row cannot be deleted anyway — execution specs,
 * merges and snapshots reference it with `ON DELETE RESTRICT`. So the table
 * holds two different things: the repository a project is connected to *now*,
 * and every repository it was connected to before.
 *
 * Eleven call sites read this table, and before M5 none of them distinguished
 * the two, because the unique constraint meant there was nothing to
 * distinguish. Adding `.is("detached_at", null)` to eleven queries and hoping
 * the twelfth remembers is how a detached repository quietly keeps getting
 * scanned, executed against, and written to — the exact thing Disconnect
 * promises to stop.
 *
 * Confining the table here makes "live or historical?" a question you cannot
 * avoid answering: there is no way to reach the rows without picking one.
 * `repository-connection-boundary.test.ts` keeps that true.
 *
 * ## Why `columns` is a plain `string`, and what that costs
 *
 * postgrest-js infers a row shape by parsing the select string *as a literal
 * type*. Threading it through a generic to keep that inference was tried and
 * is not viable: `tsc` exhausts its heap and aborts. So the string widens here,
 * and a caller that reads fields off the result states its own row type — which
 * is what most of these readers already did.
 *
 * ## Why the caller still names its own columns
 *
 * The eleven readers want eleven different column sets — one wants a repository
 * id, another six fields for a merge preflight. A helper returning a fixed
 * shape would make every caller pay for the widest one, which is the cost this
 * repository avoids elsewhere by selecting narrowly. So the boundary owns the
 * table name and the liveness predicate; the caller keeps its projection.
 */

const TABLE = "repository_connections";

/**
 * Live connections: the repository a project is connected to right now.
 *
 * This is what almost every reader wants. A detached row is not a connection
 * that happens to be inactive — it is history, and treating it as a connection
 * means acting on a repository the founder told Vibe to let go.
 */
export function liveConnections(supabase: SupabaseClient, columns: string) {
  return supabase.from(TABLE).select(columns).is("detached_at", null);
}

/**
 * Every connection a project has ever had, detached ones included.
 *
 * For reading history — an old merge's provenance, an audit trail — never for
 * deciding what to read from or write to. Nothing needs it yet; it exists so
 * that when something does, it says so at the call site instead of quietly
 * dropping the predicate.
 */
export function anyConnections(supabase: SupabaseClient, columns: string) {
  return supabase.from(TABLE).select(columns);
}
