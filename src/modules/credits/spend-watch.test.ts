import { describe, expect, it, vi } from "vitest";
import {
  ACCOUNT_SPEND_NOTICE_NANO_USD,
  SPEND_SAMPLE_LIMIT,
  crossesNotice,
  observeAccountSpend,
  summarizeSpend,
} from "./spend-watch";
import { FakeDatabase, fakeSupabase } from "@/modules/operations/test-support";

const alertOperator = vi.fn();
vi.mock("@/lib/observability/alert", () => ({
  alertOperator: (...args: unknown[]) => alertOperator(...args),
}));

/**
 * VB-033 — an account burning provider money is noticed as it burns it.
 *
 * The finding's own remedy was a scheduled ledger read, which needs a
 * background technology this product has not decided to have. This runs at the
 * write that causes the spend instead — timelier, and no new infrastructure.
 */

const USER = "user_1";

function usd(dollars: string) {
  return { provider_cost_usd: dollars };
}

describe("the arithmetic", () => {
  /**
   * Integers, never floating-point dollars. `0.1 + 0.2` is the reason every
   * money path in this repository goes through nano-USD.
   */
  it("sums stored costs without floating point", () => {
    const observed = summarizeSpend([usd("0.10"), usd("0.20"), usd("0.30")]);

    expect(observed.totalNanoUsd).toBe(600_000_000);
    expect(observed.eventCount).toBe(3);
  });

  it("ignores a row with no recorded cost rather than counting it as zero-and-known", () => {
    const observed = summarizeSpend([usd("1.00"), { provider_cost_usd: null }]);

    expect(observed.totalNanoUsd).toBe(1_000_000_000);
    expect(observed.eventCount).toBe(2);
  });

  it("reports an empty day as nothing rather than as unknown", () => {
    expect(summarizeSpend([])).toEqual({ totalNanoUsd: 0, eventCount: 0, truncated: false });
  });

  /**
   * A total that says "at least" is a different claim from one that says
   * "exactly", and the alert repeats the distinction.
   */
  it("says when the sample hit its cap", () => {
    const rows = Array.from({ length: SPEND_SAMPLE_LIMIT }, () => usd("0.01"));

    expect(summarizeSpend(rows).truncated).toBe(true);
  });
});

describe("the threshold", () => {
  it("does not fire below it", () => {
    expect(
      crossesNotice({
        totalNanoUsd: ACCOUNT_SPEND_NOTICE_NANO_USD - 1,
        eventCount: 1,
        truncated: false,
      }),
    ).toBe(false);
  });

  it("fires at it", () => {
    expect(
      crossesNotice({ totalNanoUsd: ACCOUNT_SPEND_NOTICE_NANO_USD, eventCount: 1, truncated: false }),
    ).toBe(true);
  });

  /**
   * Two orders of magnitude above a real audit run (~$0.20 measured), so
   * ordinary use never reaches it.
   */
  it("sits far above a day of ordinary use", () => {
    const ordinaryDay = Array.from({ length: 20 }, () => usd("0.20"));

    expect(crossesNotice(summarizeSpend(ordinaryDay))).toBe(false);
  });
});

describe("the observation", () => {
  function seed(db: FakeDatabase, costs: string[], userId = USER) {
    for (const cost of costs) {
      db.seed("ai_usage_events", {
        user_id: userId,
        provider_cost_usd: cost,
        created_at: new Date().toISOString(),
      });
    }
  }

  it("reports a spike, with the total as dollars rather than raw units", async () => {
    alertOperator.mockClear();
    const db = new FakeDatabase();
    seed(db, ["20.00", "10.00"]);

    await observeAccountSpend(fakeSupabase(db), { userId: USER });

    expect(alertOperator).toHaveBeenCalledWith(
      expect.stringContaining("daily notice threshold"),
      expect.objectContaining({ userId: USER, spendUsd: "30.000000000" }),
      "warning",
    );
  });

  it("says nothing about an ordinary day", async () => {
    alertOperator.mockClear();
    const db = new FakeDatabase();
    seed(db, ["0.20", "0.35"]);

    await observeAccountSpend(fakeSupabase(db), { userId: USER });

    expect(alertOperator).not.toHaveBeenCalled();
  });

  /**
   * The service-role client this runs on does not enforce RLS, so the user
   * filter is the only thing keeping one account's spend out of another's
   * total — and a false alarm attributed to the wrong customer is worse than
   * no alarm.
   */
  it("never counts another account's spend", async () => {
    alertOperator.mockClear();
    const db = new FakeDatabase();
    seed(db, ["0.50"], USER);
    seed(db, ["99.00"], "user_2");

    await observeAccountSpend(fakeSupabase(db), { userId: USER });

    expect(alertOperator).not.toHaveBeenCalled();
  });

  it("never throws when the read fails — observing spend cannot fail the work", async () => {
    alertOperator.mockClear();
    const db = new FakeDatabase();
    seed(db, ["50.00"]);
    db.failNextReadWith = { table: "ai_usage_events", message: "boom" };

    await expect(observeAccountSpend(fakeSupabase(db), { userId: USER })).resolves.toBeUndefined();
    expect(alertOperator).not.toHaveBeenCalled();
  });

  /**
   * It refuses nothing. What a customer may spend is a product decision, and
   * this function deliberately has no way to express one.
   */
  it("returns nothing a caller could act on", async () => {
    const db = new FakeDatabase();
    seed(db, ["50.00"]);

    expect(await observeAccountSpend(fakeSupabase(db), { userId: USER })).toBeUndefined();
  });
});
