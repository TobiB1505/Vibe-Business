import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The wiring test for the two fetch layers this client installs.
 *
 * `clock-skew.test.ts` and `net/bounded-fetch.test.ts` prove the wrappers
 * behave; this proves the client actually uses them. Without it, either could
 * be perfect and unreachable — which is precisely the shape of the original
 * defect: correct code, and a failing screen, because the two were never
 * connected.
 *
 * It asserts behaviour rather than a function name. The name was a proxy for
 * "the retry is installed", and it stopped being one the moment a second
 * wrapper (VB-031's deadline) went around it — a composition that is correct
 * and would have failed a name check. What is actually load-bearing is that a
 * `PGRST303` still gets retried and that every request still carries a
 * deadline, so those are what is checked.
 */

const createServerClientMock = vi.fn(
  (_url: string, _key: string, _options: { global?: { fetch?: typeof fetch } }) => ({
    from: vi.fn(),
  }),
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

const REAL_FETCH = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = REAL_FETCH;
  createServerClientMock.mockClear();
});

/** The `fetch` the client was actually constructed with. */
async function installedFetch(): Promise<typeof fetch> {
  await createClient();
  const installed = createServerClientMock.mock.calls[0]?.[2]?.global?.fetch;
  expect(typeof installed).toBe("function");
  return installed as typeof fetch;
}

describe("the server-side Supabase client", () => {
  it("routes every request through the clock-skew retry", async () => {
    const responses = [
      new Response(JSON.stringify({ code: "PGRST303", message: "JWT issued at future" }), {
        status: 401,
      }),
      new Response("[]", { status: 200 }),
    ];
    const underlying = vi.fn(async () => responses.shift() as Response);
    globalThis.fetch = underlying as unknown as typeof fetch;

    const response = await (await installedFetch())("https://project.supabase.co/rest/v1/projects");

    expect(response.status).toBe(200);
    // The retry happened, which is the whole point: without the wrapper the
    // 401 would have been returned as-is.
    expect(underlying).toHaveBeenCalledTimes(2);
  });

  it("gives every request a deadline, even one the caller did not bound", async () => {
    const seen: (AbortSignal | null | undefined)[] = [];
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(init?.signal);
      return new Response("[]", { status: 200 });
    }) as unknown as typeof fetch;

    await (await installedFetch())("https://project.supabase.co/rest/v1/projects");

    expect(seen[0]).toBeInstanceOf(AbortSignal);
  });

  /**
   * The deadline is the outer layer, so it bounds the whole sequence including
   * the clock-skew retry's own wait. Inverted, a retry could restart the clock
   * indefinitely and the timeout would bound nothing.
   */
  it("keeps the deadline around the retry, not inside it", async () => {
    const seen: (AbortSignal | null | undefined)[] = [];
    const responses = [
      new Response(JSON.stringify({ code: "PGRST303", message: "JWT issued at future" }), {
        status: 401,
      }),
      new Response("[]", { status: 200 }),
    ];
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(init?.signal);
      return responses.shift() as Response;
    }) as unknown as typeof fetch;

    await (await installedFetch())("https://project.supabase.co/rest/v1/projects");

    expect(seen).toHaveLength(2);
    // The same deadline covers the replay: a new one per attempt would mean the
    // retry bought itself a fresh fifteen seconds.
    expect(seen[1]).toBe(seen[0]);
  });
});
