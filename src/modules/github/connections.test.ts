import { describe, expect, it, vi } from "vitest";
import { getVerifiedInstallation, listVerifiedInstallations } from "./connections";
import type { SupabaseClient } from "@supabase/supabase-js";

const ROW = {
  id: "installation-row-1",
  installation_id: 42,
  github_account_login: "octocat",
  account_type: "User" as const,
};

function fakeSupabase(result: { data: unknown; error: unknown }) {
  const calls: { method: string; args: unknown[] }[] = [];

  const chain = {
    select: (...args: unknown[]) => {
      calls.push({ method: "select", args });
      return chain;
    },
    eq: (...args: unknown[]) => {
      calls.push({ method: "eq", args });
      return chain;
    },
    order: (...args: unknown[]) => {
      calls.push({ method: "order", args });
      return Promise.resolve(result) as never;
    },
    maybeSingle: async () => result,
  };

  const from = vi.fn(() => chain);
  return { client: { from } as unknown as SupabaseClient, from, calls };
}

function eqCalls(calls: { method: string; args: unknown[] }[]) {
  return calls.filter((call) => call.method === "eq").map((call) => call.args);
}

describe("listVerifiedInstallations", () => {
  it("maps rows onto the domain record", async () => {
    const { client } = fakeSupabase({ data: [ROW], error: null });

    expect(await listVerifiedInstallations(client, "user-1")).toEqual([
      {
        id: "installation-row-1",
        installationId: 42,
        accountLogin: "octocat",
        accountType: "User",
        // Null is "nothing observed", never "confirmed working" (VB-041).
        accessRevokedAt: null,
      },
    ]);
  });

  it("scopes the query to the session user", async () => {
    const { client, from, calls } = fakeSupabase({ data: [], error: null });

    await listVerifiedInstallations(client, "user-1");

    expect(from).toHaveBeenCalledWith("github_installations");
    expect(eqCalls(calls)).toContainEqual(["user_id", "user-1"]);
  });

  it("returns an empty list when the user has no installations", async () => {
    const { client } = fakeSupabase({ data: null, error: null });
    expect(await listVerifiedInstallations(client, "user-1")).toEqual([]);
  });

  it("throws when the query fails rather than pretending there are none", async () => {
    const { client } = fakeSupabase({ data: null, error: { message: "boom" } });
    await expect(listVerifiedInstallations(client, "user-1")).rejects.toBeTruthy();
  });
});

describe("getVerifiedInstallation", () => {
  it("returns the installation when it belongs to the user", async () => {
    const { client } = fakeSupabase({ data: ROW, error: null });

    expect(await getVerifiedInstallation(client, "user-1", "installation-row-1")).toEqual({
      id: "installation-row-1",
      installationId: 42,
      accountLogin: "octocat",
      accountType: "User",
      accessRevokedAt: null,
    });
  });

  // Another user's installation row id must never resolve, even if the
  // id is guessed or copied from elsewhere.
  it("filters by both row id and user id", async () => {
    const { client, calls } = fakeSupabase({ data: null, error: null });

    await getVerifiedInstallation(client, "user-1", "installation-row-1");

    const filters = eqCalls(calls);
    expect(filters).toContainEqual(["id", "installation-row-1"]);
    expect(filters).toContainEqual(["user_id", "user-1"]);
  });

  it("returns null for an installation the user does not own", async () => {
    const { client } = fakeSupabase({ data: null, error: null });
    expect(await getVerifiedInstallation(client, "attacker", "installation-row-1")).toBeNull();
  });
});
