import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { nanoUsdToUsdString } from "@/modules/ai/pricing";
import { projectAiUsage, storedCostToNanoUsd, summarizeCost, type AiUsageRow } from "./projection";
import { rateUsage } from "./rating";
import { reconcileUsage } from "./reconciliation";

/**
 * The BILLING CORE-1 shadow dogfood (§68, §69, §70, §72).
 *
 * **Dev-only. Not part of the test suite.** The file is `*.probe.ts`, and
 * `vitest.config.mts` includes only `*.test.ts`, so CI can never reach the
 * database through it. Run it explicitly:
 *
 * ```
 * NEXT_PUBLIC_SUPABASE_URL=… \
 * SUPABASE_SERVICE_ROLE_KEY=… \
 * pnpm billing:dogfood
 * ```
 *
 * ## What it does, and what it costs
 *
 * It reads Vibe's **real historical provider usage**, projects it into billing,
 * reconciles the recomputed provider cost against the figure the AI ledger
 * already stored, runs the idempotent reconciliation twice, and prints the
 * calibration table.
 *
 * It makes **no provider calls of any kind** — no inference, no browser, no
 * sandbox — so running it is free. That is deliberate: §68 says to use existing
 * persisted usage rather than spending money to generate billing data.
 *
 * It charges nobody. Shadow mode writes `billing_usage_events` and nothing
 * else: no account, no grant, no reservation, no ledger entry, no balance
 * change (§5, §43).
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * The service role is required because `ai_usage_events` and
 * `deep_scan_provider_usage` have insert policies and no select policy — "the
 * absence of a select policy is the access control". A request-scoped client
 * cannot read them at all.
 */
const configured = Boolean(url && serviceRoleKey);

function client() {
  return createClient(url!, serviceRoleKey!, { auth: { persistSession: false } });
}

function usd(nano: number): string {
  return `$${nanoUsdToUsdString(nano)}`;
}

/**
 * Every financial figure this probe promises not to move.
 *
 * Counts and balances together: a row count alone would miss a run that
 * changed a balance in place, and a balance alone would miss one that added an
 * offsetting pair.
 */
async function readFinancialState(supabase: ReturnType<typeof client>): Promise<{
  accounts: number;
  ledgerEntries: number;
  reservations: number;
  postedCredits: number;
  reservedCredits: number;
}> {
  const count = async (table: string): Promise<number> => {
    const { count: rows, error } = await supabase
      .from(table)
      .select("id", { count: "exact", head: true });
    if (error) throw error;
    return rows ?? 0;
  };

  const { data: balances, error } = await supabase
    .from("billing_credit_accounts")
    .select("posted_credits, reserved_credits");
  if (error) throw error;

  const rows = (balances ?? []) as { posted_credits: number; reserved_credits: number }[];

  return {
    accounts: await count("billing_credit_accounts"),
    ledgerEntries: await count("billing_credit_ledger"),
    reservations: await count("billing_credit_reservations"),
    postedCredits: rows.reduce((total, row) => total + row.posted_credits, 0),
    reservedCredits: rows.reduce((total, row) => total + row.reserved_credits, 0),
  };
}

