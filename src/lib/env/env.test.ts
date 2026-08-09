import { describe, expect, it, beforeEach } from "vitest";
import { __resetPublicEnvCacheForTests, getPublicEnv } from "./env";

describe("getPublicEnv", () => {
  beforeEach(() => {
    __resetPublicEnvCacheForTests();
  });

  it("returns parsed values when configuration is valid", () => {
    const env = getPublicEnv({
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
    });

    expect(env).toEqual({
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
    });
  });

  it("throws a descriptive error when a required variable is missing", () => {
    expect(() =>
      getPublicEnv({
        NEXT_PUBLIC_SUPABASE_URL: "",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
      }),
    ).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it("throws a descriptive error when a URL is malformed", () => {
    expect(() =>
      getPublicEnv({
        NEXT_PUBLIC_SUPABASE_URL: "not-a-url",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
      }),
    ).toThrow(/valid URL/);
  });

  it("caches the result across calls", () => {
    const first = getPublicEnv({
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
    });
    const second = getPublicEnv({
      NEXT_PUBLIC_SUPABASE_URL: "https://other.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "other-key",
    });

    expect(second).toBe(first);
  });
});
