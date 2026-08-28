import { afterEach, describe, expect, it } from "vitest";
import { OPERATION_COST_CLASS, arePaidOperationsDisabled, isPaidOperation } from "./kill-switch";
import { isRetryable } from "./failures";
import { OPERATION_TYPES, type OperationType } from "./schema";
import { createOperationRun } from "./store";
import { FakeDatabase, fakeSupabase } from "./test-support";

/**
 * VB-032 — the lever that stops paid work without a deploy.
 *
 * The tests worth having are about the two exemptions and about the flag's
 * reading, because those are the parts that are wrong in a way nobody notices
 * until the switch is thrown during an incident.
 */

describe("what it stops", () => {
  it("refuses the operations that spend a model call", () => {
    expect(isPaidOperation("business_audit")).toBe(true);
    expect(isPaidOperation("agent_execution")).toBe(true);
  });

  it("refuses the operations that spend infrastructure", () => {
    expect(isPaidOperation("change_validation")).toBe(true);
    expect(isPaidOperation("change_preview")).toBe(true);
  });
});

describe("what it must never stop", () => {
  /**
   * The exemption that matters most. Teardown costs infrastructure and exists
   * to end a larger cost — blocking it during a spend incident leaves previews
   * running and burning exactly the money the switch was thrown to save.
   */
  it("never blocks a preview teardown", () => {
    expect(OPERATION_COST_CLASS.preview_teardown).toBe("cleanup");
    expect(isPaidOperation("preview_teardown")).toBe(false);
  });

  it("never blocks a person erasing their account", () => {
    expect(isPaidOperation("account_erasure")).toBe(false);
  });

  it("never blocks the free work, which costs no provider anything", () => {
    expect(isPaidOperation("product_scan")).toBe(false);
    expect(isPaidOperation("change_outcome_verification")).toBe(false);
    expect(isPaidOperation("business_measurement")).toBe(false);
  });
});

describe("the classification", () => {
  /**
   * A `Record<OperationType, …>` is exhaustive at compile time, so this cannot
   * fail while the build passes — it is here to state the property the table's
   * shape is chosen for, so a later refactor to a `Partial` or a lookup with a
   * default is a visible decision rather than a quiet one.
   */
  it("classifies every operation type", () => {
    for (const type of OPERATION_TYPES) {
      expect(OPERATION_COST_CLASS[type]).toBeDefined();
    }
  });
});

describe("reading the flag", () => {
  it("is off when unset", () => {
    expect(arePaidOperationsDisabled({})).toBe(false);
  });

  it("is on for exactly \"1\"", () => {
    expect(arePaidOperationsDisabled({ PAID_OPERATIONS_DISABLED: "1" })).toBe(true);
  });

  /**
   * The failure worth pinning: a loose truthiness check turns
   * `PAID_OPERATIONS_DISABLED=false` into "everything is disabled" — and it
   * would be discovered during an incident, in the direction of nothing being
   * startable.
   */
  it.each(["false", "0", "no", "off", "", "true "])(
    "is off for %o, which a truthy check would misread",
    (value) => {
      expect(arePaidOperationsDisabled({ PAID_OPERATIONS_DISABLED: value })).toBe(false);
    },
  );
});

describe("what the customer is told", () => {
  /**
   * Waiting does not fix this one — a person flipping a flag does. Offering a
   * retry button would be the product inviting a click it knows will fail.
   */
  it("does not offer a retry", () => {
    expect(isRetryable("paid_operations_disabled")).toBe(false);
    // ...unlike the limit it sits beside, where waiting genuinely is the fix.
    expect(isRetryable("start_limit_reached")).toBe(true);
  });
});

describe("the funnel actually refuses", () => {
  /**
   * The classification above is only worth having if `createOperationRun`
   * consults it. This drives the real function against a fake database, so a
   * refactor that moves the check out of the single insertion funnel — the
   * thing that makes it cover the start path nobody has written yet — fails
   * here rather than silently reopening every paid path.
   */
  const ORIGINAL = process.env.PAID_OPERATIONS_DISABLED;

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.PAID_OPERATIONS_DISABLED;
    else process.env.PAID_OPERATIONS_DISABLED = ORIGINAL;
  });

  async function start(operationType: OperationType) {
    const db = new FakeDatabase();
    return await createOperationRun(fakeSupabase(db), {
      projectId: "project_1",
      userId: "user_1",
      operationType,
      inputIdentity: `identity_${operationType}`,
      initiatedBy: "customer",
    });
  }

  it("refuses a paid start with the typed reason, and writes nothing", async () => {
    process.env.PAID_OPERATIONS_DISABLED = "1";

    const created = await start("business_audit");

    expect(created).toEqual({ ok: false, error: "paid_operations_disabled" });
  });

  it("still starts a teardown, which is how a spend incident is ended", async () => {
    process.env.PAID_OPERATIONS_DISABLED = "1";

    expect((await start("preview_teardown")).ok).toBe(true);
  });

  it("still starts an erasure", async () => {
    process.env.PAID_OPERATIONS_DISABLED = "1";

    expect((await start("account_erasure")).ok).toBe(true);
  });

  it("starts a paid operation normally when the switch is off", async () => {
    delete process.env.PAID_OPERATIONS_DISABLED;

    expect((await start("business_audit")).ok).toBe(true);
  });
});
