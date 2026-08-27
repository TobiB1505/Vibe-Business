import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { scrubErrorEvent } from "./scrub";

/**
 * VB-021 — what an error event may carry out of this process.
 *
 * The tests are written as the disclosure they prevent, not as the shape of the
 * output: each one is a thing Sentry would have received.
 */

describe("the request", () => {
  it("does not carry the payload a Server Action was called with", () => {
    const scrubbed = scrubErrorEvent({
      request: {
        url: "https://app.example.com/app/projects/abc",
        method: "POST",
        data: { email: "founder@example.com", password: "hunter2" },
      },
    });

    expect(JSON.stringify(scrubbed)).not.toContain("founder@example.com");
    expect(JSON.stringify(scrubbed)).not.toContain("hunter2");
    // ...while the part a person reads survives.
    expect((scrubbed?.request as { method?: string }).method).toBe("POST");
  });

  it("does not carry cookies, which are bearer tokens for an account", () => {
    const scrubbed = scrubErrorEvent({
      request: { cookies: { "sb-access-token": "eyJhbGciOiJIUzI1NiJ9.body.sig" } },
    });

    expect(JSON.stringify(scrubbed)).not.toContain("sb-access-token");
  });

  it("does not carry an Authorization or apikey header, whatever their case", () => {
    const scrubbed = scrubErrorEvent({
      request: {
        headers: {
          Authorization: "Bearer ghp_0123456789abcdef0123456789abcdef",
          APIKey: "some-publishable-key",
          "user-agent": "Mozilla/5.0",
        },
      },
    });

    const headers = (scrubbed?.request as { headers: Record<string, string> }).headers;
    expect(headers).toEqual({ "user-agent": "Mozilla/5.0" });
  });

  /**
   * Query strings routinely carry tokens, addresses and tracking identifiers —
   * the reasoning rule 37 applies to fetched web content, applied to our own
   * URLs. The path is what localises a bug; the query is what leaks.
   */
  it("keeps the path and drops the query string", () => {
    const scrubbed = scrubErrorEvent({
      request: { url: "https://app.example.com/auth/confirm?token_hash=abc123&email=a@b.com" },
    });

    expect((scrubbed?.request as { url: string }).url).toBe("https://app.example.com/auth/confirm");
  });

  /**
   * Rebuilt rather than edited, so a field Sentry adds in a later version is
   * absent by default instead of forwarded because nobody deleted it.
   */
  it("drops a sensitive field nobody has heard of yet", () => {
    const scrubbed = scrubErrorEvent({
      request: { url: "https://app.example.com/x", data: { a: 1 }, query_string: "t=secret" },
    });

    expect(Object.keys(scrubbed?.request as object).sort()).toEqual(["url"]);
  });
});

describe("what cannot be dropped is redacted", () => {
  it("removes a credential from a message and keeps the sentence", () => {
    const scrubbed = scrubErrorEvent({
      message: "request rejected using sk-ant-api03-AAAAAAAAAAAAAAAA",
    });

    expect(scrubbed?.message).toBe("request rejected using [redacted]");
  });

  it("reaches a credential nested inside an exception's stack frames", () => {
    const scrubbed = scrubErrorEvent({
      exception: {
        values: [
          {
            value: "fetch failed",
            stacktrace: { frames: [{ vars: { token: "ghp_0123456789abcdef0123456789abcdef" } }] },
          },
        ],
      },
    });

    expect(JSON.stringify(scrubbed)).not.toContain("ghp_");
    expect(JSON.stringify(scrubbed)).toContain("fetch failed");
  });

  it("reaches breadcrumbs, which is where a fetch URL usually is", () => {
    const scrubbed = scrubErrorEvent({
      breadcrumbs: [{ data: { url: "https://x.test/?k=sk_live_ABCDEFGHIJKL" } }],
    });

    expect(JSON.stringify(scrubbed)).not.toContain("sk_live_");
  });
});

describe("failure", () => {
  /**
   * Losing an error report is a cost; sending an unscrubbed one to a third
   * party is a disclosure. Between the two there is no argument for the second.
   */
  it("drops the event rather than sending it unscrubbed", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const hostile = {
      get message(): string {
        throw new Error("boom");
      },
    };

    expect(scrubErrorEvent(hostile as never)).toBeNull();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("treats a missing event as nothing to send", () => {
    expect(scrubErrorEvent(null)).toBeNull();
    expect(scrubErrorEvent(undefined)).toBeNull();
  });

  /** A cyclic event must not take the process down on the error path. */
  it("survives a cycle", () => {
    const cyclic: Record<string, unknown> = { message: "x" };
    cyclic.self = cyclic;

    expect(() => scrubErrorEvent(cyclic)).not.toThrow();
  });
});

describe("every Sentry runtime is wired", () => {
  /**
   * Three inits, and a scrubber installed in two of them is the failure that
   * looks fine — the events that leak are the ones from the runtime nobody
   * checked.
   */
  it.each([
    "sentry.server.config.ts",
    "sentry.edge.config.ts",
    "instrumentation-client.ts",
  ])("%s calls the scrubber", (file) => {
    const source = readFileSync(join(process.cwd(), "src", file), "utf8");

    expect(source).toContain("scrubErrorEvent");
    expect(source).toMatch(/beforeSend:/);
  });
});
