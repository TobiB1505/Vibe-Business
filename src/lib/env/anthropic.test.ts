import { afterEach, describe, expect, it } from "vitest";
import {
  __resetAnthropicEnvCacheForTests,
  getAnthropicEnv,
  hasAnthropicApiKey,
} from "./anthropic";

/**
 * Key validation is presence-only, and that is a deliberate correction.
 *
 * `hasAnthropicApiKey` gates UI affordances, so any shape check here can
 * silently disable a feature for a user whose key is perfectly valid. The
 * identical `bb_` check on `BROWSERBASE_API_KEY` did exactly that in
 * production — the Deep Scan button rendered as inert text. These tests exist
 * to stop the "cheap shape check" from being reintroduced.
 */

afterEach(() => {
  __resetAnthropicEnvCacheForTests();
});

describe("anthropic env", () => {
  it("accepts a key regardless of its prefix", () => {
    // A format we did not predict is the provider's business, not ours.
    for (const key of ["sk-ant-api03-real", "anthropic_live_abc", "xyz"]) {
      __resetAnthropicEnvCacheForTests();
      expect(hasAnthropicApiKey({ ANTHROPIC_API_KEY: key })).toBe(true);
      expect(getAnthropicEnv({ ANTHROPIC_API_KEY: key }).ANTHROPIC_API_KEY).toBe(key);
    }
  });

  it("rejects a missing or empty key, which is the one thing we can know", () => {
    expect(hasAnthropicApiKey({})).toBe(false);
    expect(hasAnthropicApiKey({ ANTHROPIC_API_KEY: "" })).toBe(false);
  });

  it("never echoes the key in its error message", () => {
    expect(() => getAnthropicEnv({ ANTHROPIC_API_KEY: "" })).toThrowError(/ANTHROPIC_API_KEY is required/);

    try {
      getAnthropicEnv({ ANTHROPIC_API_KEY: "" });
    } catch (error) {
      expect(String(error)).not.toContain("sk-ant");
    }
  });
});
