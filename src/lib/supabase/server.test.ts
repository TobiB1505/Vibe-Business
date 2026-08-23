import { describe, expect, it, vi } from "vitest";

/**
 * The wiring test for the clock-skew retry.
 *
 * `clock-skew.test.ts` proves the wrapper behaves; this proves the client
 * actually uses it. Without this, the retry could be perfect and unreachable —
 * which is precisely the shape of the original defect: correct code, and a
 * failing screen, because the two were never connected.
 */

const createServerClientMock = vi.fn(
  (_url: string, _key: string, _options: { global?: { fetch?: unknown } }) => ({ from: vi.fn() }),
);

vi.mock("@supabase/ssr", () => ({ createServerClient: createServerClientMock }));

vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));

vi.mock("@/lib/env/env", () => ({
  getPublicEnv: () => ({
    NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  }),
}));

const { createClient } = await import("./server");

describe("the server-side Supabase client", () => {
  it("routes every request through the clock-skew retry", async () => {
    await createClient();

    const options = createServerClientMock.mock.calls[0]?.[2];

    expect(typeof options?.global?.fetch).toBe("function");
    expect((options?.global?.fetch as { name?: string })?.name).toBe(
      "fetchWithJwtClockSkewRetry",
    );
  });
});
