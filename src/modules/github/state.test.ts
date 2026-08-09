import { describe, expect, it, vi } from "vitest";
import { createConnectState, verifyConnectState } from "./state";

const SECRET = "test-client-secret";
const USER_ID = "11111111-1111-1111-1111-111111111111";

describe("connect state", () => {
  it("round-trips: a freshly created state verifies for the same user", () => {
    const state = createConnectState(USER_ID, SECRET);
    expect(verifyConnectState(state, SECRET, USER_ID)).toEqual({ ok: true });
  });

  it("produces unpredictable values across calls", () => {
    const a = createConnectState(USER_ID, SECRET);
    const b = createConnectState(USER_ID, SECRET);
    expect(a).not.toBe(b);
  });

  it("rejects a state signed for a different user", () => {
    const state = createConnectState(USER_ID, SECRET);
    const result = verifyConnectState(state, SECRET, "22222222-2222-2222-2222-222222222222");
    expect(result).toEqual({ ok: false, reason: "user_mismatch" });
  });

  it("rejects a state signed with a different secret", () => {
    const state = createConnectState(USER_ID, SECRET);
    const result = verifyConnectState(state, "wrong-secret", USER_ID);
    expect(result).toEqual({ ok: false, reason: "invalid_signature" });
  });

  it("rejects a tampered payload", () => {
    const state = createConnectState(USER_ID, SECRET);
    const [, signature] = state.split(".");
    const tamperedPayload = Buffer.from(
      JSON.stringify({ uid: "attacker", nonce: "x", iat: Date.now() }),
      "utf8",
    ).toString("base64url");
    const result = verifyConnectState(`${tamperedPayload}.${signature}`, SECRET, USER_ID);
    expect(result).toEqual({ ok: false, reason: "invalid_signature" });
  });

  it("rejects a malformed state", () => {
    expect(verifyConnectState("not-a-valid-state", SECRET, USER_ID)).toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  it("rejects an expired state", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(0);
      const state = createConnectState(USER_ID, SECRET);
      vi.setSystemTime(11 * 60 * 1000); // 11 minutes later, past the 10-minute TTL
      expect(verifyConnectState(state, SECRET, USER_ID)).toEqual({ ok: false, reason: "expired" });
    } finally {
      vi.useRealTimers();
    }
  });
});
