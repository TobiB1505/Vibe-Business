import { describe, expect, it, vi } from "vitest";
import {
  MAX_CLOCK_SKEW_RETRIES,
  bearerTokenIssuedAt,
  clockSkewDelayMs,
  isJwtIssuedAtFuture,
  serverDateSeconds,
  withJwtClockSkewRetry,
} from "./clock-skew";

/**
 * The bug these cover: PostgREST refuses a token whose `iat` is ahead of its
 * own clock, so every read in the first second of a session fails and a reload
 * appears to fix the product. See the module header for the production
 * evidence.
 */

const ISSUED_AT_FUTURE_BODY = JSON.stringify({
  code: "PGRST303",
  details: null,
  hint: null,
  message: "JWT issued at future",
});

/** A token whose payload carries `iat`, signature irrelevant — never verified. */
function bearerToken(issuedAtSeconds: number): string {
  const payload = Buffer.from(JSON.stringify({ iat: issuedAtSeconds, sub: "user-1" })).toString(
    "base64url",
  );
  return `Bearer header.${payload}.signature`;
}

function jsonResponse(status: number, body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { "content-type": "application/json", ...headers } });
}

describe("recognising the refusal", () => {
  it("recognises PostgREST refusing a not-yet-valid token", () => {
    expect(isJwtIssuedAtFuture(401, ISSUED_AT_FUTURE_BODY)).toBe(true);
  });

  it("leaves every other authentication failure alone", () => {
    const expired = JSON.stringify({ code: "PGRST301", message: "JWT expired" });
    expect(isJwtIssuedAtFuture(401, expired)).toBe(false);
  });

  it("requires the status as well as the code", () => {
    // A row that merely contains the string must not turn a 200 into a retry.
    expect(isJwtIssuedAtFuture(200, ISSUED_AT_FUTURE_BODY)).toBe(false);
  });

  it("survives a body that is not JSON", () => {
    expect(isJwtIssuedAtFuture(401, "<html>PGRST303</html>")).toBe(false);
    expect(isJwtIssuedAtFuture(401, "")).toBe(false);
  });
});

describe("reading the two clocks", () => {
  it("decodes iat from a bearer token", () => {
    expect(bearerTokenIssuedAt(bearerToken(1_800_000_000))).toBe(1_800_000_000);
  });

  it("returns null for anything that is not a decodable bearer JWT", () => {
    expect(bearerTokenIssuedAt(null)).toBeNull();
    expect(bearerTokenIssuedAt("Basic abc")).toBeNull();
    expect(bearerTokenIssuedAt("Bearer not-a-jwt")).toBeNull();
    expect(bearerTokenIssuedAt("Bearer a.!!!not-base64!!!.c")).toBeNull();
  });

  it("reads the rejecting server's own clock from its Date header", () => {
    expect(serverDateSeconds("Sun, 23 Aug 2026 21:12:17 GMT")).toBe(
      Math.floor(Date.parse("2026-08-23T21:12:17Z") / 1000),
    );
    expect(serverDateSeconds(null)).toBeNull();
    expect(serverDateSeconds("not a date")).toBeNull();
  });
});

describe("how long it waits", () => {
  it("waits the measured disagreement plus a second of margin", () => {
    // The token is two seconds ahead of the server that refused it.
    expect(
      clockSkewDelayMs({ issuedAtSeconds: 1_002, serverSeconds: 1_000, attempt: 0 }),
    ).toBe(2_000);
  });

  it("still waits the margin when the measurement rounds to zero", () => {
    // The refusal is itself evidence of a disagreement smaller than the
    // Date header's one-second resolution, so the margin is the whole wait.
    expect(clockSkewDelayMs({ issuedAtSeconds: 1_000, serverSeconds: 1_000, attempt: 0 })).toBe(
      1_000,
    );
  });

  it("never waits less than the floor, even if the skew measures negative", () => {
    expect(clockSkewDelayMs({ issuedAtSeconds: 1_000, serverSeconds: 1_005, attempt: 0 })).toBe(250);
  });

  it("never blocks a render for longer than the cap", () => {
    expect(
      clockSkewDelayMs({ issuedAtSeconds: 1_060, serverSeconds: 1_000, attempt: 0 }),
    ).toBe(2_000);
  });

  it("falls back to a fixed schedule when a timestamp is missing", () => {
    expect(clockSkewDelayMs({ issuedAtSeconds: null, serverSeconds: 1_000, attempt: 0 })).toBe(600);
    expect(clockSkewDelayMs({ issuedAtSeconds: 1_000, serverSeconds: null, attempt: 1 })).toBe(1_500);
  });
});

