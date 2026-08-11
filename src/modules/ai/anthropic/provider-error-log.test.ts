import { describe, expect, it, vi } from "vitest";

import {
  extractProviderMessage,
  isProviderErrorLoggingEnabled,
  logRejectedProviderRequest,
  type RejectedRequestLogDetail,
} from "./provider-error-log";

const diagnostic = {
  httpStatus: 400,
  providerErrorType: "invalid_request_error",
  requestId: "req_011CdtzcxN1sicjdpxQYyWTz",
} as const;

/** A shape-compatible stand-in for an SDK APIError, without the SDK. */
function apiError(structuredMessage: string | null, composite = "400 status error") {
  return {
    status: 400,
    message: composite,
    ...(structuredMessage === null
      ? {}
      : { error: { type: "invalid_request_error", message: structuredMessage } }),
  };
}

describe("isProviderErrorLoggingEnabled", () => {
  it("is off in production by default, so ordinary behaviour is unchanged", () => {
    expect(isProviderErrorLoggingEnabled({ NODE_ENV: "production" })).toBe(false);
  });

  it("is on in production only when explicitly opted in", () => {
    expect(
      isProviderErrorLoggingEnabled({ NODE_ENV: "production", AI_DEBUG_PROVIDER_ERRORS: "1" }),
    ).toBe(true);
  });

  it("ignores a flag value other than the exact opt-in", () => {
    expect(
      isProviderErrorLoggingEnabled({ NODE_ENV: "production", AI_DEBUG_PROVIDER_ERRORS: "true" }),
    ).toBe(false);
  });

  it("is on outside production, where diagnosing is the point", () => {
    expect(isProviderErrorLoggingEnabled({ NODE_ENV: "development" })).toBe(true);
    expect(isProviderErrorLoggingEnabled({})).toBe(true);
  });

  it("is off under test, so rejection assertions do not emit console noise", () => {
    expect(isProviderErrorLoggingEnabled({ NODE_ENV: "test" })).toBe(false);
    expect(
      isProviderErrorLoggingEnabled({ NODE_ENV: "test", AI_DEBUG_PROVIDER_ERRORS: "1" }),
    ).toBe(true);
  });
});

/**
 * The shape the SDK actually produced on the 2026-08-11 rejection: `.error`
 * is the parsed *body*, so the provider message is one level deeper than a
 * naive lookup expects, and `.message` is the composite `"400 {...}"` form.
 */
function sdkCompositeError(providerMessage: string) {
  const body = {
    type: "error",
    error: { type: "invalid_request_error", message: providerMessage },
    request_id: "req_011CdwEyahFVgLpqzLEDPgW3",
  };
  return {
    status: 400,
    type: "invalid_request_error",
    requestID: "req_011CdwEyahFVgLpqzLEDPgW3",
    // What the SDK puts on Error.message: status prefix + whole body.
    message: `400 ${JSON.stringify(body)}`,
    error: body,
  };
}

describe("extractProviderMessage", () => {
  it("reads the provider message out of the SDK's real nesting, without the body", () => {
    const error = sdkCompositeError("The compiled grammar is too large.");
    const message = extractProviderMessage(error);

    expect(message).toBe("The compiled grammar is too large.");
    // The regression: the body reached the log because the fallback took over.
    expect(message).not.toContain('{"type":"error"');
    expect(message).not.toContain("request_id");
    expect(message).not.toMatch(/^400 /);
  });

  it("reads a message nested only one level deep too", () => {
    const message = extractProviderMessage(
      apiError("output_config.format.schema: unsupported keyword"),
    );
    expect(message).toBe("output_config.format.schema: unsupported keyword");
  });

  it("returns null rather than falling back to a composite message", () => {
    // No structured body at all: the composite message is the only thing
    // present, and it must not be used — that is the leak being regressed.
    expect(extractProviderMessage(apiError(null, '400 {"type":"error","error":{}}'))).toBeNull();
    expect(extractProviderMessage(apiError(null, "Connection error"))).toBeNull();
  });

  it("rejects a body-shaped string even when it arrives via the structured field", () => {
    expect(extractProviderMessage(apiError('{"type":"error","error":{"message":"x"}}'))).toBeNull();
    expect(extractProviderMessage(apiError('400 {"type":"error"}'))).toBeNull();
    expect(extractProviderMessage(apiError('[{"role":"user"}]'))).toBeNull();
  });

  it("collapses newlines so one rejection is one log line", () => {
    expect(extractProviderMessage(apiError("line one\n  line two\ttab"))).toBe(
      "line one line two tab",
    );
  });

  it("caps length rather than letting a body-sized message through", () => {
    const message = extractProviderMessage(apiError("x".repeat(1000)));
    expect(message).toMatch(/… \[truncated\]$/);
    expect(message!.length).toBeLessThan(450);
  });

  it("redacts anything shaped like an API key", () => {
    const message = extractProviderMessage(apiError("bad key sk-ant-api03-SECRETVALUE rejected"));
    expect(message).toBe("bad key [redacted] rejected");
    expect(message).not.toContain("SECRETVALUE");
  });

  it("returns null for values carrying no message at all", () => {
    expect(extractProviderMessage(null)).toBeNull();
    expect(extractProviderMessage("a bare string")).toBeNull();
    expect(extractProviderMessage({ error: { message: "   " } })).toBeNull();
  });
});

