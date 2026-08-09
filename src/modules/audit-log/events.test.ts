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
      metadata: { projectId: "proj-1" },
    });
  });

  it("defaults metadata to an empty object when omitted", async () => {
    const { client, insert } = fakeSupabase({ error: null });

    await recordAuditEvent(client, { userId: "user-1", eventType: "project.disconnected" });

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: {} }),
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
