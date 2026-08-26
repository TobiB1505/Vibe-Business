import { describe, expect, it } from "vitest";
import { migrationSql } from "@/modules/operations/migration-test-support";

const sql = () => migrationSql().join("\n");

describe("Founder Action attestation schema", () => {
  it("binds one immutable attestation to an exact plan step", () => {
    expect(sql()).toContain("create table public.action_plan_founder_attestations");
    expect(sql()).toContain("action_plan_founder_attestations_one_per_step");
    expect(sql()).toContain("action_plan_founder_attestations_plan_step_fk");
    expect(sql()).toContain("action_plan_founder_attestations_plan_project_fk");
    expect(sql()).toContain("founder-action-attestation.v1");
  });

  it("allows owners to read but reserves attestation writes for the service boundary", () => {
    expect(sql()).toContain('create policy "select own action_plan_founder_attestations"');
    expect(sql()).toContain(
      "revoke all on table public.action_plan_founder_attestations from anon, authenticated",
    );
    expect(sql()).toContain(
      "grant select on table public.action_plan_founder_attestations to authenticated",
    );
    expect(sql()).toContain(
      "revoke all on function public.attest_founder_action_step(uuid, uuid, text, uuid)",
    );
    expect(sql()).toContain(
      "grant execute on function public.attest_founder_action_step(uuid, uuid, text, uuid)",
    );
  });

  it("accepts only founder_action/founder_acts work on a completed owned plan", () => {
    expect(sql()).toContain("a.status = 'completed'");
    expect(sql()).toContain("s.actor = 'founder_action'");
    expect(sql()).toContain("s.execution_support = 'founder_acts'");
    expect(sql()).toContain("p.user_id = p_user_id");
  });
});
