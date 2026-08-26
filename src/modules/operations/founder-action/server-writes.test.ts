import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDatabase, fakeSupabase } from "@/modules/operations/test-support";

const serviceDb = { current: new FakeDatabase() };
const attestRpc = vi.fn();

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => fakeSupabase(serviceDb.current),
}));

vi.mock("@/modules/action-plans/founder-action-store", () => ({
  callAttestFounderActionStep: (...args: unknown[]) => attestRpc(...args),
}));

const { attestFounderAction } = await import("./server-writes");

describe("Founder Action service-role write", () => {
  beforeEach(() => {
    serviceDb.current = new FakeDatabase();
    serviceDb.current.seed("projects", { id: "project-1", user_id: "user-1" });
    attestRpc.mockReset();
    attestRpc.mockResolvedValue("attestation-1");
  });

  it("re-establishes project ownership before writing evidence", async () => {
    await expect(
      attestFounderAction({
        projectId: "project-1",
        userId: "user-2",
        actionPlanId: "plan-1",
        stepKey: "3-connect-stripe",
      }),
    ).resolves.toEqual({ ok: false, error: "project_not_found" });
    expect(attestRpc).not.toHaveBeenCalled();
  });

  it("passes the exact owned plan and step to the database authority", async () => {
    await expect(
      attestFounderAction({
        projectId: "project-1",
        userId: "user-1",
        actionPlanId: "plan-1",
        stepKey: "3-connect-stripe",
      }),
    ).resolves.toEqual({ ok: true, attestationId: "attestation-1" });

    expect(attestRpc).toHaveBeenCalledWith(
      expect.anything(),
      {
        projectId: "project-1",
        userId: "user-1",
        actionPlanId: "plan-1",
        stepKey: "3-connect-stripe",
      },
    );
  });

  it("maps a rejected step without exposing database details", async () => {
    attestRpc.mockRejectedValue(new Error("founder_action_step_not_attestable"));

    await expect(
      attestFounderAction({
        projectId: "project-1",
        userId: "user-1",
        actionPlanId: "plan-1",
        stepKey: "agent-step",
      }),
    ).resolves.toEqual({ ok: false, error: "step_not_attestable" });
  });
});