describe.skipIf(!configured)("billing shadow dogfood", () => {
  /**
   * §69 — the reconciliation that must hold exactly.
   *
   * Billing recomputes provider cost with the same authoritative module the AI
   * ledger used, at each row's own timestamp. Any disagreement is a semantic
   * mismatch to investigate, never something to "fix" by overwriting history —
   * so this asserts equality rather than closeness.
   */
  it("reproduces the AI ledger's stored cost exactly", async () => {
    const supabase = client();
    const { data, error } = await supabase
      .from("ai_usage_events")
      .select(
        "id, user_id, project_id, operation, provider, model, job_id, status, input_tokens, output_tokens, thinking_tokens, cache_read_input_tokens, cache_creation_input_tokens, provider_cost_usd, pricing_version, created_at",
      )
      .order("created_at", { ascending: true });

    expect(error).toBeNull();
    const rows = (data ?? []) as AiUsageRow[];
    console.log(`\n=== §69 provider-cost reconciliation over ${rows.length} real AI calls ===`);

    const mismatches: string[] = [];
    let reconciled = 0;
    let unpricedRows = 0;

    for (const row of rows) {
      const events = projectAiUsage(row);
      const recomputed = events.find((event) => event.rawCostNanoUsd !== null)?.rawCostNanoUsd ?? null;
      const stored = storedCostToNanoUsd(row.provider_cost_usd);

      if (stored === null && recomputed === null) {
        unpricedRows += 1;
        continue;
      }
      if (stored === recomputed) {
        reconciled += 1;
        continue;
      }
      mismatches.push(
        `${row.id} model=${row.model} stored=${stored} recomputed=${recomputed} at=${row.created_at}`,
      );
    }

    console.log(`reconciled exactly:   ${reconciled}`);
    console.log(`no cost either side:  ${unpricedRows}`);
    console.log(`mismatches:           ${mismatches.length}`);
    for (const mismatch of mismatches) console.log(`  MISMATCH ${mismatch}`);

    expect(mismatches).toEqual([]);
  }, 120_000);

  /** §70, §72 — the calibration table, keeping known and unknown apart. */
  it("reports what each operation type actually cost Vibe", async () => {
    const supabase = client();
    const { data } = await supabase
      .from("ai_usage_events")
      .select(
        "id, user_id, project_id, operation, provider, model, job_id, status, input_tokens, output_tokens, thinking_tokens, cache_read_input_tokens, cache_creation_input_tokens, provider_cost_usd, pricing_version, created_at",
      );

    const rows = (data ?? []) as AiUsageRow[];
    const byOperation = new Map<string, AiUsageRow[]>();
    for (const row of rows) {
      byOperation.set(row.operation, [...(byOperation.get(row.operation) ?? []), row]);
    }

    console.log("\n=== §72 internal calibration: AI operations ===");
    console.log("operation                  runs  in-tok   out-tok  known cost      avg/run");

    for (const [operation, operationRows] of [...byOperation].sort()) {
      const usage = operationRows.flatMap((row) => projectAiUsage(row));
      const summary = summarizeCost(usage);
      const inTokens = usage
        .filter((event) => event.sku === "anthropic_input_tokens")
        .reduce((total, event) => total + event.quantity, 0);
      const outTokens = usage
        .filter((event) => event.sku === "anthropic_output_tokens")
        .reduce((total, event) => total + event.quantity, 0);
      const average = summary.costedEvents > 0 ? summary.knownCostNanoUsd / summary.costedEvents : 0;

      console.log(
        `${operation.padEnd(26)} ${String(operationRows.length).padStart(4)}  ` +
          `${String(inTokens).padStart(7)} ${String(outTokens).padStart(9)}  ` +
          `${usd(summary.knownCostNanoUsd).padStart(14)}  ${usd(Math.round(average))}`,
      );

      // The Credit rating, reported honestly: no production card exists.
      const rating = rateUsage(usage);
      expect(rating.status).toBe("rate_card_not_configured");
      expect(rating.credits).toBeNull();
    }

    console.log("\ncustomer Credit rating for every operation above: rate_card_not_configured");
    console.log("customer charged: NO (shadow mode)");
  }, 120_000);

  /**
   * §43, §68 — the idempotency claim, proven against the real database rather
   * than asserted. Two full passes; the second must insert nothing.
   */
  it("reconciles real usage twice with no duplicates", async () => {
    const supabase = client();

    // The financial picture before this probe touches anything (§5, §43).
    //
    // This used to assert the credit tables were *globally* empty, which was
    // true when Core-1 shipped in shadow mode and stopped being true the moment
    // Core-2 wired Credits into the operation start paths. A probe asserting
    // the database is empty is asserting something about the product's history
    // rather than about itself, and it fails for the good reason that the
    // product moved on.
    //
    // What shadow mode actually claims is narrower and still worth proving:
    // *this run* writes `billing_usage_events` and nothing else. So the claim
    // is measured rather than assumed — captured here, compared afterwards.
    // It is also strictly stronger in one direction, because it would catch a
    // probe that removed rows as well as one that added them.
    const financialStateBefore = await readFinancialState(supabase);

    const first = await reconcileUsage(supabase, { limit: 1000 });
    const second = await reconcileUsage(supabase, { limit: 1000 });

    console.log("\n=== §43 idempotent reconciliation over real usage ===");
    for (const source of first.sources) {
      console.log(
        `${source.sourceKind.padEnd(26)} rows=${String(source.rowsRead).padStart(3)} ` +
          `projected=${String(source.eventsProjected).padStart(3)} ` +
          `inserted=${String(source.eventsInserted).padStart(3)} ` +
          `known=${usd(source.cost.knownCostNanoUsd)} ` +
          `unknown-cost events=${source.cost.unknownCostEvents}`,
      );
      expect(source.costMismatches).toEqual([]);
    }

    console.log(`\npass 1 inserted: ${first.totals.eventsInserted}`);
    console.log(`pass 2 inserted: ${second.totals.eventsInserted} (must be 0)`);
    console.log(`pass 2 already present: ${second.totals.eventsAlreadyPresent}`);
    console.log(`\nknown provider cost:   ${usd(first.totals.knownCostNanoUsd)}`);
    console.log(`unknown-cost events:   ${first.totals.unknownCostEvents} (never counted as $0)`);
    console.log(`credit rating status:  ${first.ratingStatus}`);

    // The guarantee: a second pass is a no-op.
    expect(second.totals.eventsInserted).toBe(0);
    expect(second.totals.eventsAlreadyPresent).toBeGreaterThan(0);

    // Shadow mode: nothing financial was written *by this run*.
    const financialStateAfter = await readFinancialState(supabase);

    console.log(`\ncredit accounts:   ${financialStateBefore.accounts} → ${financialStateAfter.accounts}`);
    console.log(`ledger entries:    ${financialStateBefore.ledgerEntries} → ${financialStateAfter.ledgerEntries}`);
    console.log(`reservations:      ${financialStateBefore.reservations} → ${financialStateAfter.reservations}`);
    console.log(`posted (all):      ${financialStateBefore.postedCredits} → ${financialStateAfter.postedCredits}`);
    console.log(`reserved (all):    ${financialStateBefore.reservedCredits} → ${financialStateAfter.reservedCredits}`);
    console.log("customer charged: NO (shadow mode)");

    // Counts *and* balances, because a probe could in principle move credits
    // without changing a row count.
    expect(financialStateAfter).toEqual(financialStateBefore);
    // Generous: two full reconciliation passes over every provider ledger,
    // each insert a separate round trip. This is a dogfood, not a unit test.
  }, 300_000);
});