describe("the wrapped fetch", () => {
  const sleep = vi.fn(async () => {});

  function wrap(responses: Response[], onRetry = vi.fn()) {
    const calls: { input: RequestInfo | URL; init?: RequestInit }[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      return responses[Math.min(calls.length - 1, responses.length - 1)];
    }) as unknown as typeof fetch;

    return { fetch: withJwtClockSkewRetry({ fetch: fetchImpl, sleep, onRetry }), calls, onRetry };
  }

  it("passes a successful response straight through", async () => {
    const { fetch, calls } = wrap([jsonResponse(200, "[]")]);

    const response = await fetch("https://project.supabase.co/rest/v1/projects");

    expect(response.status).toBe(200);
    expect(calls).toHaveLength(1);
  });

  it("retries once and returns the response that succeeded", async () => {
    const { fetch, calls, onRetry } = wrap([
      jsonResponse(401, ISSUED_AT_FUTURE_BODY, { date: "Sun, 23 Aug 2026 21:12:16 GMT" }),
      jsonResponse(200, '[{"id":"p1"}]'),
    ]);

    const response = await fetch("https://project.supabase.co/rest/v1/projects", {
      headers: { authorization: bearerToken(Math.floor(Date.parse("2026-08-23T21:12:17Z") / 1000)) },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([{ id: "p1" }]);
    expect(calls).toHaveLength(2);
    // One second of measured skew, plus the one-second margin.
    expect(onRetry).toHaveBeenCalledWith({ attempt: 1, delayMs: 2_000, skewSeconds: 1 });
  });

  it("gives up after a bounded number of attempts and returns the real failure", async () => {
    const { fetch, calls } = wrap([jsonResponse(401, ISSUED_AT_FUTURE_BODY)]);

    const response = await fetch("https://project.supabase.co/rest/v1/projects");

    expect(response.status).toBe(401);
    // The caller still sees the untouched body, not one consumed by the check.
    expect(await response.json()).toMatchObject({ code: "PGRST303" });
    expect(calls).toHaveLength(MAX_CLOCK_SKEW_RETRIES + 1);
  });

  it("does not retry any other failure", async () => {
    const { fetch, calls } = wrap([
      jsonResponse(401, JSON.stringify({ code: "PGRST301", message: "JWT expired" })),
    ]);

    const response = await fetch("https://project.supabase.co/rest/v1/projects");

    expect(response.status).toBe(401);
    expect(calls).toHaveLength(1);
  });

  it("refuses to replay a request whose body cannot be sent twice", async () => {
    // A half-read stream replayed onto a write is worse than the error being
    // avoided, so this case is left to fail honestly.
    const { fetch, calls } = wrap([jsonResponse(401, ISSUED_AT_FUTURE_BODY)]);

    const response = await fetch("https://project.supabase.co/rest/v1/projects", {
      method: "POST",
      body: new ReadableStream(),
    } as RequestInit);

    expect(response.status).toBe(401);
    expect(calls).toHaveLength(1);
  });

  it("replays a write, because the token was refused before anything ran", async () => {
    // PGRST303 is a refusal to begin: no transaction, no row, no charge.
    const { fetch, calls } = wrap([
      jsonResponse(401, ISSUED_AT_FUTURE_BODY),
      jsonResponse(201, '{"id":"p1"}'),
    ]);

    const response = await fetch("https://project.supabase.co/rest/v1/projects", {
      method: "POST",
      body: JSON.stringify({ name: "New project" }),
    });

    expect(response.status).toBe(201);
    expect(calls).toHaveLength(2);
    expect(calls[1].init?.body).toBe(JSON.stringify({ name: "New project" }));
  });
});
