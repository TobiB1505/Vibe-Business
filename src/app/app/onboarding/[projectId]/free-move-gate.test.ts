import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * VB-009 — the free Move generation is free exactly once.
 *
 * `revealAuditAndFindFirstMoveAction` passed `bundled_with_free_audit`
 * unconditionally. It is a Server Action, so anyone who had finished onboarding
 * could invoke it again and regenerate Moves for nothing, indefinitely — while
 * the control beside it in the project workspace charged 20 Credits for the
 * same operation.
 *
 * The gate is `markOnboardingMilestone`'s return value rather than a read of
 * onboarding state, and that distinction is the reason the last test here
 * exists: the milestone write is `UPDATE … WHERE audit_revealed_at IS NULL`, so
 * exactly one concurrent caller can win it. A check-then-act on onboarding
 * status would let two simultaneous invocations both see "not finished yet" and
 * both run free.
 */

const requireSessionMock = vi.fn();
const markOnboardingMilestoneMock = vi.fn();
const startOpportunityOperationMock = vi.fn();
const recordAuditEventMock = vi.fn();

/** A project row, then the newest completed audit — the action's two reads. */
function fakeSupabase() {
  const maybeSingle = vi
    .fn()
    .mockResolvedValueOnce({ data: { id: "project_1" } })
    .mockResolvedValueOnce({ data: { id: "audit_1" } });

  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "limit"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.maybeSingle = maybeSingle;
  return { from: vi.fn(() => builder) };
}

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/modules/auth/session", () => ({ requireSession: () => requireSessionMock() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fakeSupabase() }));
vi.mock("@/modules/audit-log/events", () => ({
  recordAuditEvent: (...args: unknown[]) => recordAuditEventMock(...args),
}));
vi.mock("@/modules/onboarding/store", () => ({
  markOnboardingMilestone: (...args: unknown[]) => markOnboardingMilestoneMock(...args),
  completeProjectOnboarding: vi.fn(),
  getProjectOnboarding: vi.fn(),
  setLiveSiteStatus: vi.fn(),
}));
vi.mock("@/modules/operations/service", () => ({
  startOpportunityOperation: (...args: unknown[]) => startOpportunityOperationMock(...args),
  startBusinessAuditOperation: vi.fn(),
  startProductScanOperation: vi.fn(),
}));
vi.mock("@/modules/operations/vercel/executor", () => ({
  VercelWorkflowExecutor: class {},
}));

const { revealAuditAndFindFirstMoveAction } = await import("./actions");

/** What the action asked billing for on its last invocation. */
function requestedBy(): string {
  const call = startOpportunityOperationMock.mock.calls.at(-1);
  return (call?.[2] as { requestedBy: string }).requestedBy;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireSessionMock.mockResolvedValue({ userId: "user_1" });
  startOpportunityOperationMock.mockResolvedValue({ kind: "started" });
});

describe("the first reveal, inside onboarding", () => {
  it("is bundled with the free audit", async () => {
    markOnboardingMilestoneMock.mockResolvedValue(true);

    await revealAuditAndFindFirstMoveAction("project_1");

    expect(requestedBy()).toBe("bundled_with_free_audit");
  });
});

describe("every reveal after it", () => {
  it("routes to the billable path instead of running free forever", async () => {
    // The milestone is already set, so this caller did not win it — which is
    // what "onboarding already delivered its free Move" means here.
    markOnboardingMilestoneMock.mockResolvedValue(false);

    await revealAuditAndFindFirstMoveAction("project_1");

    expect(requestedBy()).toBe("customer_requested");
  });

  it("stays billable however many times it is called", async () => {
    markOnboardingMilestoneMock.mockResolvedValue(false);

    for (let i = 0; i < 3; i += 1) await revealAuditAndFindFirstMoveAction("project_1");

    const asked = startOpportunityOperationMock.mock.calls.map(
      (call) => (call[2] as { requestedBy: string }).requestedBy,
    );
    expect(asked).toEqual(["customer_requested", "customer_requested", "customer_requested"]);
  });
});

describe("two callers at once", () => {
  /**
   * The reason the gate is the milestone write and not a status read. Only one
   * caller can win `UPDATE … WHERE audit_revealed_at IS NULL`; the loser is
   * told so by the database rather than by a read it could have raced.
   */
  it("produces exactly one free run", async () => {
    markOnboardingMilestoneMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    await Promise.all([
      revealAuditAndFindFirstMoveAction("project_1"),
      revealAuditAndFindFirstMoveAction("project_1"),
    ]);

    const asked = startOpportunityOperationMock.mock.calls.map(
      (call) => (call[2] as { requestedBy: string }).requestedBy,
    );
    expect(asked.filter((value) => value === "bundled_with_free_audit")).toHaveLength(1);
    expect(asked.filter((value) => value === "customer_requested")).toHaveLength(1);
  });
});
