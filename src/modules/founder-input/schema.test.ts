import { describe, expect, it } from "vitest";
import { checkedValues, migrationSql } from "@/modules/operations/migration-test-support";
import {
  FOUNDER_INPUT_KINDS,
  FOUNDER_INPUT_REQUEST_ORIGINS,
  FOUNDER_INPUT_REQUEST_STATUSES,
  FOUNDER_INPUT_RESPONSE_SOURCES,
  FOUNDER_INPUT_RESPONSE_TYPES,
} from "./schema";

const sql = () => migrationSql().join("\n");

describe("founder input persistence contract", () => {
  it("keeps TypeScript and database vocabularies aligned", () => {
    expect(checkedValues("project_founder_input_requests", "origin").sort()).toEqual(
      [...FOUNDER_INPUT_REQUEST_ORIGINS].sort(),
    );
    expect(checkedValues("project_founder_input_requests", "input_kind").sort()).toEqual(
      [...FOUNDER_INPUT_KINDS].sort(),
    );
    expect(checkedValues("project_founder_input_requests", "response_type").sort()).toEqual(
      [...FOUNDER_INPUT_RESPONSE_TYPES].sort(),
    );
    expect(checkedValues("project_founder_input_requests", "status").sort()).toEqual(
      [...FOUNDER_INPUT_REQUEST_STATUSES].sort(),
    );
    expect(checkedValues("project_founder_resolutions", "response_source").sort()).toEqual(
      [...FOUNDER_INPUT_RESPONSE_SOURCES].sort(),
    );
  });

  it("deduplicates both open requests and active resolutions by semantic subject", () => {
    expect(sql()).toContain("project_founder_input_requests_one_open_subject_idx");
    expect(sql()).toContain("project_founder_resolutions_one_active_subject_idx");
    expect(sql()).toContain("where status = 'open'");
    expect(sql()).toContain("where superseded_at is null");
  });

  it("allows owners to read but only the service role to mutate", () => {
    expect(sql()).toContain("alter table public.project_founder_input_requests enable row level security");
    expect(sql()).toContain("alter table public.project_founder_resolutions enable row level security");
    expect(sql()).toContain('create policy "select own project_founder_input_requests"');
    expect(sql()).toContain('create policy "select own project_founder_resolutions"');
    expect(sql()).toContain(
      "revoke all on function public.resolve_founder_input_request(uuid, uuid, text, text, text, text) from public, anon, authenticated",
    );
    expect(sql()).toContain(
      "grant execute on function public.resolve_founder_input_request(uuid, uuid, text, text, text, text) to service_role",
    );
  });

  it("resolves under one locked database transition", () => {
    expect(sql()).toContain("for update of r");
    expect(sql()).toContain("stale_founder_input_request");
    expect(sql()).toContain("set superseded_at = now()");
    expect(sql()).toContain("set status = 'resolved', resolved_at = now()");
  });
});