describe("logRejectedProviderRequest", () => {
  it("emits exactly the four diagnostic fields and nothing else", () => {
    const sink = vi.fn();
    logRejectedProviderRequest(apiError("messages.0: invalid"), diagnostic, {
      env: { NODE_ENV: "development" },
      sink,
    });

    expect(sink).toHaveBeenCalledTimes(1);
    const detail = sink.mock.calls[0]![1] as RejectedRequestLogDetail;
    expect(Object.keys(detail).sort()).toEqual([
      "httpStatus",
      "providerErrorType",
      "providerMessage",
      "requestId",
    ]);
    expect(detail).toEqual({
      httpStatus: 400,
      providerErrorType: "invalid_request_error",
      requestId: "req_011CdtzcxN1sicjdpxQYyWTz",
      providerMessage: "messages.0: invalid",
    });
  });

  it("stays silent in production unless opted in", () => {
    const sink = vi.fn();
    logRejectedProviderRequest(apiError("field rejected"), diagnostic, {
      env: { NODE_ENV: "production" },
      sink,
    });
    expect(sink).not.toHaveBeenCalled();
  });

  it("never logs the request, prompt, evidence, or headers — they are not reachable", () => {
    const sink = vi.fn();
    const error = {
      ...apiError("schema rejected"),
      headers: { authorization: "Bearer sk-ant-secret" },
      request: { messages: [{ role: "user", content: "EVIDENCE PACK BODY" }] },
    };

    logRejectedProviderRequest(error, diagnostic, { env: { NODE_ENV: "development" }, sink });

    const serialized = JSON.stringify(sink.mock.calls[0]);
    expect(serialized).not.toContain("EVIDENCE PACK BODY");
    expect(serialized).not.toContain("sk-ant-secret");
    expect(serialized).not.toContain("authorization");
  });

  it("cannot leak a composite SDK error's raw body, even one echoing the prompt", () => {
    const sink = vi.fn();
    const body = {
      type: "error",
      error: { type: "invalid_request_error", message: "messages.0.content: too long" },
      // A body that echoes what we sent is the worst case for this channel.
      request_echo: { messages: [{ role: "user", content: "EVIDENCE PACK BODY" }] },
    };
    const error = { status: 400, message: `400 ${JSON.stringify(body)}`, error: body };

    logRejectedProviderRequest(error, diagnostic, { env: { NODE_ENV: "development" }, sink });

    const detail = sink.mock.calls[0]![1] as RejectedRequestLogDetail;
    expect(detail.providerMessage).toBe("messages.0.content: too long");

    const serialized = JSON.stringify(sink.mock.calls[0]);
    expect(serialized).not.toContain("EVIDENCE PACK BODY");
    expect(serialized).not.toContain("request_echo");
    expect(serialized).not.toContain('{"type":"error"');
  });

  it("does not throw when the sink fails: a diagnostic cannot break an audit", () => {
    const sink = vi.fn(() => {
      throw new Error("log transport down");
    });
    expect(() =>
      logRejectedProviderRequest(apiError("x"), diagnostic, {
        env: { NODE_ENV: "development" },
        sink,
      }),
    ).not.toThrow();
  });
});
