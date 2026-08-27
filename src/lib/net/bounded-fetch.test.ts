import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { withBoundedFetch } from "./bounded-fetch";

/**
 * VB-031 — a hang is bounded, and a retry never becomes a second write.
 *
 * The second half is the one worth the tests. A retry helper that is right
 * about timeouts and wrong about methods turns rule 73's "read the external
 * state, never send it again" into "send it again", on the paths that push
 * commits and move a default branch.
 */

const noSleep = async () => {};

function response(status: number) {
  return new Response(null, { status });
}

describe("the deadline", () => {
  it("gives up on a socket that goes quiet", async () => {
    const hang = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );

    const bounded = withBoundedFetch({ timeoutMs: 20, sleep: noSleep }, hang as typeof fetch);

    await expect(bounded("https://api.github.test/x")).rejects.toThrow();
  });

  /**
   * A caller's own cancellation must still cancel. The deadline is an
   * additional reason to stop, never a replacement for the one passed in.
   */
  it("keeps the caller's signal alongside its own", async () => {
    const seen: (AbortSignal | null | undefined)[] = [];
    const inner = vi.fn(async (_i: RequestInfo | URL, init?: RequestInit) => {
      seen.push(init?.signal);
      return response(200);
    });

    const controller = new AbortController();
    const bounded = withBoundedFetch({ timeoutMs: 50, sleep: noSleep }, inner as typeof fetch);
    await bounded("https://api.github.test/x", { signal: controller.signal });

    expect(seen[0]).toBeInstanceOf(AbortSignal);
    expect(seen[0]).not.toBe(controller.signal);
  });

  it("does not retry a deliberate cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    const inner = vi.fn(async () => {
      throw new Error("aborted");
    });

    const bounded = withBoundedFetch(
      { timeoutMs: 50, retries: 3, sleep: noSleep },
      inner as unknown as typeof fetch,
    );

    await expect(
      bounded("https://api.github.test/x", { signal: controller.signal }),
    ).rejects.toThrow();
    expect(inner).toHaveBeenCalledTimes(1);
  });
});

describe("what may be retried", () => {
  it("retries a read that could not reach the host", async () => {
    let calls = 0;
    const inner = vi.fn(async () => {
      calls += 1;
      if (calls < 3) throw new Error("ECONNRESET");
      return response(200);
    });

    const bounded = withBoundedFetch(
      { timeoutMs: 50, retries: 2, sleep: noSleep },
      inner as unknown as typeof fetch,
    );

    expect((await bounded("https://api.github.test/x")).status).toBe(200);
    expect(calls).toBe(3);
  });

  it.each([502, 503, 504])("retries a read behind a %i", async (status) => {
    let calls = 0;
    const inner = vi.fn(async () => {
      calls += 1;
      return calls < 2 ? response(status) : response(200);
    });

    const bounded = withBoundedFetch(
      { timeoutMs: 50, retries: 2, sleep: noSleep },
      inner as unknown as typeof fetch,
    );

    expect((await bounded("https://api.github.test/x")).status).toBe(200);
  });

  it("stops after the allowance and returns what it last got", async () => {
    const inner = vi.fn(async () => response(503));
    const bounded = withBoundedFetch(
      { timeoutMs: 50, retries: 2, sleep: noSleep },
      inner as unknown as typeof fetch,
    );

    expect((await bounded("https://api.github.test/x")).status).toBe(503);
    expect(inner).toHaveBeenCalledTimes(3);
  });
});

describe("what must never be retried", () => {
  /**
   * The property this file exists for. A `POST` that creates a branch, a
   * `PATCH` that fast-forwards a default branch — sending either twice is the
   * failure rules 50 and 73 forbid, and the method is what decides, not a flag
   * a caller might forget.
   */
  it.each(["POST", "PATCH", "PUT", "DELETE"])("sends a %s exactly once", async (method) => {
    const inner = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });

    const bounded = withBoundedFetch(
      { timeoutMs: 50, retries: 5, sleep: noSleep },
      inner as unknown as typeof fetch,
    );

    await expect(bounded("https://api.github.test/x", { method })).rejects.toThrow();
    expect(inner).toHaveBeenCalledTimes(1);
  });

  it("reads the method off a Request object too, not only off init", async () => {
    const inner = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });

    const bounded = withBoundedFetch(
      { timeoutMs: 50, retries: 5, sleep: noSleep },
      inner as unknown as typeof fetch,
    );

    const request = new Request("https://api.github.test/x", { method: "POST" });
    await expect(bounded(request)).rejects.toThrow();
    expect(inner).toHaveBeenCalledTimes(1);
  });

  /** Retrying a rate limit is how a rate limit becomes a ban. */
  it("does not retry a 429", async () => {
    const inner = vi.fn(async () => response(429));
    const bounded = withBoundedFetch(
      { timeoutMs: 50, retries: 3, sleep: noSleep },
      inner as unknown as typeof fetch,
    );

    expect((await bounded("https://api.github.test/x")).status).toBe(429);
    expect(inner).toHaveBeenCalledTimes(1);
  });

  it.each([400, 401, 403, 404, 422, 500])("does not retry a %i", async (status) => {
    const inner = vi.fn(async () => response(status));
    const bounded = withBoundedFetch(
      { timeoutMs: 50, retries: 3, sleep: noSleep },
      inner as unknown as typeof fetch,
    );

    expect((await bounded("https://api.github.test/x")).status).toBe(status);
    expect(inner).toHaveBeenCalledTimes(1);
  });
});

describe("the backoff", () => {
  it("waits between attempts, within the cap", async () => {
    const waits: number[] = [];
    const inner = vi.fn(async () => response(503));

    const bounded = withBoundedFetch(
      {
        timeoutMs: 50,
        retries: 3,
        backoffBaseMs: 100,
        backoffMaxMs: 400,
        sleep: async (ms) => {
          waits.push(ms);
        },
      },
      inner as unknown as typeof fetch,
    );

    await bounded("https://api.github.test/x");

    expect(waits).toHaveLength(3);
    for (const wait of waits) {
      expect(wait).toBeGreaterThanOrEqual(0);
      expect(wait).toBeLessThanOrEqual(400);
    }
  });

  it("reports each retry without naming a URL, header or body", async () => {
    const seen: { attempt: number; delayMs: number; reason: string }[] = [];
    const inner = vi.fn(async () => response(503));

    const bounded = withBoundedFetch(
      { timeoutMs: 50, retries: 1, sleep: noSleep, onRetry: (info) => seen.push(info) },
      inner as unknown as typeof fetch,
    );

    await bounded("https://api.github.test/secret-path?token=abc");

    expect(seen).toEqual([{ attempt: 1, delayMs: expect.any(Number), reason: "status_503" }]);
  });
});

describe("every outbound client is bounded", () => {
  /**
   * Three clients, and a deadline on two of them is the failure that looks
   * fine — the hang comes from the one nobody wrapped.
   */
  it.each([
    join("lib", "supabase", "service.ts"),
    join("lib", "supabase", "server.ts"),
    join("modules", "github", "app-client.ts"),
  ])("%s installs the bounded fetch", (file) => {
    const source = readFileSync(join(process.cwd(), "src", file), "utf8");
    expect(source).toContain("withBoundedFetch");
  });

  /** Both Octokit factories, not just the installation one. */
  it("bounds the user-token Octokit as well as the installation one", () => {
    const source = readFileSync(
      join(process.cwd(), "src", "modules", "github", "app-client.ts"),
      "utf8",
    );
    expect(source.match(/request: boundedRequest\(\)/g)).toHaveLength(2);
  });
});
