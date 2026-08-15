import { describe, expect, it, vi } from "vitest";
import { recordAuditEvent } from "./events";
import type { SupabaseClient } from "@supabase/supabase-js";

function fakeSupabase(insertResult: { error: { message: string } | null }) {
  const insert = vi.fn().mockResolvedValue(insertResult);
  const from = vi.fn().mockReturnValue({ insert });
  return { client: { from } as unknown as SupabaseClient, from, insert };
}

describe("recordAuditEvent", () => {
  it("inserts into audit_events with the expected shape", async () => {
    const { client, from, insert } = fakeSupabase({ error: null });

    await recordAuditEvent(client, {
      userId: "user-1",
      eventType: "project.created",
      metadata: { projectId: "proj-1" },
    });

    expect(from).toHaveBeenCalledWith("audit_events");
    expect(insert).toHaveBeenCalledWith({
      user_id: "user-1",
      event_type: "project.created",
      // Read out of metadata, so every existing call site writes the real
      // column without being edited (Sprint UI-2.5).
      project_id: "proj-1",
      // And the metadata key is deliberately kept: removing it would be a
      // breaking change for any other reader, disguised as a refactor.
      metadata: { projectId: "proj-1" },
    });
  });

  it("writes an explicit projectId in preference to the metadata key", async () => {
    const { client, insert } = fakeSupabase({ error: null });

    await recordAuditEvent(client, {
      userId: "user-1",
      eventType: "business_audit.completed",
      projectId: "explicit",
      metadata: { projectId: "stale-metadata" },
    });

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ project_id: "explicit" }),
    );
  });

  it("writes a null project for account-level events", async () => {
    // `github.authorization.started` happens before any project exists. A
    // NOT NULL column would force this event to invent an id.
    const { client, insert } = fakeSupabase({ error: null });

    await recordAuditEvent(client, {
      userId: "user-1",
      eventType: "github.authorization.started",
    });

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ project_id: null }));
  });

  it("reads a snake_case project_id from metadata as well as camelCase", async () => {
    // Not a style preference. Merge, approval, outcome and measurement — every
    // module from Sprint 11B onwards — spell it `project_id`. Reading only
    // `projectId` silently dropped 13 real events out of Activity, including
    // the two that record Vibe moving a customer's default branch. Found by
    // querying the deployed table, not by reading the writers.
    const { client, insert } = fakeSupabase({ error: null });

    await recordAuditEvent(client, {
      userId: "user-1",
      eventType: "change_merge.default_branch_updated",
      metadata: { project_id: "proj-snake", prepared_change_id: "pc-1" },
    });

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ project_id: "proj-snake" }),
    );
  });

  it("prefers camelCase when a caller somehow carries both", async () => {
    const { client, insert } = fakeSupabase({ error: null });

    await recordAuditEvent(client, {
      userId: "user-1",
      eventType: "change_merge.verified",
      metadata: { projectId: "camel", project_id: "snake" },
    });

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ project_id: "camel" }));
  });

  it("ignores a non-string project id in metadata rather than writing rubbish", async () => {
    const { client, insert } = fakeSupabase({ error: null });

    await recordAuditEvent(client, {
      userId: "user-1",
      eventType: "project.created",
      metadata: { projectId: 42 },
    });

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ project_id: null }));
  });

  it("defaults metadata to an empty object when omitted", async () => {
    const { client, insert } = fakeSupabase({ error: null });

    await recordAuditEvent(client, { userId: "user-1", eventType: "project.disconnected" });

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: {}, project_id: null }),
    );
  });

  it("does not throw when the insert fails — audit logging is best-effort", async () => {
    const { client } = fakeSupabase({ error: { message: "connection reset" } });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(
      recordAuditEvent(client, { userId: "user-1", eventType: "github.access.failed" }),
    ).resolves.toBeUndefined();

    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
