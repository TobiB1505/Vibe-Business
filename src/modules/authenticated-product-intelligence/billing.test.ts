import { describe, expect, it, vi } from "vitest";

/**
 * The one thing this module must never do: charge for the included scan.
 *
 * `authorizeOperationCredits` resolves the retail price of `deep_scan` and
 * knows nothing about entitlements. Every project's first successful Deep Scan
 * is included (PRODUCT.md §12.1), and the only thing standing between that
 * promise and a 25-Credit charge is that this function is told which mode the
 * entitlement chose — so the free path is asserted here rather than assumed
 * from the caller.
 */

const authorizeMock = vi.fn();

vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => ({}) }));
vi.mock("@/modules/credits/operation-billing", () => ({
  authorizeOperationCredits: (...args: unknown[]) => authorizeMock(...args),
  settleOperationCredits: vi.fn(),
  releaseOperationCredits: vi.fn(),
}));

const { deepScanIdempotencyKey, holdDeepScanCredits } = await import("./billing");

describe("holdDeepScanCredits", () => {
  it("reserves nothing for the project's included scan", async () => {
    const result = await holdDeepScanCredits({
      projectId: "project-1",
      sessionId: "session-1",
      accessMode: "included_first_scan",
    });

    expect(result).toEqual({ ok: true, billable: false });
    expect(authorizeMock).not.toHaveBeenCalled();
  });

  it("reserves the retail price for an additional scan", async () => {
    authorizeMock.mockResolvedValueOnce({ ok: true, billable: true });

    await holdDeepScanCredits({
      projectId: "project-1",
      sessionId: "session-1",
      accessMode: "credits",
    });

    expect(authorizeMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        projectId: "project-1",
        operation: "deep_scan",
        idempotencyKey: "deep-scan:session-1",
        // Deliberately null: a Deep Scan is not a durable operation, and
        // inventing one to satisfy a foreign key would put a fake operation in
        // a customer's history.
        operationRunId: null,
      }),
    );
  });

  it("keys the hold to the session, so settle and release can find it again", () => {
    // If this ever diverges from what settle and release compute, a charged
    // scan leaves a hold standing forever and the customer's available balance
    // quietly shrinks.
    expect(deepScanIdempotencyKey("session-1")).toBe("deep-scan:session-1");
  });
});
