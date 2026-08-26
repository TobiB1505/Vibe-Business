import { describe, expect, it } from "vitest";
import { FakeDatabase, fakeSupabase } from "@/modules/operations/test-support";
import { listFounderActionCompletionEvidence } from "./founder-action-store";

describe("Founder Action completion evidence store", () => {
  it("returns immutable attestations for the exact project and plan", async () => {
    const db = new FakeDatabase();
    db.seed("action_plan_founder_attestations", {
      id: "attestation-1",
      project_id: "project-1",
      action_plan_id: "plan-1",
      action_plan_step_key: "3-connect-stripe",
      action_plan_step_order: 3,
      attested_by_user_id: "user-1",
      attestation_version: "founder-action-attestation.v1",
      created_at: "2026-08-26T15:00:00.000Z",
    });
    db.seed("action_plan_founder_attestations", {
      id: "attestation-other",
      project_id: "project-2",
      action_plan_id: "plan-2",
      action_plan_step_key: "1-other",
      action_plan_step_order: 1,
      attested_by_user_id: "user-2",
      attestation_version: "founder-action-attestation.v1",
      created_at: "2026-08-26T16:00:00.000Z",
    });

    await expect(
      listFounderActionCompletionEvidence(fakeSupabase(db), {
        projectId: "project-1",
        actionPlanId: "plan-1",
      }),
    ).resolves.toEqual([
      {
        attestationId: "attestation-1",
        attestedByUserId: "user-1",
        attestedAt: "2026-08-26T15:00:00.000Z",
        attestationVersion: "founder-action-attestation.v1",
        stepKey: "3-connect-stripe",
        stepOrder: 3,
      },
    ]);
  });
});
